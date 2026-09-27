namespace FallenFlower.MultiplayerBridge;

// 网络核心与游戏脚本之间传递的统一事件结构。
public readonly record struct BridgeEvent(string Type, long PeerId = 0, string Message = "");
