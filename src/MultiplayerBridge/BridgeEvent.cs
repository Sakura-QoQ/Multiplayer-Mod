namespace FallenFlower.MultiplayerBridge;

// 原生 DLL 与 TypeScript 之间传递的统一事件结构。
public readonly record struct BridgeEvent(string Type, long PeerId = 0, string Message = "");
