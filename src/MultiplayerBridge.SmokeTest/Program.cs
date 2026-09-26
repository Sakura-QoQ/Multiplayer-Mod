using FallenFlower.MultiplayerBridge;

using var host = new BridgeNode();
using var client = new BridgeNode();

Require(host.StartHost(0, 4) == 0, "host did not start");
Require(client.Join("127.0.0.1", host.BoundPort) == 0, "client did not start joining");

var hostConnected = await WaitForAsync(host, "connected");
await WaitForAsync(client, "connected");

Require(client.Send(0, "hello-from-client") == 0, "client send failed");
var receivedByHost = await WaitForAsync(host, "message");
Require(receivedByHost.Message == "hello-from-client", "host received the wrong payload");

Require(host.Send(hostConnected.PeerId, "hello-from-host") == 0, "host send failed");
var receivedByClient = await WaitForAsync(client, "message");
Require(receivedByClient.Message == "hello-from-host", "client received the wrong payload");

Console.WriteLine($"PASS hostPort={host.BoundPort} peerId={hostConnected.PeerId}");

static async Task<BridgeEvent> WaitForAsync(BridgeNode node, string eventType)
{
    var deadline = DateTime.UtcNow.AddSeconds(5);
    while (DateTime.UtcNow < deadline)
    {
        while (node.TryPoll(out var bridgeEvent))
        {
            if (bridgeEvent.Type == "error")
            {
                throw new InvalidOperationException(bridgeEvent.Message);
            }
            if (bridgeEvent.Type == eventType)
            {
                return bridgeEvent;
            }
        }
        await Task.Delay(10);
    }
    throw new TimeoutException($"timed out waiting for {eventType}");
}

static void Require(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}
