// 双实例诊断。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function runSmokeTestDiagnostics(player: Player): void {
    if (BRIDGE_CHANNEL === "default" || role === "off") return;
    const config = loadConfig();
    const now = Number(UnityEngine.Time.unscaledTime);
    if (config.smokeTestOnlineLifecycle && onlineSaveSessionReady && !smokeOnlineLifecycleFinished) {
        smokeOnlineLifecycleFinished = true;
        try {
            if (config.smokeTestLifecyclePhase === "create") {
                const current = player.transform.position;
                player.transform.position = new UnityEngine.Vector3(current.x + 3.25, current.y, current.z);
            }
            const savedPosition = player.transform.position;
            beginOnlineExitSave(player, () => log("[线上存档生命周期] phase=" + config.smokeTestLifecyclePhase +
                " save=" + selectedSaveName + " position=" + savedPosition.x.toFixed(4) + "," +
                savedPosition.y.toFixed(4) + "," + savedPosition.z.toFixed(4)));
        } catch (error) { log("诊断模式：线上存档生命周期失败: " + error); }
        return;
    }
    if (config.smokeTestPhone && localNetworkId >= 0 && !smokePhoneChecked && GameManager.Singleton) {
        smokePhoneChecked = true;
        try {
            // 复现玩家先打开 ESC 菜单的情况，再走线上模式的解除暂停逻辑。
            // 随后用游戏原生 WindowManager 打开手机（XWindow），证明窗口输入链未被 Paused 卡死。
            GameManager.PauseGame(true);
            if (WindowManager.IsOpened("PauseWindow")) WindowManager.CloseWindow("PauseWindow");
            GameManager.PauseGame(false);
            keepOnlineWorldRunning();
            if (GameManager.Paused || Number(UnityEngine.Time.timeScale) <= 0)
                throw new Error("解除暂停后游戏仍处于暂停状态");
            const phone = WindowManager.OpenWindow("XWindow");
            if (!phone || !WindowManager.IsOpened("XWindow")) throw new Error("XWindow 未能打开");
            log("诊断模式：线上暂停后手机窗口已正常打开，游戏时间未暂停");
            WindowManager.CloseWindow("XWindow");
        } catch (error) { log("诊断模式：线上手机窗口验证失败: " + error); }
    }
    if (config.smokeTestPauseMenu && localNetworkId >= 0 && !smokePauseMenuOpened && GameManager.Singleton) {
        smokePauseMenuOpened = true;
        try {
            // 无人值守测试不能可靠抢占 Windows 前台焦点，因此直接调用游戏原生窗口管理器。
            // 这会实例化和显示与玩家按 ESC 完全相同的 PauseWindow，并执行其原生 Start。
            const pause = WindowManager.OpenWindow("PauseWindow");
            if (!pause || !WindowManager.IsOpened("PauseWindow")) throw new Error("PauseWindow 未能打开");
            GameManager.PauseGame(true);
            smokePauseMenuOpenedAt = now;
            smokePauseMenuGameTime = Number(GameManager.Singleton.gameTime);
            log("诊断模式：已通过原生 WindowManager 打开 PauseWindow");
        } catch (error) { log("诊断模式：打开原版暂停菜单失败: " + error); }
    }
    if (config.smokeTestPauseMenu && smokePauseMenuOpened && !smokePauseBackgroundVerified &&
        smokePauseMenuOpenedAt >= 0 && now - smokePauseMenuOpenedAt >= 1 && GameManager.Singleton) {
        try {
            if (!WindowManager.IsOpened("PauseWindow")) throw new Error("验证期间 PauseWindow 已关闭");
            const elapsedGameTime = Number(GameManager.Singleton.gameTime) - smokePauseMenuGameTime;
            if (GameManager.Paused || Number(UnityEngine.Time.timeScale) !== 1 || elapsedGameTime < 0.5)
                throw new Error("暂停背景未持续运行 paused=" + GameManager.Paused +
                    " timeScale=" + UnityEngine.Time.timeScale + " delta=" + elapsedGameTime);
            smokePauseBackgroundVerified = true;
            log("[双实例证据] PauseWindow 保持显示且背景持续运行 paused=false timeScale=1 delta=" +
                elapsedGameTime.toFixed(2));
        } catch (error) { log("诊断模式：暂停背景持续运行验证失败: " + error); }
    }
    if (config.smokeTestSleepConsensus && localNetworkId >= 0 && smokeSleepStartedAt < 0) {
        // 房主必须等至少一个客户端完成 hello 登记；否则“当前只有房主一人”会合法地立即批准。
        if (role === "client" || Object.keys(peerNames).length > 0) smokeSleepStartedAt = now;
    }
    // 房主先进入等待；客户端延后两秒发送同一睡眠选择。批准日志证明单人请求没有立即跳夜，
    // 且第二名玩家准备后由房主发出了唯一批准包。普通玩家配置不会启用此诊断分支。
    if (config.smokeTestSleepConsensus && !smokeSleepRequested && smokeSleepStartedAt >= 0) {
        const delay = role === "host" ? 2 : 4;
        if (now - smokeSleepStartedAt >= delay) {
            smokeSleepRequested = true;
            if (role === "host") {
                sleepReady["0"] = { mode: "tomorrow", at: now };
                log("诊断模式：房主已请求睡到明天，等待其他玩家");
                tryApproveSleep();
            } else {
                log("诊断模式：客户端已请求睡到明天");
                send(0, { type: "sleepRequest", mode: "tomorrow" } as SleepRequestPacket);
            }
        }
    }
    if (role !== "host" || Object.keys(peerNames).length === 0) return;
    if (config.smokeTestMotion && smokeMotionStartedAt < 0) smokeMotionStartedAt = now;
    if (config.smokeTestMotion && smokeMotionCompletedAt < 0 && now - smokeMotionStartedAt >= 2) {
        const current = player.transform.position;
        const target = new UnityEngine.Vector3(current.x + 2, current.y, current.z);
        try {
            if (player.movment && player.movment._characterController) {
                player.movment._characterController.enabled = false;
                player.transform.position = target;
                player.movment._characterController.enabled = true;
            } else player.transform.position = target;
        } catch (_error) { player.transform.position = target; }
        // 首次加载完整资料和构建衣服可能持续数秒；测试动作保持足够长，确保另一实例
        // 的远端模型创建后仍能收到非零动作，而不是只验证一个转瞬即逝的包。
        smokeActionOverrideUntil = now + 15;
        smokeMotionCompletedAt = now;
        log("诊断模式：房主已移动两米并发送动作状态 target=" +
            target.x.toFixed(2) + "," + target.y.toFixed(2) + "," + target.z.toFixed(2));
    }
    if (config.smokeTestSceneSync && smokeMotionCompletedAt >= 0 && !smokeSceneRequested &&
        now - smokeMotionCompletedAt >= 3 && String(GameManager.NowSceneName || "") === "RoomScene") {
        smokeSceneRequested = true;
        log("诊断模式：房主切换到 StreetScene");
        try { GameManager.MoveToScene("StreetScene", () => log("诊断模式：房主已进入 StreetScene")); }
        catch (error) { log("诊断模式场景切换失败: " + error); }
    }
}

function scheduleSmokeOnlineLifecycle(menu: MainMenu, remaining = 900): void {
    if (!isCurrentGeneration() || smokeOnlineLifecycleStarted) return;
    if (bridgeAvailable && role === "host") {
        smokeOnlineLifecycleStarted = true;
        log("诊断模式：开始真实线上存档生命周期");
        enterOnlineSave();
        return;
    }
    if (remaining <= 0) {
        log("诊断模式：等待线上存档桥接超时");
        return;
    }
    JintCoroutine.WaitForNextFrame(menu, () => scheduleSmokeOnlineLifecycle(menu, remaining - 1));
}

