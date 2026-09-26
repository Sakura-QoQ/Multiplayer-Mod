// PlayerHostedMultiplayer 的游戏脚本入口。
// 本文件负责游戏内界面、配置读取、联机协议握手，以及只读存档预览。
type MultiplayerConfig = {
    mode: "off" | "host" | "client";
    address: string;
    port: number;
    maxPlayers: number;
    playerName: string;
    smokeTestAutoLoad: boolean;
};

type BridgeStatus = { state: string; port: number; peers: number };
type TranslationValues = Record<string, string | number>;
type NetworkVector3 = { x: number; y: number; z: number };
type NetworkQuaternion = { x: number; y: number; z: number; w: number };
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
type RemotePlayer = {
    id: number;
    name: string;
    root: UnityEngine.GameObject;
    animator: UnityEngine.Animator;
    targetPosition: UnityEngine.Vector3;
    targetRotation: UnityEngine.Quaternion;
    lastSeen: number;
    animationHash: number;
};

const MOD_TAG = "[PlayerHostedMultiplayer]";
const PROTOCOL_VERSION = 4;
const UI_ROOT_NAME = "MPB_UI_Root";
const MENU_BUTTON_NAME = "MPB_MultiplayerButton";
const PAUSE_BUTTON_NAME = "MPB_PauseMultiplayerButton";
const ONLINE_SAVE_PREFIX = "MPOnline_";
const ACTIVE_SAVE_PREFIX = "MPActive_";
const BRIDGE_STATE_FILE = "Bridge/state.json";
const IPC_COMMAND_KEY = "MPB.IpcCommand";
const IPC_SEQUENCE_KEY = "MPB.IpcCommandSequence";
const GENERATION_KEY = "MPB.ScriptGeneration";
const LANGUAGE_CODES = ["en", "ja", "zh-CN", "zh-TW", "ko", "es"];
const PLAYER_STATE_INTERVAL = 0.2;
const PLAYER_PROFILE_INTERVAL = 2;
const OUTGOING_MESSAGE_INTERVAL = 0.04;
const REMOTE_PLAYER_TIMEOUT = 10;
// 游戏切换场景时会重新执行 Mod 脚本。代次编号可让旧回调自动失效，避免重复轮询和重复按钮事件。
const SCRIPT_GENERATION = Number(UnityEngine.PlayerPrefs.GetInt(GENERATION_KEY, 0)) + 1;
UnityEngine.PlayerPrefs.SetInt(GENERATION_KEY, SCRIPT_GENERATION);
// 立即落盘也让独立桥接程序与游戏使用同一组 Windows PlayerPrefs 注册表值。
UnityEngine.PlayerPrefs.Save();

let initialized = false;
let bridgeAvailable = false;
let role: "off" | "host" | "client" = "off";
let currentPlayerName = "Player";
let smokeTestScheduled = false;
let updateFrames = 0;
let uiRoot: UnityEngine.GameObject | null = null;
let uiPanel: UnityEngine.GameObject | null = null;
let uiConfigBody: UnityEngine.GameObject | null = null;
let uiSaveList: UnityEngine.GameObject | null = null;
let uiTitle: UnityEngine.UI.Text | null = null;
let uiStatus: UnityEngine.UI.Text | null = null;
let uiSave: UnityEngine.UI.Text | null = null;
let uiAddress: UnityEngine.UI.InputField | null = null;
let uiPort: UnityEngine.UI.InputField | null = null;
let uiName: UnityEngine.UI.InputField | null = null;
let uiMenuButton: UnityEngine.GameObject | null = null;
let uiPauseButton: UnityEngine.GameObject | null = null;
let uiNewOnlineButton: UnityEngine.GameObject | null = null;
let uiSelectSaveButton: UnityEngine.GameObject | null = null;
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
let selectedSaveName = "";
let saveViewState: "empty" | "selected" | "needsGame" | "loaded" | "error" = "empty";
let saveViewData: Record<string, string | number> = {};
let roundedPanelSprite: UnityEngine.Sprite | null = null;
let mainMenuInstance: MainMenu | null = null;
let mainMenuTranslationRefreshPending = false;
let exitSaveInProgress = false;
let localNetworkId = -1;
let localStateSequence = 0;
let nextPlayerStateAt = 0;
let nextPlayerProfileAt = 0;
let localProfileRevision = 0;
let lastLocalProfileJson = "";
const remotePlayers: Record<string, RemotePlayer> = {};
const remoteProfiles: Record<string, PlayerProfile> = {};
const remoteProfileRevisions: Record<string, number> = {};
const latestPlayerStates: Record<string, PlayerStatePacket> = {};
const peerNames: Record<string, string> = {};
const lastRemoteSequences: Record<string, number> = {};
const outgoingMessages: { peerId: number; data: string }[] = [];
let nextOutgoingMessageAt = 0;

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
// 存档明文只保存在当前游戏进程的内存中，不写文件，也不自动发送给其他玩家。
let lastSaveSnapshot = "";

function isCurrentGeneration(): boolean {
    return Number(UnityEngine.PlayerPrefs.GetInt(GENERATION_KEY, 0)) === SCRIPT_GENERATION;
}

