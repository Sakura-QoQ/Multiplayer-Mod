using FallenFlower.MultiplayerBridge;
using System.Buffers.Binary;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace FallenFlower.MultiplayerBridgeHost;

internal static partial class Program
{
    private static async Task SelfTestRoomRelayAsync(string address, int port)
    {
        var initialCapacity = 0;
        using (var browser = new RoomRelayClient())
        {
            if (browser.ListPublicRooms(address, port) != 0)
                throw new InvalidOperationException("Could not request the public room list");
            var listEvent = await WaitForEventAsync(browser, "roomList", TimeSpan.FromSeconds(10));
            using var list = JsonDocument.Parse(listEvent.Message);
            if (!list.RootElement.TryGetProperty("rooms", out var rooms) || rooms.GetArrayLength() != 1)
                throw new InvalidOperationException("A fresh server did not expose exactly one real public room");
            initialCapacity = rooms[0].GetProperty("capacity").GetInt32();
        }
        const string roomId = "public-1";
        using var creator = new RoomRelayClient();
        using var joiner = new RoomRelayClient();
        if (creator.EnterPublicRoom(address, port, roomId, "Creator") != 0)
            throw new InvalidOperationException("Could not start the room creator relay");
        var creatorReady = await WaitForEventAsync(creator, "roomReady", TimeSpan.FromSeconds(10));
        if (creatorReady.PeerId <= 0) throw new InvalidOperationException("Creator received an invalid peer ID");
        using (var ready = JsonDocument.Parse(creatorReady.Message))
        {
            if (ready.RootElement.GetProperty("authorityPeerId").GetInt64() != 0 ||
                ready.RootElement.GetProperty("creator").GetBoolean() ||
                !ready.RootElement.GetProperty("serverAuthority").GetBoolean())
                throw new InvalidOperationException("Public room did not retain authority on the server");
        }

        if (joiner.EnterPublicRoom(address, port, roomId, "Joiner") != 0)
            throw new InvalidOperationException("Could not start the room joiner relay");
        var joinerReady = await WaitForEventAsync(joiner, "roomReady", TimeSpan.FromSeconds(10));
        if (joinerReady.PeerId <= 0 || joinerReady.PeerId == creatorReady.PeerId)
            throw new InvalidOperationException("Joiner received an invalid peer ID");

        using (var populatedBrowser = new RoomRelayClient())
        {
            if (populatedBrowser.ListPublicRooms(address, port) != 0)
                throw new InvalidOperationException("Could not refresh the populated room list");
            var populatedEvent = await WaitForEventAsync(populatedBrowser, "roomList", TimeSpan.FromSeconds(10));
            using var populated = JsonDocument.Parse(populatedEvent.Message);
            var listedRoom = populated.RootElement.GetProperty("rooms").EnumerateArray()
                .FirstOrDefault(room => room.GetProperty("roomId").GetString() == roomId);
            if (listedRoom.ValueKind == JsonValueKind.Undefined || listedRoom.GetProperty("players").GetInt32() != 2)
                throw new InvalidOperationException("Public room population did not update to two players");
            if (initialCapacity == 2 && !populated.RootElement.GetProperty("rooms").EnumerateArray()
                    .Any(room => room.GetProperty("roomId").GetString() == "public-2" &&
                        room.GetProperty("players").GetInt32() == 0 &&
                        room.GetProperty("capacity").GetInt32() == initialCapacity))
                throw new InvalidOperationException("The server did not create the next real room after capacity was reached");
        }

        _ = await WaitForEventAsync(joiner, "connected", TimeSpan.FromSeconds(5));
        const string creatorPayload = "{\"type\":\"selfTest\",\"value\":\"creator-to-member\"}";
        if (creator.Send(0, creatorPayload) != 0) throw new InvalidOperationException("Creator broadcast failed");
        var fromCreator = await WaitForPayloadTypeAsync(joiner, "selfTest", TimeSpan.FromSeconds(5));
        if (fromCreator.PeerId != creatorReady.PeerId || fromCreator.Message != creatorPayload)
            throw new InvalidOperationException("Creator message did not preserve its ordinary member identity");

        const string joinerPayload = "{\"type\":\"selfTest\",\"value\":\"member-to-member\"}";
        if (joiner.Send(0, joinerPayload) != 0) throw new InvalidOperationException("Joiner send failed");
        var fromJoiner = await WaitForPayloadTypeAsync(creator, "selfTest", TimeSpan.FromSeconds(5));
        if (fromJoiner.PeerId != joinerReady.PeerId || fromJoiner.Message != joinerPayload)
            throw new InvalidOperationException("Joiner message was not relayed to the creator");

        var seed = "{\"type\":\"serverTimeSeed\",\"gameTime\":42.5,\"day\":3," +
            "\"timeOfDay\":2,\"timeOffset\":0}";
        if (creator.Send(0, seed) != 0) throw new InvalidOperationException("Server clock seed failed");
        var creatorClock = await WaitForPayloadTypeAsync(creator, "worldTime", TimeSpan.FromSeconds(5));
        var joinerClock = await WaitForPayloadTypeAsync(joiner, "worldTime", TimeSpan.FromSeconds(5));
        if (creatorClock.PeerId != 0 || joinerClock.PeerId != 0)
            throw new InvalidOperationException("World clock did not originate from server authority peer zero");

        if (creator.Send(0, "{\"type\":\"sleepRequest\",\"mode\":\"short\"}") != 0 ||
            joiner.Send(0, "{\"type\":\"sleepRequest\",\"mode\":\"short\"}") != 0)
            throw new InvalidOperationException("Sleep consensus request failed");
        var creatorSleep = await WaitForPayloadTypeAsync(creator, "sleepApproved", TimeSpan.FromSeconds(5));
        var joinerSleep = await WaitForPayloadTypeAsync(joiner, "sleepApproved", TimeSpan.FromSeconds(5));
        if (creatorSleep.PeerId != 0 || joinerSleep.PeerId != 0)
            throw new InvalidOperationException("Sleep approval did not originate from the server");

        // 断开一个成员后，服务器必须立即释放并复用最小空闲编号；房间容量不是递增计数器。
        creator.Stop();
        var creatorLeft = await WaitForEventAsync(joiner, "disconnected", TimeSpan.FromSeconds(5));
        if (creatorLeft.PeerId != creatorReady.PeerId)
            throw new InvalidOperationException("The remaining member did not observe the departed peer ID");
        using var replacement = new RoomRelayClient();
        if (replacement.EnterPublicRoom(address, port, roomId, "Replacement") != 0)
            throw new InvalidOperationException("Could not start the replacement room member");
        var replacementReady = await WaitForEventAsync(replacement, "roomReady", TimeSpan.FromSeconds(10));
        if (replacementReady.PeerId != creatorReady.PeerId)
            throw new InvalidOperationException("The server did not reuse the smallest released peer ID");

        // 模拟没有正常关闭、也不再发送任何数据的半开客户端。测试服务器使用缩短的
        // 空闲阈值，必须主动关闭并释放相同编号，而不是依赖操作系统的 TCP KeepAlive。
        joiner.Stop();
        replacement.Stop();
        await Task.Delay(500);
        var timedOutPeerId = await WaitForSilentClientTimeoutAsync(address, port, roomId);
        await Task.Delay(500); // 等待服务端连接处理器完成 finally -> LeaveRoomAsync。
        using var afterTimeout = new RoomRelayClient();
        if (afterTimeout.EnterPublicRoom(address, port, roomId, "AfterTimeout") != 0)
            throw new InvalidOperationException("Could not start a member after the idle timeout");
        var afterTimeoutReady = await WaitForEventAsync(afterTimeout, "roomReady", TimeSpan.FromSeconds(10));
        if (afterTimeoutReady.PeerId != timedOutPeerId)
            throw new InvalidOperationException("The server did not release the timed-out peer ID");

        // 持续发送相同坐标的位置包，使 TCP 保持活跃，但有效位置五分钟不变时仍应按挂机清理。
        // 测试服务器把该阈值缩短到 3 秒。
        afterTimeout.Stop();
        await Task.Delay(500);
        var afkPeerId = await WaitForStationaryClientTimeoutAsync(address, port, roomId);
        await Task.Delay(500);
        using var afterAfk = new RoomRelayClient();
        if (afterAfk.EnterPublicRoom(address, port, roomId, "AfterAfk") != 0)
            throw new InvalidOperationException("Could not start a member after the AFK timeout");
        var afterAfkReady = await WaitForEventAsync(afterAfk, "roomReady", TimeSpan.FromSeconds(10));
        if (afterAfkReady.PeerId != afkPeerId)
            throw new InvalidOperationException("The server did not release the AFK peer ID");

        Console.WriteLine("PASS public room auto-entry, TCP inactivity and AFK timeouts, reusable peer IDs, server authority and bidirectional relay");
    }

