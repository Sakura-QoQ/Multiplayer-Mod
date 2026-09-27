// 此文件由 build.ps1 自动生成，请修改 src/GameMod 下的模块源码。
// UcModLauncher 需要单文件入口，因此发布包中保留合并后的 main.ts。

// ===== 模块: core/types.ts =====
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

type BridgeStatus = { state: string; port: number; peers: number };
type OnlineSaveMetadata = {
    save: string; scene: string;
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

// ===== 模块: core/config.ts =====
// 常量与实例配置。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
const MOD_TAG = "[PlayerHostedMultiplayer]";
const PROTOCOL_VERSION = 8;
const UI_ROOT_NAME = "MPB_UI_Root";
const MENU_BUTTON_NAME = "MPB_MultiplayerButton";
const PAUSE_BUTTON_NAME = "MPB_PauseMultiplayerButton";
const ONLINE_SAVE_PREFIX = "MPOnline_";
const ACTIVE_SAVE_PREFIX = "MPActive_";
const BRIDGE_STATE_FILE = BRIDGE_CHANNEL === "default" ? "Bridge/state.json" : "Bridge/state." + BRIDGE_CHANNEL + ".json";
const IPC_LOG_MARKER = BRIDGE_CHANNEL === "default" ? "[PlayerHostedMultiplayerIPC]" : "[PlayerHostedMultiplayerIPC:" + BRIDGE_CHANNEL + "]";
const GENERATION_KEY = prefKey("MPB.ScriptGeneration");
const ONLINE_SAVE_ID_KEY = prefKey("MPB.OnlineSaveUuidV7");
const BRIDGE_STATE_READY_KEY = prefKey("MPB.BridgeStateReady");
const LANGUAGE_CODES = ["en", "ja", "zh-CN", "zh-TW", "ko", "es"];
// 玩家位置、朝向和动作以 20 Hz 发送；画面仍在每个渲染帧插值，兼顾响应速度与流量。
const PLAYER_STATE_INTERVAL = 0.05;
const PLAYER_PROFILE_INTERVAL = 2;
const PLAYER_LIVE_DATA_INTERVAL = 0.5;
const PLAYER_STATUS_XOR_KEY = 730807045;
const PLAYER_PROFILE_CHUNK_SIZE = 10000;
const MAX_PLAYER_PROFILE_CHUNKS = 256;
const OUTGOING_MESSAGE_INTERVAL = 0.02;
const REMOTE_PLAYER_TIMEOUT = 10;
// 世界时间变化远慢于人物动作，继续按 5 Hz 同步即可消除昼夜进度分叉。
const WORLD_TIME_INTERVAL = 0.2;
const SLEEP_READY_TIMEOUT = 20;
const PRESENCE_INTERVAL = 5;
// 游戏切换场景时会重新执行 Mod 脚本。代次编号可让旧回调自动失效，避免重复轮询和重复按钮事件。
const SCRIPT_GENERATION = Number(UnityEngine.PlayerPrefs.GetInt(GENERATION_KEY, 0)) + 1;
UnityEngine.PlayerPrefs.SetInt(GENERATION_KEY, SCRIPT_GENERATION);
// 立即落盘也让独立桥接程序与游戏使用同一组 Windows PlayerPrefs 注册表值。
UnityEngine.PlayerPrefs.Save();

// ===== 模块: core/state.ts =====
// 共享运行状态。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
let initialized = false;
let bridgeAvailable = false;
let bridgeNetworkState = "stopped";
let bridgeLaunchAttempted = false;
let bridgeStartupGraceFrames = 0;
let role: "off" | "host" | "client" = "off";
let currentPlayerName = "Player";
let smokeTestScheduled = false;
let smokeSleepStartedAt = -1;
let smokeSleepRequested = false;
let smokeMotionStartedAt = -1;
let smokeMotionCompletedAt = -1;
let smokeSceneRequested = false;
let smokePhoneChecked = false;
let onlinePauseReleaseCount = 0;
let pauseVisibleEvidenceLogged = false;
let smokePauseMenuOpened = false;
let smokePauseMenuOpenedAt = -1;
let smokePauseMenuGameTime = 0;
let smokePauseBackgroundVerified = false;
let smokeOnlineLifecycleStarted = false;
let onlineSaveSessionReady = false;
let smokeOnlineLifecycleFinished = false;
let preparedOnlineSaveMetadata: OnlineSaveMetadata | null = null;
let smokeActionOverrideUntil = -1;
let diagnosticAppearanceReadyAt = -1;
let updateFrames = 0;
let uiRoot: UnityEngine.GameObject | null = null;
let uiPanel: UnityEngine.GameObject | null = null;
let uiConfigBody: UnityEngine.GameObject | null = null;
let uiTitle: UnityEngine.UI.Text | null = null;
let uiStatus: UnityEngine.UI.Text | null = null;
let uiPlayerInfo: UnityEngine.UI.Text | null = null;
let uiPlayerListPanel: UnityEngine.GameObject | null = null;
let uiPlayerListTitle: UnityEngine.UI.Text | null = null;
let uiPlayerListCount: UnityEngine.UI.Text | null = null;
let uiPlayerListBody: UnityEngine.UI.Text | null = null;
let uiAddress: UnityEngine.UI.InputField | null = null;
let uiPort: UnityEngine.UI.InputField | null = null;
let uiName: UnityEngine.UI.InputField | null = null;
let uiMenuButton: UnityEngine.GameObject | null = null;
let uiPauseButton: UnityEngine.GameObject | null = null;
let uiPauseLoadButton: UnityEngine.GameObject | null = null;
let pauseButtonLayout: { setting: UnityEngine.UI.Button; multiplayer: UnityEngine.UI.Button; load: UnityEngine.UI.Button;
    secret: UnityEngine.UI.Button; bugFeedback: UnityEngine.UI.Button; exit: UnityEngine.UI.Button } | null = null;
let lastPauseLayoutOnline: boolean | null = null;
let coroutineRunner: UnityEngine.MonoBehaviour | null = null;
let lastBridgeEventSequence = 0;
let pendingBridgeEvents: string[] = [];
let languageIndex = -1;
let languageCode = "en";
let lastPreferenceLanguage = -1;
let runtimeLanguageCandidate = -1;
let runtimeLanguageStableFrames = 0;
let languagePollFrames = 0;
let messages: Record<string, string> = {};
let englishMessages: Record<string, string> = {};
let uiFont: any = null;
let uiInputLoopStarted = false;
let lastPlayerListSignature = "";
let selectedSaveName = "";
let roundedPanelSprite: UnityEngine.Sprite | null = null;
let mainMenuInstance: MainMenu | null = null;
let mainMenuTranslationRefreshPending = false;
let exitSaveInProgress = false;
let saveNameRedirectInProgress = false;
let onlineLoadRedirectedDuringStart = false;
let localNetworkId = -1;
// 场景重载会重新执行脚本。以时间为序号基线，避免新场景从 1 开始而被另一端当作旧包
// 丢弃几十秒；同一毫秒内不同类型使用不同偏移。
const RUNTIME_SEQUENCE_BASE = Math.trunc((Date.now() * 10) % 2000000000);
let localStateSequence = RUNTIME_SEQUENCE_BASE;
let nextPlayerStateAt = 0;
let nextPlayerProfileAt = 0;
let nextPlayerLiveDataAt = 0;
let nextWorldTimeAt = 0;
let nextPresenceAt = 0;
let nextBridgePollAt = 0;
let worldTimeSequence = RUNTIME_SEQUENCE_BASE + 1;
let lastWorldTimeSequence = 0;
let lastDiagnosticWorldTimeLogAt = -1;
let onlineClockInitialized = false;
let onlineClockGameTime = 0;
let onlineClockLastUnscaledTime = 0;
let gameManagerPausedField: any = null;
let lastBridgeTouchAt = -1;
let bedWindowInstance: BedWindow | null = null;
let sleepConsensusExecuting = false;
let applyingAuthoritativeTime = false;
let sleepApprovalSequence = RUNTIME_SEQUENCE_BASE + 2;
let lastSleepApprovalSequence = 0;
let pendingSleepApproval: { packet: SleepApprovedPacket; createdAt: number;
    acknowledged: Record<string, boolean>; nextSendAt: number } | null = null;
let clientEntryStarted = false;
let pendingHostScene = "";
const sleepReady: Record<string, { mode: SleepMode; at: number }> = {};
let localProfileRevision = 0;
let localLiveDataSequence = RUNTIME_SEQUENCE_BASE + 3;
let lastLocalProfileJson = "";
const remotePlayers: Record<string, RemotePlayer> = {};
const remoteProfiles: Record<string, PlayerProfile> = {};
const remoteProfileRevisions: Record<string, number> = {};
const latestPlayerStates: Record<string, PlayerStatePacket> = {};
const peerNames: Record<string, string> = {};
const lastRemoteSequences: Record<string, number> = {};
const lastRemoteLiveDataSequences: Record<string, number> = {};
// 0=控制消息，1=实时状态（允许丢旧），2=完整资料（必须逐片送达）。
const outgoingMessages: { peerId: number; data: string; priority: number }[] = [];
const pendingProfileChunks: Record<string, { parts: string[]; received: number; count: number; createdAt: number }> = {};
let nextOutgoingMessageAt = 0;
// 使用高分辨率时间作为本次游戏进程的序号起点，避免桥接程序短时间重启时与旧响应碰撞。
let ipcCommandSequence = Math.trunc(Date.now() % 2000000000);

// ===== 模块: ui/i18n/runtime.ts =====
// 界面语言运行时。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function loadLanguageFile(code: string): Record<string, string> {
    try {
        const text = ReadModFile("i18n/" + code + "/strings.json");
        const parsed = text ? JSON.parse(text) : null;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        log("语言包读取失败 " + code + ": " + error);
        return {};
    }
}

function tr(key: string, values?: TranslationValues): string {
    let value = messages[key] || englishMessages[key] || key;
    if (values) {
        for (const name of Object.keys(values)) value = value.split("{" + name + "}").join(String(values[name]));
    }
    return value;
}

function syncGameLanguage(force = false): void {
    let preferenceLanguage = -1;
    let runtimeLanguage = -1;
    try {
        runtimeLanguage = Number(Localization.Language);
        preferenceLanguage = Number(UnityEngine.PlayerPrefs.GetInt("UserSelectedLanguage", runtimeLanguage));
    } catch (_error) { }

    const valid = (value: number) => Number.isInteger(value) && value >= 0 && value < LANGUAGE_CODES.length;
    if (!valid(preferenceLanguage)) preferenceLanguage = -1;
    if (!valid(runtimeLanguage)) runtimeLanguage = -1;
    languagePollFrames += 1;

    // 玩家在设置菜单确认语言后，PlayerPrefs 的变化具有最高优先级，可在下一帧立即刷新。
    const preferenceChanged = preferenceLanguage >= 0 && lastPreferenceLanguage >= 0 && preferenceLanguage !== lastPreferenceLanguage;
    if (preferenceLanguage >= 0) lastPreferenceLanguage = preferenceLanguage;

    // 游戏初始化主菜单时会快速遍历多种语言。只有运行时语言连续稳定 8 帧才采用它，
    // 这样既支持游戏内实时切换，也不会让联机界面在启动时跟着闪烁。
    if (runtimeLanguage === runtimeLanguageCandidate) runtimeLanguageStableFrames += 1;
    else {
        runtimeLanguageCandidate = runtimeLanguage;
        runtimeLanguageStableFrames = 1;
    }

    let nextIndex = languageIndex;
    if (force) nextIndex = preferenceLanguage >= 0 ? preferenceLanguage : (runtimeLanguage >= 0 ? runtimeLanguage : 0);
    else if (preferenceChanged) nextIndex = preferenceLanguage;
    else if (runtimeLanguage >= 0 && runtimeLanguageStableFrames >= 8 && languagePollFrames >= 30) nextIndex = runtimeLanguage;
    else if (nextIndex < 0) nextIndex = preferenceLanguage >= 0 ? preferenceLanguage : (runtimeLanguage >= 0 ? runtimeLanguage : 0);

    if (!force && nextIndex === languageIndex) return;
    languageIndex = nextIndex;
    languageCode = LANGUAGE_CODES[nextIndex];
    if (Object.keys(englishMessages).length === 0) englishMessages = loadLanguageFile("en");
    messages = languageCode === "en" ? englishMessages : loadLanguageFile(languageCode);
    refreshLocalizedUi();
    log("已切换联机界面语言: " + languageCode);
}

// ===== 模块: core/runtime.ts =====
// 通用运行时工具。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function isCurrentGeneration(): boolean {
    return Number(UnityEngine.PlayerPrefs.GetInt(GENERATION_KEY, 0)) === SCRIPT_GENERATION;
}

function log(message: string): void { print(MOD_TAG + " " + message); }

// 以固定时间轴推进周期任务，避免使用“当前时间 + 间隔”时把一帧取整误差永久累加。
// 如果游戏曾卡顿超过一个周期，则直接从当前时刻重新起算，不在恢复后突发补发旧状态。
function advanceFixedDeadline(previous: number, now: number, interval: number): number {
    if (previous <= 0 || previous < now - interval) return now + interval;
    return previous + interval;
}

function toast(message: string): void {
    log(message);
    // 部分场景加载早期 Toast 单例尚未创建。此时只写日志，避免原版组件内部空引用。
    try {
        if (Toast.Singleton) Toast.Show(tr("mod.name") + ": " + message, 5);
    } catch (_error) { }
}

// ===== 模块: network/bridge/state.ts =====
// 桥接状态与 IPC。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
type BridgeStateFile = {
    protocol: number;
    running?: boolean;
    heartbeatUtcTicks?: number;
    state: string;
    port: number;
    peers: number;
    responseSequence?: number;
    response?: string;
    saves?: { name: string; lastWriteUtcTicks: number; size: number }[];
    events?: { sequence: number; type: string; peerId: number; message?: string }[];
};

// 联机桥是随 Mod 打包的独立程序。脚本只使用游戏官方允许的 PlayerPrefs 和 ReadModFile，
// 不再向游戏根目录注入 DLL，因此不会触发游戏的 AntiTamperChecker。
function readBridgeState(): BridgeStateFile | null {
    try {
        // 桥接写当前 50ms 槽，游戏读取两个槽之前的不可变快照。三槽轮转让
        // ReadModFile 不再撞上 Windows 原子替换的短暂独占窗口。
        const epoch = Math.floor(Date.now() / 50);
        const stableSlot = ((epoch - 2) % 3 + 3) % 3;
        const slotFile = BRIDGE_STATE_FILE.replace(/\.json$/, "." + stableSlot + ".json");
        const text = ReadModFile(slotFile);
        if (!text) return null;
        const parsed = JSON.parse(text);
        return {
            protocol: Number(parsed.protocol) || 0,
            running: parsed.running === true,
            heartbeatUtcTicks: Number(parsed.heartbeatUtcTicks) || 0,
            state: typeof parsed.state === "string" ? parsed.state : "stopped",
            port: Number(parsed.port) || 0,
            peers: Number(parsed.peers) || 0,
            responseSequence: Number(parsed.responseSequence) || 0,
            response: typeof parsed.response === "string" ? parsed.response : "",
            saves: Array.isArray(parsed.saves) ? parsed.saves
                .filter((item: any) => item && typeof item.name === "string")
                .map((item: any) => ({
                    name: String(item.name),
                    lastWriteUtcTicks: Number(item.lastWriteUtcTicks) || 0,
                    size: Number(item.size) || 0
                })) : [],
            events: Array.isArray(parsed.events) ? parsed.events : []
        };
    } catch (_error) { return null; }
}

function readPreparedSaveMetadata(saveName = ""): OnlineSaveMetadata | null {
    const state = readBridgeState();
    const events = state && state.events ? state.events : [];
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event.type !== "saveMetadata" || !event.message) continue;
        try {
            const metadata = JSON.parse(event.message) as OnlineSaveMetadata;
            if (metadata && (!saveName || metadata.save === saveName)) return metadata;
        } catch (_error) { }
    }
    return null;
}

function applyPreparedOnlineLocation(onApplied?: () => void): void {
    const metadata = preparedOnlineSaveMetadata;
    const applyTransform = () => {
        try {
            const player = Player.LocalPlayer;
            if (player && metadata && metadata.position) {
                const target = new UnityEngine.Vector3(
                    finiteNumber(metadata.position.x), finiteNumber(metadata.position.y), finiteNumber(metadata.position.z));
                // CharacterController 会在下一帧把直接修改的 Transform 拉回它保存的旧坐标。
                // 先停用控制器再写入，重新启用时它会以线上存档坐标重建内部状态。
                const controller = player.movment ? player.movment._characterController : null;
                if (controller) controller.enabled = false;
                player.transform.position = target;
                if (metadata.rotation) player.transform.rotation = UnityEngine.Quaternion.Euler(
                    finiteNumber(metadata.rotation.x), finiteNumber(metadata.rotation.y), finiteNumber(metadata.rotation.z));
                if (controller) controller.enabled = true;
                log("已恢复线上存档场景位置: " + metadata.scene + " target=" +
                    target.x.toFixed(4) + "," + target.y.toFixed(4) + "," + target.z.toFixed(4));
            }
        } catch (error) { log("恢复线上存档位置失败: " + error); }
        if (onApplied) onApplied();
    };
    if (metadata && metadata.scene && String(GameManager.NowSceneName || "") !== metadata.scene) {
        try { GameManager.MoveToScene(metadata.scene, applyTransform); return; }
        catch (error) { log("恢复线上存档场景失败: " + error); }
    }
    applyTransform();
}

function bridgeStateIsFresh(state: BridgeStateFile | null): boolean {
    if (!state || !state.heartbeatUtcTicks) return false;
    // .NET ticks 从公元 1 年开始，每毫秒 10,000 ticks。
    const heartbeatMilliseconds = Number(state.heartbeatUtcTicks) / 10000 - 62135596800000;
    return Math.abs(Date.now() - heartbeatMilliseconds) < 5000;
}

