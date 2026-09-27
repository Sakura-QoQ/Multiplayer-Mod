using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FallenFlower.MultiplayerBridge;

namespace FallenFlower.MultiplayerBridgeHost;

internal static partial class Program
{
    // 线上存档会话与单机存档恢复。
    private static void DiscardRedundantActiveSaves()
    {
        try
        {
            var saveDirectory = GetSaveDirectory();
            if (!Directory.Exists(saveDirectory)) return;
            foreach (var activePath in Directory.EnumerateFiles(saveDirectory,
                         ActiveSavePrefix + "*.save", SearchOption.TopDirectoryOnly))
            {
                var activeName = Path.GetFileNameWithoutExtension(activePath);
                var onlinePath = Path.Combine(saveDirectory, ToOnlineSaveName(activeName) + ".save");
                if (!File.Exists(onlinePath)) continue;
                try
                {
                    // 只有正式档通过外层认证和内层文件头验证，才丢弃旧版工作副本。
                    _ = DecryptOuterLayer(File.ReadAllBytes(onlinePath));
                    File.Delete(activePath);
                    ProtectedHashes.Remove(activePath);
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                catch (CryptographicException) { }
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void EnsureActiveRecoveryCopy()
    {
        if (_activeOnlineSaveName.Length == 0 || _activeSaveDirectory.Length == 0) return;
        var activePath = Path.Combine(_activeSaveDirectory, ToActiveSaveName(_activeOnlineSaveName) + ".save");
        var onlinePath = Path.Combine(_activeSaveDirectory, _activeOnlineSaveName + ".save");
        if (File.Exists(activePath) || !File.Exists(onlinePath)) return;
        try
        {
            var originalGameCiphertext = DecryptOuterLayer(File.ReadAllBytes(onlinePath));
            if (!originalGameCiphertext.AsSpan().StartsWith("Encrypted"u8)) return;
            WriteAtomic(activePath, originalGameCiphertext);
            ProtectedHashes[activePath] = Convert.ToHexString(SHA256.HashData(originalGameCiphertext));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        catch (CryptographicException exception)
        {
            AddEvent(new BridgeEvent("error", 0, "Failed to recover the online working copy: " + exception.Message));
        }
    }

    private static int PrepareOnlineSave(Dictionary<string, string> values, string? saveDirectoryOverride = null)
    {
        _onlineSaveWritesEnabled = false;
        var onlineName = NormalizeOnlineSaveName(values.GetValueOrDefault("name", string.Empty));
        var strictName = values.GetValueOrDefault("strict", string.Empty) == "1";
        var saveDirectory = saveDirectoryOverride ?? GetSaveDirectory();
        Directory.CreateDirectory(saveDirectory);
        // 游戏侧记忆可能为空，状态快照也可能尚未刷新。没有指定名称时由桥接程序直接
        // 扫描磁盘，并在正式档和工作副本中选择最近使用的 UUID，绝不能因此新建角色。
        if (!strictName && (onlineName.Length == 0 ||
            (!File.Exists(Path.Combine(saveDirectory, onlineName + ".save")) &&
             !File.Exists(Path.Combine(saveDirectory, ToActiveSaveName(onlineName) + ".save")))))
        {
            // 记住的 UUID 已过期时也回退到最近的真实磁盘存档；界面已经移除手动选档，
            // 因此保留一个不存在的旧选择没有意义，更不能据此创建第二个角色。
            var latestName = FindLatestOnlineSaveName(saveDirectory);
            if (latestName.Length > 0) onlineName = latestName;
        }
        if (onlineName.Length == 0) return -3;

        BeginOnlineSaveSession(onlineName, saveDirectory);
        var onlinePath = Path.Combine(saveDirectory, onlineName + ".save");
        var activeName = ToActiveSaveName(onlineName);
        var activePath = Path.Combine(saveDirectory, activeName + ".save");
        byte[] originalGameCiphertext;
        if (File.Exists(onlinePath))
        {
            originalGameCiphertext = DecryptOuterLayer(File.ReadAllBytes(onlinePath));
        }
        else if (File.Exists(activePath))
        {
            // 正式档暂时不可见或上次封装中断时，同 UUID 工作副本是权威恢复来源。
            // 只有通过原版 Encrypted 文件头检查后才重新生成正式双层密文。
            originalGameCiphertext = File.ReadAllBytes(activePath);
            if (!originalGameCiphertext.AsSpan().StartsWith("Encrypted"u8)) return -5;
            WriteAtomic(onlinePath, EncryptOuterLayer(originalGameCiphertext));
            AddEvent(new BridgeEvent("saveRecovered", 0, onlineName));
        }
        else return -3;

        WriteAtomic(activePath, originalGameCiphertext);
        ProtectedHashes[activePath] = Convert.ToHexString(SHA256.HashData(originalGameCiphertext));
        AddEvent(new BridgeEvent("saveMetadata", 0, BuildSaveMetadata(onlineName, originalGameCiphertext)));
        AddEvent(new BridgeEvent("savePrepared", 0, activeName));
        return 0;
    }

    // MPOnline 带有 Mod 外层加密，原版游戏只能读取临时解出的 Encrypted 工作文件。
    // 游戏确认加载完成后立即删除工作文件，因此稳定状态下每个角色只保留一个 MPOnline 文件。
    private static int ReleasePreparedOnlineSave()
    {
        if (_activeOnlineSaveName.Length == 0 || _activeSaveDirectory.Length == 0) return -2;
        var onlinePath = Path.Combine(_activeSaveDirectory, _activeOnlineSaveName + ".save");
        var activePath = Path.Combine(_activeSaveDirectory, ToActiveSaveName(_activeOnlineSaveName) + ".save");
        try
        {
            if (!File.Exists(onlinePath) || new FileInfo(onlinePath).Length == 0) return -5;
            _ = DecryptOuterLayer(File.ReadAllBytes(onlinePath));
            if (File.Exists(activePath)) File.Delete(activePath);
            ProtectedHashes.Remove(activePath);
            return 0;
        }
        catch (IOException) { return -6; }
        catch (UnauthorizedAccessException) { return -6; }
        catch (CryptographicException) { return -5; }
    }

    private static string FindLatestOnlineSaveName(string saveDirectory)
    {
        try
        {
            return Directory.EnumerateFiles(saveDirectory, "*.save", SearchOption.TopDirectoryOnly)
                .Select(path => new FileInfo(path))
                .Where(file => file.Name.StartsWith(OnlineSavePrefix, StringComparison.Ordinal) ||
                               file.Name.StartsWith(ActiveSavePrefix, StringComparison.Ordinal))
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .Select(file => Path.GetFileNameWithoutExtension(file.Name))
                .Select(name => name.StartsWith(ActiveSavePrefix, StringComparison.Ordinal)
                    ? ToOnlineSaveName(name)
                    : name)
                .FirstOrDefault() ?? string.Empty;
        }
        catch (IOException) { return string.Empty; }
        catch (UnauthorizedAccessException) { return string.Empty; }
    }

    private static int BeginOnlineSave(Dictionary<string, string> values)
    {
        var onlineName = NormalizeOnlineSaveName(values.GetValueOrDefault("name", string.Empty));
        if (onlineName.Length == 0) return -2;
        _onlineSaveWritesEnabled = false;
        BeginOnlineSaveSession(onlineName);
        return 0;
    }

    // 旧版使用毫秒时间戳命名。升级时只改正式线上文件名，不解密、不改存档内容，
    // 并且绝不覆盖已经存在的 UUIDv7 目标文件。
    private static int RenameOnlineSave(Dictionary<string, string> values, string? saveDirectoryOverride = null)
    {
        var sourceName = NormalizeOnlineSaveName(values.GetValueOrDefault("name", string.Empty));
        var targetName = NormalizeOnlineSaveName(values.GetValueOrDefault("target", string.Empty));
        if (sourceName.Length == 0 || targetName.Length == 0) return -2;
        if (sourceName.Equals(targetName, StringComparison.Ordinal)) return 0;
        var saveDirectory = saveDirectoryOverride ?? GetSaveDirectory();
        var sourcePath = Path.Combine(saveDirectory, sourceName + ".save");
        var targetPath = Path.Combine(saveDirectory, targetName + ".save");
        if (!File.Exists(sourcePath)) return -3;
        if (File.Exists(targetPath)) return -4;
        File.Move(sourcePath, targetPath, false);
        if (_activeOnlineSaveName.Equals(sourceName, StringComparison.Ordinal))
            _activeOnlineSaveName = targetName;
        AddEvent(new BridgeEvent("saveRenamed", 0, targetName));
        return 0;
    }

    private static void BeginOnlineSaveSession(string onlineName, string? saveDirectoryOverride = null)
    {
        if (_activeOnlineSaveName == onlineName) return;
        _activeOnlineSaveName = onlineName;
        _activeSaveDirectory = saveDirectoryOverride ?? GetSaveDirectory();
        Directory.CreateDirectory(_activeSaveDirectory);
    }

}
