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
    // 存档保护、双层加密与自检。
    private static void ProtectActiveSaves(bool deleteActive, string? saveDirectoryOverride = null)
    {
        try
        {
            var saveDirectory = saveDirectoryOverride ?? GetSaveDirectory();
            if (!Directory.Exists(saveDirectory)) return;
            foreach (var activePath in Directory.EnumerateFiles(saveDirectory, ActiveSavePrefix + "*.save", SearchOption.TopDirectoryOnly))
            {
                try
                {
                    var activeName = Path.GetFileNameWithoutExtension(activePath);
                    var onlinePath = Path.Combine(saveDirectory, ToOnlineSaveName(activeName) + ".save");
                    if (_saveProtectionName.Length > 0 &&
                        !onlinePath.Equals(Path.Combine(saveDirectory, _saveProtectionName + ".save"),
                            StringComparison.OrdinalIgnoreCase))
                        continue;
                    var originalGameCiphertext = File.ReadAllBytes(activePath);
                    if (originalGameCiphertext.Length == 0)
                    {
                        // 游戏中断进场时可能只创建空占位文件；退出清理不能让它永久残留。
                        if (deleteActive) File.Delete(activePath);
                        continue;
                    }
                    // 第一层必须仍然是游戏自己的 Encrypted 存档，拒绝把损坏或明文文件封装成线上存档。
                    if (!originalGameCiphertext.AsSpan().StartsWith("Encrypted"u8)) continue;
                    var hash = Convert.ToHexString(SHA256.HashData(originalGameCiphertext));
                    if (!File.Exists(onlinePath) ||
                        !ProtectedHashes.TryGetValue(activePath, out var previousHash) || previousHash != hash)
                    {
                        WriteAtomic(onlinePath, EncryptOuterLayer(originalGameCiphertext));
                        ProtectedHashes[activePath] = hash;
                    }
                    if (deleteActive) File.Delete(activePath);
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                catch (CryptographicException exception)
                {
                    AddEvent(new BridgeEvent("error", 0, "Online-save encryption failed: " + exception.Message));
                }
            }
        }
        catch { }
    }

    private static byte[] EncryptOuterLayer(byte[] originalGameCiphertext)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var tag = new byte[16];
        var ciphertext = new byte[originalGameCiphertext.Length];
        var key = Rfc2898DeriveBytes.Pbkdf2(ModEncryptionPassword, salt, ModKeyIterations, HashAlgorithmName.SHA256, 32);
        using (var aes = new AesGcm(key, 16)) aes.Encrypt(nonce, originalGameCiphertext, ciphertext, tag, Encoding.ASCII.GetBytes(OnlineSaveMagic));
        CryptographicOperations.ZeroMemory(key);

        var result = new byte[4 + salt.Length + nonce.Length + tag.Length + ciphertext.Length];
        Encoding.ASCII.GetBytes(OnlineSaveMagic).CopyTo(result, 0);
        salt.CopyTo(result, 4);
        nonce.CopyTo(result, 20);
        tag.CopyTo(result, 32);
        ciphertext.CopyTo(result, 48);
        return result;
    }

    private static byte[] EncryptGameSave(string json)
    {
        // 与游戏 EncryptHelper.Encrypt 完全一致："Encrypted" + Base64(HMAC || IV || AES-CBC)。
        // 参数来自当前 GameAssembly.dll 的静态分析，并已用原版 AutoSave 做解密/再加密往返验证。
        var key = DeriveGameSaveKey();
        try
        {
            using var aes = Aes.Create();
            aes.Key = key;
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.PKCS7;
            aes.GenerateIV();
            var plain = Encoding.UTF8.GetBytes(json);
            using var encryptor = aes.CreateEncryptor();
            var ciphertext = encryptor.TransformFinalBlock(plain, 0, plain.Length);
            var authenticated = new byte[aes.IV.Length + ciphertext.Length];
            Buffer.BlockCopy(aes.IV, 0, authenticated, 0, aes.IV.Length);
            Buffer.BlockCopy(ciphertext, 0, authenticated, aes.IV.Length, ciphertext.Length);
            using var hmac = new HMACSHA256(key);
            var mac = hmac.ComputeHash(authenticated);
            var payload = new byte[mac.Length + authenticated.Length];
            Buffer.BlockCopy(mac, 0, payload, 0, mac.Length);
            Buffer.BlockCopy(authenticated, 0, payload, mac.Length, authenticated.Length);
            return Encoding.UTF8.GetBytes("Encrypted" + Convert.ToBase64String(payload));
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    private static string DecryptGameSave(byte[] encodedBytes)
    {
        var encoded = Encoding.UTF8.GetString(encodedBytes);
        if (!encoded.StartsWith("Encrypted", StringComparison.Ordinal))
            throw new CryptographicException("Missing the game's original Encrypted header");
        var payload = Convert.FromBase64String(encoded[9..]);
        if (payload.Length < 64 || payload.Length % 16 != 0)
            throw new CryptographicException("Invalid original game ciphertext length");
        var expectedMac = payload.AsSpan(0, 32);
        var iv = payload.AsSpan(32, 16);
        var ciphertext = payload.AsSpan(48);
        var key = DeriveGameSaveKey();
        try
        {
            using var hmac = new HMACSHA256(key);
            var actualMac = hmac.ComputeHash(payload, 32, payload.Length - 32);
            if (!CryptographicOperations.FixedTimeEquals(expectedMac, actualMac))
                throw new CryptographicException("Original game-save HMAC verification failed");
            using var aes = Aes.Create();
            aes.Key = key;
            aes.IV = iv.ToArray();
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.PKCS7;
            using var decryptor = aes.CreateDecryptor();
            var plain = decryptor.TransformFinalBlock(ciphertext.ToArray(), 0, ciphertext.Length);
            return Encoding.UTF8.GetString(plain);
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    private static byte[] DeriveGameSaveKey() =>
        Rfc2898DeriveBytes.Pbkdf2(GameEncryptionPassword, GameEncryptionSalt,
            GameKeyIterations, HashAlgorithmName.SHA256, 32);

    private static string BuildSaveMetadata(string onlineName, byte[] originalGameCiphertext)
    {
        using var document = JsonDocument.Parse(DecryptGameSave(originalGameCiphertext));
        var root = document.RootElement;
        var scene = root.TryGetProperty("Scene", out var sceneElement) ? sceneElement.GetString() ?? string.Empty : string.Empty;
        var position = root.TryGetProperty("PlayerPosition", out var positionElement) ? positionElement.GetRawText() : "null";
        var rotation = root.TryGetProperty("PlayerRotation", out var rotationElement) ? rotationElement.GetRawText() : "null";
        return "{\"save\":\"" + Escape(onlineName) + "\",\"scene\":\"" + Escape(scene) +
            "\",\"position\":" + position + ",\"rotation\":" + rotation + "}";
    }

    private static byte[] DecryptOuterLayer(byte[] container)
    {
        if (container.Length < 49 || Encoding.ASCII.GetString(container, 0, 4) != OnlineSaveMagic)
            throw new CryptographicException("Not a valid MPB2 online save");
        var salt = container.AsSpan(4, 16);
        var nonce = container.AsSpan(20, 12);
        var tag = container.AsSpan(32, 16);
        var ciphertext = container.AsSpan(48);
        var plaintext = new byte[ciphertext.Length];
        var key = Rfc2898DeriveBytes.Pbkdf2(ModEncryptionPassword, salt, ModKeyIterations, HashAlgorithmName.SHA256, 32);
        using (var aes = new AesGcm(key, 16)) aes.Decrypt(nonce, ciphertext, tag, plaintext, Encoding.ASCII.GetBytes(OnlineSaveMagic));
        CryptographicOperations.ZeroMemory(key);
        if (!plaintext.AsSpan().StartsWith("Encrypted"u8)) throw new CryptographicException("Inner payload is not an original encrypted game save");
        return plaintext;
    }

    private static void SelfTestOnlineSaveCrypto()
    {
        var original = Encoding.UTF8.GetBytes("Encrypted" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(128)));
        var wrapped = EncryptOuterLayer(original);
        var roundTrip = DecryptOuterLayer(wrapped);
        if (!original.AsSpan().SequenceEqual(roundTrip)) throw new InvalidOperationException("Online-save encryption round trip mismatch");
        wrapped[^1] ^= 0x01;
        try
        {
            _ = DecryptOuterLayer(wrapped);
            throw new InvalidOperationException("A tampered online save was not rejected");
        }
        catch (AuthenticationTagMismatchException) { }

        var testDirectory = Path.Combine(Path.GetTempPath(), "MPB-save-self-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(testDirectory);
        try
        {
            var autoSavePath = Path.Combine(testDirectory, "AutoSave.save");
            var singlePlayer = Encoding.UTF8.GetBytes("Encrypted-single-player");
            var onlineAutoSave = Encoding.UTF8.GetBytes("Encrypted-online-progress");
            File.WriteAllBytes(autoSavePath, singlePlayer);
            BeginOnlineSaveSession("MPOnline_selftest", testDirectory);
            File.WriteAllBytes(autoSavePath, onlineAutoSave);
            RedirectOnlineAutoSave();
            var activePath = Path.Combine(testDirectory, "MPActive_selftest.save");
            if (!File.ReadAllBytes(activePath).AsSpan().SequenceEqual(onlineAutoSave))
                throw new InvalidOperationException("Online autosave was not redirected to the working copy");
            if (!File.ReadAllBytes(autoSavePath).AsSpan().SequenceEqual(singlePlayer))
                throw new InvalidOperationException("Single-player AutoSave was not restored after online autosave redirection");
            ProtectActiveSaves(deleteActive: false, saveDirectoryOverride: testDirectory);
            var onlinePath = Path.Combine(testDirectory, "MPOnline_selftest.save");
            if (!File.Exists(activePath))
                throw new InvalidOperationException("The online working copy was incorrectly deleted after formal-save wrapping");
            if (!File.Exists(onlinePath))
                throw new InvalidOperationException("The online working copy was not wrapped into a formal online save");
            if (!DecryptOuterLayer(File.ReadAllBytes(onlinePath)).AsSpan().SequenceEqual(onlineAutoSave))
                throw new InvalidOperationException("Formal online-save content differs from the working copy");
            File.Delete(activePath);
            EnsureActiveRecoveryCopy();
            if (!File.Exists(activePath) ||
                !File.ReadAllBytes(activePath).AsSpan().SequenceEqual(onlineAutoSave))
                throw new InvalidOperationException("The working copy was not recovered from the formal online save after game exit");
            const string uuidV7Name = "MPOnline_01890f3e-7b00-7abc-8def-0123456789ab";
            var renameResult = RenameOnlineSave(new Dictionary<string, string>
            {
                ["name"] = "MPOnline_selftest",
                ["target"] = uuidV7Name
            }, testDirectory);
            var uuidV7Path = Path.Combine(testDirectory, uuidV7Name + ".save");
            if (renameResult != 0 || File.Exists(onlinePath) || !File.Exists(uuidV7Path))
                throw new InvalidOperationException("The legacy online save was not migrated to a UUIDv7 filename");
            if (!DecryptOuterLayer(File.ReadAllBytes(uuidV7Path)).AsSpan().SequenceEqual(onlineAutoSave))
                throw new InvalidOperationException("UUIDv7 migration changed the online-save content");

            // 即使正式档缺失或 PlayerPrefs 忘记上次选择，也必须优先恢复已有工作副本，
            // 不能把一次临时读取失败误判为首次游戏并创建空白角色。
            const string recoveryName = "MPOnline_01890f3e-7b01-7abc-8def-0123456789ab";
            var recoveryActivePath = Path.Combine(testDirectory, ToActiveSaveName(recoveryName) + ".save");
            var recoveryOnlinePath = Path.Combine(testDirectory, recoveryName + ".save");
            var recoveryCiphertext = EncryptGameSave("{\"Scene\":\"RoomScene\",\"PlayerPosition\":{\"x\":1,\"y\":2,\"z\":3},\"PlayerRotation\":{\"x\":0,\"y\":90,\"z\":0}}");
            File.WriteAllBytes(recoveryActivePath, recoveryCiphertext);
            var recoveryResult = PrepareOnlineSave(new Dictionary<string, string> { ["name"] = recoveryName }, testDirectory);
            if (recoveryResult != 0 || !File.Exists(recoveryOnlinePath))
                throw new InvalidOperationException("The matching UUID working copy was not used when the formal save was missing");
            File.Delete(recoveryOnlinePath);
            recoveryResult = PrepareOnlineSave(new Dictionary<string, string> { ["name"] = string.Empty }, testDirectory);
            if (recoveryResult != 0 || !File.Exists(recoveryOnlinePath))
                throw new InvalidOperationException("The latest online save was not discovered and recovered when PlayerPrefs was missing");
            RestoreSinglePlayerAutoSave();
        }
        finally
        {
            if (Directory.Exists(testDirectory)) Directory.Delete(testDirectory, true);
        }
        Console.WriteLine("PASS UUIDv7 rename, online-save crypto, active-save recovery, latest-save discovery, tamper rejection, autosave redirect and single-player restore");
    }

    private static void WriteAtomic(string path, byte[] bytes)
    {
        var temporary = path + ".tmp";
        File.WriteAllBytes(temporary, bytes);
        File.Move(temporary, path, true);
    }

}
