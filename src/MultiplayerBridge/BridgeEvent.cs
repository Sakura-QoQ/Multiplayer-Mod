namespace FallenFlower.MultiplayerBridge;

// 原生 DLL 与 TypeScript 之间传递的统一事件结构。
public readonly record struct BridgeEvent(string Type, long PeerId = 0, string Message = "")
{
    public string ToJson()
    {
        return $"{{\"type\":\"{Escape(Type)}\",\"peerId\":{PeerId},\"message\":\"{Escape(Message)}\"}}";
    }

    private static string Escape(string value)
    {
        // NativeAOT 构建尽量少依赖反射式 JSON 序列化，因此这里手动完成必要的 JSON 字符转义。
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var result = new System.Text.StringBuilder(value.Length + 8);
        foreach (var character in value)
        {
            switch (character)
            {
                case '\\': result.Append("\\\\"); break;
                case '"': result.Append("\\\""); break;
                case '\n': result.Append("\\n"); break;
                case '\r': result.Append("\\r"); break;
                case '\t': result.Append("\\t"); break;
                default:
                    if (character < 0x20)
                    {
                        result.Append("\\u").Append(((int)character).ToString("x4"));
                    }
                    else
                    {
                        result.Append(character);
                    }
                    break;
            }
        }

        return result.ToString();
    }
}