    private static async Task<long> WaitForSilentClientTimeoutAsync(string address, int port, string roomId)
    {
        using var client = new TcpClient();
        await client.ConnectAsync(address, port);
        var stream = client.GetStream();
        var encodedRoomId = JsonEncodedText.Encode(roomId).ToString();
        await WriteTestFrameAsync(stream, "{\"type\":\"room.enter\",\"roomId\":\"" + encodedRoomId +
            "\",\"roomName\":\"" + encodedRoomId + "\",\"playerName\":\"SilentClient\"}");

        long peerId = 0;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(22));
        try
        {
            while (true)
            {
                using var document = await ReadTestFrameAsync(stream, timeout.Token);
                if (document is null) break;
                var root = document.RootElement;
                if (root.TryGetProperty("type", out var type) && type.GetString() == "room.ready")
                    peerId = root.GetProperty("peerId").GetInt64();
            }
        }
        catch (Exception exception) when (exception is IOException or SocketException) { }
        catch (OperationCanceledException)
        {
            throw new InvalidOperationException("The test server did not disconnect the silent client within 22 seconds");
        }
        if (peerId <= 0) throw new InvalidOperationException("The silent client did not enter the room");
        return peerId;
    }

    private static async Task<long> WaitForStationaryClientTimeoutAsync(string address, int port, string roomId)
    {
        using var client = new TcpClient();
        await client.ConnectAsync(address, port);
        var stream = client.GetStream();
        var encodedRoomId = JsonEncodedText.Encode(roomId).ToString();
        await WriteTestFrameAsync(stream, "{\"type\":\"room.enter\",\"roomId\":\"" + encodedRoomId +
            "\",\"roomName\":\"" + encodedRoomId + "\",\"playerName\":\"StationaryClient\"}");

        long peerId = 0;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(22));
        using var senderCancellation = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
        var sender = Task.Run(async () =>
        {
            var fixedPlayerState = "{\"type\":\"room.send\",\"targetPeerId\":0," +
                "\"payload\":\"{\\\"type\\\":\\\"playerState\\\",\\\"scene\\\":\\\"SelfTest\\\"," +
                "\\\"position\\\":{\\\"x\\\":1,\\\"y\\\":2,\\\"z\\\":3}}\"}";
            try
            {
                while (!senderCancellation.IsCancellationRequested)
                {
                    await Task.Delay(250, senderCancellation.Token);
                    await WriteTestFrameAsync(stream, fixedPlayerState);
                }
            }
            catch (Exception exception) when (exception is IOException or SocketException or ObjectDisposedException or OperationCanceledException) { }
        });
        try
        {
            while (true)
            {
                using var document = await ReadTestFrameAsync(stream, deadline.Token);
                if (document is null) break;
                var root = document.RootElement;
                if (root.TryGetProperty("type", out var type) && type.GetString() == "room.ready")
                    peerId = root.GetProperty("peerId").GetInt64();
            }
        }
        catch (Exception exception) when (exception is IOException or SocketException) { }
        catch (OperationCanceledException)
        {
            throw new InvalidOperationException("The test server did not disconnect the stationary client within 22 seconds");
        }
        finally
        {
            senderCancellation.Cancel();
            await sender;
        }
        if (peerId <= 0) throw new InvalidOperationException("The stationary client did not enter the room");
        return peerId;
    }

    private static async Task WriteTestFrameAsync(NetworkStream stream, string json)
    {
        var payload = Encoding.UTF8.GetBytes(json);
        var frame = new byte[payload.Length + 4];
        BinaryPrimitives.WriteInt32BigEndian(frame, payload.Length);
        payload.CopyTo(frame.AsSpan(4));
        await stream.WriteAsync(frame);
        await stream.FlushAsync();
    }

    private static async Task<JsonDocument?> ReadTestFrameAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var header = new byte[4];
        if (!await ReadTestExactlyAsync(stream, header, cancellationToken)) return null;
        var length = BinaryPrimitives.ReadInt32BigEndian(header);
        if (length is <= 0 or > 64 * 1024) throw new InvalidDataException("Invalid test frame length");
        var payload = new byte[length];
        if (!await ReadTestExactlyAsync(stream, payload, cancellationToken)) throw new EndOfStreamException();
        return JsonDocument.Parse(payload);
    }

    private static async Task<bool> ReadTestExactlyAsync(
        NetworkStream stream, byte[] buffer, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset), cancellationToken);
            if (read == 0) return false;
            offset += read;
        }
        return true;
    }

    private static async Task<BridgeEvent> WaitForEventAsync(
        RoomRelayClient client, string eventType, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            while (client.TryPoll(out var bridgeEvent))
            {
                if (bridgeEvent.Type == "error") throw new InvalidOperationException(bridgeEvent.Message);
                if (bridgeEvent.Type == eventType) return bridgeEvent;
            }
            await Task.Delay(10);
        }
        throw new TimeoutException($"Timed out waiting for {eventType}");
    }

    private static async Task<BridgeEvent> WaitForPayloadTypeAsync(
        RoomRelayClient client, string payloadType, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            while (client.TryPoll(out var bridgeEvent))
            {
                if (bridgeEvent.Type == "error") throw new InvalidOperationException(bridgeEvent.Message);
                if (bridgeEvent.Type != "message") continue;
                using var payload = JsonDocument.Parse(bridgeEvent.Message);
                if (payload.RootElement.TryGetProperty("type", out var type) && type.GetString() == payloadType)
                    return bridgeEvent;
            }
            await Task.Delay(10);
        }
        throw new TimeoutException($"Timed out waiting for payload {payloadType}");
    }
}
