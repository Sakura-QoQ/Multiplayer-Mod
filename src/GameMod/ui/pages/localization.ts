// 页面语言刷新。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function refreshLocalizedUi(): void {
    try {
        if (uiMenuButton) {
            const menuText = findTextInChildren(uiMenuButton.transform);
            if (menuText) menuText.text = tr("menu.multiplayer");
        }
        if (uiPauseButton) {
            const pauseText = findTextInChildren(uiPauseButton.transform);
            if (pauseText) pauseText.text = tr("menu.multiplayer");
        }
        if (!uiPanel) return;
        const root = uiPanel.transform;
        const labels: Record<string, string> = {
            NameLabel: "field.playerName",
            Stop: "button.stop",
            PublicTitle: "publicRoom.title",
            PublicRoom1: "publicRoom.public-1",
            PublicRoom2: "publicRoom.public-2",
            PublicRoom3: "publicRoom.public-3",
            Privacy: "privacy",
            Save: "save.notRead",
            Cancel: "button.cancel"
        };
        for (const name of Object.keys(labels)) setChildText(root, name, tr(labels[name]));
        try { if (uiName && uiName.placeholder) (uiName.placeholder as UnityEngine.UI.Text).text = tr("placeholder.playerName"); } catch (_error) { }
        if (uiTitle) uiTitle.text = tr(uiPanelMode === "room" ? "room.title" : "panel.title");
        refreshPlayerListUi(true);
        if (uiPanelMode === "room") {
            lastRoomInfoSignature = "";
            refreshRoomInfoUi(true);
        }
        // 玩家资料卡也必须随游戏当前语言立即刷新，不能保留上一次语言的文本。
        refreshPlayerInfoUi();
        updateStatusText();
    } catch (error) { log("Failed to refresh multiplayer UI localization: " + error); }
}

// 复制游戏自己的“新建游戏”按钮，因此背景、字体、悬停动画和缩放规则都与原界面一致。
