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

