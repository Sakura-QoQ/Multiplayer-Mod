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
                    log("Attached to the running multiplayer bridge without requesting another launch");
                }
            } catch (_error) { }
        }
        if (bridgeLaunchAttempted) {
            // 继续向下读取当前 hosting/connected 状态，恢复房主或客户端角色。
        } else {
        initialized = true;
        bridgeStartupGraceFrames = 60;
        launchBundledBridge();
        log("The multiplayer bridge is not running yet; waiting for the bundled bridge to start");
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
        log("The multiplayer bridge is not running yet; waiting for the bundled bridge to start");
        return;
    }

    const config = loadConfig();
    currentPlayerName = UnityEngine.PlayerPrefs.GetString(prefKey("MPB.PlayerName"), config.playerName);
    // 原生网络层不会因为场景切换而卸载，因此新一代脚本应接管现有连接，而不是重新连接。
    const existing = readBridgeStatus();
    if (existing.state === "hosting") {
        role = "host";
        localNetworkId = 0;
        log("Reattached to the host connection from the previous scene on port " + existing.port);
        return;
    }
    if (existing.state === "connecting" || existing.state === "connected") {
        role = "client";
        localNetworkId = -1;
        log("Reattached to the client connection from the previous scene");
        // 场景切换会重新载入脚本；重新握手可恢复本代脚本丢失的 peerId 和玩家名映射。
        if (existing.state === "connected") send(0, { type: "hello", protocol: PROTOCOL_VERSION, playerName: currentPlayerName });
        return;
    }

    role = config.mode;
    if (role === "off") { log("Loaded; use the Multiplayer button above New Game"); return; }
    const result = role === "host"
        ? bridgeCall("host?port=" + config.port + "&max=" + config.maxPlayers)
        : bridgeCall("join?address=" + encodeURIComponent(config.address) + "&port=" + config.port);
    if (result !== "0") { log("Failed to start the network bridge; error code=" + result); role = "off"; return; }
    localNetworkId = role === "host" ? 0 : -1;
    log(role === "host" ? "Listening on 0.0.0.0:" + config.port : "Connecting to " + config.address + ":" + config.port);
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

