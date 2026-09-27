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

function roomPlayerRowsSignature(rows: { id: number; name: string; tag: string }[]): string {
    return rows.map(row => row.id + ":" + row.name + ":" + row.tag).join("|");
}

function formatRoomPlayerRows(rows: { id: number; name: string; tag: string }[]): string {
    return rows.map(row => "• " + row.name + (row.tag ? "  " + row.tag : "")).join("\n");
}

function refreshPlayerListUi(force = false): void {
    if (!uiPlayerListTitle || !uiPlayerListCount || !uiPlayerListBody) return;
    const rows = roomPlayerRows();
    const signature = languageCode + "|" + role + "|" + roomPlayerRowsSignature(rows);
    if (!force && signature === lastPlayerListSignature) return;
    lastPlayerListSignature = signature;
    uiPlayerListTitle.text = tr("playerList.title");
    uiPlayerListCount.text = tr("playerList.count", { count: rows.length });
    uiPlayerListBody.text = formatRoomPlayerRows(rows);
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