function launchBundledBridge(): void {
    if (bridgeLaunchAttempted) return;
    bridgeLaunchAttempted = true;
    try {
        // 非默认通道仅用于同机双游戏自动化验证，由测试工具带 --channel/--log-path
        // 参数预先启动桥接程序。生产包始终使用 default，仍保持零配置自动启动。
        if (BRIDGE_CHANNEL !== "default") {
            log("等待测试通道桥接程序: " + BRIDGE_CHANNEL);
            return;
        }
        // 启动器会给每个 Mod 提供 __dirname；这样即使玩家修改文件夹名称，也能找到随包桥接程序。
        let modDirectory = String(typeof __dirname !== "undefined" ? __dirname : "").replace(/\\/g, "/");
        if (!modDirectory) {
            // 兼容没有注入 __dirname 的旧版启动器，退回游戏默认 Mods 目录。
            const dataPath = String(UnityEngine.Application.dataPath || "").replace(/\\/g, "/");
            const separator = dataPath.lastIndexOf("/");
            if (separator <= 0) throw new Error("无法确定游戏根目录: " + dataPath);
            modDirectory = dataPath.substring(0, separator) + "/Mods/PlayerHostedMultiplayer";
        }
        const bridgePath = modDirectory + "/Bridge/MultiplayerBridgeHost.exe";
        let startedDirectly = false;
        try {
            // OpenURL 会经过 Windows Shell，把本地 EXE 当成用户点击的外部文件，可能每次都弹出
            // 安全确认。直接 CreateProcess 语义以当前游戏的普通用户令牌启动，不申请管理员权限。
            const startInfo = new System.Diagnostics.ProcessStartInfo();
            startInfo.FileName = bridgePath.replace(/\//g, "\\");
            startInfo.WorkingDirectory = modDirectory.replace(/\//g, "\\") + "\\Bridge";
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            const process = System.Diagnostics.Process.Start(startInfo);
            startedDirectly = process !== null;
        } catch (error) {
            log("普通权限直接启动联机桥失败，将使用兼容启动方式: " + error);
        }
        if (!startedDirectly) UnityEngine.Application.OpenURL(bridgePath);
        UnityEngine.PlayerPrefs.SetInt(BRIDGE_STATE_READY_KEY, 1);
        UnityEngine.PlayerPrefs.Save();
        log("已使用普通用户权限启动联机桥: " + bridgePath);
    } catch (error) {
        log("自动启动联机桥失败: " + error);
    }
}

function submitBridgeCommandTracked(command: string): number {
    if (!bridgeAvailable) return -1;
    try {
        const sequence = ++ipcCommandSequence;
        // Unity PlayerPrefs 在部分运行环境中不会写入桥接程序可见的注册表位置。
        // Debug.Log 一定进入 Player.log；桥接程序只增量读取带专用标记的新行。
        print(IPC_LOG_MARKER + " " + sequence + " " + command);
        return sequence;
    } catch (error) {
        log("提交桥接命令失败: " + error);
        return -1;
    }
}

function submitBridgeCommand(command: string): string {
    return submitBridgeCommandTracked(command) > 0 ? "0" : "-1";
}

// 退出保存必须得到桥接程序对同一命令序号的真实响应，不能把“命令已写进日志”
// 误当成加密封装成功。退出阶段允许短暂同步等待；外部桥接进程仍可独立处理命令。
function submitBridgeCommandAndWait(command: string, timeoutMilliseconds = 5000): string {
    const sequence = submitBridgeCommandTracked(command);
    if (sequence < 0) return "-1";
    const deadline = Date.now() + timeoutMilliseconds;
    let nextReadAt = 0;
    while (Date.now() < deadline) {
        const now = Date.now();
        if (now < nextReadAt) continue;
        nextReadAt = now + 10;
        try {
            const state = readBridgeState();
            if (state && Number(state.responseSequence || 0) >= sequence)
                return String(state.response || "-1");
        } catch (_error) { }
    }
    return "-9";
}

// PlayerPrefs 只有一个命令槽。关键操作必须等待桥接程序回写相同序号，不能依赖固定延时，
// 否则慢硬盘或首次启动时 prepareSave 会被后续 LoadGame 抢跑。
function waitForBridgeResponse(owner: UnityEngine.MonoBehaviour, sequence: number,
    callback: (result: string) => void, remaining = 360): void {
    if (!isCurrentGeneration()) return;
    const state = readBridgeState();
    if (state && Number(state.responseSequence || 0) >= sequence) {
        callback(String(state.response || "-1"));
        return;
    }
    if (remaining <= 0) { callback("-9"); return; }
    JintCoroutine.WaitForNextFrame(owner, () => waitForBridgeResponse(owner, sequence, callback, remaining - 1));
}

function collectBridgeEvents(state: BridgeStateFile | null): void {
    if (!state) return;
    bridgeNetworkState = String(state.state || "stopped");
    if (!state.events) return;
    for (const event of state.events) {
        const sequence = Number(event.sequence) || 0;
        if (sequence <= lastBridgeEventSequence) continue;
        lastBridgeEventSequence = sequence;
        pendingBridgeEvents.push(JSON.stringify({ type: event.type, peerId: Number(event.peerId) || 0, message: event.message || "" }));
    }
}

function bridgeCall(command: string): string {
    const state = readBridgeState();
    if (command === "protocol") return state ? String(state.protocol) : "";
    if (command === "status") return state ? JSON.stringify({ state: state.state, port: state.port, peers: state.peers }) : "";
    if (command === "poll") {
        collectBridgeEvents(state);
        return pendingBridgeEvents.length > 0 ? pendingBridgeEvents.shift() || "" : "";
    }
    return submitBridgeCommand(command);
}

// config.json 只提供默认值；玩家在界面输入的内容会优先从 PlayerPrefs 恢复。

// ===== 模块: network/config.ts =====
// 网络配置。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function loadConfig(): MultiplayerConfig {
    const defaults: MultiplayerConfig = { mode: "off", address: "127.0.0.1", port: 27777, maxPlayers: 4,
        playerName: "Player", smokeTestAutoLoad: false, smokeTestUiOpen: false, smokeTestMotion: false,
        smokeTestSceneSync: false, smokeTestSleepConsensus: false, smokeTestAppearance: false,
        smokeTestPhone: false, smokeTestPauseMenu: false, smokeTestOnlineLifecycle: false,
        smokeTestOnlineSaveName: "", smokeTestLifecyclePhase: "",
        bridgeChannel: BRIDGE_CHANNEL };
    try {
        const text = ReadModFile("config.json");
        if (!text) return defaults;
        const parsed = JSON.parse(text);
        return {
            mode: parsed.mode === "host" || parsed.mode === "client" ? parsed.mode : "off",
            address: typeof parsed.address === "string" ? parsed.address : defaults.address,
            port: typeof parsed.port === "number" ? parsed.port : defaults.port,
            maxPlayers: typeof parsed.maxPlayers === "number" ? parsed.maxPlayers : defaults.maxPlayers,
            playerName: typeof parsed.playerName === "string" ? parsed.playerName : defaults.playerName,
            smokeTestAutoLoad: parsed.smokeTestAutoLoad === true,
            smokeTestUiOpen: parsed.smokeTestUiOpen === true,
            smokeTestMotion: parsed.smokeTestMotion === true,
            smokeTestSceneSync: parsed.smokeTestSceneSync === true,
            smokeTestSleepConsensus: parsed.smokeTestSleepConsensus === true,
            smokeTestAppearance: parsed.smokeTestAppearance === true,
            smokeTestPhone: parsed.smokeTestPhone === true,
            smokeTestPauseMenu: parsed.smokeTestPauseMenu === true,
            smokeTestOnlineLifecycle: parsed.smokeTestOnlineLifecycle === true,
            smokeTestOnlineSaveName: typeof parsed.smokeTestOnlineSaveName === "string" ? parsed.smokeTestOnlineSaveName : "",
            smokeTestLifecyclePhase: typeof parsed.smokeTestLifecyclePhase === "string" ? parsed.smokeTestLifecyclePhase : "",
            bridgeChannel: normalizeBridgeChannel(parsed.bridgeChannel)
        };
    } catch (error) {
        log("config.json 读取失败: " + error);
        return defaults;
    }
}

function readBridgeStatus(): BridgeStatus {
    try {
        const state = readBridgeState();
        if (!bridgeStateIsFresh(state)) return { state: "unavailable", port: 0, peers: 0 };
        const parsed = JSON.parse(bridgeCall("status"));
        return {
            state: typeof parsed.state === "string" ? parsed.state : "unknown",
            port: Number(parsed.port) || 0,
            peers: Number(parsed.peers) || 0
        };
    } catch (_error) {
        return { state: bridgeAvailable ? "stopped" : "unavailable", port: 0, peers: 0 };
    }
}

function statusLabel(status?: BridgeStatus): string {
    const value = status || readBridgeStatus();
    if (!bridgeAvailable) return tr("status.runtimeMissing");
    if (value.state === "hosting") return tr("status.hosting", { port: value.port, peers: value.peers });
    if (value.state === "connecting") return tr("status.connecting");
    if (value.state === "connected") return tr("status.connected");
    return tr("status.offline");
}

function updateStatusText(message?: string): void {
    if (!uiStatus) return;
    try { uiStatus.text = message || statusLabel(); } catch (_error) { }
    refreshPlayerInfoUi();
}

// ===== 模块: player/info/view-model.ts =====
// 玩家信息展示模型。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
type PlayerProfileFieldCounts = {
    cloth: number;
    quests: number;
    playFlags: number;
    conditions: number;
    contacts: number;
};

function playerProfileFieldCounts(profile: PlayerProfile | undefined): PlayerProfileFieldCounts {
    const progress = profile && profile.progress ? profile.progress : {};
    const cloth = Array.isArray(progress.Cloth) ? progress.Cloth.length : (profile ? profile.cloth.length : 0);
    const quests = progress.Quests && typeof progress.Quests === "object" ? Object.keys(progress.Quests).length : 0;
    const contacts = Array.isArray(progress.XContactData) ? progress.XContactData.length : 0;
    const playFlags = Object.keys(progress).filter(key => key.indexOf("PlayFlag") === 0 && Boolean(progress[key])).length;
    const conditions = progress.ConditionSave && typeof progress.ConditionSave === "object"
        ? Object.keys(progress.ConditionSave).length : 0;
    return { cloth, quests, playFlags, conditions, contacts };
}

function playerLiveLine(profile: PlayerProfile | undefined): string {
    const progress = profile && profile.progress ? profile.progress : {};
    const status = progress.PlayerStatusData && typeof progress.PlayerStatusData === "object"
        ? progress.PlayerStatusData : {};
    return tr("players.live", {
        health: Math.round(finiteNumber(status.health) * finiteNumber(status.maxHealth, 100)),
        maxHealth: Math.round(finiteNumber(status.maxHealth, 100)),
        stamina: Math.round(finiteNumber(status.stamina) * finiteNumber(status.maxStamina, 100)),
        maxStamina: Math.round(finiteNumber(status.maxStamina, 100)),
        // PlayerData.money 在存档内使用游戏自己的 XOR_KEY；资料卡显示 PlayerStatus.Money 的运行时值。
        money: typeof status.money === "number" ? (Math.trunc(status.money) ^ PLAYER_STATUS_XOR_KEY) : 0,
        day: Math.trunc(finiteNumber(status.day)),
        timeOfDay: Math.trunc(finiteNumber(status.timeOfDay))
    });
}

function refreshPlayerInfoUi(): void {
    if (!uiPlayerInfo) return;
    try {
        const lines: string[] = [tr("players.title")];
        const localName = currentPlayerName || "Player";
        const localProfile = captureLocalPlayerProfile();
        const localCounts = playerProfileFieldCounts(localProfile || undefined);
        lines.push(tr("players.summary", { player: localName, cloth: localCounts.cloth, quests: localCounts.quests,
            playFlags: localCounts.playFlags, conditions: localCounts.conditions, contacts: localCounts.contacts }));
        lines.push(playerLiveLine(localProfile || undefined));
        for (const key of Object.keys(remoteProfiles).sort((a, b) => Number(a) - Number(b))) {
            const counts = playerProfileFieldCounts(remoteProfiles[key]);
            lines.push(tr("players.summary", { player: peerNames[key] || (remotePlayers[key] ? remotePlayers[key].name : "Player"),
                cloth: counts.cloth, quests: counts.quests, playFlags: counts.playFlags,
                conditions: counts.conditions, contacts: counts.contacts }));
            lines.push(playerLiveLine(remoteProfiles[key]));
        }
        uiPlayerInfo.text = lines.slice(0, 12).join("\n");
    } catch (_error) { }
}

// ===== 模块: network/control/session.ts =====
// 建房与会话控制。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function startBridge(): void {
    // ReadModFile 对不存在的文件会抛出启动器宿主异常，Jint 的 try/catch 无法可靠截获。
    // 因此首次进入时先启动单例桥接程序，等待它创建 state.json 后再读取。
    if (!bridgeLaunchAttempted) {
        // 场景切换会重新执行脚本，但桥接进程不会随场景卸载。只有上一次已经成功创建过
        // 状态文件时才尝试读取，避免首次安装读取不存在文件触发启动器宿主异常。
        if (Number(UnityEngine.PlayerPrefs.GetInt(BRIDGE_STATE_READY_KEY, 0)) === 1) {
            try {
                const existingState = readBridgeState();
                if (existingState && existingState.running === true &&
                    existingState.protocol === PROTOCOL_VERSION && bridgeStateIsFresh(existingState)) {
                    bridgeLaunchAttempted = true;
                    bridgeAvailable = true;
                    initialized = false;
                    bridgeStartupGraceFrames = 0;
                    log("已接管当前运行的联机桥，不再重复请求系统启动权限");
                }
            } catch (_error) { }
        }
        if (bridgeLaunchAttempted) {
            // 继续向下读取当前 hosting/connected 状态，恢复房主或客户端角色。
        } else {
        initialized = true;
        bridgeStartupGraceFrames = 60;
        launchBundledBridge();
        log("联机桥尚未运行，正在等待 Mod 自动启动随包桥接程序");
        return;
        }
    }
    if (bridgeStartupGraceFrames > 0) {
        bridgeStartupGraceFrames -= 1;
        return;
    }
    if (initialized && bridgeAvailable) return;
    // 桥接程序可以在游戏之后启动；未连接时每约 60 帧重新检查一次，避免必须重启游戏。
    if (initialized && updateFrames % 60 !== 0) return;
    initialized = true;
    try {
        const state = readBridgeState();
        bridgeAvailable = bridgeStateIsFresh(state) && state !== null && state.protocol === PROTOCOL_VERSION;
    }
    catch (_error) { bridgeAvailable = false; }
    if (!bridgeAvailable) {
        launchBundledBridge();
        log("联机桥尚未运行，正在等待 Mod 自动启动随包桥接程序");
        return;
    }

    const config = loadConfig();
    currentPlayerName = UnityEngine.PlayerPrefs.GetString(prefKey("MPB.PlayerName"), config.playerName);
    // 原生网络层不会因为场景切换而卸载，因此新一代脚本应接管现有连接，而不是重新连接。
    const existing = readBridgeStatus();
    if (existing.state === "hosting") {
        role = "host";
        localNetworkId = 0;
        log("接管场景切换前的主机连接，端口=" + existing.port);
        return;
    }
    if (existing.state === "connecting" || existing.state === "connected") {
        role = "client";
        localNetworkId = -1;
        log("接管场景切换前的客户端连接");
        // 场景切换会重新载入脚本；重新握手可恢复本代脚本丢失的 peerId 和玩家名映射。
        if (existing.state === "connected") send(0, { type: "hello", protocol: PROTOCOL_VERSION, playerName: currentPlayerName });
        return;
    }

    role = config.mode;
    if (role === "off") { log("已加载，可使用“新建游戏”上方的“联机”按钮"); return; }
    const result = role === "host"
        ? bridgeCall("host?port=" + config.port + "&max=" + config.maxPlayers)
        : bridgeCall("join?address=" + encodeURIComponent(config.address) + "&port=" + config.port);
    if (result !== "0") { log("启动网络桥接失败，错误码=" + result); role = "off"; return; }
    localNetworkId = role === "host" ? 0 : -1;
    log(role === "host" ? "正在监听 0.0.0.0:" + config.port : "正在连接 " + config.address + ":" + config.port);
}

function valueOr(input: UnityEngine.UI.InputField | null, fallback: string): string {
    try {
        const value = input ? String(input.text || "").trim() : "";
        return value || fallback;
    } catch (_error) { return fallback; }
}

function startHostFromUi(): void {
    if (!bridgeAvailable) { toast(tr("toast.runtimeMissing")); return; }
    const config = loadConfig();
    const port = Number(valueOr(uiPort, String(config.port)));
    currentPlayerName = valueOr(uiName, config.playerName);
    if (!Number.isInteger(port) || port < 1 || port > 65535) { toast(tr("toast.invalidPort")); return; }
    UnityEngine.PlayerPrefs.SetString(prefKey("MPB.Port"), String(port));
    UnityEngine.PlayerPrefs.SetString(prefKey("MPB.PlayerName"), currentPlayerName);
    UnityEngine.PlayerPrefs.Save();
    updateStatusText(tr("status.startingHost", { port }));
    // host 命令内部会安全停止旧连接，不再先发 stop，避免单槽 IPC 把 stop 覆盖掉。
    const sequence = submitBridgeCommandTracked("host?port=" + port + "&max=" + config.maxPlayers);
    if (sequence < 0 || !mainMenuInstance) { role = "off"; toast(tr("toast.hostFailed", { code: -1 })); return; }
    waitForBridgeResponse(mainMenuInstance, sequence, result => {
        if (result !== "0") { role = "off"; toast(tr("toast.hostFailed", { code: result })); return; }
        role = "host";
        localNetworkId = 0;
        toast(tr("toast.hostStarted", { port }));
        enterOnlineSave();
    });
}

// ===== 模块: save/lifecycle.ts =====
// 线上存档进入流程。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function activeSaveName(onlineName: string): string {
    return onlineName.startsWith(ONLINE_SAVE_PREFIX)
        ? ACTIVE_SAVE_PREFIX + onlineName.substring(ONLINE_SAVE_PREFIX.length)
        : "";
}

function onlineActiveSaveName(): string {
    if (role === "off") return "";
    return activeSaveName(selectedSaveName);
}

function isDefaultAutoSaveName(value: string): boolean {
    const normalized = String(value || "AutoSave").replace(/\\/g, "/");
    const fileName = normalized.substring(normalized.lastIndexOf("/") + 1).replace(/\.save$/i, "");
    return fileName.toLowerCase() === "autosave";
}

function isOnlineSaveSlot(value: string): boolean {
    // 原版不同页面传入的可能是槽位名、文件名或完整路径；统一提取文件名并忽略大小写。
    const normalized = String(value || "").replace(/\\/g, "/");
    const fileName = normalized.substring(normalized.lastIndexOf("/") + 1).replace(/\.save$/i, "");
    const lowerName = fileName.toLowerCase();
    return lowerName.startsWith(ONLINE_SAVE_PREFIX.toLowerCase()) ||
        lowerName.startsWith(ACTIVE_SAVE_PREFIX.toLowerCase());
}

