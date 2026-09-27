// 界面运行时。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function ensureUi(font?: any): void {
    if (uiRoot || !isCurrentGeneration()) return;
    const inheritedFont = font || findOldUiFont();
    if (inheritedFont) buildUi(inheritedFont);
}

function setOnlinePausedFlag(paused: boolean): boolean {
    const manager = GameManager.Singleton;
    if (!manager) return false;
    try {
        // BindingFlags.Instance | BindingFlags.NonPublic = 4 | 32 = 36。
        if (!gameManagerPausedField)
            gameManagerPausedField = manager.GetType().GetField("_isPaused", 36);
        if (!gameManagerPausedField) return false;
        gameManagerPausedField.SetValue(manager, paused);
        return GameManager.Paused === paused;
    } catch (error) {
        log("设置联机暂停标志失败: " + error);
        return false;
    }
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
            // PauseGame(false) 会顺带关闭 PauseWindow。直接清除原版私有暂停标志，保留窗口、
            // 光标和按钮，同时让 NPC、物理、Animator、场景脚本与 Mod 权威时钟继续更新。
            const released = setOnlinePausedFlag(false);
            if (Number(UnityEngine.Time.timeScale) !== 1) UnityEngine.Time.timeScale = 1;
            if (BRIDGE_CHANNEL !== "default" && !pauseVisibleEvidenceLogged && released) {
                pauseVisibleEvidenceLogged = true;
                onlinePauseReleaseCount += 1;
                log("[双实例证据] 联机暂停菜单背景持续运行 count=" + onlinePauseReleaseCount +
                    " pauseVisible=true paused=" + GameManager.Paused + " timeScale=" +
                    Number(UnityEngine.Time.timeScale).toFixed(1));
            }
        } else {
            pauseVisibleEvidenceLogged = false;
            // 窗口已关闭但某个原版回调仍留下暂停标志时，恢复完整游戏状态。
            if (GameManager.Paused) GameManager.PauseGame(false);
        }
        if (Number(UnityEngine.Time.timeScale) !== 1) UnityEngine.Time.timeScale = 1;
    } catch (_error) { }
}

