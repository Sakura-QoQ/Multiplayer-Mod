using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FallenFlower.MultiplayerBridge;
using Microsoft.Win32;

namespace FallenFlower.MultiplayerBridgeHost;

internal static class Program
{
    private const string RegistryPath = @"Software\DefaultCompany\FallenFlower";
    private const string CommandValueName = "MPB.IpcCommand";
    private const string SequenceValueName = "MPB.IpcCommandSequence";
    private const int ProtocolVersion = 8;
    private const int MaxRetainedEvents = 128;
    private const string OnlineSavePrefix = "MPOnline_";
    private const string ActiveSavePrefix = "MPActive_";
    private const string OnlineSaveMagic = "MPB2";
    private const string ModEncryptionPassword = "FallenFlower.PlayerHostedMultiplayer.Save.v1";
    private const string GameEncryptionPassword = "Encrypt";
    private const string DefaultLogCommandMarker = "[PlayerHostedMultiplayerIPC]";
    private const int ModKeyIterations = 120_000;
    private const int GameKeyIterations = 10_000;
    private const int StateSlotCount = 3;
    private const int StateSlotMilliseconds = 100;

    private static readonly BridgeNode Node = new();
    private static readonly List<StateEvent> Events = [];
    private static readonly object StateLock = new();
    private static long _eventSequence;
    private static int _responseSequence;
    private static string _response = string.Empty;
    private static readonly Dictionary<string, string> ProtectedHashes = new(StringComparer.OrdinalIgnoreCase);
    private static string _activeOnlineSaveName = string.Empty;
    private static string _activeSaveDirectory = string.Empty;
    private static byte[]? _singlePlayerAutoSaveBackup;
    private static bool _singlePlayerAutoSaveExisted;
    private static string _autoSaveObservedHash = string.Empty;
    private static long _gameLogPosition;
    private static string _gameLogRemainder = string.Empty;
    private static string _channel = "default";
    private static string _commandValueName = CommandValueName;
    private static string _sequenceValueName = SequenceValueName;
    private static string _logCommandMarker = DefaultLogCommandMarker;
    private static string? _gameLogPathOverride;
    private static bool _networkOnly;
    private static DateTime _lastClientTouchUtc;
    private static bool _clientTouchSeen;
    private static readonly StringBuilder RawSaveBuffer = new();
    private static readonly byte[] GameEncryptionSalt = [0x04, 0x08, 0x41, 0x20, 0x49, 0x24, 0x00, 0x6d];
    private static int _rawSaveExpectedChunks;
    private static int _rawSaveReceivedChunks;

    private static async Task Main(string[] args)
    {
        if (args.Contains("--self-test-save-crypto", StringComparer.OrdinalIgnoreCase))
        {
            SelfTestOnlineSaveCrypto();
            return;
        }
        ConfigureInstance(args);
        // 默认通道仍保持单例。测试通道按名称隔离，允许在同一台电脑运行两个真实游戏进程，
        // 分别拥有自己的桥接状态和 IPC，不改变普通玩家的一机一桥行为。
        // Mutex 构造函数的 out 参数只表示“是否新建内核对象”，不表示当前进程是否持有锁；
        // 因此必须显式 WaitOne，才能正确处理残留句柄和上次进程异常退出后的 abandoned 状态。
        var mutexName = @"Local\FallenFlower.PlayerHostedMultiplayer" +
            (_channel == "default" ? string.Empty : "." + _channel);
        using var singleton = new Mutex(false, mutexName);
        var ownsMutex = false;
        try
        {
            ownsMutex = singleton.WaitOne(0, false);
        }
        catch (AbandonedMutexException)
        {
            ownsMutex = true;
        }
        if (!ownsMutex) return;

        var bridgeDirectory = AppContext.BaseDirectory;
        var statePath = Path.Combine(bridgeDirectory,
            _channel == "default" ? "state.json" : $"state.{_channel}.json");
        using var registry = Registry.CurrentUser.CreateSubKey(RegistryPath, true);
        if (registry is null) return;

        var lastCommandSequence = ReadInt(registry, _sequenceValueName);
        var startedAt = Stopwatch.StartNew();
        var gameWasSeen = false;
        var noProcessSince = Stopwatch.StartNew();
        var saveProtectionTimer = Stopwatch.StartNew();
        var stateWriteTimer = Stopwatch.StartNew();
        InitializeGameLogPosition();
        // 上次游戏异常退出时也只补做正式档封装，不删除运行期工作档。
        // 工作档是可恢复的最后一道保险，正式档写入失败时不能让玩家进度一起消失。
        if (!_networkOnly && Process.GetProcessesByName("FallenFlower").Length == 0)
            ProtectActiveSaves(deleteActive: false);
        WriteState(statePath);

        try
        {
            while (true)
            {
                var dirty = DrainNetworkEvents();
                if (DrainGameLogCommands()) dirty = true;
                var currentSequence = ReadInt(registry, _sequenceValueName);
                if (currentSequence != lastCommandSequence)
                {
                    lastCommandSequence = currentSequence;
                    var command = ReadString(registry, _commandValueName);
                    HandleCommand(command, currentSequence);
                    dirty = true;
                }

                // 有大量位置包时最多 10 Hz 刷新状态；空闲时仍每秒刷新心跳。玩家状态本身为 5 Hz，
                // 10 Hz 足以容纳双向批次，并进一步缩短与游戏 ReadModFile 竞争正式路径的概率。
                // 又会放大与游戏 ReadModFile 同时访问时的 Windows 共享冲突。
                if ((dirty && stateWriteTimer.ElapsedMilliseconds >= 100) || stateWriteTimer.ElapsedMilliseconds >= 1000)
                {
                    WriteState(statePath);
                    stateWriteTimer.Restart();
                }

                // 定期保护工作副本，并兼容旧版脚本可能留下的原版自动存档写入。
                if (!_networkOnly && saveProtectionTimer.ElapsedMilliseconds >= 500)
                {
                    RedirectOnlineAutoSave();
                    ProtectActiveSaves(deleteActive: false);
                    saveProtectionTimer.Restart();
                }

                var gameRunning = Process.GetProcessesByName("FallenFlower").Length > 0;
                if (!_networkOnly && _clientTouchSeen &&
                    DateTime.UtcNow - _lastClientTouchUtc > TimeSpan.FromSeconds(8))
                {
                    // 只跟踪加载了当前 Mod 的游戏脚本；其他单机实例或 Mod 启动器不能让
                    // 联机桥永久占用端口。finally 会先提交线上存档，再释放监听。
                    break;
                }
                if (gameRunning)
                {
                    gameWasSeen = true;
                    noProcessSince.Restart();
                }
                else if ((gameWasSeen && noProcessSince.Elapsed > TimeSpan.FromSeconds(5)) ||
                         (!gameWasSeen && startedAt.Elapsed > TimeSpan.FromMinutes(2)))
                {
                    // Mod 启动器通常会留在后台；它不应阻止桥接程序释放监听端口并退出。
                    break;
                }

                await Task.Delay(25).ConfigureAwait(false);
            }
        }
        catch (Exception exception)
        {
            // NativeAOT 的未处理托管异常会直接触发 fail-fast，Windows 事件里只留下 0xc0000409。
            // 把真实异常写在桥旁边，双机测试和玩家现场都能给出可复现证据。
            try
            {
                File.WriteAllText(statePath + ".crash.log", exception.ToString(), new UTF8Encoding(false));
            }
            catch { }
        }
        finally
        {
            if (!_networkOnly)
            {
                RedirectOnlineAutoSave();
                // 退出时生成/刷新双层加密的 MPOnline 正式档，同时保留 MPActive 工作档。
                // 下一次联机优先继续同一 UUID，不能把一次正常退出变成“重新建档”。
                ProtectActiveSaves(deleteActive: false);
                EnsureActiveRecoveryCopy();
                RestoreSinglePlayerAutoSave();
            }
            Node.Dispose();
            WriteOfflineState(statePath);
            try { singleton.ReleaseMutex(); } catch { }
        }
    }

