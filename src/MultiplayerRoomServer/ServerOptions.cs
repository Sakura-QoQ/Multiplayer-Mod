using System.Net;

namespace FallenFlower.MultiplayerRoomServer;

internal sealed record ServerOptions(
    IPAddress ListenAddress,
    int Port,
    int MaxRooms,
    int MaxPlayersPerRoom,
    int ClientTimeoutSeconds,
    int AfkTimeoutSeconds,
    string AdminToken)
{
    public static ServerOptions Parse(string[] args)
    {
        // 命令行优先于环境变量，便于容器默认配置被临时启动参数覆盖。
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index++)
        {
            var key = args[index];
            if (!key.StartsWith("--", StringComparison.Ordinal) || index + 1 >= args.Length)
                throw new ArgumentException($"Invalid argument: {key}");
            values[key[2..]] = args[++index];
        }

        var listenText = Value("listen", "FF_ROOM_LISTEN", "0.0.0.0");
        if (!IPAddress.TryParse(listenText, out var listenAddress))
            throw new ArgumentException("--listen must be an IPv4 or IPv6 address");

        var options = new ServerOptions(
            listenAddress,
            IntValue("port", "FF_ROOM_PORT", 27777, 1, 65535),
            IntValue("max-rooms", "FF_ROOM_MAX_ROOMS", 256, 1, 10_000),
            IntValue("max-players", "FF_ROOM_MAX_PLAYERS", 8, 2, 32),
            IntValue("client-timeout-seconds", "FF_ROOM_CLIENT_TIMEOUT_SECONDS", 300, 3, 3600),
            IntValue("afk-timeout-seconds", "FF_ROOM_AFK_TIMEOUT_SECONDS", 300, 3, 3600),
            Value("admin-token", "FF_ROOM_ADMIN_TOKEN", string.Empty));

        if (options.AdminToken.Length is > 0 and < 16)
            throw new ArgumentException("admin token must contain at least 16 characters");
        return options;

        string Value(string argument, string environment, string fallback) =>
            values.GetValueOrDefault(argument)
            ?? Environment.GetEnvironmentVariable(environment)
            ?? fallback;

        int IntValue(string argument, string environment, int fallback, int minimum, int maximum)
        {
            var text = Value(argument, environment, fallback.ToString());
            if (!int.TryParse(text, out var value) || value < minimum || value > maximum)
                throw new ArgumentException($"--{argument} must be between {minimum} and {maximum}");
            return value;
        }
    }
}
