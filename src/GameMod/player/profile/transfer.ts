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

