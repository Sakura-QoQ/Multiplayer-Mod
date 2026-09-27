// 玩家状态发送与渲染。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function sendLocalPlayerState(player: Player): void {
    if (!bridgeAvailable || role === "off" || localNetworkId < 0) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (now < nextPlayerStateAt) return;
    nextPlayerStateAt = advanceFixedDeadline(nextPlayerStateAt, now, PLAYER_STATE_INTERVAL);
    const packet = captureLocalPlayerState(player);
    if (packet) send(0, packet);
}

function updateRemotePlayers(): void {
    const now = Number(UnityEngine.Time.unscaledTime);
    const delta = Math.max(0, Math.min(0.1, Number(UnityEngine.Time.unscaledDeltaTime)));
    // 网络以 20 Hz 发送目标快照；渲染帧用指数平滑追赶目标，帧率变化不会改变手感。
    const blend = 1 - Math.exp(-12 * delta);
    for (const key of Object.keys(remotePlayers)) {
        const remote = remotePlayers[key];
        if (now - remote.lastSeen > REMOTE_PLAYER_TIMEOUT) {
            destroyRemotePlayer(Number(key));
            continue;
        }
        try {
            const transform = remote.root.transform;
            const distance = UnityEngine.Vector3.Distance(transform.position, remote.targetPosition);
            transform.position = distance > 8
                ? remote.targetPosition
                : UnityEngine.Vector3.Lerp(transform.position, remote.targetPosition, blend);
            transform.rotation = UnityEngine.Quaternion.Slerp(transform.rotation, remote.targetRotation, blend);
            // Dress 逻辑已从代理剥离；每帧复制身体同名骨，衣服不会按网络节拍阶梯抖动。
            for (const pair of remote.clothBonePairs) {
                pair.driven.position = pair.source.position;
                pair.driven.rotation = pair.source.rotation;
                pair.driven.localScale = pair.source.localScale;
            }
        } catch (_error) {
            // 场景销毁窗口中 Unity 包装器可能短暂失效；超时清理负责最终回收。
        }
    }
}

