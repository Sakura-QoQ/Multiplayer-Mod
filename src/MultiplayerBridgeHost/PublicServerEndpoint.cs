using System.Security.Cryptography;
using System.Text;

namespace FallenFlower.MultiplayerBridgeHost;

internal static class PublicServerEndpoint
{
    // 公开端点不作为配置明文分发。固定密钥随客户端存在，只提供静态隐藏，不构成秘密管理。
    private const string NonceBase64 = "GaktLu+PqaNofU7z";
    private const string TagBase64 = "n43HCMBjkmNcpxVc+AlsYg==";
    private const string CiphertextBase64 = "V326oS/VOP/AKh8zfOKwxhXx";

    public static (string Host, int Port) Decrypt()
    {
        var nonce = Convert.FromBase64String(NonceBase64);
        var tag = Convert.FromBase64String(TagBase64);
        var ciphertext = Convert.FromBase64String(CiphertextBase64);
        var plaintext = new byte[ciphertext.Length];
        var key = SHA256.HashData(Encoding.UTF8.GetBytes("FallenFlower.PublicRoom.Endpoint.v1"));
        try
        {
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(nonce, ciphertext, tag, plaintext, Encoding.ASCII.GetBytes("FF-PUBLIC-ENDPOINT"));
            var endpoint = Encoding.UTF8.GetString(plaintext);
            var separator = endpoint.LastIndexOf(':');
            if (separator <= 0 || !int.TryParse(endpoint[(separator + 1)..], out var port))
                throw new CryptographicException("The embedded public-server endpoint is invalid");
            return (endpoint[..separator], port);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }
}
