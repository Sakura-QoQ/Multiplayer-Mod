// 网络控制更新循环。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function updateBridge(player: Player | null): void {
    if (!isCurrentGeneration()) return;
    handleUiInput();
    syncGameLanguage();
    startBridge();
    if (bridgeAvailable) {
        const touchNow = Number(UnityEngine.Time.unscaledTime);
        if (lastBridgeTouchAt < 0 || touchNow - lastBridgeTouchAt >= 2) {
            lastBridgeTouchAt = touchNow;
            submitBridgeCommand("touch");
        }
    }
    ensureUi();
    // PauseWindow 通常在场景载入时就已完成 Start，首次按 ESC 只是把已注册窗口显示出来。
    // 因此不能只依赖 Start Hook；窗口打开时主动发现现有实例，确保联机按钮一定存在。
    try {
        if (!pauseButtonLayout && WindowManager.Singleton && WindowManager.IsOpened("PauseWindow")) {
            const pause = WindowManager.GetWindow("PauseWindow") as PauseWindow;
            if (pause) {
                const nativeLabel = pause.setting ? findTextInChildren(pause.setting.transform) : null;
                ensureUi(nativeLabel ? (nativeLabel as any).font : null);
                buildPauseMenuButton(pause);
            }
        }
    } catch (error) { log("发现已打开暂停菜单失败: " + error); }
    // 暂停窗口可能先于联机状态变化创建；每帧按当前模式同步原版“读取”按钮。
    // 联机时隐藏，停止联机后恢复，避免永久修改原版菜单。
    refreshPauseMenuLayout();
    updateFrames += 1;
    if (updateFrames % 120 === 0) updateStatusText();
    updateRemotePlayers();
    if (!bridgeAvailable || role === "off") return;
    // Unity 在 timeScale=0 时仍执行 Update；解除逻辑暂停与世界时钟，但不销毁暂停窗口。
    keepOnlineWorldRunning();
    updateOnlineWorldClock();
    // 状态文件只采样一次，再从内存队列处理事件。旧实现每处理一个事件都会重新读文件，
    // 会放大 Windows 共享冲突，并在完整资料包到达时阻塞 Unity 主线程。
    const pollNow = Number(UnityEngine.Time.unscaledTime);
    if (pollNow >= nextBridgePollAt) {
        // 与 20 Hz 玩家快照保持同一读取节拍，避免桥接层把多个状态包合并成一次可见更新。
        nextBridgePollAt = advanceFixedDeadline(nextBridgePollAt, pollNow, PLAYER_STATE_INTERVAL);
        try {
            collectBridgeEvents(readBridgeState());
        } catch (error) {
            log("轮询网络桥接暂时失败，将自动重试: " + error);
        }
    }
    // 每帧最多处理 32 个已入内存事件，防止网络洪峰长时间占用 Unity 主线程。
    for (let index = 0; index < 32 && pendingBridgeEvents.length > 0; index++) {
        const eventJson = pendingBridgeEvents.shift() || "";
        if (eventJson) processEvent(eventJson);
    }
    if (player) {
        const now = Number(UnityEngine.Time.unscaledTime);
        if (role === "client" && now >= nextPresenceAt) {
            nextPresenceAt = now + PRESENCE_INTERVAL;
            send(0, { type: "hello", protocol: PROTOCOL_VERSION, playerName: currentPlayerName });
        }
        runSmokeTestDiagnostics(player);
        sendLocalPlayerState(player);
        sendLocalPlayerLiveData();
        sendLocalPlayerProfile();
        sendAuthoritativeWorldTime();
    }
    resendPendingSleepApproval();
    flushOutgoingMessage();
}

