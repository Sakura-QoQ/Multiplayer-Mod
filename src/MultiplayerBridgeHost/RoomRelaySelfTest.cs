using FallenFlower.MultiplayerBridge;
using System.Text.Json;

namespace FallenFlower.MultiplayerBridgeHost;

internal static partial class Program
{
    private static async Task SelfTestRoomRelayAsync(string address, int port)
    {
        var roomId = "selftest-" + Guid.NewGuid().ToString("N")[..12];
        using var creator = new RoomRelayClient();
        using var joiner = new RoomRelayClient();
        if (creator.EnterPublicRoom(address, port, roomId, "Creator", 4) != 0)
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

        if (joiner.EnterPublicRoom(address, port, roomId, "Joiner", 4) != 0)
            throw new InvalidOperationException("Could not start the room joiner relay");
        var joinerReady = await WaitForEventAsync(joiner, "roomReady", TimeSpan.FromSeconds(10));
        if (joinerReady.PeerId <= 0 || joinerReady.PeerId == creatorReady.PeerId)
            throw new InvalidOperationException("Joiner received an invalid peer ID");

        _ = await WaitForEventAsync(joiner, "connected", TimeSpan.FromSeconds(5));
        const string creatorPayload = "{\"type\":\"selfTest\",\"value\":\"creator-to-member\"}";
        if (creator.Send(0, creatorPayload) != 0) throw new InvalidOperationException("Creator broadcast failed");
        var fromCreator = await WaitForEventAsync(joiner, "message", TimeSpan.FromSeconds(5));
        if (fromCreator.PeerId != creatorReady.PeerId || fromCreator.Message != creatorPayload)
            throw new InvalidOperationException("Creator message did not preserve its ordinary member identity");

        const string joinerPayload = "{\"type\":\"selfTest\",\"value\":\"member-to-member\"}";
        if (joiner.Send(0, joinerPayload) != 0) throw new InvalidOperationException("Joiner send failed");
        var fromJoiner = await WaitForEventAsync(creator, "message", TimeSpan.FromSeconds(5));
        if (fromJoiner.PeerId != joinerReady.PeerId || fromJoiner.Message != joinerPayload)
            throw new InvalidOperationException("Joiner message was not relayed to the creator");
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
}
