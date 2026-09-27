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
const GENERATION_OBJECT_NAME = "MPB_ScriptGeneration";
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
// 游戏切换场景时会重新执行 Mod 脚本。用游戏引擎内的常驻对象标识当前脚本代次，
// 避免把 Mod 状态写进 Windows 系统配置。
const previousGenerationObject = UnityEngine.GameObject.Find(GENERATION_OBJECT_NAME);
if (previousGenerationObject) UnityEngine.Object.DestroyImmediate(previousGenerationObject);
const SCRIPT_GENERATION_OBJECT = new UnityEngine.GameObject(GENERATION_OBJECT_NAME);
UnityEngine.Object.DontDestroyOnLoad(SCRIPT_GENERATION_OBJECT);
const SCRIPT_GENERATION = Number(SCRIPT_GENERATION_OBJECT.GetInstanceID());

