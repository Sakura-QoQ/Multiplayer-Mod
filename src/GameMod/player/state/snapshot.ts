// 玩家状态采集。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function captureLocalPlayerState(player: Player): PlayerStatePacket | null {
    if (!player || !player.animator || !GameManager.InGame || localNetworkId < 0) return null;
    try {
        const position = player.transform.position;
        const rotation = player.transform.rotation;
        const move = player.movment ? player.movment.MoveLrep : new UnityEngine.Vector3(0, 0, 0);
        const animations: NetworkAnimationLayer[] = [];
        const layerCount = Math.min(8, Math.max(1, Math.trunc(Number(player.animator.layerCount))));
        for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
            const layer = player.animator.GetCurrentAnimatorStateInfo(layerIndex);
            animations.push({
                hash: finiteNumber(layer.fullPathHash),
                time: finiteNumber(layer.normalizedTime),
                weight: finiteNumber(player.animator.GetLayerWeight(layerIndex), layerIndex === 0 ? 1 : 0)
            });
        }
        let weapon = 0;
        try { weapon = player.status && player.status.Data ? Number(player.status.Data.selectedWeapon) : 0; } catch (_error) { }
        const diagnosticAction = Number(UnityEngine.Time.unscaledTime) < smokeActionOverrideUntil;
        return {
            type: "playerState",
            ownerId: localNetworkId,
            sequence: ++localStateSequence,
            playerName: currentPlayerName,
            scene: String(GameManager.NowSceneName || ""),
            position: { x: position.x, y: position.y, z: position.z },
            rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
            move: { x: move.x, y: move.y, z: move.z },
            grounded: player.movment ? Boolean(player.movment.onGround) : true,
            action: diagnosticAction ? 7 : (player.action ? finiteNumber(player.action.Action) : 0),
            handAction: diagnosticAction ? 3 : (player.action ? finiteNumber(player.action.handAction) : 0),
            stateId: diagnosticAction ? 2 : (player.action ? finiteNumber(player.action.stateID) : 0),
            attack: diagnosticAction ? 1 : (player.action ? finiteNumber(player.action.attack) : 0),
            weapon,
            animationHash: animations.length > 0 ? animations[0].hash : 0,
            animationTime: animations.length > 0 ? animations[0].time : 0,
            animations
        };
    } catch (error) {
        log("Failed to capture local-player state: " + error);
        return null;
    }
}

// 只供同机双实例自动化使用。非 default 测试通道在双方握手后把房主移动两米，
// 并短暂发送非零动作字段；随后可切到 StreetScene 验证客户端自动跟随。
// 普通玩家配置的两个开关均为 false，不会改变实际游戏行为。
