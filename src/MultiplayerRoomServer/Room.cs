using System.Collections.Concurrent;

namespace FallenFlower.MultiplayerRoomServer;

internal sealed class Room(string id, string key, string name, int capacity)
{
    private readonly object _membershipLock = new();
    private long _nextPeerId;

    public string Id { get; } = id;
    public string Key { get; } = key;
    public string Name { get; } = name;
    public int Capacity { get; } = capacity;
    public ConcurrentDictionary<long, ClientConnection> Members { get; } = new();
    public bool IsClosed { get; private set; }

    public bool TryAdd(ClientConnection client, out long peerId)
    {
        // 所有连接都是普通成员；容量检查与写入必须在同一临界区，避免并发加入时超员。
        lock (_membershipLock)
        {
            peerId = 0;
            if (IsClosed || Members.Count >= Capacity) return false;
            peerId = Interlocked.Increment(ref _nextPeerId);
            if (!Members.TryAdd(peerId, client)) return false;
            return true;
        }
    }

    public void Close()
    {
        lock (_membershipLock) IsClosed = true;
    }
}