function log(message: string): void { print(MOD_TAG + " " + message); }
function toast(message: string): void {
    log(message);
    try { Toast.Show(tr("mod.name") + ": " + message, 5); } catch (_error) { }
}
type BridgeStateFile = {
    protocol: number;
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
        const text = ReadModFile(BRIDGE_STATE_FILE);
        if (!text) return null;
        const parsed = JSON.parse(text);
        return {
            protocol: Number(parsed.protocol) || 0,
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

function submitBridgeCommandTracked(command: string): number {
    if (!bridgeAvailable) return -1;
    try {
        const sequence = Number(UnityEngine.PlayerPrefs.GetInt(IPC_SEQUENCE_KEY, 0)) + 1;
        // 先写命令正文，再写序号；桥接程序只把序号变化视为一条新命令。
        UnityEngine.PlayerPrefs.SetString(IPC_COMMAND_KEY, command);
        UnityEngine.PlayerPrefs.SetInt(IPC_SEQUENCE_KEY, sequence);
        UnityEngine.PlayerPrefs.Save();
        return sequence;
    } catch (error) {
        log("提交桥接命令失败: " + error);
        return -1;
    }
}

function submitBridgeCommand(command: string): string {
    return submitBridgeCommandTracked(command) > 0 ? "0" : "-1";
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
    if (!state || !state.events) return;
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
function loadConfig(): MultiplayerConfig {
    const defaults: MultiplayerConfig = { mode: "off", address: "127.0.0.1", port: 27777, maxPlayers: 4, playerName: "Player", smokeTestAutoLoad: false };
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
            smokeTestAutoLoad: parsed.smokeTestAutoLoad === true
        };
    } catch (error) {
        log("config.json 读取失败: " + error);
        return defaults;
    }
}

function readBridgeStatus(): BridgeStatus {
    try {
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
}

function startBridge(): void {
    if (initialized) return;
    initialized = true;
    try { bridgeAvailable = bridgeCall("protocol") === String(PROTOCOL_VERSION); }
    catch (_error) { bridgeAvailable = false; }
    if (!bridgeAvailable) {
        log("联机桥未运行；请用游戏目录里的“启动联机 Mod.cmd”启动游戏");
        return;
    }

    const config = loadConfig();
    currentPlayerName = UnityEngine.PlayerPrefs.GetString("MPB.PlayerName", config.playerName);
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
    UnityEngine.PlayerPrefs.SetString("MPB.Port", String(port));
    UnityEngine.PlayerPrefs.SetString("MPB.PlayerName", currentPlayerName);
    UnityEngine.PlayerPrefs.Save();
    updateStatusText(tr("status.startingHost", { port }));
    // host 命令内部会安全停止旧连接，不再先发 stop，避免单槽 IPC 把 stop 覆盖掉。
    const sequence = submitBridgeCommandTracked("host?port=" + port + "&max=" + config.maxPlayers);
    if (sequence < 0 || !mainMenuInstance) { role = "off"; toast(tr("toast.hostFailed", { code: -1 })); return; }
    waitForBridgeResponse(mainMenuInstance, sequence, result => {
        if (result !== "0") { role = "off"; toast(tr("toast.hostFailed", { code: result })); return; }
        role = "host";
        localNetworkId = 0;
        refreshOnlineUiMode();
        toast(tr("toast.hostStarted", { port }));
        enterOnlineSave();
    });
}

function activeSaveName(onlineName: string): string {
    return onlineName.startsWith(ONLINE_SAVE_PREFIX)
        ? ACTIVE_SAVE_PREFIX + onlineName.substring(ONLINE_SAVE_PREFIX.length)
        : "";
}

function isOnlineSaveSlot(value: string): boolean {
    // 原版不同页面传入的可能是槽位名、文件名或完整路径；统一提取文件名并忽略大小写。
    const normalized = String(value || "").replace(/\\/g, "/");
    const fileName = normalized.substring(normalized.lastIndexOf("/") + 1).replace(/\.save$/i, "");
    const lowerName = fileName.toLowerCase();
    return lowerName.startsWith(ONLINE_SAVE_PREFIX.toLowerCase()) ||
        lowerName.startsWith(ACTIVE_SAVE_PREFIX.toLowerCase());
}

function makeOnlineSaveName(): string {
    // 时间戳只用于产生不重复的文件名；正式文件仍由桥接程序写入游戏原本的 Saves 目录。
    return ONLINE_SAVE_PREFIX + String(Date.now());
}

function chooseNewOnlineSave(): void {
    selectedSaveName = "";
    UnityEngine.PlayerPrefs.DeleteKey("MPB.SelectedSave");
    UnityEngine.PlayerPrefs.Save();
    saveViewState = "empty";
    saveViewData = {};
    refreshSaveText();
    toast(tr("toast.newOnlineSelected"));
}

function waitForGameManager(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void,
    remaining = 180, settleFrames = 2): void {
    if (!isCurrentGeneration()) return;
    // StartGame 会异步切场景；即使旧场景的 Singleton 还存在，也至少让出两帧再使用它。
    if (settleFrames > 0) {
        JintCoroutine.WaitForNextFrame(owner, () => waitForGameManager(owner, callback, remaining, settleFrames - 1));
        return;
    }
    try {
        if (GameManager.Singleton) { callback(GameManager.Singleton); return; }
    } catch (_error) { }
    if (remaining <= 0) { toast(tr("toast.onlineSaveFailed")); return; }
    JintCoroutine.WaitForNextFrame(owner, () => waitForGameManager(owner, callback, remaining - 1, 0));
}

function waitForPlayableGame(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void, remaining = 600): void {
    if (!isCurrentGeneration()) return;
    try {
        if (GameManager.Singleton && GameManager.InGame && Player.LocalPlayer) {
            callback(GameManager.Singleton);
            return;
        }
    } catch (_error) { }
    if (remaining <= 0) { toast(tr("toast.onlineSaveFailed")); return; }
    JintCoroutine.WaitForNextFrame(owner, () => waitForPlayableGame(owner, callback, remaining - 1));
}

function enterOnlineSave(): void {
    const menu = mainMenuInstance;
    if (!menu) {
        // 暂停菜单可以修改联机参数，但创建或切换线上存档必须回到主菜单，避免覆盖当前单机进度。
        if (!GameManager.InGame) toast(tr("toast.onlineSaveFailed"));
        return;
    }

    const state = readBridgeState();
    const saves = state && state.saves ? state.saves : [];
    // 建立房间时优先继续上次选择的线上档；选择失效时自动读取最近的线上档。
    // 只有磁盘上完全没有线上档时才从零创建，避免每次建房产生一个新存档。
    const selectedExists = selectedSaveName && saves.some(save => save.name === selectedSaveName);
    if (!selectedExists && saves.length > 0) {
        selectedSaveName = saves[0].name;
        UnityEngine.PlayerPrefs.SetString("MPB.SelectedSave", selectedSaveName);
        UnityEngine.PlayerPrefs.Save();
    }

    if (selectedSaveName && (selectedExists || saves.some(save => save.name === selectedSaveName))) {
        const activeName = activeSaveName(selectedSaveName);
        if (!activeName) { toast(tr("toast.onlineSaveFailed")); return; }
        const sequence = submitBridgeCommandTracked("prepareSave?name=" + encodeURIComponent(selectedSaveName));
        if (sequence < 0) { toast(tr("toast.onlineSaveFailed")); return; }
        waitForBridgeResponse(menu, sequence, result => {
            if (result !== "0") { log("准备线上存档失败，错误码=" + result); toast(tr("toast.onlineSaveFailed")); return; }
            try {
                menu.StartGame();
                waitForGameManager(menu, manager => {
                    // LoadGame 前先固定线上临时名，原版自动保存也不会落入单机 AutoSave。
                    GameManager.SaveName = activeName;
                    manager.LoadGame(activeName);
                    closePanel();
                    log("已载入线上存档: " + selectedSaveName);
                });
            } catch (error) { log("载入线上存档失败: " + error); toast(tr("toast.onlineSaveFailed")); }
        });
        return;
    }

    // 没有选择旧档时始终从游戏的新游戏初始状态开始，绝不复制任何单机存档。
    selectedSaveName = makeOnlineSaveName();
    const activeName = activeSaveName(selectedSaveName);
    UnityEngine.PlayerPrefs.SetString("MPB.SelectedSave", selectedSaveName);
    UnityEngine.PlayerPrefs.Save();
    const sequence = submitBridgeCommandTracked("beginSave?name=" + encodeURIComponent(selectedSaveName));
    if (sequence < 0) { toast(tr("toast.onlineSaveFailed")); return; }
    waitForBridgeResponse(menu, sequence, result => {
        if (result !== "0") { log("创建线上存档会话失败，错误码=" + result); toast(tr("toast.onlineSaveFailed")); return; }
        try {
            menu.StartGame();
            waitForPlayableGame(menu, manager => {
                GameManager.SaveName = activeName;
                manager.SaveGame(activeName);
                // 桥接程序把已经由游戏加密的 MPActive_ 文件再封装成 MPOnline_ 正式档。
                JintCoroutine.WaitForSeconds(menu, 0.6, () => submitBridgeCommand("flushSave"));
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
    UnityEngine.PlayerPrefs.SetString("MPB.Address", address);
    UnityEngine.PlayerPrefs.SetString("MPB.Port", String(port));
    UnityEngine.PlayerPrefs.SetString("MPB.PlayerName", currentPlayerName);
    UnityEngine.PlayerPrefs.Save();
    updateStatusText(tr("status.connectingTo", { address, port }));
    const sequence = submitBridgeCommandTracked("join?address=" + encodeURIComponent(address) + "&port=" + port);
    if (sequence < 0 || !mainMenuInstance) { role = "off"; toast(tr("toast.joinFailed", { code: -1 })); return; }
    waitForBridgeResponse(mainMenuInstance, sequence, result => {
        if (result !== "0") { role = "off"; toast(tr("toast.joinFailed", { code: result })); return; }
        role = "client";
        localNetworkId = -1;
        refreshOnlineUiMode();
    });
}

function stopFromUi(): void {
    try { bridgeCall("stop"); } catch (_error) { }
    role = "off";
    localNetworkId = -1;
    clearRemotePlayers();
    outgoingMessages.splice(0, outgoingMessages.length);
    refreshOnlineUiMode();
    updateStatusText(tr("status.offline"));
    toast(tr("toast.stopped"));
}

function send(peerId: number, message: any): void {
    // PlayerPrefs 是单槽 IPC，连续写入会覆盖尚未被桥接程序读取的命令，因此先进入游戏侧队列。
    const data = JSON.stringify(message);
    if (outgoingMessages.length >= 256) outgoingMessages.shift();
    outgoingMessages.push({ peerId, data });
}

function flushOutgoingMessage(): void {
    if (!bridgeAvailable || outgoingMessages.length === 0) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (now < nextOutgoingMessageAt) return;
    nextOutgoingMessageAt = now + OUTGOING_MESSAGE_INTERVAL;
    const item = outgoingMessages.shift();
    if (!item) return;
    // peerId=0 在房主模式下表示向全部客户端广播。
    const result = bridgeCall("send?peer=" + item.peerId + "&data=" + encodeURIComponent(item.data));
    if (result !== "0") log("发送失败，错误码=" + result);
}

function finiteNumber(value: any, fallback = 0): number {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function validPlayerState(packet: any): packet is PlayerStatePacket {
    return packet && packet.type === "playerState" && Number.isInteger(Number(packet.ownerId)) &&
        Number.isInteger(Number(packet.sequence)) && Number(packet.sequence) >= 0 &&
        packet.position && packet.rotation && packet.move && typeof packet.scene === "string" &&
        packet.scene.length <= 128 && String(packet.playerName || "").length <= 64 &&
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

function destroyRemotePlayer(ownerId: number): void {
    const key = String(ownerId);
    const remote = remotePlayers[key];
    if (!remote) return;
    try { if (remote.root) UnityEngine.Object.Destroy(remote.root); } catch (_error) { }
    delete remotePlayers[key];
}

function applyRemoteAppearance(clone: UnityEngine.GameObject, profile: PlayerProfile | undefined): void {
    if (!profile) return;
    try {
        const clonedPlayer = clone.GetComponent("Player") as Player;
        const cloths = clonedPlayer && clonedPlayer.cloth ? clonedPlayer.cloth.All : null;
        const dressed: Record<string, boolean> = {};
        for (const id of profile.cloth) dressed[String(id)] = true;
        if (cloths) {
            for (const id of Object.keys(cloths)) {
                const dress = cloths[id];
                if (dress && dress.gameObject) dress.gameObject.SetActive(Boolean(dressed[id]));
            }
        }

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

function clearRemotePlayers(): void {
    for (const key of Object.keys(remotePlayers)) destroyRemotePlayer(Number(key));
    for (const key of Object.keys(lastRemoteSequences)) delete lastRemoteSequences[key];
    for (const key of Object.keys(remoteProfiles)) delete remoteProfiles[key];
    for (const key of Object.keys(remoteProfileRevisions)) delete remoteProfileRevisions[key];
    for (const key of Object.keys(latestPlayerStates)) delete latestPlayerStates[key];
}

function stripRemoteNode(node: UnityEngine.Transform): void {
    const go = node.gameObject;
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
        // Player 预制体内含全部未使用服装和发型。远端只保留当前可见分支，避免每个玩家
        // 克隆上千个无效节点，也避免对这些永远不会显示的节点逐个执行组件查询。
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
    let clone: UnityEngine.GameObject | null = null;
    try {
        // inactive 对象被 Instantiate 时不会执行克隆脚本的 Awake；先剥离逻辑组件再激活。
        if (wasActive) source.SetActive(false);
        clone = UnityEngine.Object.Instantiate(source) as UnityEngine.GameObject;
        clone.name = "MPB_RemotePlayer_" + packet.ownerId;
        const animator = clone.GetComponent("Animator") as UnityEngine.Animator;
        if (!animator) throw new Error("远端玩家克隆体缺少 Animator");
        log("正在准备远端玩家可视模型: " + String(packet.playerName || packet.ownerId));
        // 剥离脚本和未启用节点之前，按该玩家的资料启用衣服、发型和脸型。
        applyRemoteAppearance(clone, remoteProfiles[String(packet.ownerId)]);
        stripRemoteClone(clone, animator);
        animator.applyRootMotion = false;
        clone.transform.position = new UnityEngine.Vector3(packet.position.x, packet.position.y, packet.position.z);
        clone.transform.rotation = new UnityEngine.Quaternion(packet.rotation.x, packet.rotation.y, packet.rotation.z, packet.rotation.w);
        clone.SetActive(true);
        const remote: RemotePlayer = {
            id: packet.ownerId,
            name: String(packet.playerName || "Player"),
            root: clone,
            animator,
            targetPosition: clone.transform.position,
            targetRotation: clone.transform.rotation,
            lastSeen: Number(UnityEngine.Time.unscaledTime),
            animationHash: 0
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
        destroyRemotePlayer(packet.ownerId);
        return;
    }
    let remote = remotePlayers[String(packet.ownerId)] || createRemotePlayer(packet);
    if (!remote) return;
    remote.name = String(packet.playerName || remote.name);
    remote.lastSeen = Number(UnityEngine.Time.unscaledTime);
    remote.targetPosition = new UnityEngine.Vector3(packet.position.x, packet.position.y, packet.position.z);
    remote.targetRotation = new UnityEngine.Quaternion(packet.rotation.x, packet.rotation.y, packet.rotation.z, packet.rotation.w);
    try {
        const distance = UnityEngine.Vector3.Distance(remote.root.transform.position, remote.targetPosition);
        if (distance > 8) remote.root.transform.position = remote.targetPosition;
        remote.animator.SetFloat("Speed", Math.sqrt(packet.move.x * packet.move.x + packet.move.z * packet.move.z));
        remote.animator.SetBool("Grounded", packet.grounded);
        remote.animator.SetBool("OnGround", packet.grounded);
        remote.animator.SetInteger("Action", Math.trunc(packet.action));
        remote.animator.SetInteger("HandAction", Math.trunc(packet.handAction));
        remote.animator.SetInteger("StateID", Math.trunc(packet.stateId));
        remote.animator.SetInteger("Attack", Math.trunc(packet.attack));
        remote.animator.SetInteger("Weapon", Math.trunc(packet.weapon));
        if (packet.animationHash && packet.animationHash !== remote.animationHash) {
            remote.animator.Play(Math.trunc(packet.animationHash), 0, Math.max(0, packet.animationTime % 1));
            remote.animationHash = packet.animationHash;
        }
    } catch (error) { log("更新远端玩家动作失败: " + error); }
}

function applyRemotePlayerProfile(packet: PlayerProfilePacket): void {
    if (!validPlayerProfile(packet) || packet.ownerId === localNetworkId) return;
    const key = String(packet.ownerId);
    const revision = Math.trunc(Number(packet.revision));
    if (remoteProfileRevisions[key] !== undefined && revision <= remoteProfileRevisions[key]) return;
    remoteProfileRevisions[key] = revision;
    remoteProfiles[key] = packet.profile;
    // 外观节点在克隆时裁剪。资料变化后重建一次模型，确保换装和捏脸立即生效。
    if (remotePlayers[key]) destroyRemotePlayer(packet.ownerId);
    const state = latestPlayerStates[key];
    if (state) createRemotePlayer(state);
    log("已同步玩家衣服和个人进度: " + String(packet.playerName || packet.ownerId));
}

function captureLocalPlayerProfile(): PlayerProfile | null {
    try {
        const manager = GameManager.Singleton;
        if (!manager || !GameManager.InGame) return null;
        const data = JSON.parse(manager.GetSave() || "{}");
        const progress: Record<string, any> = {};
        // 这些字段覆盖角色状态、任务、事件条件、服装解锁、性经历与全部个人进度旗标。
        const progressKeys = ["PlayerStatusData", "SexData", "Quests", "ConditionSave", "UnlockedCloth", "PlayerHelper", "FirstExperience"];
        for (const key of progressKeys) if (data[key] !== undefined) progress[key] = data[key];
        for (const key of Object.keys(data)) if (key.startsWith("PlayFlag")) progress[key] = data[key];
        return {
            cloth: Array.isArray(data.Cloth) ? data.Cloth.map((id: any) => String(id)).slice(0, 128) : [],
            customization: data.CustomizationData && typeof data.CustomizationData === "object" ? data.CustomizationData : {},
            progress
        };
    } catch (error) {
        log("采集玩家衣服和个人进度失败: " + error);
        return null;
    }
}

function sendLocalPlayerProfile(): void {
    if (!bridgeAvailable || role === "off" || localNetworkId < 0) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (now < nextPlayerProfileAt) return;
    nextPlayerProfileAt = now + PLAYER_PROFILE_INTERVAL;
    const profile = captureLocalPlayerProfile();
    if (!profile) return;
    const json = JSON.stringify(profile);
    if (json === lastLocalProfileJson) return;
    // 留出协议包头余量；正常个人进度只有数 KB，异常膨胀时拒绝超过网络层 64 KiB 上限。
    if (json.length > 56000) { log("个人进度包过大，已跳过本次同步: " + json.length); return; }
    lastLocalProfileJson = json;
    send(0, {
        type: "playerProfile", ownerId: localNetworkId, playerName: currentPlayerName,
        revision: ++localProfileRevision, profile
    } as PlayerProfilePacket);
}

function captureLocalPlayerState(player: Player): PlayerStatePacket | null {
    if (!player || !player.animator || !GameManager.InGame || localNetworkId < 0) return null;
    try {
        const position = player.transform.position;
        const rotation = player.transform.rotation;
        const move = player.movment ? player.movment.MoveLrep : new UnityEngine.Vector3(0, 0, 0);
        const animation = player.animator.GetCurrentAnimatorStateInfo(0);
        let weapon = 0;
        try { weapon = player.status && player.status.Data ? Number(player.status.Data.selectedWeapon) : 0; } catch (_error) { }
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
            action: player.action ? finiteNumber(player.action.Action) : 0,
            handAction: player.action ? finiteNumber(player.action.handAction) : 0,
            stateId: player.action ? finiteNumber(player.action.stateID) : 0,
            attack: player.action ? finiteNumber(player.action.attack) : 0,
            weapon,
            animationHash: finiteNumber(animation.fullPathHash),
            animationTime: finiteNumber(animation.normalizedTime)
        };
    } catch (error) {
        log("采集本地玩家状态失败: " + error);
        return null;
    }
}

function sendLocalPlayerState(player: Player): void {
    if (!bridgeAvailable || role === "off" || localNetworkId < 0) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (now < nextPlayerStateAt) return;
    nextPlayerStateAt = now + PLAYER_STATE_INTERVAL;
    const packet = captureLocalPlayerState(player);
    if (packet) send(0, packet);
}

function updateRemotePlayers(): void {
    const now = Number(UnityEngine.Time.unscaledTime);
    const blend = Math.min(1, Number(UnityEngine.Time.unscaledDeltaTime) * 12);
    for (const key of Object.keys(remotePlayers)) {
        const remote = remotePlayers[key];
        if (!remote.root || now - remote.lastSeen > REMOTE_PLAYER_TIMEOUT) {
            destroyRemotePlayer(Number(key));
            continue;
        }
        remote.root.transform.position = UnityEngine.Vector3.Lerp(remote.root.transform.position, remote.targetPosition, blend);
        remote.root.transform.rotation = UnityEngine.Quaternion.Slerp(remote.root.transform.rotation, remote.targetRotation, blend);
    }
}

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
            peerNames[String(event.peerId)] = String(packet.playerName || "Player");
            send(event.peerId, { type: "welcome", protocol: PROTOCOL_VERSION, peerId: event.peerId });
            // 新玩家需要立即收到房主和已在线玩家的完整外观/个人进度，而不是等待资料变化。
            lastLocalProfileJson = "";
            for (const ownerKey of Object.keys(remoteProfiles)) {
                send(event.peerId, {
                    type: "playerProfile", ownerId: Number(ownerKey),
                    playerName: peerNames[ownerKey] || "Player", revision: 1, profile: remoteProfiles[ownerKey]
                });
            }
            toast(tr("toast.playerJoined", { player: packet.playerName }));
        } else if (role === "client" && packet.type === "welcome") {
            if (packet.protocol !== PROTOCOL_VERSION) return;
            localNetworkId = Math.trunc(Number(packet.peerId));
            lastLocalProfileJson = "";
            toast(tr("toast.joinedRoom", { peer: packet.peerId }));
        } else if (packet.type === "playerState" && validPlayerState(packet)) {
            if (role === "host") {
                packet.ownerId = Math.trunc(Number(event.peerId));
                packet.playerName = peerNames[String(event.peerId)] || String(packet.playerName || "Player");
                applyRemotePlayerState(packet);
                // 房主是星型拓扑中心：转发后客户端之间也能互相看到。
                send(0, packet);
            } else applyRemotePlayerState(packet);
        } else if (packet.type === "playerProfile" && validPlayerProfile(packet)) {
            if (role === "host") {
                packet.ownerId = Math.trunc(Number(event.peerId));
                packet.playerName = peerNames[String(event.peerId)] || String(packet.playerName || "Player");
                applyRemotePlayerProfile(packet);
                send(0, packet);
            } else applyRemotePlayerProfile(packet);
        } else if (packet.type === "playerLeft") {
            destroyRemotePlayer(Math.trunc(Number(packet.ownerId)));
            delete remoteProfiles[String(packet.ownerId)];
            delete remoteProfileRevisions[String(packet.ownerId)];
            delete latestPlayerStates[String(packet.ownerId)];
            delete lastRemoteSequences[String(packet.ownerId)];
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
            send(0, { type: "playerLeft", ownerId: Number(event.peerId) });
        } else {
            localNetworkId = -1;
            clearRemotePlayers();
        }
        updateStatusText();
    }
}

function refreshSaveText(): void {
    if (!uiSave) return;
    if (saveViewState === "needsGame") uiSave.text = tr("save.needsGame");
    else if (saveViewState === "selected") uiSave.text = tr("save.selected", saveViewData);
    else if (saveViewState === "loaded") uiSave.text = tr("save.loaded", saveViewData);
    else if (saveViewState === "error") uiSave.text = tr("save.failed", saveViewData);
    else uiSave.text = tr("save.notRead");
}

function closePanel(): void {
    if (uiSaveList) uiSaveList.SetActive(false);
    if (uiConfigBody) uiConfigBody.SetActive(true);
    if (uiTitle) uiTitle.text = tr("panel.title");
    if (uiPanel) uiPanel.SetActive(false);
}

function showConfigPage(): void {
    if (uiSaveList) uiSaveList.SetActive(false);
    if (uiConfigBody) uiConfigBody.SetActive(true);
    if (uiTitle) uiTitle.text = tr("panel.title");
    refreshOnlineUiMode();
}

function refreshOnlineUiMode(): void {
    const online = role !== "off";
    // 已进入联机后不允许在暂停菜单中切换存档或另建线上档，避免运行中替换世界状态。
    try { if (uiSelectSaveButton) uiSelectSaveButton.SetActive(!online); } catch (_error) { }
    try { if (uiNewOnlineButton) uiNewOnlineButton.SetActive(!online); } catch (_error) { }
}

function openPanel(): void {
    if (!uiPanel) return;
    syncGameLanguage();
    if (uiSaveList) uiSaveList.SetActive(false);
    if (uiConfigBody) uiConfigBody.SetActive(true);
    if (uiTitle) uiTitle.text = tr("panel.title");
    refreshOnlineUiMode();
    uiPanel.SetActive(true);
}

function selectSave(saveName: string): void {
    selectedSaveName = saveName;
    UnityEngine.PlayerPrefs.SetString("MPB.SelectedSave", saveName);
    UnityEngine.PlayerPrefs.Save();
    if (uiSaveList) uiSaveList.SetActive(false);
    if (uiConfigBody) uiConfigBody.SetActive(true);
    if (uiTitle) uiTitle.text = tr("panel.title");

    // 只有游戏当前已经加载了这个存档时才读取明文，避免从主菜单强制切场景引发崩溃。
    if (GameManager.InGame && String(GameManager.SaveName || "") === activeSaveName(saveName)) {
        readCurrentSave();
        return;
    }
    saveViewState = "selected";
    saveViewData = { save: saveName };
    refreshSaveText();
}

function refreshSaveList(): void {
    if (!uiSaveList || !uiFont) return;
    Extensions.RemoveAllChildren(uiSaveList.transform);
    const state = readBridgeState();
    const saves = state && state.saves ? state.saves : [];
    if (!state) {
        makeText(uiSaveList.transform, "Unavailable", tr("save.listUnavailable"), uiFont, 34, 34, 652, 70, 26);
        makeButton(uiSaveList.transform, "Back", tr("button.back"), uiFont, 220, 446, 280, showConfigPage, 54);
        return;
    }
    if (saves.length === 0) {
        makeText(uiSaveList.transform, "Empty", tr("save.noSaves"), uiFont, 34, 34, 652, 70, 26);
        makeButton(uiSaveList.transform, "Back", tr("button.back"), uiFont, 220, 446, 280, showConfigPage, 54);
        return;
    }

    // 原版读取窗口使用三条大行：左侧名称和相对时间，右侧是“读取”按钮。
    const visible = saves.slice(0, 3);
    for (let index = 0; index < visible.length; index++) {
        const save = visible[index];
        const y = 22 + index * 132;
        const marker = save.name === selectedSaveName ? "✓  " : "";
        makeText(uiSaveList.transform, "SaveName_" + index, marker + save.name, uiFont, 34, y, 470, 48, 31);
        makeText(uiSaveList.transform, "SaveAge_" + index, formatSaveAge(save.lastWriteUtcTicks), uiFont, 34, y + 50, 470, 38, 24);
        makeButton(uiSaveList.transform, "SaveLoad_" + index, tr("button.load"), uiFont, 548, y + 17, 138, () => selectSave(save.name), 66);
        if (index < visible.length - 1) makeSolidRect(uiSaveList.transform, "Separator_" + index, new UnityEngine.Color(1, 1, 1, 0.16), 30, y + 113, 656, 2);
    }
    if (saves.length > visible.length) {
        makeText(uiSaveList.transform, "More", tr("save.more", { count: saves.length - visible.length }), uiFont, 34, 410, 652, 30, 18);
    }
    makeButton(uiSaveList.transform, "Back", tr("button.back"), uiFont, 220, 446, 280, showConfigPage, 54);
}

function formatSaveAge(lastWriteUtcTicks: number): string {
    try {
        const unixMilliseconds = Number(lastWriteUtcTicks) / 10000 - 62135596800000;
        const minutes = Math.max(0, Math.floor((Date.now() - unixMilliseconds) / 60000));
        if (minutes < 1) return tr("time.justNow");
        if (minutes < 60) return tr("time.minutesAgo", { count: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return tr("time.hoursAgo", { count: hours });
        return tr("time.daysAgo", { count: Math.floor(hours / 24) });
    } catch (_error) { return ""; }
}

function toggleSaveList(): void {
    if (!uiSaveList) return;
    const opening = !uiSaveList.activeSelf;
    uiSaveList.SetActive(opening);
    if (uiConfigBody) uiConfigBody.SetActive(!opening);
    if (uiTitle) uiTitle.text = opening ? tr("save.listTitle") : tr("panel.title");
    if (opening) refreshSaveList();
}

function readCurrentSave(): void {
    try {
        const manager = GameManager.Singleton;
        if (!manager || !GameManager.InGame) {
            saveViewState = "needsGame";
            saveViewData = {};
            refreshSaveText();
            return;
        }
        // 调用游戏自己的序列化接口，避免直接解密或改写磁盘上的 .save 文件。
        const plaintext = manager.GetSave();
        if (!plaintext) throw new Error("游戏返回了空存档");
        const data = JSON.parse(plaintext);
        const player = data.PlayerStatusData || {};
        lastSaveSnapshot = plaintext;
        const saveName = String(GameManager.SaveName || "当前存档");
        const scene = String(data.Scene || GameManager.NowSceneName || "未知");
        const playerName = String(player.playerName || "未知");
        const day = player.day === undefined ? "?" : String(player.day);
        const money = player.money === undefined ? "?" : String(player.money);
        saveViewState = "loaded";
        saveViewData = { save: saveName, player: playerName, day, scene, money, length: plaintext.length };
        refreshSaveText();
        toast(tr("toast.saveRead"));
    } catch (error) {
        lastSaveSnapshot = "";
        saveViewState = "error";
        saveViewData = { error: String(error) };
        refreshSaveText();
        log("存档读取失败: " + error);
    }
}

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

function useDarkPanelText(text: UnityEngine.UI.Text): UnityEngine.UI.Text {
    // 保留旧函数名以减少热更新迁移风险；原版样式统一使用白字黑描边。
    text.color = new UnityEngine.Color(1, 1, 1, 1);
    return text;
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
            NewOnline: "button.newOnline",
            SelectSave: "button.selectSave",
            Back: "button.back",
            Privacy: "privacy",
            Cancel: "button.cancel"
        };
        for (const name of Object.keys(labels)) setChildText(root, name, tr(labels[name]));
        try { if (uiAddress && uiAddress.placeholder) (uiAddress.placeholder as UnityEngine.UI.Text).text = tr("placeholder.address"); } catch (_error) { }
        try { if (uiPort && uiPort.placeholder) (uiPort.placeholder as UnityEngine.UI.Text).text = tr("placeholder.port"); } catch (_error) { }
        try { if (uiName && uiName.placeholder) (uiName.placeholder as UnityEngine.UI.Text).text = tr("placeholder.playerName"); } catch (_error) { }
        if (uiTitle) uiTitle.text = uiSaveList && uiSaveList.activeSelf ? tr("save.listTitle") : tr("panel.title");
        updateStatusText();
        refreshSaveText();
        if (uiSaveList && uiSaveList.activeSelf) refreshSaveList();
    } catch (error) { log("刷新联机界面语言失败: " + error); }
}

// 复制游戏自己的“新建游戏”按钮，因此背景、字体、悬停动画和缩放规则都与原界面一致。
function buildMainMenuButton(menu: MainMenu): void {
    if (!menu.newGame || !menu.newGame.gameObject || !uiPanel) return;
    let stage = "准备";
    try {
        const parent = menu.newGame.transform.parent;
        const old = findNamedChild(parent, MENU_BUTTON_NAME);
        if (old) UnityEngine.Object.Destroy(old.gameObject);

        // Jint 对 Unity 的三参数 Instantiate 重载解析不稳定；两参数版本与现有 Mod 兼容。
        stage = "复制按钮";
        const cloned = UnityEngine.Object.Instantiate(menu.newGame.gameObject, parent) as UnityEngine.GameObject;
        cloned.name = MENU_BUTTON_NAME;
        stage = "读取 Button 组件";
        const button = cloned.GetComponent("Button") as UnityEngine.UI.Button;
        if (!button) throw new Error("复制后的按钮缺少 Button 组件");
        stage = "清除旧点击事件";
        try { button.onClick.RemoveAllListeners(); } catch (error) { log("清除复制按钮事件失败，将继续覆盖: " + error); }
        const onClick = () => {
            if (!isCurrentGeneration() || !uiPanel) return;
            const opening = !uiPanel.activeSelf;
            if (opening) openPanel();
            else closePanel();
            if (!opening && uiSaveList) uiSaveList.SetActive(false);
        };
        stage = "添加联机点击事件";
        let listenerAdded = false;
        try { button.onClick.AddListener(onClick); listenerAdded = true; } catch (_error) { }
        if (!listenerAdded) {
            try { Extensions.SetListener(button.onClick, onClick); listenerAdded = true; } catch (_error) { }
        }
        if (!listenerAdded) throw new Error("无法绑定联机按钮点击事件");

        stage = "修改按钮文字";
        const label = findTextInChildren(cloned.transform);
        if (label) label.text = tr("menu.multiplayer");

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
function buildPauseMenuButton(pause: PauseWindow): void {
    if (!pause.setting || !pause.setting.gameObject) return;
    let stage = "准备";
    try {
        const parent = pause.setting.transform.parent;
        const old = findNamedChild(parent, PAUSE_BUTTON_NAME);
        if (old) UnityEngine.Object.Destroy(old.gameObject);

        stage = "复制设置按钮";
        const cloned = UnityEngine.Object.Instantiate(pause.setting.gameObject, parent) as UnityEngine.GameObject;
        cloned.name = PAUSE_BUTTON_NAME;
        const button = cloned.GetComponent("Button") as UnityEngine.UI.Button;
        if (!button) throw new Error("复制后的按钮缺少 Button 组件");
        try { button.onClick.RemoveAllListeners(); } catch (_error) { }

        stage = "绑定打开事件";
        const onClick = () => { if (isCurrentGeneration()) openPanel(); };
        let listenerAdded = false;
        try { button.onClick.AddListener(onClick); listenerAdded = true; } catch (_error) { }
        if (!listenerAdded) {
            try { Extensions.SetListener(button.onClick, onClick); listenerAdded = true; } catch (_error) { }
        }
        if (!listenerAdded) throw new Error("无法绑定暂停菜单联机按钮");

        const label = findTextInChildren(cloned.transform);
        if (label) label.text = tr("menu.multiplayer");

        stage = "重新排列暂停菜单";
        cloned.transform.SetSiblingIndex(pause.setting.transform.GetSiblingIndex() + 1);
        // 原菜单的五个按钮已经占满竖向空间。插入“联机”后，把六个按钮等距放进
        // 原来“设置”到“退出”的世界坐标范围。原版按钮分属不同容器，不能比较 anchoredPosition。
        const startPosition = pause.setting.transform.position;
        const endPosition = pause.exit.transform.position;
        const orderedButtons: UnityEngine.UI.Button[] = [
            pause.setting, button, pause.load, pause.secret, pause.bugFeedback, pause.exit
        ];
        const stepY = (endPosition.y - startPosition.y) / (orderedButtons.length - 1);
        for (let index = 0; index < orderedButtons.length; index++) {
            const itemTransform = orderedButtons[index].transform;
            const current = itemTransform.position;
            itemTransform.position = new UnityEngine.Vector3(
                current.x,
                startPosition.y + stepY * index,
                current.z
            );
        }
        cloned.SetActive(true);
        uiPauseButton = cloned;
        log("已在 ESC 暂停菜单中创建原生样式的“联机”按钮，并重新等距排列菜单");
    } catch (error) {
        uiPauseButton = null;
        log("创建暂停菜单联机按钮失败（" + stage + "）: " + error);
    }
}

function buildUi(font: any): void {
    if (!font || uiRoot) return;
    try {
        const old = UnityEngine.GameObject.Find(UI_ROOT_NAME);
        if (old) UnityEngine.Object.Destroy(old);

        const config = loadConfig();
        // 使用独立的顶层 Canvas，确保联机面板不会被游戏窗口遮挡或裁剪。
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
        uiRoot = root;
        uiFont = font;
        selectedSaveName = UnityEngine.PlayerPrefs.GetString("MPB.SelectedSave", "");

        const panel = uiObject("Panel", root.transform);
        // 原版读取窗口采用竖向居中的窄面板；anchor、pivot 固定在屏幕中心。
        rect(panel, 0.5, 0.5, 0, 0, 760, 720);
        const panelImage = panel.AddComponent("Image");
        panelImage.color = new UnityEngine.Color(0, 0, 0, 0);
        uiPanel = panel;

        uiTitle = makeText(panel.transform, "Title", tr("panel.title"), font, 80, 4, 600, 72, 44);
        (uiTitle as any).alignment = 4;

        // 半透明灰黑内容区和四角白色框线来自原版“读取”窗口的视觉语言。
        const configBody = uiObject("ConfigBody", panel.transform);
        rect(configBody, 0, 1, 20, -92, 720, 520);
        const bodyImage = configBody.AddComponent("Image");
        bodyImage.color = new UnityEngine.Color(0.34, 0.34, 0.34, 0.58);
        uiConfigBody = configBody;
        addOriginalFrameCorners(panel.transform, 12, 84, 736, 536);

        uiStatus = makeText(configBody.transform, "Status", statusLabel(), font, 30, 18, 660, 46, 27);
        (uiStatus as any).alignment = 4;
        makeText(configBody.transform, "AddressLabel", tr("field.address"), font, 30, 78, 135, 46, 24);
        makeText(configBody.transform, "PortLabel", tr("field.port"), font, 440, 78, 72, 46, 24);
        uiAddress = makeInput(configBody.transform, "Address", UnityEngine.PlayerPrefs.GetString("MPB.Address", config.address), tr("placeholder.address"), font, 170, 76, 250);
        uiPort = makeInput(configBody.transform, "Port", UnityEngine.PlayerPrefs.GetString("MPB.Port", String(config.port)), tr("placeholder.port"), font, 520, 76, 170);
        makeText(configBody.transform, "NameLabel", tr("field.playerName"), font, 30, 136, 135, 46, 24);
        uiName = makeInput(configBody.transform, "PlayerName", UnityEngine.PlayerPrefs.GetString("MPB.PlayerName", config.playerName), tr("placeholder.playerName"), font, 170, 134, 520);

        makeButton(configBody.transform, "Host", tr("button.host"), font, 30, 202, 205, startHostFromUi, 56);
        makeButton(configBody.transform, "Join", tr("button.join"), font, 257, 202, 205, joinFromUi, 56);
        makeButton(configBody.transform, "Stop", tr("button.stop"), font, 484, 202, 205, stopFromUi, 56);
        uiNewOnlineButton = makeButton(configBody.transform, "NewOnline", tr("button.newOnline"), font, 30, 280, 310, chooseNewOnlineSave, 56);
        uiSelectSaveButton = makeButton(configBody.transform, "SelectSave", tr("button.selectSave"), font, 380, 280, 310, toggleSaveList, 56);
        makeText(configBody.transform, "Privacy", tr("privacy"), font, 30, 350, 660, 54, 20);
        uiSave = makeText(configBody.transform, "Save", tr("save.notRead"), font, 30, 410, 660, 88, 23);
        (uiSave as any).alignment = 0;

        // 存档列表沿用原版读取界面的三行布局，切换时隐藏配置内容以免文字叠加。
        const saveList = uiObject("SaveList", panel.transform);
        rect(saveList, 0, 1, 20, -92, 720, 520);
        const saveListImage = saveList.AddComponent("Image");
        saveListImage.color = new UnityEngine.Color(0.34, 0.34, 0.34, 0.64);
        uiSaveList = saveList;
        saveList.SetActive(false);
        refreshOnlineUiMode();

        makeButton(panel.transform, "Cancel", tr("button.cancel"), font, 130, 640, 500, closePanel, 64);
        panel.SetActive(false);
        log("游戏内联机界面已创建：原版读取窗口样式、半透明灰黑面板和白色四角框线");
    } catch (error) {
        uiRoot = null;
        log("创建联机界面失败: " + error);
    }
}

function handleUiInput(): void {
    try {
        if (uiPanel && uiPanel.activeSelf && Input.GetKeyDown(KeyCode.Escape)) closePanel();
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

function ensureUi(font?: any): void {
    if (uiRoot || !isCurrentGeneration()) return;
    const inheritedFont = font || findOldUiFont();
    if (inheritedFont) buildUi(inheritedFont);
}

function updateBridge(player: Player | null): void {
    if (!isCurrentGeneration()) return;
    handleUiInput();
    syncGameLanguage();
    startBridge();
    ensureUi();
    updateFrames += 1;
    if (updateFrames % 120 === 0) updateStatusText();
    updateRemotePlayers();
    if (!bridgeAvailable || role === "off") return;
    // Unity 在 timeScale=0 时仍执行 Update。联机 ESC 菜单一旦把原版 Paused 置为 true，
    // 下一帧立即恢复世界时间，同时保留暂停菜单窗口本身。
    try { if (GameManager.Paused) GameManager.PauseGame(false); } catch (_error) { }
    // 每帧最多处理 32 个事件，防止网络洪峰长时间占用 Unity 主线程。
    for (let index = 0; index < 32; index++) {
        try {
            const eventJson = bridgeCall("poll");
            if (!eventJson) break;
            processEvent(eventJson);
        } catch (error) {
            log("轮询网络桥接失败: " + error);
            role = "off";
            break;
        }
    }
    if (player) {
        sendLocalPlayerState(player);
        sendLocalPlayerProfile();
    }
    flushOutgoingMessage();
}

// 原版退出按钮的回调执行前，先用游戏自己的 SaveGame 完成同步保存。
// 联机档随后通知桥接程序立即套上 Mod 的第二层加密；回调返回后才继续原版退出流程。
function saveBeforeGameExit(): boolean {
    if (exitSaveInProgress || !GameManager.InGame) return true;
    exitSaveInProgress = true;
    try {
        const manager = GameManager.Singleton;
        if (!manager) throw new Error("GameManager 尚未初始化");
        let saveName = String(GameManager.SaveName || "").trim() || "AutoSave";
        // 联机退出绝不允许写到 AutoSave 或玩家手动创建的单机槽位。
        if (role !== "off") {
            const onlineActiveName = activeSaveName(selectedSaveName);
            if (onlineActiveName) saveName = onlineActiveName;
            if (!saveName.startsWith(ACTIVE_SAVE_PREFIX)) throw new Error("没有有效的线上临时存档名");
            GameManager.SaveName = saveName;
        }
        manager.SaveGame(saveName);
        if (bridgeAvailable && saveName.startsWith(ACTIVE_SAVE_PREFIX)) bridgeCall("flushSave");
        log("退出前已自动保存: " + saveName);
        return true;
    } catch (error) {
        log("退出前自动保存失败: " + error);
        toast(tr("toast.exitSaveFailed"));
        return false;
    } finally {
        exitSaveInProgress = false;
    }
}

// Player.Update 是进入存档后的稳定逐帧入口，用于处理网络队列和刷新界面状态。
RegisterHook("System.Void Player::Update()", (self: Player) => { updateBridge(self); });
// PauseWindow.Start 的原生初始化完成后，在下一帧复制“设置”按钮，避免覆盖游戏自己的监听器。
RegisterHook("System.Void PauseWindow::Start()", (self: PauseWindow) => {
    if (!isCurrentGeneration()) return;
    JintCoroutine.WaitForNextFrame(self, () => {
        if (!isCurrentGeneration()) return;
        try {
            const nativeLabel = self.setting ? findTextInChildren(self.setting.transform) : null;
            ensureUi(nativeLabel ? (nativeLabel as any).font : null);
            buildPauseMenuButton(self);
            // 联机暂停菜单只打开 UI，不冻结世界时间；其他玩家和网络状态继续更新。
            if (role !== "off") GameManager.PauseGame(false);
            syncGameLanguage();
        } catch (error) { log("暂停菜单 UI 初始化失败: " + error); }
    });
});
// PauseWindow.Start 会把此闭包绑定到原版 Exit 按钮；钩子先运行，随后保留原版退出行为。
RegisterHook("System.Void PauseWindow::<Start>b__9_3()", (_self: any, ctx: IHookContext) => {
    if (isCurrentGeneration() && !saveBeforeGameExit()) ctx.Intercept();
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
    if (!config.smokeTestAutoLoad || smokeTestScheduled) return;
    smokeTestScheduled = true;
    log("诊断模式：等待主菜单初始化");
    JintCoroutine.WaitForSeconds(self, 2, () => {
        if (!isCurrentGeneration()) return;
        try {
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