function isUuidV7(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function createUuidV7(): string {
    // UUIDv7：前 48 位是 Unix 毫秒时间，版本位固定为 7，variant 固定为 RFC 9562 的 10。
    // 其余 74 位使用 Jint 的随机源；时间有序且每位玩家发生碰撞的概率可以忽略。
    const bytes: number[] = [];
    for (let index = 0; index < 16; index++) bytes.push(Math.floor(Math.random() * 256));
    let timestamp = Date.now();
    for (let index = 5; index >= 0; index--) {
        bytes[index] = timestamp % 256;
        timestamp = Math.floor(timestamp / 256);
    }
    bytes[6] = 0x70 | (bytes[6] & 0x0f);
    bytes[8] = 0x80 | (bytes[8] & 0x3f);
    const hex = bytes.map(value => ("0" + Math.floor(value).toString(16)).slice(-2)).join("");
    return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-" +
        hex.substring(16, 20) + "-" + hex.substring(20);
}

function getOrCreateOnlineSaveId(): string {
    const existing = UnityEngine.PlayerPrefs.GetString(ONLINE_SAVE_ID_KEY, "");
    if (isUuidV7(existing)) return existing.toLowerCase();
    const created = createUuidV7();
    UnityEngine.PlayerPrefs.SetString(ONLINE_SAVE_ID_KEY, created);
    UnityEngine.PlayerPrefs.Save();
    return created;
}

function hasUuidV7OnlineName(value: string): boolean {
    return value.startsWith(ONLINE_SAVE_PREFIX) && isUuidV7(value.substring(ONLINE_SAVE_PREFIX.length));
}

function makeOnlineSaveName(): string {
    // 每位玩家只生成一次 UUIDv7；之后建房、自动保存和重新进入都复用同一专属 ID。
    return ONLINE_SAVE_PREFIX + getOrCreateOnlineSaveId();
}

type GameReadyPredicate = (manager: GameManager) => boolean;

function waitForGameState(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void,
    predicate: GameReadyPredicate, remaining: number, settleFrames = 0): void {
    if (!isCurrentGeneration()) return;
    // 场景切换期间旧单例仍可能存活；调用者可要求先让出若干帧，再检查目标状态。
    if (settleFrames > 0) {
        JintCoroutine.WaitForNextFrame(owner,
            () => waitForGameState(owner, callback, predicate, remaining, settleFrames - 1));
        return;
    }
    try {
        const manager = GameManager.Singleton;
        if (manager && predicate(manager)) { callback(manager); return; }
    } catch (_error) { }
    if (remaining <= 0) { toast(tr("toast.onlineSaveFailed")); return; }
    JintCoroutine.WaitForNextFrame(owner,
        () => waitForGameState(owner, callback, predicate, remaining - 1));
}

function waitForGameManager(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void,
    remaining = 180, settleFrames = 2): void {
    waitForGameState(owner, callback, _manager => true, remaining, settleFrames);
}

function waitForPlayableGame(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void, remaining = 600): void {
    waitForGameState(owner, callback, _manager => Boolean(GameManager.InGame && Player.LocalPlayer), remaining);
}

function waitForSavableGame(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void, remaining = 900): void {
    waitForGameState(owner, callback, manager => {
        if (!GameManager.InGame || !Player.LocalPlayer) return false;
        const raw = manager.GetSave();
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
    }, remaining);
}

function gameCoroutineOwner(menu: MainMenu): UnityEngine.MonoBehaviour {
    // UI 根节点使用 DontDestroyOnLoad，优先让等待任务绑定到它的常驻 MonoBehaviour。
    if (coroutineRunner) return coroutineRunner;
    try { if (GameManager.Singleton) return GameManager.Singleton; } catch (_error) { }
    try {
        const manager = menu.gameManager ? menu.gameManager.GetComponent("GameManager") : null;
        if (manager) return manager as GameManager;
    } catch (_error) { }
    return menu;
}

function enterOnlineSave(): void {
    const menu = mainMenuInstance;
    if (!menu) {
        // 暂停菜单可以修改联机参数，但创建或切换线上存档必须回到主菜单，避免覆盖当前单机进度。
        if (!GameManager.InGame) toast(tr("toast.onlineSaveFailed"));
        return;
    }

    const config = loadConfig();
    const forcedTestSave = BRIDGE_CHANNEL !== "default" && config.smokeTestOnlineLifecycle &&
        hasUuidV7OnlineName(config.smokeTestOnlineSaveName) ? config.smokeTestOnlineSaveName : "";
    if (forcedTestSave) {
        selectedSaveName = forcedTestSave;
        UnityEngine.PlayerPrefs.SetString(prefKey("MPB.SelectedSave"), selectedSaveName);
        UnityEngine.PlayerPrefs.SetString(ONLINE_SAVE_ID_KEY,
            selectedSaveName.substring(ONLINE_SAVE_PREFIX.length).toLowerCase());
        UnityEngine.PlayerPrefs.Save();
    }
    const state = readBridgeState();
    // 自动化只允许访问本次随机 UUID，绝不能因为开发机已有线上档而切换到用户文件。
    const saves = forcedTestSave ? [] : (state && state.saves ? state.saves : []);
    // PlayerPrefs 中的上次线上档名是首选依据。state.json 正在刷新或桥接刚启动时，
    // saves 可能暂时为空；不能因此直接创建新档，必须让桥接程序到磁盘上验证。
    let rememberedSave = selectedSaveName.startsWith(ONLINE_SAVE_PREFIX) ? selectedSaveName : "";
    const rememberedIsListed = rememberedSave && saves.some(save => save.name === rememberedSave);
    // 索引非空时以磁盘结果为准：旧选择已丢失就续读最近的现存档，而不是另建一个。
    if (saves.length > 0 && !rememberedIsListed) {
        selectedSaveName = saves[0].name;
        rememberedSave = selectedSaveName;
        UnityEngine.PlayerPrefs.SetString(prefKey("MPB.SelectedSave"), selectedSaveName);
        UnityEngine.PlayerPrefs.Save();
    }

    if (hasUuidV7OnlineName(rememberedSave)) {
        // 从其他电脑复制来的 UUIDv7 线上档也应成为当前玩家后续固定使用的专属 ID。
        UnityEngine.PlayerPrefs.SetString(ONLINE_SAVE_ID_KEY,
            rememberedSave.substring(ONLINE_SAVE_PREFIX.length).toLowerCase());
        UnityEngine.PlayerPrefs.Save();
    } else if (rememberedSave) {
        // 旧版时间戳文件只迁移名称，桥接程序不会解密或改写其中的存档内容。
        const migratedName = makeOnlineSaveName();
        const migrateSequence = submitBridgeCommandTracked("renameSave?name=" + encodeURIComponent(rememberedSave) +
            "&target=" + encodeURIComponent(migratedName));
        if (migrateSequence < 0) { toast(tr("toast.onlineSaveFailed")); return; }
        waitForBridgeResponse(menu, migrateSequence, result => {
            if (result === "0" || result === "-4") {
                selectedSaveName = migratedName;
                UnityEngine.PlayerPrefs.SetString(prefKey("MPB.SelectedSave"), selectedSaveName);
                UnityEngine.PlayerPrefs.Save();
                log("已将旧线上存档迁移为玩家 UUIDv7 专属 ID: " + selectedSaveName);
                enterOnlineSave();
                return;
            }
            if (result === "-3") {
                log("旧线上存档已不存在，将使用玩家 UUIDv7 创建首个线上档");
                createInitialOnlineSave(menu);
                return;
            }
            log("迁移 UUIDv7 线上存档失败，错误码=" + result);
            toast(tr("toast.onlineSaveFailed"));
        });
        return;
    }

    // 即使 PlayerPrefs 和刚启动时的状态快照都为空，也必须让桥接程序权威扫描磁盘。
    // prepareSave 只有在正式档与工作副本都不存在时才返回 -3，此时才允许创建首个线上档。
    const requestedSaveName = rememberedSave || selectedSaveName;
    // 自动化随机 UUID 必须严格隔离，不能回退到开发机上的真实玩家存档。
    const strictTestName = forcedTestSave ? "&strict=1" : "";
    const sequence = submitBridgeCommandTracked("prepareSave?name=" + encodeURIComponent(requestedSaveName) + strictTestName);
    if (sequence < 0) { toast(tr("toast.onlineSaveFailed")); return; }
    waitForBridgeResponse(menu, sequence, result => {
            if (result === "-3") {
                log("磁盘上没有正式线上档或恢复副本，将创建首个线上存档");
                createInitialOnlineSave(menu);
                return;
            }
            if (result !== "0") { log("准备线上存档失败，错误码=" + result); toast(tr("toast.onlineSaveFailed")); return; }
            try {
                preparedOnlineSaveMetadata = readPreparedSaveMetadata(requestedSaveName);
                if (!preparedOnlineSaveMetadata || !hasUuidV7OnlineName(preparedOnlineSaveMetadata.save))
                    throw new Error("桥接程序没有返回有效的 UUIDv7 线上存档元数据");
                selectedSaveName = preparedOnlineSaveMetadata.save;
                const activeName = activeSaveName(selectedSaveName);
                if (!activeName) throw new Error("无法生成线上工作副本名称");
                // 桥接实际选中的磁盘文件具有最高优先级，同时修复被清除或过期的 PlayerPrefs。
                UnityEngine.PlayerPrefs.SetString(prefKey("MPB.SelectedSave"), selectedSaveName);
                UnityEngine.PlayerPrefs.SetString(ONLINE_SAVE_ID_KEY,
                    selectedSaveName.substring(ONLINE_SAVE_PREFIX.length).toLowerCase());
                UnityEngine.PlayerPrefs.Save();
                // 在 StartGame 执行任何原版默认读取之前就切换到联机专属名称。
                GameManager.SaveName = activeName;
                onlineLoadRedirectedDuringStart = false;
                menu.StartGame();
                waitForPlayableGame(gameCoroutineOwner(menu), manager => {
                    // StartGame 内的早期 LoadGame 会在新游戏初始化期间被出生点覆盖。无论该 Hook
                    // 是否触发，都必须等新场景玩家建立后再由当前 GameManager 正式载入一次。
                    GameManager.SaveName = activeName;
                    manager.LoadGame(activeName);
                    closePanel();
                    log("已载入线上存档: " + selectedSaveName);
                    // 原版晚加载不会再执行初始化阶段的 PlayerPosition；等订阅组件收尾后补应用场景位置。
                    JintCoroutine.WaitForSeconds(manager, 2, () => {
                        applyPreparedOnlineLocation(() => {
                            if (config.smokeTestOnlineLifecycle) waitForSavableGame(manager, () => {
                                onlineSaveSessionReady = true;
                                log("诊断模式：线上续档已进入可玩状态 save=" + selectedSaveName);
                            });
                        });
                    });
                });
            } catch (error) { log("载入线上存档失败: " + error); toast(tr("toast.onlineSaveFailed")); }
    });
}

function createInitialOnlineSave(menu: MainMenu): void {
    // 磁盘上确实没有线上档时才从游戏的新游戏初始状态开始，绝不复制任何单机存档。
    selectedSaveName = makeOnlineSaveName();
    const activeName = activeSaveName(selectedSaveName);
    UnityEngine.PlayerPrefs.SetString(prefKey("MPB.SelectedSave"), selectedSaveName);
    UnityEngine.PlayerPrefs.Save();
    const sequence = submitBridgeCommandTracked("beginSave?name=" + encodeURIComponent(selectedSaveName));
    if (sequence < 0) { toast(tr("toast.onlineSaveFailed")); return; }
    waitForBridgeResponse(menu, sequence, result => {
        if (result !== "0") { log("创建线上存档会话失败，错误码=" + result); toast(tr("toast.onlineSaveFailed")); return; }
        try {
            GameManager.SaveName = activeName;
            menu.StartGame();
            waitForSavableGame(gameCoroutineOwner(menu), manager => {
                GameManager.SaveName = activeName;
                // Jint 再入调用原生 SaveGame 会在部分版本留下 0 字节 StreamWriter 文件。
                // 直接提交 GetSave JSON，由桥按原版算法生成第一层，再套 Mod 第二层。
                const saveResult = writeOnlineSaveSnapshot(manager);
                if (saveResult === "0") {
                    if (loadConfig().smokeTestOnlineLifecycle) onlineSaveSessionReady = true;
                    log("诊断模式：首个线上档已写入正式加密容器 save=" + selectedSaveName);
                } else log("首个线上档提交失败，错误码=" + saveResult);
                closePanel();
                toast(tr("toast.onlineSaveCreated"));
                log("已从零创建线上存档: " + selectedSaveName);
            });
        } catch (error) { log("创建线上存档失败: " + error); toast(tr("toast.onlineSaveFailed")); }
    });
}

function joinFromUi(): void {
    if (!bridgeAvailable) { toast(tr("toast.runtimeMissing")); return; }
    const config = loadConfig();
    const address = valueOr(uiAddress, config.address);
    const port = Number(valueOr(uiPort, String(config.port)));
    currentPlayerName = valueOr(uiName, config.playerName);
    if (!Number.isInteger(port) || port < 1 || port > 65535) { toast(tr("toast.invalidPort")); return; }
    UnityEngine.PlayerPrefs.SetString(prefKey("MPB.Address"), address);
    UnityEngine.PlayerPrefs.SetString(prefKey("MPB.Port"), String(port));
    UnityEngine.PlayerPrefs.SetString(prefKey("MPB.PlayerName"), currentPlayerName);
    UnityEngine.PlayerPrefs.Save();
    updateStatusText(tr("status.connectingTo", { address, port }));
    clientEntryStarted = false;
    const sequence = submitBridgeCommandTracked("join?address=" + encodeURIComponent(address) + "&port=" + port);
    if (sequence < 0 || !mainMenuInstance) { role = "off"; toast(tr("toast.joinFailed", { code: -1 })); return; }
    waitForBridgeResponse(mainMenuInstance, sequence, result => {
        if (result !== "0") { role = "off"; toast(tr("toast.joinFailed", { code: result })); return; }
        role = "client";
        localNetworkId = -1;
    });
}

function stopFromUi(): void {
    try { bridgeCall("stop"); } catch (_error) { }
    role = "off";
    localNetworkId = -1;
    clientEntryStarted = false;
    clearRemotePlayers();
    outgoingMessages.splice(0, outgoingMessages.length);
    for (const key of Object.keys(sleepReady)) delete sleepReady[key];
    if (uiPauseLoadButton) uiPauseLoadButton.SetActive(true);
    updateStatusText(tr("status.offline"));
    toast(tr("toast.stopped"));
}

// ===== 模块: network/transport.ts =====
// 消息队列与校验。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function send(peerId: number, message: any): void {
    // PlayerPrefs 是单槽 IPC，连续写入会覆盖尚未被桥接程序读取的命令，因此先进入游戏侧队列。
    const data = JSON.stringify(message);
    const type = String(message && message.type || "");
    const priority = type === "playerState" || type === "worldTime" ? 1 :
        (type === "playerProfile" || type === "playerProfileChunk" ? 2 : 0);
    if (outgoingMessages.length >= 1024) {
        // 队列满时只丢可替代的旧位置/时间包；不能把资料分片头部删掉导致永远无法重组。
        const disposable = outgoingMessages.findIndex(item => item.priority === 1);
        if (disposable >= 0) outgoingMessages.splice(disposable, 1);
        else if (priority === 1) return;
        else outgoingMessages.shift();
    }
    outgoingMessages.push({ peerId, data, priority });
}

// 玩家完整存档数据可能超过桥接层单帧 64 KiB 限制。资料包超过安全值时拆分发送，
// 接收端重组后仍按一个带修订号的 playerProfile 处理，避免静默丢失手机、联系人等字段。
function sendPlayerProfilePacket(peerId: number, packet: PlayerProfilePacket): void {
    const serialized = JSON.stringify(packet);
    if (serialized.length <= 50000) {
        send(peerId, packet);
        return;
    }
    const count = Math.ceil(serialized.length / PLAYER_PROFILE_CHUNK_SIZE);
    if (count > MAX_PLAYER_PROFILE_CHUNKS) {
        log("玩家完整资料超过同步上限，已跳过: " + serialized.length);
        return;
    }
    const transferId = packet.ownerId + "-" + packet.revision + "-" + Date.now();
    for (let index = 0; index < count; index++) {
        send(peerId, {
            type: "playerProfileChunk", transferId, index, count,
            payload: serialized.substring(index * PLAYER_PROFILE_CHUNK_SIZE, (index + 1) * PLAYER_PROFILE_CHUNK_SIZE)
        } as PlayerProfileChunkPacket);
    }
}

function validPlayerProfileChunk(packet: any): packet is PlayerProfileChunkPacket {
    return packet && packet.type === "playerProfileChunk" && typeof packet.transferId === "string" &&
        packet.transferId.length <= 128 && Number.isInteger(Number(packet.index)) &&
        Number.isInteger(Number(packet.count)) && Number(packet.count) > 0 &&
        Number(packet.count) <= MAX_PLAYER_PROFILE_CHUNKS && Number(packet.index) >= 0 &&
        Number(packet.index) < Number(packet.count) && typeof packet.payload === "string" &&
        packet.payload.length <= PLAYER_PROFILE_CHUNK_SIZE;
}

function receivePlayerProfileChunk(packet: PlayerProfileChunkPacket, sourcePeerId: number): PlayerProfilePacket | null {
    const now = Number(UnityEngine.Time.unscaledTime);
    for (const pendingKey of Object.keys(pendingProfileChunks)) {
        if (now - pendingProfileChunks[pendingKey].createdAt > 30) delete pendingProfileChunks[pendingKey];
    }
    // 房主按来源 peer 隔离 transferId，防止不同客户端碰撞；客户端来源固定为服务器。
    const key = sourcePeerId + ":" + packet.transferId;
    let pending = pendingProfileChunks[key];
    if (!pending || pending.count !== packet.count) {
        pending = { parts: [], received: 0, count: packet.count, createdAt: now };
        pendingProfileChunks[key] = pending;
    }
    if (pending.parts[packet.index] === undefined) {
        pending.parts[packet.index] = packet.payload;
        pending.received += 1;
    }
    if (pending.received < pending.count) return null;
    delete pendingProfileChunks[key];
    try {
        const completed = JSON.parse(pending.parts.join(""));
        return validPlayerProfile(completed) ? completed : null;
    } catch (error) {
        log("重组玩家完整资料失败: " + error);
        return null;
    }
}

function flushOutgoingMessage(): void {
    if (!bridgeAvailable || outgoingMessages.length === 0) return;
    // join 命令返回只代表开始异步连接；TCP 尚未进入 connected 时保留队列，不能调用
    // Send 让桥接产生误导性的 “bridge is not connected” 错误事件。
    if ((role === "client" && bridgeNetworkState !== "connected") ||
        (role === "host" && bridgeNetworkState !== "hosting")) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (now < nextOutgoingMessageAt) return;
    nextOutgoingMessageAt = advanceFixedDeadline(nextOutgoingMessageAt, now, OUTGOING_MESSAGE_INTERVAL);
    // 每帧最多四条：控制优先，至少给一个资料分片机会，其余发送最新实时状态。
    // 这让四名客户端的房主基础流量不会超过消费速度，同时避免大资料饿死。
    for (let sent = 0; sent < 4 && outgoingMessages.length > 0; sent++) {
        let index = outgoingMessages.findIndex(item => item.priority === 0);
        if (index < 0 && sent === 0) index = outgoingMessages.findIndex(item => item.priority === 2);
        if (index < 0) index = outgoingMessages.findIndex(item => item.priority === 1);
        if (index < 0) index = 0;
        const item = outgoingMessages.splice(index, 1)[0];
        const result = bridgeCall("send?peer=" + item.peerId + "&data=" + encodeURIComponent(item.data));
        if (result !== "0") log("发送失败，错误码=" + result);
    }
}

function finiteNumber(value: any, fallback = 0): number {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function validPlayerState(packet: any): packet is PlayerStatePacket {
    const layersValid = Array.isArray(packet && packet.animations) && packet.animations.length <= 8 &&
        packet.animations.every((layer: any) => layer && Number.isFinite(Number(layer.hash)) &&
            Number.isFinite(Number(layer.time)) && Number.isFinite(Number(layer.weight)));
    return packet && packet.type === "playerState" && Number.isInteger(Number(packet.ownerId)) &&
        Number.isInteger(Number(packet.sequence)) && Number(packet.sequence) >= 0 &&
        packet.position && packet.rotation && packet.move && typeof packet.scene === "string" &&
        packet.scene.length <= 128 && String(packet.playerName || "").length <= 64 && layersValid &&
        [packet.position.x, packet.position.y, packet.position.z, packet.rotation.x, packet.rotation.y,
            packet.rotation.z, packet.rotation.w, packet.move.x, packet.move.y, packet.move.z]
            .every(value => Number.isFinite(Number(value)) && Math.abs(Number(value)) < 1000000);
}

function validPlayerProfile(packet: any): packet is PlayerProfilePacket {
    if (!packet || packet.type !== "playerProfile" || !Number.isInteger(Number(packet.ownerId)) ||
        !Number.isInteger(Number(packet.revision)) || !packet.profile || !Array.isArray(packet.profile.cloth) ||
        !packet.profile.customization || typeof packet.profile.customization !== "object" ||
        !packet.profile.progress || typeof packet.profile.progress !== "object") return false;
    if (packet.profile.cloth.length > 128) return false;
    return packet.profile.cloth.every((id: any) => typeof id === "string" && id.length <= 128);
}

function validPlayerLiveData(packet: any): packet is PlayerLiveDataPacket {
    return packet && packet.type === "playerLiveData" && Number.isInteger(Number(packet.ownerId)) &&
        Number.isInteger(Number(packet.sequence)) && Number(packet.sequence) >= 0 &&
        packet.status && typeof packet.status === "object" && Object.keys(packet.status).length <= 128 &&
        Number.isFinite(Number(packet.gameTime)) && Number.isFinite(Number(packet.timeOffset)) &&
        typeof packet.scene === "string" && packet.scene.length <= 128 &&
        String(packet.playerName || "").length <= 64;
}

function validWorldTime(packet: any): packet is WorldTimePacket {
    return packet && packet.type === "worldTime" && Number.isInteger(Number(packet.sequence)) &&
        Number.isFinite(Number(packet.gameTime)) && Number(packet.gameTime) >= 0 &&
        Number.isFinite(Number(packet.day)) && Number.isFinite(Number(packet.timeOfDay)) &&
        Number.isFinite(Number(packet.timeOffset));
}

// ===== 模块: network/world-time.ts =====
// 权威时间与睡眠共识。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function validSleepMode(value: any): value is SleepMode {
    return value === "short" || value === "tomorrow";
}

// 联机时不再使用各电脑自己的 Time.deltaTime 累加结果。房主维护唯一权威时钟，客户端
// 收到房主锚点后只在两次网络包之间按 unscaledTime 平滑推进，下一包会重新校准。
// 这样 ESC 菜单、窗口动画或本地 timeScale 都不能让任意一台电脑的游戏时间停住或分叉。
function updateOnlineWorldClock(): void {
    if (role === "off" || !GameManager.InGame || !GameManager.Singleton) {
        onlineClockInitialized = false;
        return;
    }
    const now = Number(UnityEngine.Time.unscaledTime);
    if (!onlineClockInitialized) {
        onlineClockInitialized = true;
        onlineClockGameTime = Number(GameManager.Singleton.gameTime);
        onlineClockLastUnscaledTime = now;
    } else {
        const elapsed = Math.max(0, Math.min(0.25, now - onlineClockLastUnscaledTime));
        onlineClockGameTime += elapsed;
        onlineClockLastUnscaledTime = now;
    }
    GameManager.Singleton.gameTime = onlineClockGameTime;
}

function resetOnlineWorldClockFromGame(): void {
    if (!GameManager.Singleton) return;
    onlineClockInitialized = true;
    onlineClockGameTime = Number(GameManager.Singleton.gameTime);
    onlineClockLastUnscaledTime = Number(UnityEngine.Time.unscaledTime);
}

function sendAuthoritativeWorldTime(force = false): void {
    if (role !== "host" || !GameManager.InGame || !GameManager.Singleton) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (!force && now < nextWorldTimeAt) return;
    nextWorldTimeAt = advanceFixedDeadline(nextWorldTimeAt, now, WORLD_TIME_INTERVAL);
    const status = Player.LocalPlayer ? Player.LocalPlayer.status : null;
    const data = status ? status.Data : null;
    send(0, {
        type: "worldTime",
        sequence: ++worldTimeSequence,
        gameTime: Number(GameManager.Singleton.gameTime),
        day: data ? Number(data.day) : 0,
        timeOfDay: data ? Number(data.timeOfDay) : 0,
        timeOffset: status ? Number(status.timeOffset) : 0
    } as WorldTimePacket);
}

function applyAuthoritativeWorldTime(packet: WorldTimePacket): void {
    if (role !== "client" || !validWorldTime(packet) || packet.sequence <= lastWorldTimeSequence) return;
    lastWorldTimeSequence = packet.sequence;
    applyingAuthoritativeTime = true;
    try {
        onlineClockInitialized = true;
        onlineClockGameTime = Number(packet.gameTime);
        onlineClockLastUnscaledTime = Number(UnityEngine.Time.unscaledTime);
        if (GameManager.Singleton) GameManager.Singleton.gameTime = onlineClockGameTime;
        const status = Player.LocalPlayer ? Player.LocalPlayer.status : null;
        if (status && status.Data) {
            status.timeOffset = Number(packet.timeOffset);
            // PlayerStatus.Data 返回 PlayerData(struct) 的副本，直接写 Data.day/timeOfDay 不会可靠回写。
            // 使用游戏公开接口推进日期和设置时段，避免只修改装箱副本。
            const targetDay = Math.trunc(Number(packet.day));
            let localDay = Math.trunc(Number(status.Data.day));
            for (let guard = 0; localDay < targetDay && guard < 64; guard++, localDay++) status.AddDay();
            const targetTimeOfDay = Math.trunc(Number(packet.timeOfDay));
            if (Math.trunc(Number(status.Data.timeOfDay)) !== targetTimeOfDay) status.SetTime(targetTimeOfDay);
        }
        if (BRIDGE_CHANNEL !== "default") {
            const now = Number(UnityEngine.Time.unscaledTime);
            if (lastDiagnosticWorldTimeLogAt < 0 || now - lastDiagnosticWorldTimeLogAt >= 2) {
                lastDiagnosticWorldTimeLogAt = now;
                log("[双实例证据] 已应用房主时间 seq=" + packet.sequence + " gameTime=" +
                    Number(packet.gameTime).toFixed(2) + " day=" + Math.trunc(Number(packet.day)) +
                    " timeOfDay=" + Math.trunc(Number(packet.timeOfDay)));
            }
        }
    } catch (error) { log("应用房主游戏时间失败: " + error); }
    finally { applyingAuthoritativeTime = false; }
}

