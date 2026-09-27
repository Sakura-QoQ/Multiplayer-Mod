// 权威时间与睡眠共识。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function validSleepMode(value: any): value is SleepMode {
    return value === "short" || value === "tomorrow";
}

// 联机时不再使用各电脑自己的 Time.deltaTime 累加结果。房主维护唯一权威时钟，客户端
// 收到房主锚点后只在两次网络包之间按 unscaledTime 平滑推进，下一包会重新校准。
// 这样 ESC 菜单、窗口动画或本地 timeScale 都不能让任意一台电脑的游戏时间停住或分叉。
function updateOnlineWorldClock(): void {
    if (role === "off" || !GameManager.InGame || !GameManager.Singleton) {
        onlineClockInitialized = false;
        return;
    }
    const now = Number(UnityEngine.Time.unscaledTime);
    if (!onlineClockInitialized) {
        onlineClockInitialized = true;
        onlineClockGameTime = Number(GameManager.Singleton.gameTime);
        onlineClockLastUnscaledTime = now;
    } else {
        const elapsed = Math.max(0, Math.min(0.25, now - onlineClockLastUnscaledTime));
        onlineClockGameTime += elapsed;
        onlineClockLastUnscaledTime = now;
    }
    GameManager.Singleton.gameTime = onlineClockGameTime;
}

function resetOnlineWorldClockFromGame(): void {
    if (!GameManager.Singleton) return;
    onlineClockInitialized = true;
    onlineClockGameTime = Number(GameManager.Singleton.gameTime);
    onlineClockLastUnscaledTime = Number(UnityEngine.Time.unscaledTime);
}

function sendAuthoritativeWorldTime(force = false): void {
    if (role !== "host" || !GameManager.InGame || !GameManager.Singleton) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (!force && now < nextWorldTimeAt) return;
    nextWorldTimeAt = advanceFixedDeadline(nextWorldTimeAt, now, WORLD_TIME_INTERVAL);
    const status = Player.LocalPlayer ? Player.LocalPlayer.status : null;
    const data = status ? status.Data : null;
    send(0, {
        type: "worldTime",
        sequence: ++worldTimeSequence,
        gameTime: Number(GameManager.Singleton.gameTime),
        day: data ? Number(data.day) : 0,
        timeOfDay: data ? Number(data.timeOfDay) : 0,
        timeOffset: status ? Number(status.timeOffset) : 0
    } as WorldTimePacket);
}

function applyAuthoritativeWorldTime(packet: WorldTimePacket): void {
    if (role !== "client" || !validWorldTime(packet) || packet.sequence <= lastWorldTimeSequence) return;
    lastWorldTimeSequence = packet.sequence;
    applyingAuthoritativeTime = true;
    try {
        onlineClockInitialized = true;
        onlineClockGameTime = Number(packet.gameTime);
        onlineClockLastUnscaledTime = Number(UnityEngine.Time.unscaledTime);
        if (GameManager.Singleton) GameManager.Singleton.gameTime = onlineClockGameTime;
        const status = Player.LocalPlayer ? Player.LocalPlayer.status : null;
        if (status && status.Data) {
            status.timeOffset = Number(packet.timeOffset);
            // PlayerStatus.Data 返回 PlayerData(struct) 的副本，直接写 Data.day/timeOfDay 不会可靠回写。
            // 使用游戏公开接口推进日期和设置时段，避免只修改装箱副本。
            const targetDay = Math.trunc(Number(packet.day));
            let localDay = Math.trunc(Number(status.Data.day));
            for (let guard = 0; localDay < targetDay && guard < 64; guard++, localDay++) status.AddDay();
            const targetTimeOfDay = Math.trunc(Number(packet.timeOfDay));
            if (Math.trunc(Number(status.Data.timeOfDay)) !== targetTimeOfDay) status.SetTime(targetTimeOfDay);
        }
        if (BRIDGE_CHANNEL !== "default") {
            const now = Number(UnityEngine.Time.unscaledTime);
            if (lastDiagnosticWorldTimeLogAt < 0 || now - lastDiagnosticWorldTimeLogAt >= 2) {
                lastDiagnosticWorldTimeLogAt = now;
                log("[DualInstanceEvidence] Applied host time seq=" + packet.sequence + " gameTime=" +
                    Number(packet.gameTime).toFixed(2) + " day=" + Math.trunc(Number(packet.day)) +
                    " timeOfDay=" + Math.trunc(Number(packet.timeOfDay)));
            }
        }
    } catch (error) { log("Failed to apply host game time: " + error); }
    finally { applyingAuthoritativeTime = false; }
}

