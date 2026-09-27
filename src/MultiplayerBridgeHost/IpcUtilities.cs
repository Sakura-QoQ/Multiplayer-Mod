using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FallenFlower.MultiplayerBridge;
using Microsoft.Win32;

namespace FallenFlower.MultiplayerBridgeHost;

internal static partial class Program
{
    // IPC 查询、注册表和 JSON 工具。
    private static Dictionary<string, string> ParseQuery(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = part.IndexOf('=');
            var key = separator < 0 ? part : part[..separator];
            var value = separator < 0 ? string.Empty : part[(separator + 1)..];
            result[Uri.UnescapeDataString(key)] = Uri.UnescapeDataString(value);
        }
        return result;
    }

    private static int ReadInt(RegistryKey registry, string name)
    {
        try { return Convert.ToInt32(registry.GetValue(FindUnityValueName(registry, name), 0), CultureInfo.InvariantCulture); }
        catch { return 0; }
    }

    private static string ReadString(RegistryKey registry, string name)
    {
        try
        {
            var value = registry.GetValue(FindUnityValueName(registry, name), string.Empty);
            // Unity 把字符串 PlayerPrefs 保存为以 NUL 结尾的 UTF-8 REG_BINARY，而不是 REG_SZ。
            if (value is byte[] bytes) return Encoding.UTF8.GetString(bytes).TrimEnd('\0');
            return Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        }
        catch { return string.Empty; }
    }

    private static string FindUnityValueName(RegistryKey registry, string logicalName)
    {
        // Unity 2022 的 Windows PlayerPrefs 会把键保存为“原名_h哈希”。优先使用该值，
        // 同时保留明文键兼容旧 Unity、测试工具以及将来的存储实现变化。
        var prefix = logicalName + "_h";
        foreach (var candidate in registry.GetValueNames())
        {
            if (candidate.StartsWith(prefix, StringComparison.Ordinal)) return candidate;
        }
        return logicalName;
    }

    private static int ReadInt(Dictionary<string, string> values, string key, int fallback) =>
        int.TryParse(values.GetValueOrDefault(key), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : fallback;

    private static string Escape(string value)
    {
        var builder = new StringBuilder(value.Length + 8);
        foreach (var character in value)
        {
            switch (character)
            {
                case '\\': builder.Append("\\\\"); break;
                case '"': builder.Append("\\\""); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (character < 0x20) builder.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                    else builder.Append(character);
                    break;
            }
        }
        return builder.ToString();
    }

}