    private static void ConfigureInstance(string[] args)
    {
        _channel = NormalizeChannel(ReadArgument(args, "--channel") ?? "default");
        _commandValueName = ChannelName(CommandValueName);
        _sequenceValueName = ChannelName(SequenceValueName);
        _logCommandMarker = _channel == "default"
            ? DefaultLogCommandMarker
            : $"[PlayerHostedMultiplayerIPC:{_channel}]";
        _gameLogPathOverride = ReadArgument(args, "--log-path");
        _networkOnly = args.Contains("--network-only", StringComparer.OrdinalIgnoreCase);
    }

    private static string? ReadArgument(string[] args, string name)
    {
        for (var index = 0; index + 1 < args.Length; index++)
        {
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase))
                return args[index + 1];
        }
        return null;
    }

    private static string NormalizeChannel(string value)
    {
        var normalized = new string((value ?? string.Empty).Where(character =>
            char.IsAsciiLetterOrDigit(character) || character is '-' or '_').Take(32).ToArray());
        return string.IsNullOrWhiteSpace(normalized) ? "default" : normalized.ToLowerInvariant();
    }

    private static string ChannelName(string baseName) =>
        _channel == "default" ? baseName : baseName + "." + _channel;

    private static void HandleCommand(string command, int sequence)
    {
        try
        {
            var separator = command.IndexOf('?');
            var verb = separator < 0 ? command : command[..separator];
            var values = ParseQuery(separator < 0 ? string.Empty : command[(separator + 1)..]);
            var result = verb switch
            {
                "host" => RestartHost(values),
                "join" => RestartClient(values),
                "send" => Send(values),
                "beginSave" => BeginOnlineSave(values),
                "prepareSave" => PrepareOnlineSave(values),
                "renameSave" => RenameOnlineSave(values),
                "flushSave" => FlushOnlineSave(),
                "beginRawSave" => BeginRawOnlineSave(values),
                "appendRawSave" => AppendRawOnlineSave(values),
                "commitRawSave" => CommitRawOnlineSave(),
                "touch" => TouchClient(),
                "stop" => Stop(),
                _ => -1
            };
            _responseSequence = sequence;
            _response = result.ToString(CultureInfo.InvariantCulture);
        }
        catch (Exception exception)
        {
            _responseSequence = sequence;
            _response = "-1";
            AddEvent(new BridgeEvent("error", 0, exception.Message));
        }
    }

    private static int TouchClient()
    {
        _clientTouchSeen = true;
        _lastClientTouchUtc = DateTime.UtcNow;
        return 0;
    }

    private static int BeginRawOnlineSave(Dictionary<string, string> values)
    {
        var onlineName = NormalizeOnlineSaveName(values.GetValueOrDefault("name", string.Empty));
        if (onlineName.Length == 0 ||
            !int.TryParse(values.GetValueOrDefault("chunks", "0"), out var chunks) || chunks < 1 || chunks > 2048)
            return -2;
        BeginOnlineSaveSession(onlineName);
        RawSaveBuffer.Clear();
        _rawSaveExpectedChunks = chunks;
        _rawSaveReceivedChunks = 0;
        return 0;
    }

    private static int AppendRawOnlineSave(Dictionary<string, string> values)
    {
        if (_rawSaveExpectedChunks <= 0 ||
            !int.TryParse(values.GetValueOrDefault("index", "-1"), out var index) || index != _rawSaveReceivedChunks)
            return -2;
        var data = values.GetValueOrDefault("data", string.Empty);
        if (RawSaveBuffer.Length + data.Length > 16 * 1024 * 1024) return -7;
        RawSaveBuffer.Append(data);
        _rawSaveReceivedChunks++;
        return 0;
    }

    private static int CommitRawOnlineSave()
    {
        if (_activeOnlineSaveName.Length == 0 || _activeSaveDirectory.Length == 0 ||
            _rawSaveExpectedChunks <= 0 || _rawSaveReceivedChunks != _rawSaveExpectedChunks)
            return -2;
        try
        {
            var json = RawSaveBuffer.ToString();
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object) return -7;
            var activePath = Path.Combine(_activeSaveDirectory, ToActiveSaveName(_activeOnlineSaveName) + ".save");
            WriteAtomic(activePath, EncryptGameSave(json));
            ProtectedHashes.Remove(activePath);
            var result = FlushOnlineSave();
            if (result == 0) AddEvent(new BridgeEvent("saveFlushed", 0, _activeOnlineSaveName));
            return result;
        }
        catch (JsonException) { return -7; }
        finally
        {
            RawSaveBuffer.Clear();
            _rawSaveExpectedChunks = 0;
            _rawSaveReceivedChunks = 0;
        }
    }

    private static string GetGameLogPath()
    {
        if (!string.IsNullOrWhiteSpace(_gameLogPathOverride))
            return Path.GetFullPath(_gameLogPathOverride);
        var localDirectory = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var appDataDirectory = Directory.GetParent(localDirectory)?.FullName
            ?? throw new InvalidOperationException("无法确定 AppData 目录");
        return Path.Combine(appDataDirectory, "LocalLow", "DefaultCompany", "FallenFlower", "Player.log");
    }

    private static void InitializeGameLogPosition()
    {
        try
        {
            var path = GetGameLogPath();
            _gameLogPosition = File.Exists(path) ? new FileInfo(path).Length : 0;
        }
        catch
        {
            _gameLogPosition = 0;
        }
    }

    // UcModLauncher 的 Jint 环境可以稳定写 Player.log，但 PlayerPrefs 不一定落入普通注册表。
    // 这里只读取上次偏移之后的新内容，并且只接受带专用标记、整数序号和单行命令的记录。
    private static bool DrainGameLogCommands()
    {
        try
        {
            var path = GetGameLogPath();
            if (!File.Exists(path)) return false;
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete);
            if (stream.Length < _gameLogPosition)
            {
                // Unity 每次启动会轮换/截断 Player.log。
                _gameLogPosition = 0;
                _gameLogRemainder = string.Empty;
            }
            if (stream.Length == _gameLogPosition) return false;
            stream.Position = _gameLogPosition;
            using var reader = new StreamReader(stream, Encoding.UTF8, true, 4096, leaveOpen: true);
            var text = _gameLogRemainder + reader.ReadToEnd();
            _gameLogPosition = stream.Position;
            var lines = text.Split('\n');
            _gameLogRemainder = text.EndsWith('\n') ? string.Empty : lines[^1];
            var completeCount = text.EndsWith('\n') ? lines.Length : lines.Length - 1;
            var handled = false;
            for (var index = 0; index < completeCount; index++)
            {
                var line = lines[index].TrimEnd('\r');
                var markerAt = line.IndexOf(_logCommandMarker, StringComparison.Ordinal);
                if (markerAt < 0) continue;
                var payload = line[(markerAt + _logCommandMarker.Length)..].TrimStart();
                var separator = payload.IndexOf(' ');
                if (separator <= 0 || !int.TryParse(payload[..separator], NumberStyles.Integer,
                        CultureInfo.InvariantCulture, out var sequence)) continue;
                var command = payload[(separator + 1)..].Trim();
                if (command.Length == 0 || command.Length > 60_000) continue;
                HandleCommand(command, sequence);
                handled = true;
            }
            return handled;
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    private static int RestartHost(Dictionary<string, string> values)
    {
        Node.Stop();
        return Node.StartHost(ReadInt(values, "port", 27777), ReadInt(values, "max", 4));
    }

    private static int RestartClient(Dictionary<string, string> values)
    {
        Node.Stop();
        return Node.Join(values.GetValueOrDefault("address", "127.0.0.1"), ReadInt(values, "port", 27777));
    }

    private static int Send(Dictionary<string, string> values)
    {
        _ = long.TryParse(values.GetValueOrDefault("peer", "0"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var peerId);
        return Node.Send(peerId, values.GetValueOrDefault("data", string.Empty));
    }

    private static int Stop()
    {
        Node.Stop();
        return 0;
    }

    // 游戏脚本先提交完整 GetSave JSON；这里验证工作副本和正式双层密文已经一致。
    private static int FlushOnlineSave()
    {
        RedirectOnlineAutoSave();
        // 退出前不能“尽力而为”后仍返回成功。只有当前 MPActive_ 已经被完整封装为
        // MPOnline_，并且正式档确实存在且非空，游戏端才可以继续执行原版退出回调。
        // MPActive_ 始终保留，作为断电或外层加密失败时的恢复副本。
        if (_activeOnlineSaveName.Length == 0 || _activeSaveDirectory.Length == 0) return -2;
        var activePath = Path.Combine(_activeSaveDirectory, ToActiveSaveName(_activeOnlineSaveName) + ".save");
        var onlinePath = Path.Combine(_activeSaveDirectory, _activeOnlineSaveName + ".save");
        ProtectedHashes.Remove(activePath);

        // 文件可能正处于原子替换的极短窗口。桥接线程不能睡眠等待；-6 让游戏脚本在后续帧重试。
        try
        {
            if (!File.Exists(activePath) || new FileInfo(activePath).Length == 0) return -6;
            var active = File.ReadAllBytes(activePath);
            if (!active.AsSpan().StartsWith("Encrypted"u8)) return -5;
            ProtectActiveSaves(deleteActive: false);
            if (File.Exists(onlinePath) && new FileInfo(onlinePath).Length > 0)
            {
                var unpacked = DecryptOuterLayer(File.ReadAllBytes(onlinePath));
                if (unpacked.AsSpan().SequenceEqual(active)) return 0;
            }
        }
        catch (IOException) { return -6; }
        catch (UnauthorizedAccessException) { return -6; }
        catch (CryptographicException) { }

        AddEvent(new BridgeEvent("error", 0, "退出前未能验证正式线上存档，已阻止退出以保护进度"));
        return -5;
    }

    // 原版退出流程或其他 Mod 即使删除了当前槽位，也从刚验证过的正式线上档恢复
    // MPActive_ 工作副本。这样退出后磁盘上始终同时保留正式档和可恢复副本。
    private static void EnsureActiveRecoveryCopy()
    {
        if (_activeOnlineSaveName.Length == 0 || _activeSaveDirectory.Length == 0) return;
        var activePath = Path.Combine(_activeSaveDirectory, ToActiveSaveName(_activeOnlineSaveName) + ".save");
        var onlinePath = Path.Combine(_activeSaveDirectory, _activeOnlineSaveName + ".save");
        if (File.Exists(activePath) || !File.Exists(onlinePath)) return;
        try
        {
            var originalGameCiphertext = DecryptOuterLayer(File.ReadAllBytes(onlinePath));
            if (!originalGameCiphertext.AsSpan().StartsWith("Encrypted"u8)) return;
            WriteAtomic(activePath, originalGameCiphertext);
            ProtectedHashes[activePath] = Convert.ToHexString(SHA256.HashData(originalGameCiphertext));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        catch (CryptographicException exception)
        {
            AddEvent(new BridgeEvent("error", 0, "恢复线上工作档失败: " + exception.Message));
        }
    }

    private static int PrepareOnlineSave(Dictionary<string, string> values)
    {
        var onlineName = NormalizeOnlineSaveName(values.GetValueOrDefault("name", string.Empty));
        if (onlineName.Length == 0) return -2;
        BeginOnlineSaveSession(onlineName);
        var saveDirectory = GetSaveDirectory();
        Directory.CreateDirectory(saveDirectory);
        var onlinePath = Path.Combine(saveDirectory, onlineName + ".save");
        if (!File.Exists(onlinePath)) return -3;

        var activeName = ToActiveSaveName(onlineName);
        var activePath = Path.Combine(saveDirectory, activeName + ".save");
        var originalGameCiphertext = DecryptOuterLayer(File.ReadAllBytes(onlinePath));
        WriteAtomic(activePath, originalGameCiphertext);
        ProtectedHashes[activePath] = Convert.ToHexString(SHA256.HashData(originalGameCiphertext));
        AddEvent(new BridgeEvent("saveMetadata", 0, BuildSaveMetadata(onlineName, originalGameCiphertext)));
        AddEvent(new BridgeEvent("savePrepared", 0, activeName));
        return 0;
    }

    private static int BeginOnlineSave(Dictionary<string, string> values)
    {
        var onlineName = NormalizeOnlineSaveName(values.GetValueOrDefault("name", string.Empty));
        if (onlineName.Length == 0) return -2;
        BeginOnlineSaveSession(onlineName);
        return 0;
    }

    // 旧版使用毫秒时间戳命名。升级时只改正式线上文件名，不解密、不改存档内容，
    // 并且绝不覆盖已经存在的 UUIDv7 目标文件。
    private static int RenameOnlineSave(Dictionary<string, string> values, string? saveDirectoryOverride = null)
    {
        var sourceName = NormalizeOnlineSaveName(values.GetValueOrDefault("name", string.Empty));
        var targetName = NormalizeOnlineSaveName(values.GetValueOrDefault("target", string.Empty));
        if (sourceName.Length == 0 || targetName.Length == 0) return -2;
        if (sourceName.Equals(targetName, StringComparison.Ordinal)) return 0;
        var saveDirectory = saveDirectoryOverride ?? GetSaveDirectory();
        var sourcePath = Path.Combine(saveDirectory, sourceName + ".save");
        var targetPath = Path.Combine(saveDirectory, targetName + ".save");
        if (!File.Exists(sourcePath)) return -3;
        if (File.Exists(targetPath)) return -4;
        File.Move(sourcePath, targetPath, false);
        if (_activeOnlineSaveName.Equals(sourceName, StringComparison.Ordinal))
            _activeOnlineSaveName = targetName;
        AddEvent(new BridgeEvent("saveRenamed", 0, targetName));
        return 0;
    }

    private static void BeginOnlineSaveSession(string onlineName, string? saveDirectoryOverride = null)
    {
        if (_activeOnlineSaveName == onlineName) return;
        RestoreSinglePlayerAutoSave();
        _activeOnlineSaveName = onlineName;
        _activeSaveDirectory = saveDirectoryOverride ?? GetSaveDirectory();
        Directory.CreateDirectory(_activeSaveDirectory);
        var autoSavePath = Path.Combine(_activeSaveDirectory, "AutoSave.save");
        _singlePlayerAutoSaveExisted = File.Exists(autoSavePath);
        _singlePlayerAutoSaveBackup = _singlePlayerAutoSaveExisted ? File.ReadAllBytes(autoSavePath) : null;
        _autoSaveObservedHash = _singlePlayerAutoSaveBackup is null
            ? string.Empty
            : Convert.ToHexString(SHA256.HashData(_singlePlayerAutoSaveBackup));
    }

    private static void RedirectOnlineAutoSave()
    {
        if (_activeOnlineSaveName.Length == 0) return;
        try
        {
            var saveDirectory = _activeSaveDirectory;
            if (saveDirectory.Length == 0) return;
            var autoSavePath = Path.Combine(saveDirectory, "AutoSave.save");
            if (!File.Exists(autoSavePath)) return;
            var current = File.ReadAllBytes(autoSavePath);
            var hash = Convert.ToHexString(SHA256.HashData(current));
            if (hash == _autoSaveObservedHash) return;
            if (!current.AsSpan().StartsWith("Encrypted"u8)) return;

            // 兼容旧版脚本或未经过 Hook 的原版自动保存：发现 AutoSave 改动时转存到临时线上档，
            // 随后立即恢复玩家的线下 AutoSave，避免联机进度污染或覆盖单机进度。
            var activePath = Path.Combine(saveDirectory, ToActiveSaveName(_activeOnlineSaveName) + ".save");
            WriteAtomic(activePath, current);
            RestoreSinglePlayerAutoSaveFile(autoSavePath);
            _autoSaveObservedHash = _singlePlayerAutoSaveBackup is null
                ? string.Empty
                : Convert.ToHexString(SHA256.HashData(_singlePlayerAutoSaveBackup));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void RestoreSinglePlayerAutoSave()
    {
        if (_activeOnlineSaveName.Length == 0) return;
        try
        {
            RestoreSinglePlayerAutoSaveFile(Path.Combine(_activeSaveDirectory, "AutoSave.save"));
        }
        catch { }
        _activeOnlineSaveName = string.Empty;
        _activeSaveDirectory = string.Empty;
        _singlePlayerAutoSaveBackup = null;
        _singlePlayerAutoSaveExisted = false;
        _autoSaveObservedHash = string.Empty;
    }

    private static void RestoreSinglePlayerAutoSaveFile(string autoSavePath)
    {
        if (_singlePlayerAutoSaveExisted && _singlePlayerAutoSaveBackup is not null)
            WriteAtomic(autoSavePath, _singlePlayerAutoSaveBackup);
        else if (File.Exists(autoSavePath))
            File.Delete(autoSavePath);
    }

    private static bool DrainNetworkEvents()
    {
        var changed = false;
        while (Node.TryPoll(out var bridgeEvent))
        {
            AddEvent(bridgeEvent);
            changed = true;
        }
        return changed;
    }

    private static void AddEvent(BridgeEvent bridgeEvent)
    {
        lock (StateLock)
        {
            Events.Add(new StateEvent(++_eventSequence, bridgeEvent.Type, bridgeEvent.PeerId, bridgeEvent.Message));
            if (Events.Count > MaxRetainedEvents) Events.RemoveRange(0, Events.Count - MaxRetainedEvents);
        }
    }

    private static void WriteState(string path)
    {
        // 游戏脚本运行在受限沙箱中，不能直接枚举磁盘。桥接程序只把存档文件名、
        // 修改时间和大小作为列表元数据写入状态文件，不读取、更不修改存档内容。
        var saves = ReadSaveEntries();
        string json;
        lock (StateLock)
        {
            var builder = new StringBuilder(4096);
            builder.Append("{\"protocol\":").Append(ProtocolVersion)
                .Append(",\"heartbeatUtcTicks\":").Append(DateTime.UtcNow.Ticks)
                .Append(",\"state\":\"").Append(Escape(Node.State)).Append('"')
                .Append(",\"port\":").Append(Node.BoundPort)
                .Append(",\"peers\":").Append(Node.PeerCount)
                .Append(",\"responseSequence\":").Append(_responseSequence)
                .Append(",\"response\":\"").Append(Escape(_response)).Append("\",\"saves\":[");
            for (var index = 0; index < saves.Count; index++)
            {
                if (index > 0) builder.Append(',');
                var save = saves[index];
                builder.Append("{\"name\":\"").Append(Escape(save.Name)).Append('"')
                    .Append(",\"lastWriteUtcTicks\":").Append(save.LastWriteUtcTicks)
                    .Append(",\"size\":").Append(save.Size).Append('}');
            }
            builder.Append("],\"events\":[");
            for (var index = 0; index < Events.Count; index++)
            {
                if (index > 0) builder.Append(',');
                var item = Events[index];
                builder.Append("{\"sequence\":").Append(item.Sequence)
                    .Append(",\"type\":\"").Append(Escape(item.Type)).Append('"')
                    .Append(",\"peerId\":").Append(item.PeerId)
                    .Append(",\"message\":\"").Append(Escape(item.Message)).Append("\"}");
            }
            builder.Append("]}");
            json = builder.ToString();
        }

        WriteStateSnapshots(path, json);
    }

    private static void WriteOfflineState(string path)
    {
        // 保留心跳为 0 的离线哨兵，避免下次启动时 ReadModFile 因文件不存在而中断整个 Mod。
        // 存档索引不能清空，否则游戏在下一次桥接心跳完成前会把“暂时没有索引”误判成“没有存档”。
        var saves = ReadSaveEntries();
        var builder = new StringBuilder(1024);
        builder.Append("{\"protocol\":").Append(ProtocolVersion)
            .Append(",\"heartbeatUtcTicks\":0,\"state\":\"stopped\",\"port\":0,\"peers\":0,")
            .Append("\"responseSequence\":0,\"response\":\"\",\"saves\":[");
        for (var index = 0; index < saves.Count; index++)
        {
            if (index > 0) builder.Append(',');
            var save = saves[index];
            builder.Append("{\"name\":\"").Append(Escape(save.Name)).Append('"')
                .Append(",\"lastWriteUtcTicks\":").Append(save.LastWriteUtcTicks)
                .Append(",\"size\":").Append(save.Size).Append('}');
        }
        builder.Append("],\"events\":[]}");
        var json = builder.ToString();
        // 离线状态同步写入全部槽位，下次游戏启动无论先读到哪一槽都不会误判为在线。
        TryWriteStateFile(path, json);
        for (var slot = 0; slot < StateSlotCount; slot++)
            TryWriteStateFile(GetStateSlotPath(path, slot), json);
    }

    private static void WriteStateSnapshots(string path, string json)
    {
        // 保留原路径供测试工具和人工诊断读取；游戏本身读取三槽轮转快照。
        // 桥接只写当前 100ms 槽，游戏读取两个槽之前的文件，因此 ReadModFile 永远不会
        // 与 File.Move 争用同一路径，同时保持 200~300ms 以内的事件延迟。
        TryWriteStateFile(path, json);
        var epoch = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / StateSlotMilliseconds;
        var currentSlot = (int)(epoch % StateSlotCount);
        for (var slot = 0; slot < StateSlotCount; slot++)
        {
            var slotPath = GetStateSlotPath(path, slot);
            if (slot == currentSlot || !File.Exists(slotPath)) TryWriteStateFile(slotPath, json);
        }
    }

    private static string GetStateSlotPath(string path, int slot)
    {
        var directory = Path.GetDirectoryName(path) ?? string.Empty;
        var name = Path.GetFileNameWithoutExtension(path);
        return Path.Combine(directory, $"{name}.{slot}.json");
    }

    private static void TryWriteStateFile(string path, string json)
    {
        var temporary = path + ".tmp";
        try
        {
            // 完整内容先写到临时文件，正式路径只经历一次极短的原子替换；游戏侧已经把
            // 状态读取限制为 20 Hz，不再为每个事件重复打开文件。
            File.WriteAllText(temporary, json, new UTF8Encoding(false));
            File.Move(temporary, path, true);
        }
        catch (IOException)
        {
            // 状态快照允许丢一拍；网络节点和监听端口不能因此退出。
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
        catch (UnauthorizedAccessException)
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
    }

    private static List<SaveEntry> ReadSaveEntries()
    {
        try
        {
            var saveDirectory = GetSaveDirectory();
            if (!Directory.Exists(saveDirectory)) return [];

            return Directory.EnumerateFiles(saveDirectory, OnlineSavePrefix + "*.save", SearchOption.TopDirectoryOnly)
                .Select(path => new FileInfo(path))
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .Take(20)
                .Select(file => new SaveEntry(Path.GetFileNameWithoutExtension(file.Name), file.LastWriteTimeUtc.Ticks, file.Length))
                .ToList();
        }
        catch
        {
            // 存档列表是辅助功能；目录暂时被占用时不能影响联机心跳和网络连接。
            return [];
        }
    }

    private static string GetSaveDirectory()
    {
        var localDirectory = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var appDataDirectory = Directory.GetParent(localDirectory)?.FullName
            ?? throw new InvalidOperationException("无法确定 AppData 目录");
        return Path.Combine(appDataDirectory, "LocalLow", "DefaultCompany", "FallenFlower", "Saves");
    }

    private static string NormalizeOnlineSaveName(string value)
    {
        var name = Path.GetFileNameWithoutExtension(value ?? string.Empty);
        if (!name.StartsWith(OnlineSavePrefix, StringComparison.Ordinal)) return string.Empty;
        if (name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return string.Empty;
        return name;
    }

    private static string ToActiveSaveName(string onlineName) =>
        ActiveSavePrefix + onlineName[OnlineSavePrefix.Length..];

    private static string ToOnlineSaveName(string activeName) =>
        OnlineSavePrefix + activeName[ActiveSavePrefix.Length..];

    private static void ProtectActiveSaves(bool deleteActive, string? saveDirectoryOverride = null)
    {
        try
        {
            var saveDirectory = saveDirectoryOverride ?? GetSaveDirectory();
            if (!Directory.Exists(saveDirectory)) return;
            foreach (var activePath in Directory.EnumerateFiles(saveDirectory, ActiveSavePrefix + "*.save", SearchOption.TopDirectoryOnly))
            {
                try
                {
                    var originalGameCiphertext = File.ReadAllBytes(activePath);
                    if (originalGameCiphertext.Length == 0)
                    {
                        // 游戏中断进场时可能只创建空占位文件；退出清理不能让它永久残留。
                        if (deleteActive) File.Delete(activePath);
                        continue;
                    }
                    // 第一层必须仍然是游戏自己的 Encrypted 存档，拒绝把损坏或明文文件封装成线上存档。
                    if (!originalGameCiphertext.AsSpan().StartsWith("Encrypted"u8)) continue;
                    var hash = Convert.ToHexString(SHA256.HashData(originalGameCiphertext));
                    var activeName = Path.GetFileNameWithoutExtension(activePath);
                    var onlinePath = Path.Combine(saveDirectory, ToOnlineSaveName(activeName) + ".save");
                    if (!File.Exists(onlinePath) ||
                        !ProtectedHashes.TryGetValue(activePath, out var previousHash) || previousHash != hash)
                    {
                        WriteAtomic(onlinePath, EncryptOuterLayer(originalGameCiphertext));
                        ProtectedHashes[activePath] = hash;
                    }
                    if (deleteActive) File.Delete(activePath);
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                catch (CryptographicException exception)
                {
                    AddEvent(new BridgeEvent("error", 0, "线上存档加密失败: " + exception.Message));
                }
            }
        }
        catch { }
    }

    private static byte[] EncryptOuterLayer(byte[] originalGameCiphertext)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var tag = new byte[16];
        var ciphertext = new byte[originalGameCiphertext.Length];
        var key = Rfc2898DeriveBytes.Pbkdf2(ModEncryptionPassword, salt, ModKeyIterations, HashAlgorithmName.SHA256, 32);
        using (var aes = new AesGcm(key, 16)) aes.Encrypt(nonce, originalGameCiphertext, ciphertext, tag, Encoding.ASCII.GetBytes(OnlineSaveMagic));
        CryptographicOperations.ZeroMemory(key);

        var result = new byte[4 + salt.Length + nonce.Length + tag.Length + ciphertext.Length];
        Encoding.ASCII.GetBytes(OnlineSaveMagic).CopyTo(result, 0);
        salt.CopyTo(result, 4);
        nonce.CopyTo(result, 20);
        tag.CopyTo(result, 32);
        ciphertext.CopyTo(result, 48);
        return result;
    }

    private static byte[] EncryptGameSave(string json)
    {
        // 与游戏 EncryptHelper.Encrypt 完全一致："Encrypted" + Base64(HMAC || IV || AES-CBC)。
        // 参数来自当前 GameAssembly.dll 的静态分析，并已用原版 AutoSave 做解密/再加密往返验证。
        var key = DeriveGameSaveKey();
        try
        {
            using var aes = Aes.Create();
            aes.Key = key;
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.PKCS7;
            aes.GenerateIV();
            var plain = Encoding.UTF8.GetBytes(json);
            using var encryptor = aes.CreateEncryptor();
            var ciphertext = encryptor.TransformFinalBlock(plain, 0, plain.Length);
            var authenticated = new byte[aes.IV.Length + ciphertext.Length];
            Buffer.BlockCopy(aes.IV, 0, authenticated, 0, aes.IV.Length);
            Buffer.BlockCopy(ciphertext, 0, authenticated, aes.IV.Length, ciphertext.Length);
            using var hmac = new HMACSHA256(key);
            var mac = hmac.ComputeHash(authenticated);
            var payload = new byte[mac.Length + authenticated.Length];
            Buffer.BlockCopy(mac, 0, payload, 0, mac.Length);
            Buffer.BlockCopy(authenticated, 0, payload, mac.Length, authenticated.Length);
            return Encoding.UTF8.GetBytes("Encrypted" + Convert.ToBase64String(payload));
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    private static string DecryptGameSave(byte[] encodedBytes)
    {
        var encoded = Encoding.UTF8.GetString(encodedBytes);
        if (!encoded.StartsWith("Encrypted", StringComparison.Ordinal))
            throw new CryptographicException("缺少游戏原版 Encrypted 文件头");
        var payload = Convert.FromBase64String(encoded[9..]);
        if (payload.Length < 64 || payload.Length % 16 != 0)
            throw new CryptographicException("游戏原版密文长度无效");
        var expectedMac = payload.AsSpan(0, 32);
        var iv = payload.AsSpan(32, 16);
        var ciphertext = payload.AsSpan(48);
        var key = DeriveGameSaveKey();
        try
        {
            using var hmac = new HMACSHA256(key);
            var actualMac = hmac.ComputeHash(payload, 32, payload.Length - 32);
            if (!CryptographicOperations.FixedTimeEquals(expectedMac, actualMac))
                throw new CryptographicException("游戏原版存档 HMAC 验证失败");
            using var aes = Aes.Create();
            aes.Key = key;
            aes.IV = iv.ToArray();
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.PKCS7;
            using var decryptor = aes.CreateDecryptor();
            var plain = decryptor.TransformFinalBlock(ciphertext.ToArray(), 0, ciphertext.Length);
            return Encoding.UTF8.GetString(plain);
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    private static byte[] DeriveGameSaveKey() =>
        Rfc2898DeriveBytes.Pbkdf2(GameEncryptionPassword, GameEncryptionSalt,
            GameKeyIterations, HashAlgorithmName.SHA256, 32);

    private static string BuildSaveMetadata(string onlineName, byte[] originalGameCiphertext)
    {
        using var document = JsonDocument.Parse(DecryptGameSave(originalGameCiphertext));
        var root = document.RootElement;
        var scene = root.TryGetProperty("Scene", out var sceneElement) ? sceneElement.GetString() ?? string.Empty : string.Empty;
        var position = root.TryGetProperty("PlayerPosition", out var positionElement) ? positionElement.GetRawText() : "null";
        var rotation = root.TryGetProperty("PlayerRotation", out var rotationElement) ? rotationElement.GetRawText() : "null";
        return "{\"save\":\"" + Escape(onlineName) + "\",\"scene\":\"" + Escape(scene) +
            "\",\"position\":" + position + ",\"rotation\":" + rotation + "}";
    }

    private static byte[] DecryptOuterLayer(byte[] container)
    {
        if (container.Length < 49 || Encoding.ASCII.GetString(container, 0, 4) != OnlineSaveMagic)
            throw new CryptographicException("不是有效的 MPB2 线上存档");
        var salt = container.AsSpan(4, 16);
        var nonce = container.AsSpan(20, 12);
        var tag = container.AsSpan(32, 16);
        var ciphertext = container.AsSpan(48);
        var plaintext = new byte[ciphertext.Length];
        var key = Rfc2898DeriveBytes.Pbkdf2(ModEncryptionPassword, salt, ModKeyIterations, HashAlgorithmName.SHA256, 32);
        using (var aes = new AesGcm(key, 16)) aes.Decrypt(nonce, ciphertext, tag, plaintext, Encoding.ASCII.GetBytes(OnlineSaveMagic));
        CryptographicOperations.ZeroMemory(key);
        if (!plaintext.AsSpan().StartsWith("Encrypted"u8)) throw new CryptographicException("内层不是游戏原版加密存档");
        return plaintext;
    }

    private static void SelfTestOnlineSaveCrypto()
    {
        var original = Encoding.UTF8.GetBytes("Encrypted" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(128)));
        var wrapped = EncryptOuterLayer(original);
        var roundTrip = DecryptOuterLayer(wrapped);
        if (!original.AsSpan().SequenceEqual(roundTrip)) throw new InvalidOperationException("线上存档加密往返不一致");
        wrapped[^1] ^= 0x01;
        try
        {
            _ = DecryptOuterLayer(wrapped);
            throw new InvalidOperationException("被篡改的线上存档未被拒绝");
        }
        catch (AuthenticationTagMismatchException) { }

        var testDirectory = Path.Combine(Path.GetTempPath(), "MPB-save-self-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(testDirectory);
        try
        {
            var autoSavePath = Path.Combine(testDirectory, "AutoSave.save");
            var singlePlayer = Encoding.UTF8.GetBytes("Encrypted-single-player");
            var onlineAutoSave = Encoding.UTF8.GetBytes("Encrypted-online-progress");
            File.WriteAllBytes(autoSavePath, singlePlayer);
            BeginOnlineSaveSession("MPOnline_selftest", testDirectory);
            File.WriteAllBytes(autoSavePath, onlineAutoSave);
            RedirectOnlineAutoSave();
            var activePath = Path.Combine(testDirectory, "MPActive_selftest.save");
            if (!File.ReadAllBytes(activePath).AsSpan().SequenceEqual(onlineAutoSave))
                throw new InvalidOperationException("线上自动保存没有转存到临时档");
            if (!File.ReadAllBytes(autoSavePath).AsSpan().SequenceEqual(singlePlayer))
                throw new InvalidOperationException("线上自动保存转存后没有恢复单机 AutoSave");
            ProtectActiveSaves(deleteActive: false, saveDirectoryOverride: testDirectory);
            var onlinePath = Path.Combine(testDirectory, "MPOnline_selftest.save");
            if (!File.Exists(activePath))
                throw new InvalidOperationException("正式档封装后错误删除了线上工作档");
            if (!File.Exists(onlinePath))
                throw new InvalidOperationException("临时线上存档没有封装成正式线上存档");
            if (!DecryptOuterLayer(File.ReadAllBytes(onlinePath)).AsSpan().SequenceEqual(onlineAutoSave))
                throw new InvalidOperationException("正式线上存档内容与临时档不一致");
            File.Delete(activePath);
            EnsureActiveRecoveryCopy();
            if (!File.Exists(activePath) ||
                !File.ReadAllBytes(activePath).AsSpan().SequenceEqual(onlineAutoSave))
                throw new InvalidOperationException("原版退出删除工作档后没有从正式线上档恢复");
            const string uuidV7Name = "MPOnline_01890f3e-7b00-7abc-8def-0123456789ab";
            var renameResult = RenameOnlineSave(new Dictionary<string, string>
            {
                ["name"] = "MPOnline_selftest",
                ["target"] = uuidV7Name
            }, testDirectory);
            var uuidV7Path = Path.Combine(testDirectory, uuidV7Name + ".save");
            if (renameResult != 0 || File.Exists(onlinePath) || !File.Exists(uuidV7Path))
                throw new InvalidOperationException("旧线上存档没有迁移到 UUIDv7 文件名");
            if (!DecryptOuterLayer(File.ReadAllBytes(uuidV7Path)).AsSpan().SequenceEqual(onlineAutoSave))
                throw new InvalidOperationException("UUIDv7 迁移改变了线上存档内容");
            RestoreSinglePlayerAutoSave();
        }
        finally
        {
            if (Directory.Exists(testDirectory)) Directory.Delete(testDirectory, true);
        }
        Console.WriteLine("PASS UUIDv7 rename, online-save crypto, active-save retention, formal-save commit, tamper rejection, autosave redirect and single-player restore");
    }

    private static void WriteAtomic(string path, byte[] bytes)
    {
        var temporary = path + ".tmp";
        File.WriteAllBytes(temporary, bytes);
        File.Move(temporary, path, true);
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = part.IndexOf('=');
            var key = separator < 0 ? part : part[..separator];
            var value = separator < 0 ? string.Empty : part[(separator + 1)..];
            result[Uri.UnescapeDataString(key)] = Uri.UnescapeDataString(value);
        }
        return result;
    }

    private static int ReadInt(RegistryKey registry, string name)
    {
        try { return Convert.ToInt32(registry.GetValue(FindUnityValueName(registry, name), 0), CultureInfo.InvariantCulture); }
        catch { return 0; }
    }

    private static string ReadString(RegistryKey registry, string name)
    {
        try
        {
            var value = registry.GetValue(FindUnityValueName(registry, name), string.Empty);
            // Unity 把字符串 PlayerPrefs 保存为以 NUL 结尾的 UTF-8 REG_BINARY，而不是 REG_SZ。
            if (value is byte[] bytes) return Encoding.UTF8.GetString(bytes).TrimEnd('\0');
            return Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        }
        catch { return string.Empty; }
    }

    private static string FindUnityValueName(RegistryKey registry, string logicalName)
    {
        // Unity 2022 的 Windows PlayerPrefs 会把键保存为“原名_h哈希”。优先使用该值，
        // 同时保留明文键兼容旧 Unity、测试工具以及将来的存储实现变化。
        var prefix = logicalName + "_h";
        foreach (var candidate in registry.GetValueNames())
        {
            if (candidate.StartsWith(prefix, StringComparison.Ordinal)) return candidate;
        }
        return logicalName;
    }

    private static int ReadInt(Dictionary<string, string> values, string key, int fallback) =>
        int.TryParse(values.GetValueOrDefault(key), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : fallback;

    private static string Escape(string value)
    {
        var builder = new StringBuilder(value.Length + 8);
        foreach (var character in value)
        {
            switch (character)
            {
                case '\\': builder.Append("\\\\"); break;
                case '"': builder.Append("\\\""); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (character < 0x20) builder.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                    else builder.Append(character);
                    break;
            }
        }
        return builder.ToString();
    }

    private readonly record struct StateEvent(long Sequence, string Type, long PeerId, string Message);
    private readonly record struct SaveEntry(string Name, long LastWriteUtcTicks, long Size);
}