// PlayerStatus 没有 SetDay，日期只能通过 AddDay 向前推进。若加入者的线上角色日期
// 比房主更晚，房主先采用房间内最大的日期，再广播给所有人；之后客户端的本地
// AddTime/AddDay 会被拦截，因此整个会话不会再次分叉，也不需要倒退日期破坏任务状态。
function adoptLatestRoomDay(profile: PlayerProfile): void {
    if (role !== "host" || !Player.LocalPlayer || !Player.LocalPlayer.status) return;
    try {
        const source = profile.progress ? profile.progress.PlayerStatusData : null;
        const peerDay = source ? Math.trunc(Number(source.day)) : 0;
        const status = Player.LocalPlayer.status;
        let hostDay = status.Data ? Math.trunc(Number(status.Data.day)) : 0;
        if (!Number.isFinite(peerDay) || peerDay <= hostDay) return;
        applyingAuthoritativeTime = true;
        for (let guard = 0; hostDay < peerDay && guard < 4096; guard++, hostDay++) status.AddDay();
        log("房间日期已推进到较晚玩家的进度: 第 " + peerDay + " 天");
        sendAuthoritativeWorldTime(true);
    } catch (error) { log("合并房间日期失败: " + error); }
    finally { applyingAuthoritativeTime = false; }
}

function invokeApprovedSleep(mode: SleepMode): void {
    if (!bedWindowInstance || sleepConsensusExecuting) return;
    const button = mode === "tomorrow"
        ? bedWindowInstance.sleepToTomorrowButton
        : bedWindowInstance.sleepForAWhileButton;
    if (!button) return;
    sleepConsensusExecuting = true;
    try {
        button.onClick.Invoke();
        // 睡眠可能一次性改写 gameTime；立即把新值纳入 Mod 权威时钟，不能在下一帧
        // 又被睡眠前的旧锚点覆盖。
        resetOnlineWorldClockFromGame();
    }
    catch (error) { log("执行全员睡觉失败: " + error); }
    finally { sleepConsensusExecuting = false; }
}

function tryApproveSleep(): void {
    if (role !== "host") return;
    const now = Number(UnityEngine.Time.unscaledTime);
    // TCP 已连接但 hello 尚未恢复时，peerNames 可能短暂为空。以桥接层真实连接数兜底，
    // 只要还有任何未登记玩家就绝不批准睡眠。
    const bridgeState = readBridgeState();
    const connectedPeers = bridgeState ? Math.max(0, Math.trunc(Number(bridgeState.peers) || 0)) : 0;
    if (Object.keys(peerNames).length < connectedPeers) return;
    const expected = ["0", ...Object.keys(peerNames)];
    let mode: SleepMode | null = null;
    for (const peerId of expected) {
        const ready = sleepReady[peerId];
        if (!ready || now - ready.at > SLEEP_READY_TIMEOUT) return;
        if (!mode) mode = ready.mode;
        else if (mode !== ready.mode) return;
    }
    if (!mode) return;
    for (const key of Object.keys(sleepReady)) delete sleepReady[key];
    const packet: SleepApprovedPacket = { type: "sleepApproved", mode, sequence: ++sleepApprovalSequence };
    pendingSleepApproval = {
        packet, createdAt: now, acknowledged: {}, nextSendAt: now + 0.5
    };
    send(0, packet);
    log("全员睡眠共识已批准: " + mode + "，序号=" + packet.sequence);
    invokeApprovedSleep(mode);
    // 睡觉回调可能通过协程推进时间；随后正常的房主时间包会持续把结果同步给所有玩家。
    sendAuthoritativeWorldTime(true);
}

// 睡眠批准是一次性控制消息，不能像位置包一样允许状态快照漏掉。房主每 0.5 秒
// 向尚未确认的客户端重发，全部 ACK 或 10 秒超时后结束本轮。
function resendPendingSleepApproval(): void {
    if (role !== "host" || !pendingSleepApproval) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    const peerIds = Object.keys(peerNames);
    if (peerIds.every(peerId => pendingSleepApproval!.acknowledged[peerId])) {
        log("全部客户端已确认睡眠批准: " + pendingSleepApproval.packet.sequence);
        pendingSleepApproval = null;
        return;
    }
    if (now - pendingSleepApproval.createdAt > 10) {
        log("睡眠批准确认超时，本轮已结束: " + pendingSleepApproval.packet.sequence);
        pendingSleepApproval = null;
        return;
    }
    if (now < pendingSleepApproval.nextSendAt) return;
    pendingSleepApproval.nextSendAt = now + 0.5;
    for (const peerId of peerIds) {
        if (!pendingSleepApproval.acknowledged[peerId])
            send(Number(peerId), pendingSleepApproval.packet);
    }
}

function requestConsensusSleep(mode: SleepMode, ctx: IHookContext): void {
    if (role === "off" || sleepConsensusExecuting) return;
    ctx.Intercept();
    if (role === "host") {
        sleepReady["0"] = { mode, at: Number(UnityEngine.Time.unscaledTime) };
        const waitingForRemotePlayers = Object.keys(peerNames).length > 0;
        tryApproveSleep();
        if (waitingForRemotePlayers) toast(tr("toast.sleepWaiting"));
    } else {
        send(0, { type: "sleepRequest", mode } as SleepRequestPacket);
        toast(tr("toast.sleepWaiting"));
    }
}

// ===== 模块: player/avatar/bones.ts =====
// 远端模型骨骼映射。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function destroyRemotePlayer(ownerId: number): void {
    const key = String(ownerId);
    const remote = remotePlayers[key];
    if (!remote) return;
    try { if (remote.root) UnityEngine.Object.Destroy(remote.root); } catch (_error) { }
    // 远端渲染器使用独立材质，销毁代理时同步释放，避免频繁换装造成显存泄漏。
    try {
        for (const material of remote.ownedMaterials) {
            if (material) UnityEngine.Object.Destroy(material);
        }
    } catch (_error) { }
    delete remotePlayers[key];
}

function bindRemoteClothBones(dressRoot: UnityEngine.Transform, armature: UnityEngine.Transform,
    cloneRoot: UnityEngine.Transform): { renderers: number; mapped: number; total: number; missing: number;
        preserved: number; missingNames: string[] } {
    const result = { renderers: 0, mapped: 0, total: 0, missing: 0, preserved: 0, missingNames: [] as string[] };
    const dress = dressRoot.gameObject.GetComponent("Dress") as Dress;
    if (!dress) throw new Error("衣服根节点缺少 Dress 组件");

    const belongsToClone = (bone: UnityEngine.Transform | null): boolean => {
        let node = bone;
        for (let guard = 0; node && guard < 160; guard++) {
            if (String(node.name) === String(cloneRoot.name)) return true;
            node = node.parent;
        }
        return false;
    };
    const belongsToDress = (bone: UnityEngine.Transform | null): boolean => {
        let node = bone;
        for (let guard = 0; node && guard < 160; guard++) {
            if (String(node.name) === String(dressRoot.name)) return true;
            node = node.parent;
        }
        return false;
    };
    const visit = (node: UnityEngine.Transform): void => {
        const renderer = node.gameObject.GetComponent("SkinnedMeshRenderer") as UnityEngine.SkinnedMeshRenderer;
        if (renderer) {
            result.renderers += 1;
            const bones = renderer.bones;
            for (let boneIndex = 0; boneIndex < bones.length; boneIndex++) {
                result.total += 1;
                const bone = bones[boneIndex];
                if (bone && belongsToClone(bone)) {
                    result.mapped += 1;
                    if (belongsToDress(bone)) result.preserved += 1;
                } else {
                    result.missing += 1;
                    const missingName = bone ? String(bone.name) : "<null>";
                    if (result.missingNames.indexOf(missingName) < 0) result.missingNames.push(missingName);
                }
            }
            renderer.updateWhenOffscreen = true;
        }
        for (let index = 0; index < node.childCount; index++) visit(node.GetChild(index));
    };
    visit(dressRoot);
    return result;
}

function collectRemoteClothBonePairs(clone: UnityEngine.GameObject, armature: UnityEngine.Transform):
    { driven: UnityEngine.Transform; source: UnityEngine.Transform }[] {
    const sourceByName: Record<string, UnityEngine.Transform> = {};
    const collectSources = (node: UnityEngine.Transform): void => {
        sourceByName[String(node.name)] = node;
        for (let index = 0; index < node.childCount; index++) collectSources(node.GetChild(index));
    };
    collectSources(armature);
    const pairs: { driven: UnityEngine.Transform; source: UnityEngine.Transform }[] = [];
    const clothRoot = clone.transform.Find("ClothRoot");
    const collectDriven = (node: UnityEngine.Transform): void => {
        // stripRemoteNode 会删除所有未启用分支；这里不能把那些即将销毁的 Transform
        // 放入持久映射，否则下一次状态包访问失效包装器会抛 NullReferenceException。
        if (node !== clothRoot && !node.gameObject.activeSelf) return;
        const source = sourceByName[String(node.name)];
        if (source) pairs.push({ driven: node, source });
        for (let index = 0; index < node.childCount; index++) collectDriven(node.GetChild(index));
    };
    if (clothRoot) collectDriven(clothRoot);
    log("远端衣服骨骼驱动映射完成: " + pairs.length + " 对");
    return pairs;
}

// ===== 模块: player/avatar/appearance.ts =====
// 远端模型外观。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function applyRemoteAppearance(clone: UnityEngine.GameObject, profile: PlayerProfile | undefined): void {
    if (!profile) return;
    try {
        const clonedPlayer = clone.GetComponent("Player") as Player;
        const playerCloth = clonedPlayer ? clonedPlayer.cloth : null;
        const allCloths = playerCloth ? playerCloth.All : null;
        const equippedCloths = playerCloth ? playerCloth.cloths : null;
        const findDress = (id: string): any => {
            // Jint 的字典索引器在键不存在时会把 KeyNotFoundException 穿透 JS try/catch。
            // 必须先调用 ContainsKey，再调用 get_Item；不能使用 dictionary[id] 探测。
            if (allCloths && (allCloths as any).ContainsKey(id)) {
                const value = (allCloths as any).get_Item(id);
                if (value) return value as Dress;
            }
            if (equippedCloths && (equippedCloths as any).ContainsKey(id)) {
                const value = (equippedCloths as any).get_Item(id);
                if (value) return value as Dress;
            }
            // PlayerCloth 的字典由 Awake/Start 初始化，而远端克隆必须在未激活状态先剥离
            // 游戏逻辑脚本，因此该字典可能为空。衣服实际位于 Player/ClothRoot/<ID>，
            // 直接按节点名查找即可启用渲染对象，不需要运行 PlayerCloth。
            const clothRoot = clone.transform.Find("ClothRoot");
            if (clothRoot) {
                for (let index = 0; index < clothRoot.childCount; index++) {
                    const child = clothRoot.GetChild(index);
                    if (String(child.name) === id) return { gameObject: child.gameObject };
                }
            }
            return null;
        };

        // 克隆源带着本机当前服装，先按本机存档中的明确 ID 关闭，再启用远端服装。
        // 不能枚举 Dictionary，否则启动器环境会得到空数组并把本机服装错误保留在远端模型上。
        try {
            const localSave = JSON.parse(GameManager.Singleton ? (GameManager.Singleton.GetSave() || "{}") : "{}");
            const localCloth = Array.isArray(localSave.Cloth) ? localSave.Cloth : [];
            for (const rawId of localCloth) {
                const dress = findDress(String(rawId));
                if (dress && dress.gameObject) dress.gameObject.SetActive(false);
            }
        } catch (_error) { }
        let appliedCloth = 0;
        const remoteArmature = clonedPlayer && clonedPlayer.bodyModel ? clonedPlayer.bodyModel.armature : null;
        for (const rawId of profile.cloth) {
            const id = String(rawId);
            const dress = findDress(id);
            if (dress && dress.gameObject) {
                dress.gameObject.SetActive(true);
                if (!remoteArmature) {
                    dress.gameObject.SetActive(false);
                    log("远端衣服缺少目标 Armature，已禁用: " + id);
                    continue;
                }
                const binding = bindRemoteClothBones(dress.gameObject.transform, remoteArmature, clone.transform);
                if (binding.renderers <= 0 || binding.missing > 0 || binding.mapped !== binding.total) {
                    dress.gameObject.SetActive(false);
                    log("远端衣服骨骼重绑失败 dress=" + id + " renderers=" + binding.renderers +
                        " bones=" + binding.mapped + "/" + binding.total + " missing=" + binding.missing +
                        " names=" + binding.missingNames.slice(0, 24).join(","));
                    continue;
                }
                appliedCloth += 1;
                log("远端衣服骨骼绑定完成 dress=" + id + " renderers=" + binding.renderers +
                    " bones=" + binding.mapped + "/" + binding.total + " local=" + binding.preserved +
                    " missing=0 root=" + remoteArmature.name);
            } else log("远端衣服 ID 在本机资源中不存在: " + id);
        }
        log("远端衣服映射完成: " + appliedCloth + "/" + profile.cloth.length);

        const customization = clonedPlayer ? clonedPlayer.customization : null;
        const data = profile.customization || {};
        if (customization && customization.hairs) {
            const hair = Math.trunc(finiteNumber(data.hair, -1));
            for (let index = 0; index < customization.hairs.childCount; index++)
                customization.hairs.GetChild(index).gameObject.SetActive(index === hair);
        }
        if (customization && customization.body && PlayerCustomization.BlendShapeNames) {
            const keys = Object.keys(data);
            for (let index = 0; index < PlayerCustomization.BlendShapeNames.length; index++) {
                const name = String(PlayerCustomization.BlendShapeNames[index]);
                const key = keys.find(item => item.toLowerCase() === name.toLowerCase());
                if (key && typeof data[key] === "number")
                    customization.body.SetBlendShapeWeight(index, finiteNumber(data[key]) * 100);
            }
        }
    } catch (error) { log("应用远端玩家衣服/外观失败: " + error); }
}

// 原版 PlayerSkin.OnDestroy 会清理它缓存的实例材质。远端克隆剥离脚本前，必须先从
// sharedMaterials 复制一套未挂到渲染器上的材质；脚本销毁后再装回，避免引用已释放材质时
// 显示成 Unity 的红色/洋红色错误材质，同时保证远端晒黑参数不会污染本地玩家。
function captureRemoteMaterials(root: UnityEngine.Transform): RemoteMaterialSnapshot[] {
    const snapshots: RemoteMaterialSnapshot[] = [];
    const visit = (node: UnityEngine.Transform): void => {
        const renderer = node.gameObject.GetComponent("Renderer") as UnityEngine.Renderer;
        if (renderer) {
            const copied = renderer.sharedMaterials as UnityEngine.Material[];
            for (let index = 0; copied && index < copied.length; index++) {
                if (copied[index]) copied[index] = UnityEngine.Object.Instantiate(copied[index]) as UnityEngine.Material;
            }
            snapshots.push({ renderer, materials: copied });
        }
        for (let index = 0; index < node.childCount; index++) {
            const child = node.GetChild(index);
            if (child.gameObject.activeSelf) visit(child);
        }
    };
    visit(root);
    return snapshots;
}

function restoreRemoteMaterials(snapshots: RemoteMaterialSnapshot[], skinTan: boolean): UnityEngine.Material[] {
    const owned: UnityEngine.Material[] = [];
    let tanMaterials = 0;
    let invalidShaders = 0;
    let unsupportedTanProperties = 0;
    for (const snapshot of snapshots) {
        for (let index = 0; snapshot.materials && index < snapshot.materials.length; index++) {
            const material = snapshot.materials[index];
            if (!material) continue;
            owned.push(material);
            const shader = material.shader;
            const shaderName = shader ? String(shader.name || "") : "";
            if (!shader || shaderName.indexOf("InternalErrorShader") >= 0) {
                invalidShaders += 1;
                continue;
            }
            if (!material.HasProperty("_Tan")) continue;
            // Unity ShaderPropertyType: Color=0, Vector=1, Float=2, Range=3, Texture=4, Int=5。
            // 只对原版定义为 Float/Range 的 _Tan 写浮点值；若未来版本改成颜色，绝不能把
            // SetFloat 写成 (1,0,0,0) 而把整个角色染红。
            const propertyIndex = shader.FindPropertyIndex("_Tan");
            const propertyType = propertyIndex >= 0 ? Number(shader.GetPropertyType(propertyIndex)) : -1;
            if (propertyType === 2 || propertyType === 3) {
                material.SetFloat("_Tan", skinTan ? 1 : 0);
                tanMaterials += 1;
            } else unsupportedTanProperties += 1;
        }
        snapshot.renderer.sharedMaterials = snapshot.materials;
    }
    log("远端材质恢复完成: 渲染器=" + snapshots.length + "，材质=" + owned.length +
        "，tan=" + skinTan + "/" + tanMaterials + "，无效Shader=" + invalidShaders +
        "，跳过非浮点Tan=" + unsupportedTanProperties);
    if (BRIDGE_CHANNEL !== "default") {
        log("[双实例证据] 远端材质检查 invalid=" + invalidShaders + " tan=" + tanMaterials +
            " unsupported=" + unsupportedTanProperties);
    }
    return owned;
}

function readCurrentClothIds(): string[] {
    try {
        const manager = GameManager.Singleton;
        const data = manager ? JSON.parse(manager.GetSave() || "{}") : {};
        return Array.isArray(data.Cloth) ? data.Cloth.map((id: any) => String(id)).slice(0, 128) : [];
    } catch (_error) { return []; }
}

// Unity 只会把已经实例化到 ClothRoot 下的服装一起克隆。创建远端模型前临时把本地
// 源角色换成远端服装，完成 Instantiate 后立即恢复；整个过程位于同一主线程回调，
// 不会渲染出中间状态，也不会调用 SaveGame 或改写玩家存档。
function setRuntimeClothes(cloth: PlayerCloth, ids: string[]): void {
    cloth.TakeOffAll();
    for (const rawId of ids) {
        const id = String(rawId);
        try {
            const dress = cloth.DressUp(id);
            if (!dress) log("本机不存在远端衣服资源: " + id);
        } catch (error) { log("准备衣服资源失败 " + id + ": " + error); }
    }
}

// ===== 模块: player/avatar/remote.ts =====
// 远端模型生命周期。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function clearRemotePlayers(): void {
    for (const key of Object.keys(remotePlayers)) destroyRemotePlayer(Number(key));
    for (const key of Object.keys(lastRemoteSequences)) delete lastRemoteSequences[key];
    for (const key of Object.keys(lastRemoteLiveDataSequences)) delete lastRemoteLiveDataSequences[key];
    for (const key of Object.keys(remoteProfiles)) delete remoteProfiles[key];
    for (const key of Object.keys(remoteProfileRevisions)) delete remoteProfileRevisions[key];
    for (const key of Object.keys(latestPlayerStates)) delete latestPlayerStates[key];
    for (const key of Object.keys(pendingProfileChunks)) delete pendingProfileChunks[key];
    for (const key of Object.keys(sleepReady)) delete sleepReady[key];
}

function stripRemoteNode(node: UnityEngine.Transform): void {
    const go = node.gameObject;
    // 先显式移除布料物理、受损和额外形变组件；它们引用本地玩家碰撞体，会触发
    // MagicaCloth 异步重建。衣服骨骼改由 RemotePlayer.clothBonePairs 在网络节拍驱动。
    for (const typeName of ["MagicaCloth", "ClothDamage", "ClothingArmBlendShapeController"]) {
        for (let guard = 0; guard < 32; guard++) {
            const component = go.GetComponent(typeName);
            if (!component) break;
            UnityEngine.Object.DestroyImmediate(component);
        }
    }
    // UcModLauncher 不公开 GetComponentsInChildren(Type)，但支持按类型名查找单个组件。
    // 每删除一个就重新查询，直到本节点不再包含任何 MonoBehaviour。
    for (let guard = 0; guard < 128; guard++) {
        const script = go.GetComponent("MonoBehaviour");
        if (!script) break;
        UnityEngine.Object.DestroyImmediate(script);
    }
    const blockedTypes = ["Collider", "Rigidbody", "Camera", "AudioListener", "AudioSource", "Light"];
    for (const typeName of blockedTypes) {
        for (let guard = 0; guard < 32; guard++) {
            const component = go.GetComponent(typeName);
            if (!component) break;
            UnityEngine.Object.DestroyImmediate(component);
        }
    }
    for (let index = Number(node.childCount) - 1; index >= 0; index--) {
        const child = node.GetChild(index);
        // 角色预制体包含数量很大的未启用服装、道具和动作资源。远端克隆不能递归这些
        // 分支，否则 Unity 主线程会长时间阻塞，连握手都无法回发。当前可见骨骼和渲染树
        // 足以播放同步的 Animator 状态；临时道具应按需单独映射，不能保留整棵资源树。
        if (!child.gameObject.activeSelf) UnityEngine.Object.DestroyImmediate(child.gameObject);
        else stripRemoteNode(child);
    }
}

