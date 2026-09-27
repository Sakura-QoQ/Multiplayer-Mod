// 网络配置。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function loadConfig(): MultiplayerConfig {
    const defaults: MultiplayerConfig = { mode: "off", address: "", port: 27777, maxPlayers: 8,
        playerName: "Player", roomId: "fallen-flower", roomKey: "", smokeTestAutoLoad: false, smokeTestUiOpen: false, smokeTestMotion: false,
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
            roomId: typeof parsed.roomId === "string" ? parsed.roomId : defaults.roomId,
            roomKey: typeof parsed.roomKey === "string" ? parsed.roomKey : defaults.roomKey,
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
        log("Failed to read config.json: " + error);
        return defaults;
    }
}

function readBridgeStatus(): BridgeStatus {
    try {
        const state = readBridgeState();
        if (!bridgeStateIsFresh(state)) return { state: "unavailable", port: 0, peers: 0,
            transport: "direct", localPeerId: 0, authorityPeerId: 0 };
        const parsed = JSON.parse(bridgeCall("status"));
        return {
            state: typeof parsed.state === "string" ? parsed.state : "unknown",
            port: Number(parsed.port) || 0,
            peers: Number(parsed.peers) || 0,
            transport: typeof parsed.transport === "string" ? parsed.transport : "direct",
            localPeerId: Number(parsed.localPeerId) || 0,
            authorityPeerId: Number(parsed.authorityPeerId) || 0
        };
    } catch (_error) {
        return { state: bridgeAvailable ? "stopped" : "unavailable", port: 0, peers: 0,
            transport: "direct", localPeerId: 0, authorityPeerId: 0 };
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

