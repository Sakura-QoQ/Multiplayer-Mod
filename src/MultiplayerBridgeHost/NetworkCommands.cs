using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FallenFlower.MultiplayerBridge;
using Microsoft.Win32;

namespace FallenFlower.MultiplayerBridgeHost;

internal static partial class Program
{
    // 网络命令、日志 IPC 与原始存档接收。
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
            ?? throw new InvalidOperationException("Unable to determine the AppData directory");
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

        AddEvent(new BridgeEvent("error", 0, "The formal online save could not be verified before exit; exit was blocked to protect progress"));
        return -5;
    }

    // 原版退出流程或其他 Mod 即使删除了当前槽位，也从刚验证过的正式线上档恢复
    // MPActive_ 工作副本。这样退出后磁盘上始终同时保留正式档和可恢复副本。
}