function stripRemoteClone(clone: UnityEngine.GameObject, animator: UnityEngine.Animator): void {
    // 克隆体还未激活，此时销毁脚本可保证它们的 Awake/Start 永远不会运行；Animator
    // 继承 Behaviour 而非 MonoBehaviour，因此会被保留，用于播放同步后的原版动作。
    stripRemoteNode(clone.transform);
    animator.enabled = true;
}

function createRemotePlayer(packet: PlayerStatePacket): RemotePlayer | null {
    const local = Player.LocalPlayer;
    if (!local || !local.gameObject || !local.animator) return null;
    const source = local.gameObject;
    const wasActive = source.activeSelf;
    const originalClothes = readCurrentClothIds();
    const remoteProfile = remoteProfiles[String(packet.ownerId)];
    let sourceAppearanceChanged = false;
    let clone: UnityEngine.GameObject | null = null;
    try {
        const remoteClothes = remoteProfile ? remoteProfile.cloth.map(id => String(id)) : [];
        const sameRuntimeClothes = JSON.stringify(originalClothes) === JSON.stringify(remoteClothes);
        if (local.cloth && remoteProfile && !sameRuntimeClothes) {
            setRuntimeClothes(local.cloth, remoteProfile.cloth);
            sourceAppearanceChanged = true;
        }
        // inactive 对象被 Instantiate 时不会执行克隆脚本的 Awake；先剥离逻辑组件再激活。
        if (wasActive) source.SetActive(false);
        clone = UnityEngine.Object.Instantiate(source) as UnityEngine.GameObject;
        clone.name = "MPB_RemotePlayer_" + packet.ownerId;
        const animator = clone.GetComponent("Animator") as UnityEngine.Animator;
        if (!animator) throw new Error("远端玩家克隆体缺少 Animator");
        log("正在准备远端玩家可视模型: " + String(packet.playerName || packet.ownerId));
        // 剥离脚本和未启用节点之前，按该玩家的资料启用衣服、发型和脸型。
        applyRemoteAppearance(clone, remoteProfile);
        const materialSnapshots = captureRemoteMaterials(clone.transform);
        const remoteArmature = (clone.GetComponent("Player") as Player).bodyModel.armature;
        const clothBonePairs = collectRemoteClothBonePairs(clone, remoteArmature);
        stripRemoteClone(clone, animator);
        const ownedMaterials = restoreRemoteMaterials(materialSnapshots,
            !!(remoteProfile && remoteProfile.customization && remoteProfile.customization.skinTan === true));
        animator.applyRootMotion = false;
        clone.transform.position = new UnityEngine.Vector3(packet.position.x, packet.position.y, packet.position.z);
        clone.transform.rotation = new UnityEngine.Quaternion(packet.rotation.x, packet.rotation.y, packet.rotation.z, packet.rotation.w);
        // 玩家模型跨场景保留，避免每次切图都重新禁用本机角色并触发 MagicaCloth 异步重建。
        UnityEngine.Object.DontDestroyOnLoad(clone);
        clone.SetActive(true);
        const remote: RemotePlayer = {
            id: packet.ownerId,
            name: String(packet.playerName || "Player"),
            root: clone,
            animator,
            targetPosition: clone.transform.position,
            targetRotation: clone.transform.rotation,
            lastSeen: Number(UnityEngine.Time.unscaledTime),
            animationHashes: [],
            diagnosticPosition: clone.transform.position,
            diagnosticActionKey: "",
            clothBonePairs,
            ownedMaterials
        };
        remotePlayers[String(packet.ownerId)] = remote;
        log("已创建远端玩家模型: " + remote.name + " (peer=" + packet.ownerId + ")");
        return remote;
    } catch (error) {
        if (clone) UnityEngine.Object.Destroy(clone);
        log("创建远端玩家模型失败: " + error);
        return null;
    } finally {
        if (wasActive && !source.activeSelf) source.SetActive(true);
        if (sourceAppearanceChanged && local.cloth) {
            try { setRuntimeClothes(local.cloth, originalClothes); }
            catch (error) { log("恢复本地玩家衣服失败: " + error); }
        }
        // 防御性恢复：即使未来游戏版本改变 Awake 时机，也不能让克隆体替换本地玩家单例。
        Player.LocalPlayer = local;
    }
}

function applyRemotePlayerState(packet: PlayerStatePacket): void {
    if (!validPlayerState(packet) || packet.ownerId === localNetworkId) return;
    const key = String(packet.ownerId);
    const sequence = Math.trunc(Number(packet.sequence));
    if (lastRemoteSequences[key] !== undefined && sequence <= lastRemoteSequences[key]) return;
    lastRemoteSequences[key] = sequence;
    latestPlayerStates[key] = packet;
    if (!GameManager.InGame || packet.scene !== String(GameManager.NowSceneName || "")) {
        // 房主是世界场景权威。客户端收到房主（ownerId=0）的不同场景后自动跟随，
        // 避免两边连接正常却永远互相不可见。普通客户端不能反向强制房主换场景。
        if (role === "client" && packet.ownerId === 0 && GameManager.InGame && packet.scene &&
            pendingHostScene !== packet.scene) {
            pendingHostScene = packet.scene;
            log("正在跟随房主切换场景: " + packet.scene);
            try {
                GameManager.MoveToScene(packet.scene, () => {
                    pendingHostScene = "";
                    try {
                        if (Player.LocalPlayer) {
                            Player.LocalPlayer.transform.position = new UnityEngine.Vector3(
                                packet.position.x + 1.0, packet.position.y, packet.position.z);
                        }
                    } catch (_error) { }
                    log("已进入房主场景: " + packet.scene);
                });
            } catch (error) {
                pendingHostScene = "";
                log("跟随房主场景失败: " + error);
            }
        }
        return;
    }
    // 等完整资料到达后再建立一次模型，避免先用默认外观创建、随后立即销毁重建。
    if (!remoteProfiles[key]) return;
    let remote = remotePlayers[String(packet.ownerId)] || createRemotePlayer(packet);
    if (!remote) return;
    remote.name = String(packet.playerName || remote.name);
    remote.lastSeen = Number(UnityEngine.Time.unscaledTime);
    remote.targetPosition = new UnityEngine.Vector3(packet.position.x, packet.position.y, packet.position.z);
    remote.targetRotation = new UnityEngine.Quaternion(packet.rotation.x, packet.rotation.y, packet.rotation.z, packet.rotation.w);
    try {
        remote.animator.SetFloat("Speed", Math.sqrt(packet.move.x * packet.move.x + packet.move.z * packet.move.z));
        remote.animator.SetBool("Grounded", packet.grounded);
        remote.animator.SetBool("OnGround", packet.grounded);
        remote.animator.SetInteger("Action", Math.trunc(packet.action));
        remote.animator.SetInteger("HandAction", Math.trunc(packet.handAction));
        remote.animator.SetInteger("StateID", Math.trunc(packet.stateId));
        remote.animator.SetInteger("Attack", Math.trunc(packet.attack));
        remote.animator.SetInteger("Weapon", Math.trunc(packet.weapon));
        for (let layerIndex = 0; layerIndex < packet.animations.length; layerIndex++) {
            const layer = packet.animations[layerIndex];
            const targetTime = Math.max(0, layer.time % 1);
            const current = remote.animator.GetCurrentAnimatorStateInfo(layerIndex);
            const currentTime = Math.max(0, Number(current.normalizedTime) % 1);
            const drift = Math.min(Math.abs(currentTime - targetTime), 1 - Math.abs(currentTime - targetTime));
            if (layer.hash && (remote.animationHashes[layerIndex] !== layer.hash || drift > 0.2))
                remote.animator.Play(Math.trunc(layer.hash), layerIndex, targetTime);
            remote.animator.SetLayerWeight(layerIndex, finiteNumber(layer.weight, 1));
            remote.animationHashes[layerIndex] = layer.hash;
        }
        if (BRIDGE_CHANNEL !== "default") {
            const actionKey = packet.animations.map(layer => layer.hash).join(",") + ":" + packet.action + ":" + packet.handAction + ":" + packet.attack;
            const moved = UnityEngine.Vector3.Distance(remote.diagnosticPosition, remote.targetPosition) >= 0.1;
            if (moved || actionKey !== remote.diagnosticActionKey) {
                log("[双实例证据] 远端状态 peer=" + packet.ownerId + " seq=" + packet.sequence +
                    " pos=" + packet.position.x.toFixed(2) + "," + packet.position.y.toFixed(2) + "," + packet.position.z.toFixed(2) +
                    " anim=" + packet.animationHash + " action=" + packet.action + "/" + packet.handAction + "/" + packet.attack);
                remote.diagnosticPosition = remote.targetPosition;
                remote.diagnosticActionKey = actionKey;
            }
        }
    } catch (_error) {
        // 场景系统可能已销毁克隆体而 JS 字典尚未收到通知。丢弃失效包装器，下一包重建。
        delete remotePlayers[key];
    }
}

// ===== 模块: player/profile/store.ts =====
// 远端玩家资料存储。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function applyRemotePlayerProfile(packet: PlayerProfilePacket): void {
    if (!validPlayerProfile(packet) || packet.ownerId === localNetworkId) return;
    const key = String(packet.ownerId);
    const revision = Math.trunc(Number(packet.revision));
    if (remoteProfileRevisions[key] !== undefined && revision <= remoteProfileRevisions[key]) return;
    const previous = remoteProfiles[key];
    const appearanceChanged = !previous || JSON.stringify(previous.cloth) !== JSON.stringify(packet.profile.cloth) ||
        JSON.stringify(previous.customization) !== JSON.stringify(packet.profile.customization);
    remoteProfileRevisions[key] = revision;
    remoteProfiles[key] = packet.profile;
    // 任务、成就、联系人或数值变化不应重建人物，否则每次资料更新都会闪烁。
    // 只有衣服/捏脸发生变化时才重建裁剪后的可视模型。
    if (appearanceChanged) {
        if (remotePlayers[key]) destroyRemotePlayer(packet.ownerId);
        const state = latestPlayerStates[key];
        if (state) createRemotePlayer(state);
    }
    log("已接收玩家完整存档资料快照" + (appearanceChanged ? "并刷新外观" : "") + ": " +
        String(packet.playerName || packet.ownerId));
    refreshPlayerInfoUi();
}

// ===== 模块: player/profile/read.ts =====
// 本地玩家资料读取。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function playerProfileSignature(profile: PlayerProfile): string {
    // GetSave 含位置、时间、NPC 坐标、耐力等持续变化值。对完整对象签名会每两秒发送一次
    // 巨型快照，淹没位置/场景包。签名只覆盖玩家长期资料；真正发送时仍携带完整 GetSave。
    const progress = profile.progress || {};
    const stable: any = {};
    const stableKeys = ["SexData", "ParcelData", "PlayerHelper", "Quests", "ConditionSave",
        "XPostData", "XContactData", "Photo", "LastTakePhoto", "UnlockedCloth", "FirstExperience"];
    for (const key of stableKeys) {
        if (progress[key] !== undefined) stable[key] = progress[key];
    }
    for (const key of Object.keys(progress)) {
        if (key.startsWith("PlayFlag")) stable[key] = progress[key];
    }
    if (progress.PlayerStatusData && typeof progress.PlayerStatusData === "object") {
        const status = JSON.parse(JSON.stringify(progress.PlayerStatusData));
        for (const key of ["day", "timeOfDay", "health", "stamina", "magic", "aroused", "clothDurability", "gameTimes"])
            delete status[key];
        stable.PlayerStatusData = status;
    }
    return JSON.stringify({ cloth: profile.cloth, customization: profile.customization, stable });
}

function captureLocalPlayerProfile(): PlayerProfile | null {
    try {
        const manager = GameManager.Singleton;
        if (!manager || !GameManager.InGame) return null;
        const diagnosticAppearance = BRIDGE_CHANNEL !== "default" && loadConfig().smokeTestAppearance;
        if (diagnosticAppearance && Player.LocalPlayer && Player.LocalPlayer.cloth &&
            !Player.LocalPlayer.cloth.Dressed("Sailor")) {
            // 只改变双实例测试进程的内存，不调用 SaveGame。这样源角色真实生成 Dress、骨骼和材质，
            // Instantiate 时 Unity 才能把该服装映射进远端克隆体。
            const diagnosticDress = Player.LocalPlayer.cloth.DressUp("Sailor");
            diagnosticAppearanceReadyAt = Number(UnityEngine.Time.unscaledTime) + 3;
            log("诊断模式：已在内存中装备 Sailor 外观样本");
            // 服装由 PlayerCloth 动态实例化，通常不在 Player.gameObject 子树内。记录真实层级与
            // copyFrom 骨骼源，供双实例测试确认远端克隆应该复制哪一个对象并绑定哪套骨骼。
            try {
                const describeChain = (start: UnityEngine.Transform | null): string => {
                    const names: string[] = [];
                    let node = start;
                    for (let guard = 0; node && guard < 16; guard++) {
                        names.unshift(String(node.name));
                        node = node.parent;
                    }
                    return names.join("/");
                };
                log("[双实例证据] 本地衣服对象 path=" +
                    describeChain(diagnosticDress ? diagnosticDress.gameObject.transform : null) +
                    " copyFrom=" + describeChain(diagnosticDress ? diagnosticDress.copyFrom : null) +
                    " player=" + describeChain(Player.LocalPlayer.gameObject.transform));
            } catch (error) { log("诊断衣服层级失败: " + error); }
        }
        if (diagnosticAppearance && diagnosticAppearanceReadyAt > Number(UnityEngine.Time.unscaledTime))
            return null;
        const data = JSON.parse(manager.GetSave() || "{}");
        // 仅双实例诊断通道注入一个确定的非空外观，不写回游戏存档。这样自动测试能证明
        // 衣服字典查找、启用与晒黑材质映射确实运行，而不只是验证 JSON 字段存在。
        if (diagnosticAppearance) {
            data.Cloth = ["Sailor"];
            if (!data.CustomizationData || typeof data.CustomizationData !== "object") data.CustomizationData = {};
            data.CustomizationData.skinTan = true;
            data.CustomizationData.EyeSize = 0.15;
        }
        return {
            cloth: Array.isArray(data.Cloth) ? data.Cloth.map((id: any) => String(id)).slice(0, 128) : [],
            customization: data.CustomizationData && typeof data.CustomizationData === "object" ? data.CustomizationData : {},
            // 保留 GetSave 返回的完整角色资料：手机联系人/X 动态、照片索引、包裹、NPC、
            // 任务、状态、成就旗标、时间、场景和位置均在内。照片图片文件本身不属于存档 JSON。
            progress: data
        };
    } catch (error) {
        log("采集玩家衣服和个人进度失败: " + error);
        return null;
    }
}

// ===== 模块: player/profile/transfer.ts =====
// 玩家资料传递。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function sendLocalPlayerProfile(): void {
    if (!bridgeAvailable || role === "off" || localNetworkId < 0) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (now < nextPlayerProfileAt) return;
    nextPlayerProfileAt = now + PLAYER_PROFILE_INTERVAL;
    const profile = captureLocalPlayerProfile();
    if (!profile) return;
    const signature = playerProfileSignature(profile);
    if (signature === lastLocalProfileJson) return;
    lastLocalProfileJson = signature;
    sendPlayerProfilePacket(0, {
        type: "playerProfile", ownerId: localNetworkId, playerName: currentPlayerName,
        revision: ++localProfileRevision, profile
    } as PlayerProfilePacket);
}

function sendLocalPlayerLiveData(): void {
    if (!bridgeAvailable || role === "off" || localNetworkId < 0 || !GameManager.InGame) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (now < nextPlayerLiveDataAt) return;
    nextPlayerLiveDataAt = now + PLAYER_LIVE_DATA_INTERVAL;
    const profile = captureLocalPlayerProfile();
    if (!profile) return;
    const progress = profile.progress || {};
    send(0, {
        type: "playerLiveData",
        ownerId: localNetworkId,
        playerName: currentPlayerName,
        sequence: ++localLiveDataSequence,
        status: progress.PlayerStatusData && typeof progress.PlayerStatusData === "object"
            ? progress.PlayerStatusData : {},
        gameTime: finiteNumber(progress.GameTime),
        timeOffset: finiteNumber(progress.TimeOffset),
        scene: String(progress.Scene || GameManager.NowSceneName || "")
    } as PlayerLiveDataPacket);
}

function applyRemotePlayerLiveData(packet: PlayerLiveDataPacket): void {
    if (!validPlayerLiveData(packet) || packet.ownerId === localNetworkId) return;
    const key = String(packet.ownerId);
    const sequence = Math.trunc(Number(packet.sequence));
    if (lastRemoteLiveDataSequences[key] !== undefined && sequence <= lastRemoteLiveDataSequences[key]) return;
    lastRemoteLiveDataSequences[key] = sequence;
    const profile = remoteProfiles[key];
    if (!profile) return;
    profile.progress.PlayerStatusData = packet.status;
    profile.progress.GameTime = Number(packet.gameTime);
    profile.progress.TimeOffset = Number(packet.timeOffset);
    profile.progress.Scene = String(packet.scene);
    if (BRIDGE_CHANNEL !== "default" && sequence % 4 === 0)
        log("[双实例证据] 已应用玩家实时资料 peer=" + packet.ownerId + " seq=" + sequence +
            " health=" + finiteNumber(packet.status.health) + " stamina=" + finiteNumber(packet.status.stamina) +
            " money=" + finiteNumber(packet.status.money));
    refreshPlayerInfoUi();
}

// ===== 模块: player/state/snapshot.ts =====
// 玩家状态采集。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function captureLocalPlayerState(player: Player): PlayerStatePacket | null {
    if (!player || !player.animator || !GameManager.InGame || localNetworkId < 0) return null;
    try {
        const position = player.transform.position;
        const rotation = player.transform.rotation;
        const move = player.movment ? player.movment.MoveLrep : new UnityEngine.Vector3(0, 0, 0);
        const animations: NetworkAnimationLayer[] = [];
        const layerCount = Math.min(8, Math.max(1, Math.trunc(Number(player.animator.layerCount))));
        for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
            const layer = player.animator.GetCurrentAnimatorStateInfo(layerIndex);
            animations.push({
                hash: finiteNumber(layer.fullPathHash),
                time: finiteNumber(layer.normalizedTime),
                weight: finiteNumber(player.animator.GetLayerWeight(layerIndex), layerIndex === 0 ? 1 : 0)
            });
        }
        let weapon = 0;
        try { weapon = player.status && player.status.Data ? Number(player.status.Data.selectedWeapon) : 0; } catch (_error) { }
        const diagnosticAction = Number(UnityEngine.Time.unscaledTime) < smokeActionOverrideUntil;
        return {
            type: "playerState",
            ownerId: localNetworkId,
            sequence: ++localStateSequence,
            playerName: currentPlayerName,
            scene: String(GameManager.NowSceneName || ""),
            position: { x: position.x, y: position.y, z: position.z },
            rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
            move: { x: move.x, y: move.y, z: move.z },
            grounded: player.movment ? Boolean(player.movment.onGround) : true,
            action: diagnosticAction ? 7 : (player.action ? finiteNumber(player.action.Action) : 0),
            handAction: diagnosticAction ? 3 : (player.action ? finiteNumber(player.action.handAction) : 0),
            stateId: diagnosticAction ? 2 : (player.action ? finiteNumber(player.action.stateID) : 0),
            attack: diagnosticAction ? 1 : (player.action ? finiteNumber(player.action.attack) : 0),
            weapon,
            animationHash: animations.length > 0 ? animations[0].hash : 0,
            animationTime: animations.length > 0 ? animations[0].time : 0,
            animations
        };
    } catch (error) {
        log("采集本地玩家状态失败: " + error);
        return null;
    }
}

// 只供同机双实例自动化使用。非 default 测试通道在双方握手后把房主移动两米，
// 并短暂发送非零动作字段；随后可切到 StreetScene 验证客户端自动跟随。
// 普通玩家配置的两个开关均为 false，不会改变实际游戏行为。

