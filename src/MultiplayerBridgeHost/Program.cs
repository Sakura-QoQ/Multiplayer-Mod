using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using FallenFlower.MultiplayerBridge;
using Microsoft.Win32;

namespace FallenFlower.MultiplayerBridgeHost;

internal static class Program
{
    private const string RegistryPath = @"Software\DefaultCompany\FallenFlower";
    private const string CommandValueName = "MPB.IpcCommand";
    private const string SequenceValueName = "MPB.IpcCommandSequence";
    private const int ProtocolVersion = 2;
    private const int MaxRetainedEvents = 128;
    private const string OnlineSavePrefix = "MPOnline_";
    private const string ActiveSavePrefix = "MPActive_";
    private const string OnlineSaveMagic = "MPB2";
    private const string ModEncryptionPassword = "FallenFlower.PlayerHostedMultiplayer.Save.v1";
    private const int ModKeyIterations = 120_000;

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

    private static async Task Main(string[] args)
    {
        if (args.Contains("--self-test-save-crypto", StringComparer.OrdinalIgnoreCase))
        {
            SelfTestOnlineSaveCrypto();
            return;
        }
        // 全局互斥锁防止玩家重复点击启动脚本后出现两个桥接进程争用同一状态文件。
        // Mutex 构造函数的 out 参数只表示“是否新建内核对象”，不表示当前进程是否持有锁；
        // 因此必须显式 WaitOne，才能正确处理残留句柄和上次进程异常退出后的 abandoned 状态。
        using var singleton = new Mutex(false, @"Local\FallenFlower.PlayerHostedMultiplayer");
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
        var statePath = Path.Combine(bridgeDirectory, "state.json");
        using var registry = Registry.CurrentUser.CreateSubKey(RegistryPath, true);
        if (registry is null) return;

        var lastCommandSequence = ReadInt(registry, SequenceValueName);
        var startedAt = Stopwatch.StartNew();
        var gameWasSeen = false;
        var noProcessSince = Stopwatch.StartNew();
        var saveProtectionTimer = Stopwatch.StartNew();
        if (Process.GetProcessesByName("FallenFlower").Length == 0) ProtectActiveSaves(deleteActive: true);
        WriteState(statePath);

        try
        {
            while (true)
            {
                var dirty = DrainNetworkEvents();
                var currentSequence = ReadInt(registry, SequenceValueName);
                if (currentSequence != lastCommandSequence)
                {
                    lastCommandSequence = currentSequence;
                    var command = ReadString(registry, CommandValueName);
                    HandleCommand(command, currentSequence);
                    dirty = true;
                }

                // 即使没有网络变化也定时改写心跳，游戏可据此识别桥接程序是否仍在运行。
                if (dirty || startedAt.ElapsedMilliseconds % 1000 < 30) WriteState(statePath);

                // 游戏仍然写入原版加密的临时存档。桥接程序检测到变化后，再把完整原版密文
                // 套入 Mod 的 AES-GCM 认证加密容器；这样磁盘上的正式线上存档始终是双层密文。
                if (saveProtectionTimer.ElapsedMilliseconds >= 500)
                {
                    RedirectOnlineAutoSave();
                    ProtectActiveSaves(deleteActive: false);
                    saveProtectionTimer.Restart();
                }

                var gameRunning = Process.GetProcessesByName("FallenFlower").Length > 0;
                var launcherRunning = Process.GetProcessesByName("UcModLauncher").Length > 0;
                if (gameRunning) gameWasSeen = true;
                if (gameRunning || launcherRunning) noProcessSince.Restart();
                else if ((gameWasSeen && noProcessSince.Elapsed > TimeSpan.FromSeconds(5)) ||
                         (!gameWasSeen && startedAt.Elapsed > TimeSpan.FromMinutes(2))) break;

                await Task.Delay(25).ConfigureAwait(false);
            }
        }
        finally
        {
            RedirectOnlineAutoSave();
            ProtectActiveSaves(deleteActive: true);
            RestoreSinglePlayerAutoSave();
            Node.Dispose();
            try { File.Delete(statePath); } catch { }
            try { singleton.ReleaseMutex(); } catch { }
        }
    }

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
                "flushSave" => FlushOnlineSave(),
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

    // 游戏在退出回调前已经同步写好 MPActive_ 临时档；这里立即完成 Mod 外层加密。
    private static int FlushOnlineSave()
    {
        RedirectOnlineAutoSave();
        ProtectActiveSaves(deleteActive: false);
        return 0;
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

            // 游戏的 AutoSaving() 固定传入 AutoSave。联机期间把这次写入立即转存到临时线上档，
            // 随后恢复玩家原来的单机 AutoSave，避免联机进度污染或覆盖单机进度。
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

        var temporary = path + ".tmp";
        File.WriteAllText(temporary, json, new UTF8Encoding(false));
        File.Move(temporary, path, true);
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

    private static void ProtectActiveSaves(bool deleteActive)
    {
        try
        {
            var saveDirectory = GetSaveDirectory();
            if (!Directory.Exists(saveDirectory)) return;
            foreach (var activePath in Directory.EnumerateFiles(saveDirectory, ActiveSavePrefix + "*.save", SearchOption.TopDirectoryOnly))
            {
                try
                {
                    var originalGameCiphertext = File.ReadAllBytes(activePath);
                    if (originalGameCiphertext.Length == 0) continue;
                    // 第一层必须仍然是游戏自己的 Encrypted 存档，拒绝把损坏或明文文件封装成线上存档。
                    if (!originalGameCiphertext.AsSpan().StartsWith("Encrypted"u8)) continue;
                    var hash = Convert.ToHexString(SHA256.HashData(originalGameCiphertext));
                    if (!ProtectedHashes.TryGetValue(activePath, out var previousHash) || previousHash != hash)
                    {
                        var activeName = Path.GetFileNameWithoutExtension(activePath);
                        var onlinePath = Path.Combine(saveDirectory, ToOnlineSaveName(activeName) + ".save");
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
                throw new InvalidOperationException("单机 AutoSave 没有恢复");
            RestoreSinglePlayerAutoSave();
        }
        finally
        {
            if (Directory.Exists(testDirectory)) Directory.Delete(testDirectory, true);
        }
        Console.WriteLine("PASS online-save crypto, tamper rejection, autosave redirect and single-player restore");
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
