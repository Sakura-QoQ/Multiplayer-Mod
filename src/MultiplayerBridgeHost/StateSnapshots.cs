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
    // 网络事件与桥接状态快照。
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
                .Append(",\"running\":true")
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
            .Append(",\"running\":false,\"heartbeatUtcTicks\":0,\"state\":\"stopped\",\"port\":0,\"peers\":0,")
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
        // 桥接只写当前 50ms 槽，游戏读取两个槽之前的文件，因此 ReadModFile 永远不会
        // 与 File.Move 争用同一路径，同时把状态文件链路延迟控制在约 100~150ms。
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
            ?? throw new InvalidOperationException("Unable to determine the AppData directory");
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

}