// ===== 模块: diagnostics/smoke.ts =====
// 双实例诊断。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function runSmokeTestDiagnostics(player: Player): void {
    if (BRIDGE_CHANNEL === "default" || role === "off") return;
    const config = loadConfig();
    const now = Number(UnityEngine.Time.unscaledTime);
    if (config.smokeTestOnlineLifecycle && onlineSaveSessionReady && !smokeOnlineLifecycleFinished) {
        smokeOnlineLifecycleFinished = true;
        try {
            if (config.smokeTestLifecyclePhase === "create") {
                const current = player.transform.position;
                player.transform.position = new UnityEngine.Vector3(current.x + 3.25, current.y, current.z);
            }
            const savedPosition = player.transform.position;
            beginOnlineExitSave(player, () => log("[线上存档生命周期] phase=" + config.smokeTestLifecyclePhase +
                " save=" + selectedSaveName + " position=" + savedPosition.x.toFixed(4) + "," +
                savedPosition.y.toFixed(4) + "," + savedPosition.z.toFixed(4)));
        } catch (error) { log("诊断模式：线上存档生命周期失败: " + error); }
        return;
    }
    if (config.smokeTestPhone && localNetworkId >= 0 && !smokePhoneChecked && GameManager.Singleton) {
        smokePhoneChecked = true;
        try {
            // 复现玩家先打开 ESC 菜单的情况，再走线上模式的解除暂停逻辑。
            // 随后用游戏原生 WindowManager 打开手机（XWindow），证明窗口输入链未被 Paused 卡死。
            GameManager.PauseGame(true);
            if (WindowManager.IsOpened("PauseWindow")) WindowManager.CloseWindow("PauseWindow");
            GameManager.PauseGame(false);
            keepOnlineWorldRunning();
            if (GameManager.Paused || Number(UnityEngine.Time.timeScale) <= 0)
                throw new Error("解除暂停后游戏仍处于暂停状态");
            const phone = WindowManager.OpenWindow("XWindow");
            if (!phone || !WindowManager.IsOpened("XWindow")) throw new Error("XWindow 未能打开");
            log("诊断模式：线上暂停后手机窗口已正常打开，游戏时间未暂停");
            WindowManager.CloseWindow("XWindow");
        } catch (error) { log("诊断模式：线上手机窗口验证失败: " + error); }
    }
    if (config.smokeTestPauseMenu && localNetworkId >= 0 && !smokePauseMenuOpened && GameManager.Singleton) {
        smokePauseMenuOpened = true;
        try {
            // 无人值守测试不能可靠抢占 Windows 前台焦点，因此直接调用游戏原生窗口管理器。
            // 这会实例化和显示与玩家按 ESC 完全相同的 PauseWindow，并执行其原生 Start。
            const pause = WindowManager.OpenWindow("PauseWindow");
            if (!pause || !WindowManager.IsOpened("PauseWindow")) throw new Error("PauseWindow 未能打开");
            GameManager.PauseGame(true);
            smokePauseMenuOpenedAt = now;
            smokePauseMenuGameTime = Number(GameManager.Singleton.gameTime);
            log("诊断模式：已通过原生 WindowManager 打开 PauseWindow");
        } catch (error) { log("诊断模式：打开原版暂停菜单失败: " + error); }
    }
    if (config.smokeTestPauseMenu && smokePauseMenuOpened && !smokePauseBackgroundVerified &&
        smokePauseMenuOpenedAt >= 0 && now - smokePauseMenuOpenedAt >= 1 && GameManager.Singleton) {
        try {
            if (!WindowManager.IsOpened("PauseWindow")) throw new Error("验证期间 PauseWindow 已关闭");
            const elapsedGameTime = Number(GameManager.Singleton.gameTime) - smokePauseMenuGameTime;
            if (GameManager.Paused || Number(UnityEngine.Time.timeScale) !== 1 || elapsedGameTime < 0.5)
                throw new Error("暂停背景未持续运行 paused=" + GameManager.Paused +
                    " timeScale=" + UnityEngine.Time.timeScale + " delta=" + elapsedGameTime);
            smokePauseBackgroundVerified = true;
            log("[双实例证据] PauseWindow 保持显示且背景持续运行 paused=false timeScale=1 delta=" +
                elapsedGameTime.toFixed(2));
        } catch (error) { log("诊断模式：暂停背景持续运行验证失败: " + error); }
    }
    if (config.smokeTestSleepConsensus && localNetworkId >= 0 && smokeSleepStartedAt < 0) {
        // 房主必须等至少一个客户端完成 hello 登记；否则“当前只有房主一人”会合法地立即批准。
        if (role === "client" || Object.keys(peerNames).length > 0) smokeSleepStartedAt = now;
    }
    // 房主先进入等待；客户端延后两秒发送同一睡眠选择。批准日志证明单人请求没有立即跳夜，
    // 且第二名玩家准备后由房主发出了唯一批准包。普通玩家配置不会启用此诊断分支。
    if (config.smokeTestSleepConsensus && !smokeSleepRequested && smokeSleepStartedAt >= 0) {
        const delay = role === "host" ? 2 : 4;
        if (now - smokeSleepStartedAt >= delay) {
            smokeSleepRequested = true;
            if (role === "host") {
                sleepReady["0"] = { mode: "tomorrow", at: now };
                log("诊断模式：房主已请求睡到明天，等待其他玩家");
                tryApproveSleep();
            } else {
                log("诊断模式：客户端已请求睡到明天");
                send(0, { type: "sleepRequest", mode: "tomorrow" } as SleepRequestPacket);
            }
        }
    }
    if (role !== "host" || Object.keys(peerNames).length === 0) return;
    if (config.smokeTestMotion && smokeMotionStartedAt < 0) smokeMotionStartedAt = now;
    if (config.smokeTestMotion && smokeMotionCompletedAt < 0 && now - smokeMotionStartedAt >= 2) {
        const current = player.transform.position;
        const target = new UnityEngine.Vector3(current.x + 2, current.y, current.z);
        try {
            if (player.movment && player.movment._characterController) {
                player.movment._characterController.enabled = false;
                player.transform.position = target;
                player.movment._characterController.enabled = true;
            } else player.transform.position = target;
        } catch (_error) { player.transform.position = target; }
        // 首次加载完整资料和构建衣服可能持续数秒；测试动作保持足够长，确保另一实例
        // 的远端模型创建后仍能收到非零动作，而不是只验证一个转瞬即逝的包。
        smokeActionOverrideUntil = now + 15;
        smokeMotionCompletedAt = now;
        log("诊断模式：房主已移动两米并发送动作状态 target=" +
            target.x.toFixed(2) + "," + target.y.toFixed(2) + "," + target.z.toFixed(2));
    }
    if (config.smokeTestSceneSync && smokeMotionCompletedAt >= 0 && !smokeSceneRequested &&
        now - smokeMotionCompletedAt >= 3 && String(GameManager.NowSceneName || "") === "RoomScene") {
        smokeSceneRequested = true;
        log("诊断模式：房主切换到 StreetScene");
        try { GameManager.MoveToScene("StreetScene", () => log("诊断模式：房主已进入 StreetScene")); }
        catch (error) { log("诊断模式场景切换失败: " + error); }
    }
}

function scheduleSmokeOnlineLifecycle(menu: MainMenu, remaining = 900): void {
    if (!isCurrentGeneration() || smokeOnlineLifecycleStarted) return;
    if (bridgeAvailable && role === "host") {
        smokeOnlineLifecycleStarted = true;
        log("诊断模式：开始真实线上存档生命周期");
        enterOnlineSave();
        return;
    }
    if (remaining <= 0) {
        log("诊断模式：等待线上存档桥接超时");
        return;
    }
    JintCoroutine.WaitForNextFrame(menu, () => scheduleSmokeOnlineLifecycle(menu, remaining - 1));
}

// ===== 模块: player/state/sync.ts =====
// 玩家状态发送与渲染。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function sendLocalPlayerState(player: Player): void {
    if (!bridgeAvailable || role === "off" || localNetworkId < 0) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (now < nextPlayerStateAt) return;
    nextPlayerStateAt = advanceFixedDeadline(nextPlayerStateAt, now, PLAYER_STATE_INTERVAL);
    const packet = captureLocalPlayerState(player);
    if (packet) send(0, packet);
}

function updateRemotePlayers(): void {
    const now = Number(UnityEngine.Time.unscaledTime);
    const delta = Math.max(0, Math.min(0.1, Number(UnityEngine.Time.unscaledDeltaTime)));
    // 网络以 20 Hz 发送目标快照；渲染帧用指数平滑追赶目标，帧率变化不会改变手感。
    const blend = 1 - Math.exp(-12 * delta);
    for (const key of Object.keys(remotePlayers)) {
        const remote = remotePlayers[key];
        if (now - remote.lastSeen > REMOTE_PLAYER_TIMEOUT) {
            destroyRemotePlayer(Number(key));
            continue;
        }
        try {
            const transform = remote.root.transform;
            const distance = UnityEngine.Vector3.Distance(transform.position, remote.targetPosition);
            transform.position = distance > 8
                ? remote.targetPosition
                : UnityEngine.Vector3.Lerp(transform.position, remote.targetPosition, blend);
            transform.rotation = UnityEngine.Quaternion.Slerp(transform.rotation, remote.targetRotation, blend);
            // Dress 逻辑已从代理剥离；每帧复制身体同名骨，衣服不会按网络节拍阶梯抖动。
            for (const pair of remote.clothBonePairs) {
                pair.driven.position = pair.source.position;
                pair.driven.rotation = pair.source.rotation;
                pair.driven.localScale = pair.source.localScale;
            }
        } catch (_error) {
            // 场景销毁窗口中 Unity 包装器可能短暂失效；超时清理负责最终回收。
        }
    }
}

// ===== 模块: network/events/router.ts =====
// 网络事件路由。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function processEvent(rawEvent: string): void {
    const event = JSON.parse(rawEvent);
    if (!event || !event.type) return;
    if (event.type === "listening") {
        updateStatusText();
        return;
    }
    if (event.type === "connected") {
        log("连接建立，peer=" + event.peerId);
        // 客户端建立 TCP 连接后先发送协议版本和玩家名，由房主确认兼容性。
        if (role === "client") {
            localNetworkId = -1;
            send(0, { type: "hello", protocol: PROTOCOL_VERSION, playerName: currentPlayerName });
        }
        updateStatusText();
        return;
    }
    if (event.type === "message") {
        const packet = JSON.parse(event.message);
        if (role === "host" && packet.type === "hello") {
            if (packet.protocol !== PROTOCOL_VERSION) { log("客户端协议不兼容，peer=" + event.peerId); return; }
            const isNewPeer = peerNames[String(event.peerId)] === undefined;
            peerNames[String(event.peerId)] = String(packet.playerName || "Player");
            send(event.peerId, { type: "welcome", protocol: PROTOCOL_VERSION, peerId: event.peerId });
            // 新玩家需要立即收到房主和已在线玩家的完整外观/个人进度，而不是等待资料变化。
            if (isNewPeer) {
                lastLocalProfileJson = "";
                for (const ownerKey of Object.keys(remoteProfiles)) {
                    sendPlayerProfilePacket(event.peerId, {
                        type: "playerProfile", ownerId: Number(ownerKey),
                        playerName: peerNames[ownerKey] || "Player",
                        revision: remoteProfileRevisions[ownerKey] || 1, profile: remoteProfiles[ownerKey]
                    });
                }
                toast(tr("toast.playerJoined", { player: packet.playerName }));
            }
        } else if (role === "client" && packet.type === "welcome") {
            if (packet.protocol !== PROTOCOL_VERSION) return;
            const firstWelcome = localNetworkId < 0;
            localNetworkId = Math.trunc(Number(packet.peerId));
            if (firstWelcome) {
                lastLocalProfileJson = "";
                toast(tr("toast.joinedRoom", { peer: packet.peerId }));
            }
            // 加入房间不是只建立 TCP：握手成功后必须进入本机专属线上存档，才能创建
            // Player、开始状态同步并在场景里真正看到其他玩家。诊断自动加载模式自行进场。
            if (!clientEntryStarted && mainMenuInstance && !loadConfig().smokeTestAutoLoad) {
                clientEntryStarted = true;
                enterOnlineSave();
            }
        } else if (packet.type === "playerState" && validPlayerState(packet)) {
            if (role === "host") {
                packet.ownerId = Math.trunc(Number(event.peerId));
                packet.playerName = peerNames[String(event.peerId)] || String(packet.playerName || "Player");
                applyRemotePlayerState(packet);
                // 房主是星型拓扑中心：转发后客户端之间也能互相看到。
                send(0, packet);
            } else applyRemotePlayerState(packet);
        } else if (packet.type === "playerLiveData" && validPlayerLiveData(packet)) {
            if (role === "host") {
                packet.ownerId = Math.trunc(Number(event.peerId));
                packet.playerName = peerNames[String(event.peerId)] || String(packet.playerName || "Player");
                applyRemotePlayerLiveData(packet);
                send(0, packet);
            } else applyRemotePlayerLiveData(packet);
        } else if (packet.type === "worldTime" && validWorldTime(packet)) {
            // 星型拓扑中只有客户端接受服务器发来的权威时间；房主忽略客户端伪造的时间包。
            if (role === "client") applyAuthoritativeWorldTime(packet);
        } else if (packet.type === "sleepRequest" && role === "host" && validSleepMode(packet.mode)) {
            sleepReady[String(event.peerId)] = {
                mode: packet.mode,
                at: Number(UnityEngine.Time.unscaledTime)
            };
            tryApproveSleep();
        } else if (packet.type === "sleepApproved" && role === "client" && validSleepMode(packet.mode) &&
            Number.isInteger(Number(packet.sequence))) {
            const sequence = Number(packet.sequence);
            // 睡眠会立即切换游戏状态，期间 Player.Update 可能暂停。必须先把 ACK 强制刷入桥接，
            // 不能留在普通发送队列里等待下一帧，否则房主会一直重发直到确认超时。
            send(0, { type: "sleepAck", sequence } as SleepAckPacket);
            nextOutgoingMessageAt = 0;
            flushOutgoingMessage();
            if (sequence > lastSleepApprovalSequence) {
                lastSleepApprovalSequence = sequence;
                log("已收到全员睡眠批准: " + packet.mode + "，序号=" + sequence);
                invokeApprovedSleep(packet.mode);
            }
            // 重复批准同样会在上方立即 ACK，但绝不重复执行睡眠。
        } else if (packet.type === "sleepAck" && role === "host" && pendingSleepApproval &&
            Number(packet.sequence) === pendingSleepApproval.packet.sequence) {
            pendingSleepApproval.acknowledged[String(event.peerId)] = true;
        } else if (packet.type === "playerProfileChunk" && validPlayerProfileChunk(packet)) {
            const completed = receivePlayerProfileChunk(packet, Number(event.peerId) || 0);
            if (completed) processPlayerProfilePacket(completed, Number(event.peerId) || 0);
        } else if (packet.type === "playerProfile" && validPlayerProfile(packet)) {
            processPlayerProfilePacket(packet, Number(event.peerId) || 0);
        } else if (packet.type === "playerLeft") {
            destroyRemotePlayer(Math.trunc(Number(packet.ownerId)));
            delete remoteProfiles[String(packet.ownerId)];
            delete remoteProfileRevisions[String(packet.ownerId)];
            delete latestPlayerStates[String(packet.ownerId)];
            delete lastRemoteSequences[String(packet.ownerId)];
            delete lastRemoteLiveDataSequences[String(packet.ownerId)];
        }
        return;
    }
    if (event.type === "error") { log("网络错误: " + event.message); updateStatusText(tr("status.networkError", { error: event.message })); }
    else if (event.type === "disconnected") {
        log("连接断开，peer=" + event.peerId);
        if (role === "host") {
            destroyRemotePlayer(Number(event.peerId));
            delete peerNames[String(event.peerId)];
            delete remoteProfiles[String(event.peerId)];
            delete remoteProfileRevisions[String(event.peerId)];
            delete latestPlayerStates[String(event.peerId)];
            delete lastRemoteSequences[String(event.peerId)];
            delete lastRemoteLiveDataSequences[String(event.peerId)];
            delete sleepReady[String(event.peerId)];
            send(0, { type: "playerLeft", ownerId: Number(event.peerId) });
        } else {
            localNetworkId = -1;
            clearRemotePlayers();
        }
        updateStatusText();
    }
}

function processPlayerProfilePacket(packet: PlayerProfilePacket, sourcePeerId: number): void {
    if (role === "host") {
        packet.ownerId = Math.trunc(sourcePeerId);
        packet.playerName = peerNames[String(sourcePeerId)] || String(packet.playerName || "Player");
        adoptLatestRoomDay(packet.profile);
        applyRemotePlayerProfile(packet);
        sendPlayerProfilePacket(0, packet);
    } else applyRemotePlayerProfile(packet);
}

// ===== 模块: ui/pages/panel-state.ts =====
// 页面开关状态。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function closePanel(): void {
    if (uiConfigBody) uiConfigBody.SetActive(true);
    if (uiTitle) uiTitle.text = tr("panel.title");
    if (uiPanel) uiPanel.SetActive(false);
}

function openPanel(): void {
    if (!uiPanel) return;
    syncGameLanguage();
    if (uiConfigBody) uiConfigBody.SetActive(true);
    if (uiTitle) uiTitle.text = tr("panel.title");
    // 面板可能在桥接启动后才首次打开；不能继续显示 buildUi 时缓存的“未联机”。
    updateStatusText();
    refreshPlayerInfoUi();
    uiPanel.SetActive(true);
}

// ===== 模块: ui/components/layout.ts =====
// 布局基础组件。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function rect(go: UnityEngine.GameObject, anchorX: number, anchorY: number, x: number, y: number, width: number, height: number): UnityEngine.RectTransform {
    const rt = go.GetComponent("RectTransform") || go.AddComponent("RectTransform");
    rt.anchorMin = new UnityEngine.Vector2(anchorX, anchorY);
    rt.anchorMax = new UnityEngine.Vector2(anchorX, anchorY);
    rt.pivot = new UnityEngine.Vector2(anchorX, anchorY);
    rt.anchoredPosition = new UnityEngine.Vector2(x, y);
    rt.sizeDelta = new UnityEngine.Vector2(width, height);
    return rt;
}

function uiObject(name: string, parent: UnityEngine.Transform): UnityEngine.GameObject {
    const go = new UnityEngine.GameObject(name);
    try { go.AddComponent("RectTransform"); } catch (_error) { }
    go.transform.SetParent(parent, false);
    return go;
}

function makeSolidRect(parent: UnityEngine.Transform, name: string, color: UnityEngine.Color, x: number, y: number, width: number, height: number): UnityEngine.GameObject {
    const go = uiObject(name, parent);
    rect(go, 0, 1, x, -y, width, height);
    const image = go.AddComponent("Image");
    image.color = color;
    return go;
}

// ===== 模块: ui/components/text.ts =====
// 文本组件。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function makeText(parent: UnityEngine.Transform, name: string, value: string, font: any, x: number, y: number, width: number, height: number, size = 20): UnityEngine.UI.Text {
    const go = uiObject(name, parent);
    rect(go, 0, 1, x, -y, width, height);
    const text = go.AddComponent("Text");
    (text as any).font = font;
    text.fontSize = size;
    text.color = new UnityEngine.Color(0.94, 0.96, 1, 1);
    (text as any).alignment = 3;
    text.supportRichText = true;
    text.text = value;
    // 原版 UI 的白字带明显黑色描边，在复杂场景背景上仍能保持清晰。
    const outline = go.AddComponent("Outline");
    outline.effectColor = new UnityEngine.Color(0, 0, 0, 0.92);
    outline.effectDistance = new UnityEngine.Vector2(2, -2);
    outline.useGraphicAlpha = true;
    return text;
}

// ===== 模块: ui/components/button.ts =====
// 按钮组件。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function makeButton(parent: UnityEngine.Transform, name: string, label: string, font: any, x: number, y: number, width: number, onClick: () => void, height = 42): UnityEngine.GameObject {
    const go = uiObject(name, parent);
    rect(go, 0, 1, x, -y, width, height);
    const image = go.AddComponent("Image");
    image.sprite = makeRoundedPanelSprite();
    image.type = UnityEngine.UI.Type.Sliced;
    image.color = new UnityEngine.Color(0.18, 0.18, 0.18, 0.66);
    const button = go.AddComponent("Button");
    button.targetGraphic = image;
    button.onClick.AddListener(() => { if (isCurrentGeneration()) onClick(); });
    const text = makeText(go.transform, "Label", label, font, 0, 0, width, height, height >= 54 ? 27 : 23);
    (text as any).alignment = 4;
    return go;
}

// ===== 模块: ui/components/input.ts =====
// 输入框组件。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function makeInput(parent: UnityEngine.Transform, name: string, value: string, placeholder: string, font: any, x: number, y: number, width: number): UnityEngine.UI.InputField {
    const go = uiObject(name, parent);
    rect(go, 0, 1, x, -y, width, 46);
    const image = go.AddComponent("Image");
    image.sprite = makeRoundedPanelSprite();
    image.type = UnityEngine.UI.Type.Sliced;
    image.color = new UnityEngine.Color(0.16, 0.16, 0.16, 0.7);
    const input = go.AddComponent("InputField");
    input.targetGraphic = image;
    const content = makeText(go.transform, "Text", value, font, 12, 0, width - 24, 46, 24);
    content.color = new UnityEngine.Color(1, 1, 1, 1);
    const hint = makeText(go.transform, "Placeholder", placeholder, font, 12, 0, width - 24, 46, 24);
    hint.color = new UnityEngine.Color(0.55, 0.6, 0.68, 1);
    input.textComponent = content;
    input.placeholder = hint;
    input.text = value;
    return input;
}

