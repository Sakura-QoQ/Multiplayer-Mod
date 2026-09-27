namespace FallenFlower.MultiplayerRoomServer;

internal static class Program
{
    // 管理接口用此时间计算进程运行时长，不代表任何游戏世界时间。
    public static DateTime StartedUtc { get; } = DateTime.UtcNow;

    private static async Task<int> Main(string[] args)
    {
        try
        {
            var options = ServerOptions.Parse(args);
            await using var server = new RoomServer(options);
            Console.CancelKeyPress += (_, eventArgs) =>
            {
                eventArgs.Cancel = true;
                server.Stop();
            };
            AppDomain.CurrentDomain.ProcessExit += (_, _) => server.Stop();
            await server.RunAsync();
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception.Message);
            return 1;
        }
    }
}
