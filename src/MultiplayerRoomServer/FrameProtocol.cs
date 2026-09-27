using System.Buffers.Binary;
using System.Net.Sockets;
using System.Text.Json;

namespace FallenFlower.MultiplayerRoomServer;

internal static class FrameProtocol
{
    // 与现有 Mod 网络层一致：4 字节大端长度 + UTF-8 JSON。
    public const int MaxFrameBytes = 64 * 1024;

    public static async Task<JsonDocument?> ReadJsonAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var header = new byte[4];
        if (!await ReadExactlyAsync(stream, header, allowCleanEnd: true, cancellationToken)) return null;
        var length = BinaryPrimitives.ReadInt32BigEndian(header);
        if (length is <= 0 or > MaxFrameBytes) throw new InvalidDataException("invalid frame length");
        var payload = new byte[length];
        await ReadExactlyAsync(stream, payload, allowCleanEnd: false, cancellationToken);
        return JsonDocument.Parse(payload, new JsonDocumentOptions { MaxDepth = 16 });
    }

    public static byte[] Serialize(object value)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(value);
        if (payload.Length > MaxFrameBytes) throw new InvalidDataException("response exceeds frame limit");
        var frame = new byte[payload.Length + 4];
        BinaryPrimitives.WriteInt32BigEndian(frame, payload.Length);
        payload.CopyTo(frame.AsSpan(4));
        return frame;
    }

    public static string RequiredString(JsonElement root, string name, int maximumLength)
    {
        if (!root.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String)
            throw new ProtocolException("invalid_request", $"{name} is required");
        var value = element.GetString()?.Trim() ?? string.Empty;
        if (value.Length is 0 || value.Length > maximumLength)
            throw new ProtocolException("invalid_request", $"{name} length is invalid");
        return value;
    }

    public static string OptionalString(JsonElement root, string name, int maximumLength)
    {
        if (!root.TryGetProperty(name, out var element) || element.ValueKind == JsonValueKind.Null) return string.Empty;
        if (element.ValueKind != JsonValueKind.String)
            throw new ProtocolException("invalid_request", $"{name} must be a string");
        var value = element.GetString() ?? string.Empty;
        if (value.Length > maximumLength)
            throw new ProtocolException("invalid_request", $"{name} is too long");
        return value;
    }

    private static async Task<bool> ReadExactlyAsync(
        NetworkStream stream, byte[] buffer, bool allowCleanEnd, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset), cancellationToken);
            if (read == 0)
            {
                if (allowCleanEnd && offset == 0) return false;
                throw new EndOfStreamException();
            }
            offset += read;
        }
        return true;
    }
}

internal sealed class ProtocolException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