// 生成一张硬边圆角白色纹理，再由 Image.color 统一染成面板颜色。
// 圆角边缘只使用 0 或 1 两种透明度，避免半透明抗锯齿造成“淡化”边框。
// 纹理只在创建界面时生成一次，不会进入每帧更新路径。

// ===== 模块: ui/components/panel.ts =====
// 面板与边框组件。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function makeRoundedPanelSprite(): UnityEngine.Sprite {
    if (roundedPanelSprite) return roundedPanelSprite;
    const size = 64;
    const radius = 7;
    const texture = new UnityEngine.Texture2D(size, size, UnityEngine.TextureFormat.RGBA32, false);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            const dx = Math.max(radius - px, 0, px - (size - radius));
            const dy = Math.max(radius - py, 0, py - (size - radius));
            const distance = Math.sqrt(dx * dx + dy * dy);
            const alpha = distance <= radius ? 1 : 0;
            texture.SetPixel(x, y, new UnityEngine.Color(1, 1, 1, alpha));
        }
    }
    texture.Apply(false, true);
    roundedPanelSprite = UnityEngine.Sprite.Create(
        texture,
        new UnityEngine.Rect(0, 0, size, size),
        new UnityEngine.Vector2(0.5, 0.5),
        100,
        0,
        UnityEngine.SpriteMeshType.FullRect,
        new UnityEngine.Vector4(radius, radius, radius, radius)
    );
    return roundedPanelSprite;
}

function addOriginalFrameCorners(parent: UnityEngine.Transform, x: number, y: number, width: number, height: number): void {
    const color = new UnityEngine.Color(0.92, 0.92, 0.92, 0.9);
    const length = 28;
    const thickness = 4;
    makeSolidRect(parent, "FrameTopLeftH", color, x, y, length, thickness);
    makeSolidRect(parent, "FrameTopLeftV", color, x, y, thickness, length);
    makeSolidRect(parent, "FrameTopRightH", color, x + width - length, y, length, thickness);
    makeSolidRect(parent, "FrameTopRightV", color, x + width - thickness, y, thickness, length);
    makeSolidRect(parent, "FrameBottomLeftH", color, x, y + height - thickness, length, thickness);
    makeSolidRect(parent, "FrameBottomLeftV", color, x, y + height - length, thickness, length);
    makeSolidRect(parent, "FrameBottomRightH", color, x + width - length, y + height - thickness, length, thickness);
    makeSolidRect(parent, "FrameBottomRightV", color, x + width - thickness, y + height - length, thickness, length);
}

// ===== 模块: ui/components/search.ts =====
// 原版界面查找工具。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function findOldUiFont(): any {
    try {
        const old = UnityEngine.GameObject.Find(UI_ROOT_NAME);
        if (!old) return null;
        const status = old.transform.Find("Panel/Status");
        const text = status ? status.gameObject.GetComponent("Text") : null;
        return text ? (text as any).font : null;
    } catch (_error) { return null; }
}

function findTextInChildren(transform: UnityEngine.Transform): UnityEngine.UI.Text | null {
    try {
        const own = transform.gameObject.GetComponent("Text");
        if (own) return own as UnityEngine.UI.Text;
        for (let index = 0; index < transform.childCount; index++) {
            const found = findTextInChildren(transform.GetChild(index));
            if (found) return found;
        }
    } catch (_error) { }
    return null;
}

function findNamedChild(parent: UnityEngine.Transform, name: string): UnityEngine.Transform | null {
    try {
        for (let index = 0; index < parent.childCount; index++) {
            const child = parent.GetChild(index);
            if (String(child.gameObject.name) === name) return child;
        }
    } catch (_error) { }
    return null;
}

function findNamedDescendant(parent: UnityEngine.Transform, name: string): UnityEngine.Transform | null {
    const direct = findNamedChild(parent, name);
    if (direct) return direct;
    try {
        for (let index = 0; index < parent.childCount; index++) {
            const found = findNamedDescendant(parent.GetChild(index), name);
            if (found) return found;
        }
    } catch (_error) { }
    return null;
}

function setChildText(parent: UnityEngine.Transform, childName: string, value: string): void {
    try {
        const child = findNamedDescendant(parent, childName);
        const text = child ? findTextInChildren(child) : null;
        if (text) text.text = value;
    } catch (_error) { }
}

// ===== 模块: ui/components/canvas-shell.ts =====
// 联机页面的顶层画布、协程宿主和原版风格卡片骨架。
type MultiplayerCanvasShell = {
    root: UnityEngine.GameObject;
    runner: UnityEngine.MonoBehaviour;
    panel: UnityEngine.GameObject;
    body: UnityEngine.GameObject;
};

function createMultiplayerCanvasShell(): MultiplayerCanvasShell {
    const old = UnityEngine.GameObject.Find(UI_ROOT_NAME);
    if (old) UnityEngine.Object.Destroy(old);

    const root = new UnityEngine.GameObject(UI_ROOT_NAME);
    root.AddComponent("RectTransform");
    const canvas = root.AddComponent("Canvas");
    canvas.renderMode = UnityEngine.RenderMode.ScreenSpaceOverlay;
    canvas.overrideSorting = true;
    canvas.sortingOrder = 32000;
    const scaler = root.AddComponent("CanvasScaler");
    scaler.uiScaleMode = UnityEngine.UI.ScaleMode.ScaleWithScreenSize;
    scaler.referenceResolution = new UnityEngine.Vector2(1920, 1080);
    scaler.matchWidthOrHeight = 0.5;
    root.AddComponent("GraphicRaycaster");
    UnityEngine.Object.DontDestroyOnLoad(root);

    // 透明 Image 同时是跨场景 MonoBehaviour，可安全承载联机存档协程。
    const runnerObject = uiObject("CoroutineRunner", root.transform);
    rect(runnerObject, 0.5, 0.5, 0, 0, 0, 0);
    const runnerImage = runnerObject.AddComponent("Image") as UnityEngine.UI.Image;
    runnerImage.color = new UnityEngine.Color(0, 0, 0, 0);
    runnerImage.raycastTarget = false;

    const panel = uiObject("Panel", root.transform);
    rect(panel, 0.5, 0.5, 0, 0, 760, 820);
    const panelImage = panel.AddComponent("Image");
    panelImage.color = new UnityEngine.Color(0, 0, 0, 0);

    const body = uiObject("ConfigBody", panel.transform);
    rect(body, 0, 1, 20, -92, 720, 620);
    const bodyImage = body.AddComponent("Image");
    bodyImage.color = new UnityEngine.Color(0.34, 0.34, 0.34, 0.58);
    addOriginalFrameCorners(panel.transform, 12, 84, 736, 636);
    return { root, runner: runnerImage as UnityEngine.MonoBehaviour, panel, body };
}

// ===== 模块: ui/components/native-button.ts =====
// 克隆原版按钮并统一替换事件与文字，页面不再重复操作 Unity 组件。
type NativeButtonClone = {
    root: UnityEngine.GameObject;
    button: UnityEngine.UI.Button;
    label: UnityEngine.UI.Text | null;
};

function cloneNativeButton(template: UnityEngine.UI.Button, parent: UnityEngine.Transform,
    name: string, labelText: string, onClick: () => void): NativeButtonClone {
    const root = UnityEngine.Object.Instantiate(template.gameObject, parent) as UnityEngine.GameObject;
    root.name = name;
    const button = root.GetComponent("Button") as UnityEngine.UI.Button;
    if (!button) throw new Error("复制后的按钮缺少 Button 组件");
    button.onClick.RemoveAllListeners();
    let listenerAdded = false;
    try { button.onClick.AddListener(onClick); listenerAdded = true; } catch (_error) { }
    if (!listenerAdded) {
        try { Extensions.SetListener(button.onClick, onClick); listenerAdded = true; } catch (_error) { }
    }
    if (!listenerAdded) throw new Error("无法绑定复制按钮的点击事件");
    const label = findTextInChildren(root.transform);
    if (label) label.text = labelText;
    return { root, button, label };
}

// ===== 模块: ui/components/player-list-card.ts =====
// 屏幕中央的房间玩家名单卡片，复用联机面板的灰黑背景和白色四角框线。
type PlayerListCard = {
    root: UnityEngine.GameObject;
    title: UnityEngine.UI.Text;
    count: UnityEngine.UI.Text;
    body: UnityEngine.UI.Text;
};

function createPlayerListCard(parent: UnityEngine.Transform, font: any): PlayerListCard {
    const root = uiObject("PlayerListCard", parent);
    rect(root, 0.5, 0.5, 0, 0, 620, 470);
    const background = root.AddComponent("Image") as UnityEngine.UI.Image;
    background.color = new UnityEngine.Color(0.22, 0.22, 0.22, 0.86);
    background.raycastTarget = false;
    addOriginalFrameCorners(root.transform, 0, 0, 620, 470);

    const title = makeText(root.transform, "PlayerListTitle", tr("playerList.title"), font,
        40, 24, 540, 58, 36);
    (title as any).alignment = 4;
    const count = makeText(root.transform, "PlayerListCount", "", font,
        40, 86, 540, 40, 21);
    (count as any).alignment = 4;
    const body = makeText(root.transform, "PlayerListBody", "", font,
        58, 140, 504, 280, 27);
    (body as any).alignment = 0;
    root.SetActive(false);
    return { root, title, count, body };
}

// ===== 模块: ui/pages/localization.ts =====
// 页面语言刷新。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function refreshLocalizedUi(): void {
    try {
        if (uiMenuButton) {
            const menuText = findTextInChildren(uiMenuButton.transform);
            if (menuText) menuText.text = tr("menu.multiplayer");
        }
        if (uiPauseButton) {
            const pauseText = findTextInChildren(uiPauseButton.transform);
            if (pauseText) pauseText.text = tr("menu.multiplayer");
        }
        if (!uiPanel) return;
        const root = uiPanel.transform;
        const labels: Record<string, string> = {
            AddressLabel: "field.address",
            PortLabel: "field.port",
            NameLabel: "field.playerName",
            Host: "button.host",
            Join: "button.join",
            Stop: "button.stop",
            Privacy: "privacy",
            Save: "save.notRead",
            Cancel: "button.cancel"
        };
        for (const name of Object.keys(labels)) setChildText(root, name, tr(labels[name]));
        try { if (uiAddress && uiAddress.placeholder) (uiAddress.placeholder as UnityEngine.UI.Text).text = tr("placeholder.address"); } catch (_error) { }
        try { if (uiPort && uiPort.placeholder) (uiPort.placeholder as UnityEngine.UI.Text).text = tr("placeholder.port"); } catch (_error) { }
        try { if (uiName && uiName.placeholder) (uiName.placeholder as UnityEngine.UI.Text).text = tr("placeholder.playerName"); } catch (_error) { }
        if (uiTitle) uiTitle.text = tr("panel.title");
        refreshPlayerListUi(true);
        updateStatusText();
    } catch (error) { log("刷新联机界面语言失败: " + error); }
}

// 复制游戏自己的“新建游戏”按钮，因此背景、字体、悬停动画和缩放规则都与原界面一致。

// ===== 模块: ui/pages/main-menu.ts =====
// 主菜单联机页面。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function buildMainMenuButton(menu: MainMenu): void {
    if (!menu.newGame || !menu.newGame.gameObject || !uiPanel) return;
    let stage = "准备";
    try {
        const parent = menu.newGame.transform.parent;
        const old = findNamedChild(parent, MENU_BUTTON_NAME);
        if (old) UnityEngine.Object.Destroy(old.gameObject);

        stage = "复制按钮";
        const clonedButton = cloneNativeButton(menu.newGame, parent, MENU_BUTTON_NAME,
            tr("menu.multiplayer"), () => {
            if (!isCurrentGeneration() || !uiPanel) return;
            const opening = !uiPanel.activeSelf;
            if (opening) openPanel();
            else closePanel();
        });
        const cloned = clonedButton.root;

        stage = "计算按钮位置";
        const sourceRect = menu.newGame.transform as any;
        const clonedRect = cloned.transform as any;
        const loadRect = menu.LoadGame ? menu.LoadGame.transform as any : null;
        const sourcePosition = sourceRect.anchoredPosition;
        let spacing = 70;
        if (loadRect && loadRect.anchoredPosition) {
            const measured = Math.abs(Number(sourcePosition.y) - Number(loadRect.anchoredPosition.y));
            if (measured > 1) spacing = measured;
        }
        clonedRect.anchoredPosition = new UnityEngine.Vector2(Number(sourcePosition.x), Number(sourcePosition.y) + spacing);
        // 如果原菜单使用 VerticalLayoutGroup，兄弟序号会让布局系统把它排在“新建游戏”正上方。
        stage = "设置菜单顺序";
        cloned.transform.SetSiblingIndex(menu.newGame.transform.GetSiblingIndex());
        cloned.SetActive(true);
        uiMenuButton = cloned;
        log("已在“新建游戏”上方创建原生样式的“联机”按钮");
    } catch (error) {
        uiMenuButton = null;
        log("创建主菜单联机按钮失败（" + stage + "）: " + error);
    }
}

// 暂停菜单入口直接复制游戏自己的“设置”按钮，保留字体、背景、悬停和点击音效。

// ===== 模块: ui/pages/pause-menu.ts =====
// 暂停菜单联机页面。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function buildPauseMenuButton(pause: PauseWindow): void {
    if (!pause.setting || !pause.setting.gameObject) return;
    let stage = "准备";
    try {
        const parent = pause.setting.transform.parent;
        const old = findNamedChild(parent, PAUSE_BUTTON_NAME);
        if (old) UnityEngine.Object.Destroy(old.gameObject);

        stage = "复制设置按钮";
        const clonedButton = cloneNativeButton(pause.setting, parent, PAUSE_BUTTON_NAME,
            tr("menu.multiplayer"), () => { if (isCurrentGeneration()) openPanel(); });
        const cloned = clonedButton.root;
        const button = clonedButton.button;

        stage = "重新排列暂停菜单";
        cloned.transform.SetSiblingIndex(pause.setting.transform.GetSiblingIndex() + 1);
        // 原菜单的五个按钮已经占满竖向空间。插入“联机”后，把六个按钮等距放进
        // 原来“设置”到“退出”的世界坐标范围。原版按钮分属不同容器，不能比较 anchoredPosition。
        uiPauseLoadButton = pause.load ? pause.load.gameObject : null;
        pauseButtonLayout = {
            setting: pause.setting, multiplayer: button, load: pause.load,
            secret: pause.secret, bugFeedback: pause.bugFeedback, exit: pause.exit
        };
        lastPauseLayoutOnline = null;
        refreshPauseMenuLayout();
        cloned.SetActive(true);
        uiPauseButton = cloned;
        log("已在 ESC 暂停菜单中创建原生样式的“联机”按钮，并重新等距排列菜单");
    } catch (error) {
        uiPauseButton = null;
        log("创建暂停菜单联机按钮失败（" + stage + "）: " + error);
    }
}

function refreshPauseMenuLayout(): void {
    if (!pauseButtonLayout) return;
    const online = role !== "off";
    if (lastPauseLayoutOnline === online) return;
    lastPauseLayoutOnline = online;
    // 联机时删除原版“读取”入口，防止切回单机档；离线时恢复并参与六按钮等距布局，
    // 不能只恢复可见性而留在旧坐标，否则会再次与“联机/秘密”重叠。
    pauseButtonLayout.load.gameObject.SetActive(!online);
    const orderedButtons: UnityEngine.UI.Button[] = online
        ? [pauseButtonLayout.setting, pauseButtonLayout.multiplayer, pauseButtonLayout.secret,
            pauseButtonLayout.bugFeedback, pauseButtonLayout.exit]
        : [pauseButtonLayout.setting, pauseButtonLayout.multiplayer, pauseButtonLayout.load,
            pauseButtonLayout.secret, pauseButtonLayout.bugFeedback, pauseButtonLayout.exit];
    const startPosition = pauseButtonLayout.setting.transform.position;
    const endPosition = pauseButtonLayout.exit.transform.position;
    const stepY = (endPosition.y - startPosition.y) / (orderedButtons.length - 1);
    for (let index = 0; index < orderedButtons.length; index++) {
        const itemTransform = orderedButtons[index].transform;
        const current = itemTransform.position;
        itemTransform.position = new UnityEngine.Vector3(current.x, startPosition.y + stepY * index, current.z);
    }
}

// ===== 模块: ui/pages/player-list.ts =====
// Tab 房间玩家名单页面；页面只组合 player-list-card 组件并填充玩家数据。
function buildPlayerListPage(parent: UnityEngine.Transform, font: any): void {
    const card = createPlayerListCard(parent, font);
    uiPlayerListPanel = card.root;
    uiPlayerListTitle = card.title;
    uiPlayerListCount = card.count;
    uiPlayerListBody = card.body;
}

function roomPlayerRows(): { id: number; name: string; tag: string }[] {
    const rows: { id: number; name: string; tag: string }[] = [];
    rows.push({
        id: localNetworkId >= 0 ? localNetworkId : 0,
        name: currentPlayerName || "Player",
        tag: role === "host" ? tr("playerList.hostYou") : tr("playerList.you")
    });

    const remoteIds: Record<string, boolean> = {};
    for (const key of Object.keys(peerNames)) remoteIds[key] = true;
    for (const key of Object.keys(latestPlayerStates)) remoteIds[key] = true;
    for (const key of Object.keys(remoteProfiles)) remoteIds[key] = true;
    for (const key of Object.keys(remotePlayers)) remoteIds[key] = true;
    delete remoteIds[String(localNetworkId)];

    for (const key of Object.keys(remoteIds).sort((a, b) => Number(a) - Number(b))) {
        const state = latestPlayerStates[key];
        const remote = remotePlayers[key];
        const name = peerNames[key] || (state ? state.playerName : "") || (remote ? remote.name : "") || "Player";
        rows.push({ id: Number(key), name, tag: Number(key) === 0 ? tr("playerList.host") : "" });
    }
    return rows;
}

function refreshPlayerListUi(force = false): void {
    if (!uiPlayerListTitle || !uiPlayerListCount || !uiPlayerListBody) return;
    const rows = roomPlayerRows();
    const signature = languageCode + "|" + role + "|" + rows.map(row => row.id + ":" + row.name + ":" + row.tag).join("|");
    if (!force && signature === lastPlayerListSignature) return;
    lastPlayerListSignature = signature;
    uiPlayerListTitle.text = tr("playerList.title");
    uiPlayerListCount.text = tr("playerList.count", { count: rows.length });
    uiPlayerListBody.text = rows.map(row => "• " + row.name + (row.tag ? "  " + row.tag : "")).join("\n");
}

function handlePlayerListInput(): void {
    if (!uiPlayerListPanel) return;
    let visible = false;
    try {
        // 仅在已经进入联机游戏时响应；联机配置输入框打开时把 Tab 留给 UI 导航。
        visible = role !== "off" && GameManager.InGame && (!uiPanel || !uiPanel.activeSelf) &&
            Input.GetKey(KeyCode.Tab);
    } catch (_error) { visible = false; }
    if (visible) refreshPlayerListUi(updateFrames % 15 === 0);
    if (uiPlayerListPanel.activeSelf !== visible) uiPlayerListPanel.SetActive(visible);
}

