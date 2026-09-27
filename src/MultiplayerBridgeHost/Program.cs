using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FallenFlower.MultiplayerBridge;

namespace FallenFlower.MultiplayerBridgeHost;

internal static partial class Program
{
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
    private const int StateSlotMilliseconds = 50;

    private static readonly BridgeNode Node = new();
    private static readonly RoomRelayClient RoomRelay = new();
    private static readonly List<StateEvent> Events = [];
    private static readonly object StateLock = new();
    private static long _eventSequence;
    private static int _responseSequence;
    private static string _response = string.Empty;
    private static readonly Dictionary<string, string> ProtectedHashes = new(StringComparer.OrdinalIgnoreCase);
    private static string _activeOnlineSaveName = string.Empty;
    private static string _activeSaveDirectory = string.Empty;
    private static bool _onlineSaveWritesEnabled;
    private static byte[]? _singlePlayerAutoSaveBackup;
    private static bool _singlePlayerAutoSaveExisted;
    private static string _autoSaveObservedHash = string.Empty;
    private static long _gameLogPosition;
    private static string _gameLogRemainder = string.Empty;
    private static string _channel = "default";
    private static string _logCommandMarker = DefaultLogCommandMarker;
    private static string? _gameLogPathOverride;
    private static string _saveProtectionName = string.Empty;
    private static bool _networkOnly;
    private static DateTime _lastClientTouchUtc;
    private static bool _clientTouchSeen;
    private static readonly StringBuilder RawSaveBuffer = new();
    private static readonly byte[] GameEncryptionSalt = [0x04, 0x08, 0x41, 0x20, 0x49, 0x24, 0x00, 0x6d];
    private static int _rawSaveExpectedChunks;
    private static int _rawSaveReceivedChunks;

    private static async Task Main(string[] args)
    {
        if (args.Contains("--self-test-room-relay", StringComparer.OrdinalIgnoreCase))
        {
            var address = ReadArgument(args, "--address") ?? "127.0.0.1";
            var portText = ReadArgument(args, "--port") ?? "27777";
            if (!int.TryParse(portText, out var port)) throw new ArgumentException("--port must be an integer");
            await SelfTestRoomRelayAsync(address, port);
            return;
        }
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
        var startedAt = Stopwatch.StartNew();
        var gameWasSeen = false;
        var noProcessSince = Stopwatch.StartNew();
        var saveProtectionTimer = Stopwatch.StartNew();
        var stateWriteTimer = Stopwatch.StartNew();
        InitializeGameLogPosition();
        // 兼容旧版遗留的工作档：先补做正式档封装，再删除工作档。
        if (!_networkOnly && Process.GetProcessesByName("FallenFlower").Length == 0)
            ProtectActiveSaves(deleteActive: true);
        WriteState(statePath);

        try
        {
            while (true)
            {
                var dirty = DrainNetworkEvents();
                if (DrainGameLogCommands()) dirty = true;

                // 有大量位置包时最多 20 Hz 刷新状态，完整保留 20 Hz 玩家快照；空闲时仍每秒刷新心跳。
                // 三槽快照由游戏读取旧槽，避免桥接写入与 ReadModFile 竞争同一路径。
                if ((dirty && stateWriteTimer.ElapsedMilliseconds >= StateSlotMilliseconds) || stateWriteTimer.ElapsedMilliseconds >= 1000)
                {
                    WriteState(statePath);
                    stateWriteTimer.Restart();
                }

                // 定期保护工作副本，并兼容旧版脚本可能留下的原版自动存档写入。
                if (!_networkOnly && saveProtectionTimer.ElapsedMilliseconds >= 500)
                {
                    // 已有存档处于只读加载阶段时，桥接层也禁止封装或替换正式档。
                    if (_activeOnlineSaveName.Length == 0 || _onlineSaveWritesEnabled)
                    {
                        RedirectOnlineAutoSave();
                        ProtectActiveSaves(deleteActive: false);
                    }
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
                if (_onlineSaveWritesEnabled)
                {
                    RedirectOnlineAutoSave();
                    // 退出时封装可能由旧版自动保存留下的工作档；正式 MPOnline 是唯一持久存档。
                    ProtectActiveSaves(deleteActive: true);
                }
                else
                {
                    // 载入未完成就退出时只删除解密工作副本，绝不改写正式线上档。
                    _ = ReleasePreparedOnlineSave();
                }
                RestoreSinglePlayerAutoSave();
            }
            Node.Dispose();
            RoomRelay.Dispose();
            WriteOfflineState(statePath);
            try { singleton.ReleaseMutex(); } catch { }
        }
    }

    private static void ConfigureInstance(string[] args)
    {
        _channel = NormalizeChannel(ReadArgument(args, "--channel") ?? "default");
        _logCommandMarker = _channel == "default"
            ? DefaultLogCommandMarker
            : $"[PlayerHostedMultiplayerIPC:{_channel}]";
        _gameLogPathOverride = ReadArgument(args, "--log-path");
        // 集成测试只允许保护本次随机 UUID，避免启动扫描改写开发机上的真实玩家文件。
        _saveProtectionName = NormalizeOnlineSaveName(ReadArgument(args, "--save-name") ?? string.Empty);
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

    // 小型状态载体与主循环放在同一文件，其他实现位于同目录 partial 文件。
    private readonly record struct StateEvent(long Sequence, string Type, long PeerId, string Message);
    private readonly record struct SaveEntry(string Name, long LastWriteUtcTicks, long Size);
}
