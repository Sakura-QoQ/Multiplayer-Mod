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
                log("Restored online-save scene position: " + metadata.scene + " target=" +
                    target.x.toFixed(4) + "," + target.y.toFixed(4) + "," + target.z.toFixed(4));
            }
        } catch (error) { log("Failed to restore the online-save position: " + error); }
        if (onApplied) onApplied();
    };
    if (metadata && metadata.scene && String(GameManager.NowSceneName || "") !== metadata.scene) {
        try { GameManager.MoveToScene(metadata.scene, applyTransform); return; }
        catch (error) { log("Failed to restore the online-save scene: " + error); }
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
            log("Waiting for the test-channel bridge: " + BRIDGE_CHANNEL);
            return;
        }
        // 启动器会给每个 Mod 提供 __dirname；这样即使玩家修改文件夹名称，也能找到随包桥接程序。
        let modDirectory = String(typeof __dirname !== "undefined" ? __dirname : "").replace(/\\/g, "/");
        if (!modDirectory) {
            // 兼容没有注入 __dirname 的旧版启动器，退回游戏默认 Mods 目录。
            const dataPath = String(UnityEngine.Application.dataPath || "").replace(/\\/g, "/");
            const separator = dataPath.lastIndexOf("/");
            if (separator <= 0) throw new Error("Could not determine the game root directory: " + dataPath);
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
            log("Direct bridge launch with standard user privileges failed; using the compatibility launcher: " + error);
        }
        if (!startedDirectly) UnityEngine.Application.OpenURL(bridgePath);
        UnityEngine.PlayerPrefs.SetInt(BRIDGE_STATE_READY_KEY, 1);
        UnityEngine.PlayerPrefs.Save();
        log("Started the bridge with standard user privileges: " + bridgePath);
    } catch (error) {
        log("Failed to start the bridge automatically: " + error);
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
        log("Failed to submit a bridge command: " + error);
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