// ===== 模块: ui/pages/multiplayer.ts =====
// 联机配置页面。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function buildUi(font: any): void {
    if (!font || uiRoot) return;
    try {
        const config = loadConfig();
        const shell = createMultiplayerCanvasShell();
        uiRoot = shell.root;
        uiPanel = shell.panel;
        uiConfigBody = shell.body;
        coroutineRunner = shell.runner;
        uiFont = font;
        selectedSaveName = UnityEngine.PlayerPrefs.GetString(prefKey("MPB.SelectedSave"), "");
        buildPlayerListPage(shell.root.transform, font);

        uiTitle = makeText(shell.panel.transform, "Title", tr("panel.title"), font, 80, 4, 600, 72, 44);
        (uiTitle as any).alignment = 4;

        const configBody = shell.body;

        uiStatus = makeText(configBody.transform, "Status", statusLabel(), font, 30, 18, 660, 46, 27);
        (uiStatus as any).alignment = 4;
        makeText(configBody.transform, "AddressLabel", tr("field.address"), font, 30, 78, 135, 46, 24);
        makeText(configBody.transform, "PortLabel", tr("field.port"), font, 440, 78, 72, 46, 24);
        uiAddress = makeInput(configBody.transform, "Address", UnityEngine.PlayerPrefs.GetString(prefKey("MPB.Address"), config.address), tr("placeholder.address"), font, 170, 76, 250);
        uiPort = makeInput(configBody.transform, "Port", UnityEngine.PlayerPrefs.GetString(prefKey("MPB.Port"), String(config.port)), tr("placeholder.port"), font, 520, 76, 170);
        makeText(configBody.transform, "NameLabel", tr("field.playerName"), font, 30, 136, 135, 46, 24);
        uiName = makeInput(configBody.transform, "PlayerName", UnityEngine.PlayerPrefs.GetString(prefKey("MPB.PlayerName"), config.playerName), tr("placeholder.playerName"), font, 170, 134, 520);

        makeButton(configBody.transform, "Host", tr("button.host"), font, 30, 202, 205, startHostFromUi, 56);
        makeButton(configBody.transform, "Join", tr("button.join"), font, 257, 202, 205, joinFromUi, 56);
        makeButton(configBody.transform, "Stop", tr("button.stop"), font, 484, 202, 205, stopFromUi, 56);
        // 联机存档由建房流程自动选择最近的有效存档，不再创建“选择存档”子页面，
        // 也不提供与自动续档规则冲突的“新建线上存档”按钮。
        makeText(configBody.transform, "Privacy", tr("privacy"), font, 30, 298, 660, 70, 20);
        uiPlayerInfo = makeText(configBody.transform, "Players", tr("players.title"), font, 30, 365, 660, 235, 18);
        (uiPlayerInfo as any).alignment = 0;
        refreshPlayerInfoUi();

        makeButton(shell.panel.transform, "Cancel", tr("button.cancel"), font, 130, 740, 500, closePanel, 64);
        shell.panel.SetActive(false);
        log("游戏内联机界面已创建：原版读取窗口样式、半透明灰黑面板和白色四角框线");
    } catch (error) {
        uiRoot = null;
        coroutineRunner = null;
        log("创建联机界面失败: " + error);
    }
}

function handleUiInput(): void {
    try {
        if (uiPanel && uiPanel.activeSelf && Input.GetKeyDown(KeyCode.Escape)) closePanel();
        handlePlayerListInput();
    } catch (error) { log("检测 ESC 键失败: " + error); }
}

function startMainMenuInputLoop(owner: UnityEngine.MonoBehaviour): void {
    if (uiInputLoopStarted) return;
    uiInputLoopStarted = true;
    const nextFrame = () => {
        if (!isCurrentGeneration()) return;
        updateBridge(null);
        JintCoroutine.WaitForNextFrame(owner, nextFrame);
    };
    JintCoroutine.WaitForNextFrame(owner, nextFrame);
}

// ===== 模块: ui/pages/runtime.ts =====
// 界面运行时。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function ensureUi(font?: any): void {
    if (uiRoot || !isCurrentGeneration()) return;
    const inheritedFont = font || findOldUiFont();
    if (inheritedFont) buildUi(inheritedFont);
}

function setOnlinePausedFlag(paused: boolean): boolean {
    const manager = GameManager.Singleton;
    if (!manager) return false;
    try {
        // BindingFlags.Instance | BindingFlags.NonPublic = 4 | 32 = 36。
        if (!gameManagerPausedField)
            gameManagerPausedField = manager.GetType().GetField("_isPaused", 36);
        if (!gameManagerPausedField) return false;
        gameManagerPausedField.SetValue(manager, paused);
        return GameManager.Paused === paused;
    } catch (error) {
        log("设置联机暂停标志失败: " + error);
        return false;
    }
}

function keepOnlineWorldRunning(): void {
    if (!bridgeAvailable || role === "off") return;
    try {
        // 主菜单切场景的短窗口里静态 Singleton 为空；直接读取 Paused 会让游戏 getter
        // 抛 NullReferenceException。等 GameManager 建立后再解除暂停即可。
        if (!GameManager.Singleton) return;
        let pauseVisible = false;
        try { pauseVisible = WindowManager.IsOpened("PauseWindow"); } catch (_error) { }
        if (pauseVisible) {
            // PauseGame(false) 会顺带关闭 PauseWindow。直接清除原版私有暂停标志，保留窗口、
            // 光标和按钮，同时让 NPC、物理、Animator、场景脚本与 Mod 权威时钟继续更新。
            const released = setOnlinePausedFlag(false);
            if (Number(UnityEngine.Time.timeScale) !== 1) UnityEngine.Time.timeScale = 1;
            if (BRIDGE_CHANNEL !== "default" && !pauseVisibleEvidenceLogged && released) {
                pauseVisibleEvidenceLogged = true;
                onlinePauseReleaseCount += 1;
                log("[双实例证据] 联机暂停菜单背景持续运行 count=" + onlinePauseReleaseCount +
                    " pauseVisible=true paused=" + GameManager.Paused + " timeScale=" +
                    Number(UnityEngine.Time.timeScale).toFixed(1));
            }
        } else {
            pauseVisibleEvidenceLogged = false;
            // 窗口已关闭但某个原版回调仍留下暂停标志时，恢复完整游戏状态。
            if (GameManager.Paused) GameManager.PauseGame(false);
        }
        if (Number(UnityEngine.Time.timeScale) !== 1) UnityEngine.Time.timeScale = 1;
    } catch (_error) { }
}

// ===== 模块: network/control/update-loop.ts =====
// 网络控制更新循环。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function updateBridge(player: Player | null): void {
    if (!isCurrentGeneration()) return;
    handleUiInput();
    syncGameLanguage();
    startBridge();
    if (bridgeAvailable) {
        const touchNow = Number(UnityEngine.Time.unscaledTime);
        if (lastBridgeTouchAt < 0 || touchNow - lastBridgeTouchAt >= 2) {
            lastBridgeTouchAt = touchNow;
            submitBridgeCommand("touch");
        }
    }
    ensureUi();
    // PauseWindow 通常在场景载入时就已完成 Start，首次按 ESC 只是把已注册窗口显示出来。
    // 因此不能只依赖 Start Hook；窗口打开时主动发现现有实例，确保联机按钮一定存在。
    try {
        if (!pauseButtonLayout && WindowManager.Singleton && WindowManager.IsOpened("PauseWindow")) {
            const pause = WindowManager.GetWindow("PauseWindow") as PauseWindow;
            if (pause) {
                const nativeLabel = pause.setting ? findTextInChildren(pause.setting.transform) : null;
                ensureUi(nativeLabel ? (nativeLabel as any).font : null);
                buildPauseMenuButton(pause);
            }
        }
    } catch (error) { log("发现已打开暂停菜单失败: " + error); }
    // 暂停窗口可能先于联机状态变化创建；每帧按当前模式同步原版“读取”按钮。
    // 联机时隐藏，停止联机后恢复，避免永久修改原版菜单。
    refreshPauseMenuLayout();
    updateFrames += 1;
    if (updateFrames % 120 === 0) updateStatusText();
    updateRemotePlayers();
    if (!bridgeAvailable || role === "off") return;
    // Unity 在 timeScale=0 时仍执行 Update；解除逻辑暂停与世界时钟，但不销毁暂停窗口。
    keepOnlineWorldRunning();
    updateOnlineWorldClock();
    // 状态文件只采样一次，再从内存队列处理事件。旧实现每处理一个事件都会重新读文件，
    // 会放大 Windows 共享冲突，并在完整资料包到达时阻塞 Unity 主线程。
    const pollNow = Number(UnityEngine.Time.unscaledTime);
    if (pollNow >= nextBridgePollAt) {
        // 与 20 Hz 玩家快照保持同一读取节拍，避免桥接层把多个状态包合并成一次可见更新。
        nextBridgePollAt = advanceFixedDeadline(nextBridgePollAt, pollNow, PLAYER_STATE_INTERVAL);
        try {
            collectBridgeEvents(readBridgeState());
        } catch (error) {
            log("轮询网络桥接暂时失败，将自动重试: " + error);
        }
    }
    // 每帧最多处理 32 个已入内存事件，防止网络洪峰长时间占用 Unity 主线程。
    for (let index = 0; index < 32 && pendingBridgeEvents.length > 0; index++) {
        const eventJson = pendingBridgeEvents.shift() || "";
        if (eventJson) processEvent(eventJson);
    }
    if (player) {
        const now = Number(UnityEngine.Time.unscaledTime);
        if (role === "client" && now >= nextPresenceAt) {
            nextPresenceAt = now + PRESENCE_INTERVAL;
            send(0, { type: "hello", protocol: PROTOCOL_VERSION, playerName: currentPlayerName });
        }
        runSmokeTestDiagnostics(player);
        sendLocalPlayerState(player);
        sendLocalPlayerLiveData();
        sendLocalPlayerProfile();
        sendAuthoritativeWorldTime();
    }
    resendPendingSleepApproval();
    flushOutgoingMessage();
}

// ===== 模块: save/exit.ts =====
// 退出保存流程。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function writeOnlineSaveSnapshot(manager: GameManager): string {
    if (!bridgeAvailable || !selectedSaveName.startsWith(ONLINE_SAVE_PREFIX)) return "-2";
    try {
        const raw = manager.GetSave() || "";
        if (!raw) { log("线上存档快照无内容"); return "-7"; }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            log("线上存档快照根类型无效 type=" + typeof parsed + " array=" + Array.isArray(parsed));
            return "-7";
        }
        const json = JSON.stringify(parsed);
        if (BRIDGE_CHANNEL !== "default") log("诊断模式：线上存档规范 JSON 长度=" + json.length);
        const chunkSize = 6000;
        const chunks = Math.max(1, Math.ceil(json.length / chunkSize));
        let result = submitBridgeCommandAndWait("beginRawSave?name=" + encodeURIComponent(selectedSaveName) +
            "&chunks=" + chunks);
        if (result !== "0") { log("beginRawSave 失败 code=" + result); return result; }
        for (let index = 0; index < chunks; index++) {
            const part = json.substring(index * chunkSize, Math.min(json.length, (index + 1) * chunkSize));
            result = submitBridgeCommandAndWait("appendRawSave?index=" + index + "&data=" + encodeURIComponent(part));
            if (result !== "0") { log("appendRawSave 失败 index=" + index + " code=" + result); return result; }
        }
        result = submitBridgeCommandAndWait("commitRawSave");
        if (result !== "0") log("commitRawSave 失败 code=" + result);
        return result;
    } catch (error) {
        log("采集并写入线上存档失败: " + error);
        return "-1";
    }
}

// 线上退出必须拦截原回调：SaveGame 会跨多个 Unity 帧写盘，不能在按钮回调里同步等待。
// 写盘完成并由桥接程序验证双层密文后再退出，实现一次点击自动保存并退出。
function beginOnlineExitSave(owner: UnityEngine.MonoBehaviour, beforeQuit?: () => void): void {
    if (exitSaveInProgress || !GameManager.InGame) return;
    exitSaveInProgress = true;
    try {
        const manager = GameManager.Singleton;
        if (!manager) throw new Error("GameManager 尚未初始化");
        const saveName = activeSaveName(selectedSaveName);
        if (!saveName) throw new Error("没有有效的线上临时存档名");
        GameManager.SaveName = saveName;
        const result = writeOnlineSaveSnapshot(manager);
        if (result === "0") {
            log("退出前已自动保存并验证: " + saveName);
            try { if (beforeQuit) beforeQuit(); } catch (_error) { }
            UnityEngine.Application.Quit();
        } else {
            exitSaveInProgress = false;
            log("退出前自动保存失败，错误码=" + result);
            toast(tr("toast.exitSaveFailed"));
        }
    } catch (error) {
        exitSaveInProgress = false;
        log("退出前自动保存失败: " + error);
        toast(tr("toast.exitSaveFailed"));
    }
}

// 联机模式下把游戏所有默认 AutoSave 读写改到专属 MPActive_ 名称。
// Hook API 不能原地修改参数，因此先拦截原调用，再用防递归标记调用正确文件名。

// ===== 模块: hooks/register.ts =====
// 游戏 Hook 与入口。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
RegisterHook("System.Void GameManager::LoadGame(System.String)",
    (self: GameManager, saveName: string, ctx: IHookContext) => {
        if (!isCurrentGeneration() || saveNameRedirectInProgress || !isDefaultAutoSaveName(saveName)) return;
        const onlineName = onlineActiveSaveName();
        if (!onlineName) return;
        ctx.Intercept();
        saveNameRedirectInProgress = true;
        try {
            GameManager.SaveName = onlineName;
            onlineLoadRedirectedDuringStart = true;
            self.LoadGame(onlineName);
            log("已将默认存档读取重定向到联机专属存档: " + onlineName);
        } finally {
            saveNameRedirectInProgress = false;
        }
    });

RegisterHook("System.Void GameManager::SaveGame(System.String)",
    (self: GameManager, saveName: string, ctx: IHookContext) => {
        if (!isCurrentGeneration() || saveNameRedirectInProgress || !isDefaultAutoSaveName(saveName)) return;
        const onlineName = onlineActiveSaveName();
        if (!onlineName) return;
        ctx.Intercept();
        GameManager.SaveName = onlineName;
        const result = writeOnlineSaveSnapshot(self);
        if (result === "0") log("已将默认自动保存写入联机专属存档: " + onlineName);
        else log("联机自动保存失败，错误码=" + result);
    });

// Player.Update 是进入存档后的稳定逐帧入口，用于处理网络队列和刷新界面状态。
RegisterHook("System.Void Player::Update()", (self: Player) => { updateBridge(self); });
// 客户端不能自行推进日期或时段。所有时间变化只接受房主的 worldTime 包；
// 应用房主数据以及全员睡眠获批时用布尔标记临时放行原版方法。
RegisterHook("System.Void PlayerStatus::AddTime()", (_self: PlayerStatus, ctx: IHookContext) => {
    if (isCurrentGeneration() && role === "client" && !applyingAuthoritativeTime && !sleepConsensusExecuting) ctx.Intercept();
});
RegisterHook("System.Void PlayerStatus::AddDay()", (_self: PlayerStatus, ctx: IHookContext) => {
    if (isCurrentGeneration() && role === "client" && !applyingAuthoritativeTime && !sleepConsensusExecuting) ctx.Intercept();
});
RegisterHook("System.Void PlayerStatus::SetTime(System.Int32)", (_self: PlayerStatus, _time: number, ctx: IHookContext) => {
    if (isCurrentGeneration() && role === "client" && !applyingAuthoritativeTime && !sleepConsensusExecuting) ctx.Intercept();
});
// 两种睡觉按钮都必须经过房主的全员确认；只有所有在线玩家在 20 秒内选择同一种
// 睡眠方式时，才在所有电脑上同时放行原版回调，单个玩家不能独自跳过夜晚。
RegisterHook("System.Void BedWindow::Start()", (self: BedWindow) => {
    if (isCurrentGeneration()) bedWindowInstance = self;
});
RegisterHook("System.Void BedWindow::<Start>b__2_0()", (_self: BedWindow, ctx: IHookContext) => {
    if (isCurrentGeneration()) requestConsensusSleep("short", ctx);
});
RegisterHook("System.Void BedWindow::<Start>b__2_1()", (_self: BedWindow, ctx: IHookContext) => {
    if (isCurrentGeneration()) requestConsensusSleep("tomorrow", ctx);
});
// PauseWindow.Start 的原生初始化完成后，在下一帧复制“设置”按钮，避免覆盖游戏自己的监听器。
RegisterHook("System.Void PauseWindow::Start()", (self: PauseWindow) => {
    if (!isCurrentGeneration()) return;
    JintCoroutine.WaitForNextFrame(self, () => {
        if (!isCurrentGeneration()) return;
        try {
            const nativeLabel = self.setting ? findTextInChildren(self.setting.transform) : null;
            ensureUi(nativeLabel ? (nativeLabel as any).font : null);
            // updateBridge 可能已在窗口打开时主动补建，避免同一帧重复克隆和绑定按钮。
            if (!pauseButtonLayout) buildPauseMenuButton(self);
            // 联机暂停菜单只打开 UI，不冻结世界时间；其他玩家和网络状态继续更新。
            keepOnlineWorldRunning();
            syncGameLanguage();
        } catch (error) { log("暂停菜单 UI 初始化失败: " + error); }
    });
});
// PauseWindow.Start 会把此闭包绑定到原版 Exit 按钮；钩子先运行，随后保留原版退出行为。
RegisterHook("System.Void PauseWindow::<Start>b__9_3()", (_self: any, ctx: IHookContext) => {
    if (!isCurrentGeneration() || role === "off") return;
    ctx.Intercept();
    const manager = GameManager.Singleton;
    if (manager) beginOnlineExitSave(manager);
});
// MainMenu.Awake 用于尽早创建联机面板；面板会跨场景保留。
RegisterHook("System.Void MainMenu::Awake()", (self: MainMenu) => {
    if (!isCurrentGeneration()) return;
    try {
        mainMenuInstance = self;
        syncGameLanguage();
        const nativeLabel = self.newGame ? findTextInChildren(self.newGame.transform) : null;
        ensureUi(nativeLabel ? (nativeLabel as any).font : (self.version ? (self.version as any).font : null));
        buildMainMenuButton(self);
        startMainMenuInputLoop(self);
    } catch (error) { log("主菜单 UI 初始化失败: " + error); }
    const config = loadConfig();
    if (config.smokeTestOnlineLifecycle) {
        if (!smokeTestScheduled) {
            smokeTestScheduled = true;
            log("诊断模式：等待真实线上存档生命周期测试");
            scheduleSmokeOnlineLifecycle(self);
        }
        return;
    }
    if (!config.smokeTestAutoLoad || smokeTestScheduled) return;
    smokeTestScheduled = true;
    log("诊断模式：等待主菜单初始化");
    if (config.smokeTestUiOpen) {
        JintCoroutine.WaitForSeconds(self, 1, () => {
            if (!isCurrentGeneration()) return;
            openPanel();
            log("诊断模式：已打开联机界面供截图");
        });
    }
    JintCoroutine.WaitForSeconds(self, config.smokeTestUiOpen ? 7 : 2, () => {
        if (!isCurrentGeneration()) return;
        try {
            closePanel();
            self.StartGame();
            if (GameManager.Singleton) {
                log("诊断模式：加载 AutoSave");
                GameManager.Singleton.LoadGame("AutoSave");
            } else log("诊断模式：StartGame 后仍无 GameManager");
        } catch (error) { log("诊断模式加载失败: " + error); }
    });
});

// 原版读取/保存窗口枚举同一 Saves 目录。拦截联机正式档和运行期临时档，保证单机模式
// 永远不会显示、读取或覆盖它们；联机面板只读取桥接程序提供的线上存档列表。
RegisterHook("System.Void LoadSaveWindow::CreateLoadSlot(System.String,System.IO.FileInfo)",
    (_self: LoadSaveWindow, saveName: string, _fileInfo: any, ctx: IHookContext) => {
        if (isOnlineSaveSlot(saveName)) ctx.Intercept();
    });
// 第二层保护：即使其他 Mod 手动创建了联机槽位，也禁止原版单机读取窗口加载它。
RegisterHook("System.Void LoadSaveWindow::Load(System.String)",
    (_self: LoadSaveWindow, saveName: string, ctx: IHookContext) => {
        if (isOnlineSaveSlot(saveName)) {
            log("已阻止单机读取窗口加载联机存档: " + saveName);
            ctx.Intercept();
        }
    });
RegisterHook("System.Void SaveTab::CreateSlotUI(System.String,System.IO.FileInfo)",
    (_self: SaveTab, saveName: string, _fileInfo: any, ctx: IHookContext) => {
        if (isOnlineSaveSlot(saveName)) ctx.Intercept();
    });
// 保存页同样不能覆盖联机正式档或运行期临时档。
RegisterHook("System.Void SaveTab::ExecuteSave(System.String)",
    (_self: SaveTab, saveName: string, ctx: IHookContext) => {
        if (isOnlineSaveSlot(saveName)) {
            log("已阻止单机保存页面覆盖联机存档: " + saveName);
            ctx.Intercept();
        }
    });
// 联机期间原版暂停/保存界面不拥有线上档的删除权限。即使其他 Mod 重新显示了
// 删除按钮或直接调用 DeleteSave，也会在真正触碰磁盘前被阻止。
RegisterHook("System.Void SaveTab::DeleteSave(System.String)",
    (_self: SaveTab, saveName: string, ctx: IHookContext) => {
        if (role !== "off" || isOnlineSaveSlot(saveName)) {
            log("已阻止暂停菜单删除存档: " + saveName);
            ctx.Intercept();
        }
    });

// 原版 Translate 会在当前调用末尾重新写入克隆按钮的“新建游戏”文本，所以必须等到下一帧
// 再强制刷新联机入口；仅检测语言编号变化不够，因为这时语言编号可能已经是新值。
RegisterHook("System.Void MainMenu::Translate(UnityEngine.Transform,System.Boolean)", (self: MainMenu) => {
    if (!isCurrentGeneration() || mainMenuTranslationRefreshPending) return;
    mainMenuTranslationRefreshPending = true;
    JintCoroutine.WaitForNextFrame(self, () => {
        mainMenuTranslationRefreshPending = false;
        if (!isCurrentGeneration()) return;
        syncGameLanguage(true);
    });
});

syncGameLanguage(true);
log("脚本初始化完成，协议版本=" + PROTOCOL_VERSION + "，UI 代次=" + SCRIPT_GENERATION);
startBridge();
