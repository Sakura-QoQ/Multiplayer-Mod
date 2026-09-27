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
    // 线上存档会话与单机存档恢复。
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
        var onlineName = NormalizeOnlineSaveName(values.GetValueOrDefault("name", string.Empty));
        var strictName = values.GetValueOrDefault("strict", string.Empty) == "1";
        var saveDirectory = saveDirectoryOverride ?? GetSaveDirectory();
        Directory.CreateDirectory(saveDirectory);
        // PlayerPrefs 可能被清除，状态快照也可能尚未刷新。没有指定名称时由桥接程序直接
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
        RestoreSinglePlayerAutoSave();
        _activeOnlineSaveName = onlineName;
        _activeSaveDirectory = saveDirectoryOverride ?? GetSaveDirectory();
        Directory.CreateDirectory(_activeSaveDirectory);
        var autoSavePath = Path.Combine(_activeSaveDirectory, "AutoSave.save");
        _singlePlayerAutoSaveExisted = File.Exists(autoSavePath);
        _singlePlayerAutoSaveBackup = _singlePlayerAutoSaveExisted ? File.ReadAllBytes(autoSavePath) : null;
        _autoSaveObservedHash = _singlePlayerAutoSaveBackup is null
            ? string.Empty
            : Convert.ToHexString(SHA256.HashData(_singlePlayerAutoSaveBackup));
    }

    private static void RedirectOnlineAutoSave()
    {
        if (_activeOnlineSaveName.Length == 0) return;
        try
        {
            var saveDirectory = _activeSaveDirectory;
            if (saveDirectory.Length == 0) return;
            var autoSavePath = Path.Combine(saveDirectory, "AutoSave.save");
            if (!File.Exists(autoSavePath)) return;
            var current = File.ReadAllBytes(autoSavePath);
            var hash = Convert.ToHexString(SHA256.HashData(current));
            if (hash == _autoSaveObservedHash) return;
            if (!current.AsSpan().StartsWith("Encrypted"u8)) return;

            // 兼容旧版脚本或未经过 Hook 的原版自动保存：发现 AutoSave 改动时转存到临时线上档，
            // 随后立即恢复玩家的线下 AutoSave，避免联机进度污染或覆盖单机进度。
            var activePath = Path.Combine(saveDirectory, ToActiveSaveName(_activeOnlineSaveName) + ".save");
            WriteAtomic(activePath, current);
            RestoreSinglePlayerAutoSaveFile(autoSavePath);
            _autoSaveObservedHash = _singlePlayerAutoSaveBackup is null
                ? string.Empty
                : Convert.ToHexString(SHA256.HashData(_singlePlayerAutoSaveBackup));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void RestoreSinglePlayerAutoSave()
    {
        if (_activeOnlineSaveName.Length == 0) return;
        try
        {
            RestoreSinglePlayerAutoSaveFile(Path.Combine(_activeSaveDirectory, "AutoSave.save"));
        }
        catch { }
        _activeOnlineSaveName = string.Empty;
        _activeSaveDirectory = string.Empty;
        _singlePlayerAutoSaveBackup = null;
        _singlePlayerAutoSaveExisted = false;
        _autoSaveObservedHash = string.Empty;
    }

    private static void RestoreSinglePlayerAutoSaveFile(string autoSavePath)
    {
        if (_singlePlayerAutoSaveExisted && _singlePlayerAutoSaveBackup is not null)
            WriteAtomic(autoSavePath, _singlePlayerAutoSaveBackup);
        else if (File.Exists(autoSavePath))
            File.Delete(autoSavePath);
    }

}
