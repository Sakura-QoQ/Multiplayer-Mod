// 游戏内暂停菜单使用的只读房间信息页。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function buildRoomInfoPage(parent: UnityEngine.Transform, font: any): void {
    uiRoomInfoBody = makeSolidRect(parent, "RoomInfoBody",
        new UnityEngine.Color(0.34, 0.34, 0.34, 0.58), 20, 92, 720, 620);
    uiRoomSummary = makeText(uiRoomInfoBody.transform, "RoomSummary", "", font, 30, 28, 660, 105, 27);
    uiRoomTime = makeText(uiRoomInfoBody.transform, "RoomTime", "", font, 30, 150, 660, 82, 27);
    uiRoomPlayers = makeText(uiRoomInfoBody.transform, "RoomPlayers", "", font, 30, 250, 660, 330, 25);
    uiRoomInfoBody.SetActive(false);
}

function refreshRoomInfoUi(force = false): void {
    if (!uiRoomSummary || !uiRoomTime || !uiRoomPlayers || uiPanelMode !== "room") return;
    try {
        const status = readBridgeStatus();
        const config = loadConfig();
        const address = role === "host" ? tr("room.thisComputer") :
            UnityEngine.PlayerPrefs.GetString(prefKey("MPB.Address"), config.address);
        const port = status.port > 0 ? status.port :
            Number(UnityEngine.PlayerPrefs.GetString(prefKey("MPB.Port"), String(config.port)));
        const rows = roomPlayerRows();
        const playerStatus = Player.LocalPlayer ? Player.LocalPlayer.status : null;
        const data = playerStatus ? playerStatus.Data : null;
        const day = data ? Math.trunc(Number(data.day)) : 0;
        const timeOfDay = data ? Math.trunc(Number(data.timeOfDay)) : 0;
        const gameTime = GameManager.Singleton ? Number(GameManager.Singleton.gameTime) : onlineClockGameTime;
        const roleLabel = role === "host" ? tr("room.host") : tr("room.client");
        const signature = languageCode + "|" + role + "|" + status.state + "|" + address + "|" + port +
            "|" + day + "|" + timeOfDay + "|" + Math.trunc(gameTime) + "|" +
            roomPlayerRowsSignature(rows);
        if (!force && signature === lastRoomInfoSignature) return;
        lastRoomInfoSignature = signature;
        uiRoomSummary.text = tr("room.summary", {
            role: roleLabel,
            address,
            port,
            count: rows.length
        });
        uiRoomTime.text = tr("room.time", {
            day,
            timeOfDay,
            gameTime: Math.max(0, Math.trunc(gameTime))
        });
        uiRoomPlayers.text = tr("room.players") + "\n" + formatRoomPlayerRows(rows);
    } catch (error) { log("Failed to refresh pause-menu room information: " + error); }
}

function openRoomInfoPanel(): void {
    openPanelMode("room");
}