// PlayerStatus 没有 SetDay，日期只能通过 AddDay 向前推进。若加入者的线上角色日期
// 比房主更晚，房主先采用房间内最大的日期，再广播给所有人；之后客户端的本地
// AddTime/AddDay 会被拦截，因此整个会话不会再次分叉，也不需要倒退日期破坏任务状态。
function adoptLatestRoomDay(profile: PlayerProfile): void {
    if (role !== "host" || !Player.LocalPlayer || !Player.LocalPlayer.status) return;
    try {
        const source = profile.progress ? profile.progress.PlayerStatusData : null;
        const peerDay = source ? Math.trunc(Number(source.day)) : 0;
        const status = Player.LocalPlayer.status;
        let hostDay = status.Data ? Math.trunc(Number(status.Data.day)) : 0;
        if (!Number.isFinite(peerDay) || peerDay <= hostDay) return;
        applyingAuthoritativeTime = true;
        for (let guard = 0; hostDay < peerDay && guard < 4096; guard++, hostDay++) status.AddDay();
        log("Room day advanced to the later player's progress: day " + peerDay);
        sendAuthoritativeWorldTime(true);
    } catch (error) { log("Failed to merge the room day: " + error); }
    finally { applyingAuthoritativeTime = false; }
}

function invokeApprovedSleep(mode: SleepMode): void {
    if (!bedWindowInstance || sleepConsensusExecuting) return;
    const button = mode === "tomorrow"
        ? bedWindowInstance.sleepToTomorrowButton
        : bedWindowInstance.sleepForAWhileButton;
    if (!button) return;
    sleepConsensusExecuting = true;
    try {
        button.onClick.Invoke();
        // 睡眠可能一次性改写 gameTime；立即把新值纳入 Mod 权威时钟，不能在下一帧
        // 又被睡眠前的旧锚点覆盖。
        resetOnlineWorldClockFromGame();
    }
    catch (error) { log("Failed to execute unanimous sleep: " + error); }
    finally { sleepConsensusExecuting = false; }
}

function tryApproveSleep(): void {
    if (role !== "host") return;
    const now = Number(UnityEngine.Time.unscaledTime);
    // TCP 已连接但 hello 尚未恢复时，peerNames 可能短暂为空。以桥接层真实连接数兜底，
    // 只要还有任何未登记玩家就绝不批准睡眠。
    const bridgeState = readBridgeState();
    const connectedPeers = bridgeState ? Math.max(0, Math.trunc(Number(bridgeState.peers) || 0)) : 0;
    if (Object.keys(peerNames).length < connectedPeers) return;
    const expected = ["0", ...Object.keys(peerNames)];
    let mode: SleepMode | null = null;
    for (const peerId of expected) {
        const ready = sleepReady[peerId];
        if (!ready || now - ready.at > SLEEP_READY_TIMEOUT) return;
        if (!mode) mode = ready.mode;
        else if (mode !== ready.mode) return;
    }
    if (!mode) return;
    for (const key of Object.keys(sleepReady)) delete sleepReady[key];
    const packet: SleepApprovedPacket = { type: "sleepApproved", mode, sequence: ++sleepApprovalSequence };
    pendingSleepApproval = {
        packet, createdAt: now, acknowledged: {}, nextSendAt: now + 0.5
    };
    send(0, packet);
    log("Unanimous sleep approved: " + mode + "; sequence=" + packet.sequence);
    invokeApprovedSleep(mode);
    // 睡觉回调可能通过协程推进时间；随后正常的房主时间包会持续把结果同步给所有玩家。
    sendAuthoritativeWorldTime(true);
}

// 睡眠批准是一次性控制消息，不能像位置包一样允许状态快照漏掉。房主每 0.5 秒
// 向尚未确认的客户端重发，全部 ACK 或 10 秒超时后结束本轮。
function resendPendingSleepApproval(): void {
    if (role !== "host" || !pendingSleepApproval) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    const peerIds = Object.keys(peerNames);
    if (peerIds.every(peerId => pendingSleepApproval!.acknowledged[peerId])) {
        log("All clients acknowledged sleep approval: " + pendingSleepApproval.packet.sequence);
        pendingSleepApproval = null;
        return;
    }
    if (now - pendingSleepApproval.createdAt > 10) {
        log("Sleep approval acknowledgement timed out: " + pendingSleepApproval.packet.sequence);
        pendingSleepApproval = null;
        return;
    }
    if (now < pendingSleepApproval.nextSendAt) return;
    pendingSleepApproval.nextSendAt = now + 0.5;
    for (const peerId of peerIds) {
        if (!pendingSleepApproval.acknowledged[peerId])
            send(Number(peerId), pendingSleepApproval.packet);
    }
}

function requestConsensusSleep(mode: SleepMode, ctx: IHookContext): void {
    if (role === "off" || sleepConsensusExecuting) return;
    ctx.Intercept();
    if (role === "host") {
        sleepReady["0"] = { mode, at: Number(UnityEngine.Time.unscaledTime) };
        const waitingForRemotePlayers = Object.keys(peerNames).length > 0;
        tryApproveSleep();
        if (waitingForRemotePlayers) toast(tr("toast.sleepWaiting"));
    } else {
        send(0, { type: "sleepRequest", mode } as SleepRequestPacket);
        toast(tr("toast.sleepWaiting"));
    }
}

