// 页面开关状态。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function closePanel(): void {
    if (uiConfigBody) uiConfigBody.SetActive(true);
    if (uiTitle) uiTitle.text = tr("panel.title");
    if (uiPanel) uiPanel.SetActive(false);
}

function openPanel(): void {
    if (!uiPanel) return;
    syncGameLanguage();
    if (uiConfigBody) uiConfigBody.SetActive(true);
    if (uiTitle) uiTitle.text = tr("panel.title");
    // 面板可能在桥接启动后才首次打开；不能继续显示 buildUi 时缓存的“未联机”。
    updateStatusText();
    refreshPlayerInfoUi();
    uiPanel.SetActive(true);
}

