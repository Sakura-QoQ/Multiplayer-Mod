// 界面运行时。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function ensureUi(font?: any): void {
    if (uiRoot || !isCurrentGeneration()) return;
    const inheritedFont = font || findOldUiFont();
    if (inheritedFont) buildUi(inheritedFont);
}

function keepOnlineWorldRunning(): void {
    if (!bridgeAvailable || role === "off") return;
    try {
        // 主菜单切场景的短窗口里静态 Singleton 为空；直接读取 Paused 会让游戏 getter
        // 抛 NullReferenceException。等 GameManager 建立后再解除暂停即可。
        if (!GameManager.Singleton) return;
        let pauseVisible = false;
        try { pauseVisible = WindowManager.IsOpened("PauseWindow"); } catch (_error) { }
        if (pauseVisible) {
            // PauseGame(false) 会清理原版私有暂停状态，但同时关闭 PauseWindow。紧接着通过
            // WindowManager 重新显示同一个原版窗口，因此菜单仍在，NPC、物理、Animator、
            // 场景脚本和玩家模型却会按真正的“未暂停”状态继续更新。
            if (GameManager.Paused) {
                GameManager.PauseGame(false);
                WindowManager.OpenWindow("PauseWindow");
                pauseVisible = WindowManager.IsOpened("PauseWindow");
            }
            if (Number(UnityEngine.Time.timeScale) !== 1) UnityEngine.Time.timeScale = 1;
            if (BRIDGE_CHANNEL !== "default" && !pauseVisibleEvidenceLogged && !GameManager.Paused) {
                pauseVisibleEvidenceLogged = true;
                onlinePauseReleaseCount += 1;
                log("[DualInstanceEvidence] Online pause menu visible while world remains active count=" + onlinePauseReleaseCount +
                    " pauseVisible=true paused=" + GameManager.Paused + " timeScale=" +
                    Number(UnityEngine.Time.timeScale).toFixed(1));
            }
        } else {
            pauseVisibleEvidenceLogged = false;
        }
        if (Number(UnityEngine.Time.timeScale) !== 1) UnityEngine.Time.timeScale = 1;
    } catch (_error) { }
}
