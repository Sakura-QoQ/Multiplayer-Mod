// 联机面板状态统一由这里切换，避免配置页和只读房间页各自修改可见性。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function setPanelMode(mode: MultiplayerPanelMode): void {
    uiPanelMode = mode;
    const roomVisible = mode === "room";
    if (uiConfigBody) uiConfigBody.SetActive(mode === "config");
    if (uiLocalBody) uiLocalBody.SetActive(mode === "local");
    if (uiPublicRoomsBody) uiPublicRoomsBody.SetActive(mode === "public");
    if (uiRoomInfoBody) uiRoomInfoBody.SetActive(roomVisible);
    if (uiTitle) uiTitle.text = tr(roomVisible ? "room.title" :
        mode === "local" ? "local.title" : mode === "public" ? "publicRoom.title" : "panel.title");
    // 顶层配置页使用底部取消按钮；所有子页面统一在右上角显示返回按钮。
    if (uiBackButton) uiBackButton.SetActive(mode !== "closed" && mode !== "config");
    if (uiPanel) uiPanel.SetActive(mode !== "closed");

    if (mode === "config") {
        // 面板可能在桥接启动后才首次打开，不能继续显示 buildUi 时缓存的状态。
        updateStatusText();
        refreshPlayerInfoUi();
    } else if (roomVisible) {
        lastRoomInfoSignature = "";
        refreshRoomInfoUi(true);
    }
}

function openPanelMode(mode: "config" | "local" | "public" | "room"): void {
    if (!uiPanel) return;
    syncGameLanguage();
    if (uiPanelMode !== "closed" && uiPanelMode !== mode) uiPanelHistory.push(uiPanelMode);
    setPanelMode(mode);
}

function navigatePanelBack(): void {
    if (uiPanelMode === "closed") return;
    if (uiPanelHistory.length > 0) {
        setPanelMode(uiPanelHistory.pop() as MultiplayerPanelMode);
        return;
    }
    closePanel();
}

function closePanel(): void {
    uiPanelHistory = [];
    setPanelMode("closed");
}
function openPanel(): void { openPanelMode("config"); }
