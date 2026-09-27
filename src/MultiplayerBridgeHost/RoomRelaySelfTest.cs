using FallenFlower.MultiplayerBridge;
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
        Console.WriteLine("PASS public room auto-entry, server authority and bidirectional relay");
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
