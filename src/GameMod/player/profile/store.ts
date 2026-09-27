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
    log("Received complete player save-profile snapshot" + (appearanceChanged ? " and refreshed appearance" : "") + ": " +
        String(packet.playerName || packet.ownerId));
    refreshPlayerInfoUi();
}

