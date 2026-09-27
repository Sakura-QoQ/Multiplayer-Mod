// 共享协议类型。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
// PlayerHostedMultiplayer 的游戏脚本入口。
// 本文件负责游戏内界面、配置读取、联机协议、玩家同步和线上存档生命周期。
type MultiplayerConfig = {
    mode: "off" | "host" | "client";
    address: string;
    port: number;
    maxPlayers: number;
    playerName: string;
    roomId: string;
    roomKey: string;
    smokeTestAutoLoad: boolean;
    smokeTestUiOpen: boolean;
    smokeTestMotion: boolean;
    smokeTestSceneSync: boolean;
    smokeTestSleepConsensus: boolean;
    smokeTestAppearance: boolean;
    smokeTestPhone: boolean;
    smokeTestPauseMenu: boolean;
    smokeTestOnlineLifecycle: boolean;
    smokeTestOnlineSaveName: string;
    smokeTestLifecyclePhase: string;
    bridgeChannel: string;
};

// 联机面板页面类型。页面历史使用同一类型，保证右上角返回按钮和 ESC 行为一致。
type MultiplayerPanelMode = "closed" | "config" | "local" | "public" | "room";

function normalizeBridgeChannel(value: any): string {
    const normalized = String(value || "default").toLowerCase().replace(/[^a-z0-9_-]/g, "").substring(0, 32);
    return normalized || "default";
}

function readBridgeChannel(): string {
    try {
        const parsed = JSON.parse(ReadModFile("config.json") || "{}");
        return normalizeBridgeChannel(parsed.bridgeChannel);
    } catch (_error) { return "default"; }
}

const BRIDGE_CHANNEL = readBridgeChannel();
function prefKey(baseName: string): string {
    return BRIDGE_CHANNEL === "default" ? baseName : baseName + "." + BRIDGE_CHANNEL;
}

type BridgeStatus = { state: string; port: number; peers: number; transport: string;
    localPeerId: number; authorityPeerId: number };
type PublicRoomEntry = { roomId: string; players: number; capacity: number };
type OnlineSaveMetadata = {
    save: string; scene: string;
    cloth: string[];
    position: { x: number; y: number; z: number } | null;
    rotation: { x: number; y: number; z: number } | null;
};
type TranslationValues = Record<string, string | number>;
type NetworkVector3 = { x: number; y: number; z: number };
type NetworkQuaternion = { x: number; y: number; z: number; w: number };
type NetworkAnimationLayer = { hash: number; time: number; weight: number };
type PlayerStatePacket = {
    type: "playerState";
    ownerId: number;
    sequence: number;
    playerName: string;
    scene: string;
    position: NetworkVector3;
    rotation: NetworkQuaternion;
    move: NetworkVector3;
    grounded: boolean;
    action: number;
    handAction: number;
    stateId: number;
    attack: number;
    weapon: number;
    animationHash: number;
    animationTime: number;
    animations: NetworkAnimationLayer[];
};
type PlayerProfile = {
    cloth: string[];
    customization: Record<string, string | number | boolean>;
    progress: Record<string, any>;
};
type PlayerProfilePacket = {
    type: "playerProfile";
    ownerId: number;
    playerName: string;
    revision: number;
    profile: PlayerProfile;
};
type PlayerProfileChunkPacket = {
    type: "playerProfileChunk";
    transferId: string;
    index: number;
    count: number;
    payload: string;
};
type PlayerLiveDataPacket = {
    type: "playerLiveData";
    ownerId: number;
    playerName: string;
    sequence: number;
    status: Record<string, any>;
    gameTime: number;
    timeOffset: number;
    scene: string;
};
type WorldTimePacket = {
    type: "worldTime";
    sequence: number;
    gameTime: number;
    day: number;
    timeOfDay: number;
    timeOffset: number;
};
type SleepMode = "short" | "tomorrow";
type SleepRequestPacket = { type: "sleepRequest"; mode: SleepMode };
type SleepApprovedPacket = { type: "sleepApproved"; mode: SleepMode; sequence: number };
type SleepAckPacket = { type: "sleepAck"; sequence: number };
type RemotePlayer = {
    id: number;
    name: string;
    root: UnityEngine.GameObject;
    animator: UnityEngine.Animator;
    targetPosition: UnityEngine.Vector3;
    targetRotation: UnityEngine.Quaternion;
    lastSeen: number;
    animationHashes: number[];
    diagnosticPosition: UnityEngine.Vector3;
    diagnosticActionKey: string;
    clothBonePairs: { driven: UnityEngine.Transform; source: UnityEngine.Transform }[];
    ownedMaterials: UnityEngine.Material[];
};
type RemoteMaterialSnapshot = {
    renderer: UnityEngine.Renderer;
    materials: UnityEngine.Material[];
};

