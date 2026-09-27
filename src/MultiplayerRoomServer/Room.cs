using System.Collections.Concurrent;

namespace FallenFlower.MultiplayerRoomServer;

internal sealed class Room(string id, string key, string name, int capacity, bool serverAuthoritative = false)
{
    private readonly object _membershipLock = new();
    private readonly object _worldLock = new();
    private readonly Dictionary<long, string> _sleepRequests = new();
    private long _nextPeerId;
    private DateTime _clockUpdatedUtc = DateTime.UtcNow;
    private double _gameTime;
    private double _timeOffset;
    private int _day;
    private int _timeOfDay;
    private long _worldSequence;
    private long _sleepSequence;
    private bool _clockSeeded;
    private bool _awaitingSleepCommit;
    private string _scene = string.Empty;
    private long _sceneSequence;

    public string Id { get; } = id;
    public string Key { get; } = key;
    public string Name { get; } = name;
    public int Capacity { get; } = capacity;
    public bool ServerAuthoritative { get; } = serverAuthoritative;
    public ConcurrentDictionary<long, ClientConnection> Members { get; } = new();
    public bool IsClosed { get; private set; }
    // 公开房间的 0 号权威属于服务器；旧版显式房间仍保留创建者权威以兼容协议。
    public long AuthorityPeerId { get; private set; }

    public bool TryAdd(ClientConnection client, out long peerId)
    {
        // 所有连接都是普通成员；容量检查与写入必须在同一临界区，避免并发加入时超员。
        lock (_membershipLock)
        {
            peerId = 0;
            if (IsClosed || Members.Count >= Capacity) return false;
            peerId = Interlocked.Increment(ref _nextPeerId);
            if (!Members.TryAdd(peerId, client)) return false;
            if (!ServerAuthoritative && AuthorityPeerId == 0) AuthorityPeerId = peerId;
            return true;
        }
    }

    public void Remove(long peerId)
    {
        lock (_worldLock) _sleepRequests.Remove(peerId);
    }

    public void SeedClock(double gameTime, int day, int timeOfDay, double timeOffset)
    {
        lock (_worldLock)
        {
            if (_clockSeeded) return;
            _gameTime = Math.Max(0, gameTime);
            _day = Math.Max(0, day);
            _timeOfDay = Math.Max(0, timeOfDay);
            _timeOffset = timeOffset;
            _clockUpdatedUtc = DateTime.UtcNow;
            _clockSeeded = true;
        }
    }

    public object? CreateClockPacket()
    {
        lock (_worldLock)
        {
            if (!ServerAuthoritative || !_clockSeeded || Members.IsEmpty) return null;
            var now = DateTime.UtcNow;
            _gameTime += Math.Clamp((now - _clockUpdatedUtc).TotalSeconds, 0, 1);
            _clockUpdatedUtc = now;
            return new { type = "worldTime", sequence = ++_worldSequence, gameTime = _gameTime,
                day = _day, timeOfDay = _timeOfDay, timeOffset = _timeOffset };
        }
    }

    public object? RequestSleep(long peerId, string mode)
    {
        lock (_worldLock)
        {
            _sleepRequests[peerId] = mode;
            if (Members.Count == 0 || Members.Keys.Any(id => !_sleepRequests.TryGetValue(id, out var requested) || requested != mode))
                return null;
            _sleepRequests.Clear();
            _awaitingSleepCommit = true;
            return new { type = "sleepApproved", mode, sequence = ++_sleepSequence };
        }
    }

    public void CommitApprovedSleep(double gameTime, int day, int timeOfDay, double timeOffset)
    {
        lock (_worldLock)
        {
            if (!_awaitingSleepCommit) return;
            _gameTime = Math.Max(0, gameTime);
            _day = Math.Max(_day, day);
            _timeOfDay = Math.Max(0, timeOfDay);
            _timeOffset = timeOffset;
            _clockUpdatedUtc = DateTime.UtcNow;
            _clockSeeded = true;
            _awaitingSleepCommit = false;
        }
    }

    public object RequestScene(string expectedScene, string requestedScene)
    {
        lock (_worldLock)
        {
            if (_scene.Length == 0 || string.Equals(_scene, expectedScene, StringComparison.Ordinal))
                _scene = requestedScene;
            return new { type = "serverScene", scene = _scene, sequence = ++_sceneSequence };
        }
    }

    public void Close()
    {
        lock (_membershipLock) IsClosed = true;
    }
}
