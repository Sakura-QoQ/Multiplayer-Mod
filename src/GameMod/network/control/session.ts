// 建房与会话控制。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function startBridge(): void {
    // ReadModFile 对不存在的文件会抛出启动器宿主异常，Jint 的 try/catch 无法可靠截获。
    // 因此首次进入时先启动单例桥接程序，等待它创建 state.json 后再读取。
    if (!bridgeLaunchAttempted) {
        initialized = true;
        bridgeStartupGraceFrames = 60;
        launchBundledBridge();
        log("The multiplayer bridge is not running yet; waiting for the bundled bridge to start");
        return;
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
    // 原生网络层不会因为场景切换而卸载，因此新一代脚本应接管现有连接，而不是重新连接。
    const existing = readBridgeStatus();
    currentPlayerName = existing.playerName || config.playerName;
    currentPublicRoom = existing.roomId || currentPublicRoom;
    networkTransport = existing.transport === "server" ? "server" : "direct";
    if (existing.state === "hosting") {
        role = "host";
        localNetworkId = 0;
        log("Reattached to the host connection from the previous scene on port " + existing.port);
        return;
    }
    if (existing.state === "connecting" || existing.state === "connected") {
        role = "client";
        localNetworkId = networkTransport === "server" ? existing.localPeerId : -1;
        log("Reattached to the client connection from the previous scene");
        // 场景切换会重新载入脚本；重新握手可恢复本代脚本丢失的 peerId 和玩家名映射。
        if (existing.state === "connected") send(0, { type: "hello", protocol: PROTOCOL_VERSION, playerName: currentPlayerName });
        return;
    }

    role = config.mode;
    if (role === "off") { log("Loaded; use the Multiplayer button above New Game"); return; }
    const result = role === "host"
        ? bridgeCall("host?port=" + config.port + "&max=" + config.localMaxPlayers +
            "&player=" + encodeURIComponent(currentPlayerName))
        : bridgeCall("join?address=" + encodeURIComponent(config.address) + "&port=" + config.port +
            "&player=" + encodeURIComponent(currentPlayerName));
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

function enterPublicRoomFromUi(roomId: string): void {
    if (!bridgeAvailable) { toast(tr("toast.runtimeMissing")); return; }
    const config = loadConfig();
    currentPlayerName = valueOr(uiName, config.playerName);
    role = "client";
    networkTransport = "server";
    currentPublicRoom = roomId;
    localNetworkId = -1;
    clientEntryStarted = false;
    const selectedRoom = publicRoomEntries.find(item => item.roomId === roomId) || null;
    updateStatusText(tr("status.enteringPublicRoom", { room: publicRoomDisplayName(selectedRoom, roomId) }));
    const command = "publicEnter?room=" + encodeURIComponent(roomId) +
        "&player=" + encodeURIComponent(currentPlayerName);
    const sequence = submitBridgeCommandTracked(command);
    if (sequence < 0 || !mainMenuInstance) { role = "off"; toast(tr("toast.publicRoomFailed", { code: -1 })); return; }
    waitForBridgeResponse(mainMenuInstance, sequence, result => {
        if (result !== "0") {
            role = "off";
            networkTransport = "direct";
            toast(tr("toast.publicRoomFailed", { code: result }));
        }
    });
}

function startHostFromUi(): void {
    if (!bridgeAvailable) { toast(tr("toast.runtimeMissing")); return; }
    const config = loadConfig();
    const port = Number(valueOr(uiPort, String(config.port)));
    currentPlayerName = valueOr(uiName, config.playerName);
    if (!Number.isInteger(port) || port < 1 || port > 65535) { toast(tr("toast.invalidPort")); return; }
    networkTransport = "direct";
    updateStatusText(tr("status.startingHost", { port }));
    const sequence = submitBridgeCommandTracked("host?port=" + port + "&max=" + config.localMaxPlayers +
        "&player=" + encodeURIComponent(currentPlayerName));
    if (sequence < 0 || !mainMenuInstance) { role = "off"; toast(tr("toast.hostFailed", { code: -1 })); return; }
    waitForBridgeResponse(mainMenuInstance, sequence, result => {
        if (result !== "0") { role = "off"; toast(tr("toast.hostFailed", { code: result })); return; }
        role = "host";
        localNetworkId = 0;
        toast(tr("toast.hostStarted", { port }));
        enterOnlineSave();
    });
}

function joinFromUi(): void {
    if (!bridgeAvailable) { toast(tr("toast.runtimeMissing")); return; }
    const config = loadConfig();
    const address = valueOr(uiAddress, config.address);
    const port = Number(valueOr(uiPort, String(config.port)));
    currentPlayerName = valueOr(uiName, config.playerName);
    if (!address) { toast(tr("toast.addressRequired")); return; }
    if (!Number.isInteger(port) || port < 1 || port > 65535) { toast(tr("toast.invalidPort")); return; }
    networkTransport = "direct";
    clientEntryStarted = false;
    updateStatusText(tr("status.connectingTo", { address, port }));
    const sequence = submitBridgeCommandTracked("join?address=" + encodeURIComponent(address) + "&port=" + port +
        "&player=" + encodeURIComponent(currentPlayerName));
    if (sequence < 0 || !mainMenuInstance) { role = "off"; toast(tr("toast.joinFailed", { code: -1 })); return; }
    waitForBridgeResponse(mainMenuInstance, sequence, result => {
        if (result !== "0") { role = "off"; toast(tr("toast.joinFailed", { code: result })); return; }
        role = "client";
        localNetworkId = -1;
    });
}

function requestPublicRoomListFromUi(): void {
    if (!bridgeAvailable) { toast(tr("toast.runtimeMissing")); return; }
    openPanelMode("public");
    updateStatusText(tr("status.loadingPublicRooms"));
    const sequence = submitBridgeCommandTracked("publicList");
    if (sequence < 0) toast(tr("toast.publicRoomListFailed"));
}

function publicRoomDisplayName(entry: PublicRoomEntry | null, roomId: string): string {
    const matched = /^(?:public-)(\d+)$/.exec(roomId);
    if (matched) return tr("publicRoom.number", { number: matched[1] });
    return entry && entry.roomName ? entry.roomName : roomId;
}

function changePublicRoomPage(delta: number): void {
    const maximumPage = Math.max(0, Math.ceil(publicRoomEntries.length / 5) - 1);
    publicRoomPage = Math.max(0, Math.min(maximumPage, publicRoomPage + delta));
    refreshPublicRoomButtons();
}

function refreshPublicRoomButtons(): void {
    if (!uiPublicRoomsBody || !uiFont) return;
    for (const roomId of Object.keys(uiPublicRoomButtons)) {
        const old = uiPublicRoomButtons[roomId];
        if (old) UnityEngine.Object.Destroy(old);
        delete uiPublicRoomButtons[roomId];
    }
    const pageRooms = publicRoomEntries.slice(publicRoomPage * 5, publicRoomPage * 5 + 5);
    for (let index = 0; index < pageRooms.length; index++) {
        const entry = pageRooms[index];
        const label = publicRoomDisplayName(entry, entry.roomId) + "    " +
            tr("publicRoom.players", { players: entry.players, capacity: entry.capacity });
        uiPublicRoomButtons[entry.roomId] = makeButton(uiPublicRoomsBody.transform,
            "PublicRoom_" + entry.roomId, label, uiFont, 55, 88 + index * 66, 610,
            () => enterPublicRoomFromUi(entry.roomId), 56);
    }
    const maximumPage = Math.max(0, Math.ceil(publicRoomEntries.length / 5) - 1);
    if (uiPublicPreviousButton) uiPublicPreviousButton.SetActive(publicRoomPage > 0);
    if (uiPublicNextButton) uiPublicNextButton.SetActive(publicRoomPage < maximumPage);
}

