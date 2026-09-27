// 远端模型生命周期。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function clearRemotePlayers(): void {
    for (const key of Object.keys(remotePlayers)) destroyRemotePlayer(Number(key));
    for (const key of Object.keys(lastRemoteSequences)) delete lastRemoteSequences[key];
    for (const key of Object.keys(lastRemoteLiveDataSequences)) delete lastRemoteLiveDataSequences[key];
    for (const key of Object.keys(remoteProfiles)) delete remoteProfiles[key];
    for (const key of Object.keys(remoteProfileRevisions)) delete remoteProfileRevisions[key];
    for (const key of Object.keys(latestPlayerStates)) delete latestPlayerStates[key];
    for (const key of Object.keys(pendingProfileChunks)) delete pendingProfileChunks[key];
    for (const key of Object.keys(sleepReady)) delete sleepReady[key];
}

function stripRemoteNode(node: UnityEngine.Transform): void {
    const go = node.gameObject;
    // 先显式移除布料物理、受损和额外形变组件；它们引用本地玩家碰撞体，会触发
    // MagicaCloth 异步重建。衣服骨骼改由 RemotePlayer.clothBonePairs 在网络节拍驱动。
    for (const typeName of ["MagicaCloth", "ClothDamage", "ClothingArmBlendShapeController"]) {
        for (let guard = 0; guard < 32; guard++) {
            const component = go.GetComponent(typeName);
            if (!component) break;
            UnityEngine.Object.DestroyImmediate(component);
        }
    }
    // UcModLauncher 不公开 GetComponentsInChildren(Type)，但支持按类型名查找单个组件。
    // 每删除一个就重新查询，直到本节点不再包含任何 MonoBehaviour。
    for (let guard = 0; guard < 128; guard++) {
        const script = go.GetComponent("MonoBehaviour");
        if (!script) break;
        UnityEngine.Object.DestroyImmediate(script);
    }
    const blockedTypes = ["Collider", "Rigidbody", "Camera", "AudioListener", "AudioSource", "Light"];
    for (const typeName of blockedTypes) {
        for (let guard = 0; guard < 32; guard++) {
            const component = go.GetComponent(typeName);
            if (!component) break;
            UnityEngine.Object.DestroyImmediate(component);
        }
    }
    for (let index = Number(node.childCount) - 1; index >= 0; index--) {
        const child = node.GetChild(index);
        // 角色预制体包含数量很大的未启用服装、道具和动作资源。远端克隆不能递归这些
        // 分支，否则 Unity 主线程会长时间阻塞，连握手都无法回发。当前可见骨骼和渲染树
        // 足以播放同步的 Animator 状态；临时道具应按需单独映射，不能保留整棵资源树。
        if (!child.gameObject.activeSelf) UnityEngine.Object.DestroyImmediate(child.gameObject);
        else stripRemoteNode(child);
    }
}

function stripRemoteClone(clone: UnityEngine.GameObject, animator: UnityEngine.Animator): void {
    // 克隆体还未激活，此时销毁脚本可保证它们的 Awake/Start 永远不会运行；Animator
    // 继承 Behaviour 而非 MonoBehaviour，因此会被保留，用于播放同步后的原版动作。
    stripRemoteNode(clone.transform);
    animator.enabled = true;
}

function createRemotePlayer(packet: PlayerStatePacket): RemotePlayer | null {
    const local = Player.LocalPlayer;
    if (!local || !local.gameObject || !local.animator) return null;
    const source = local.gameObject;
    const wasActive = source.activeSelf;
    const originalClothes = readCurrentClothIds();
    const remoteProfile = remoteProfiles[String(packet.ownerId)];
    let sourceAppearanceChanged = false;
    let clone: UnityEngine.GameObject | null = null;
    try {
        const remoteClothes = remoteProfile ? remoteProfile.cloth.map(id => String(id)) : [];
        const sameRuntimeClothes = JSON.stringify(originalClothes) === JSON.stringify(remoteClothes);
        if (local.cloth && remoteProfile && !sameRuntimeClothes) {
            setRuntimeClothes(local.cloth, remoteProfile.cloth);
            sourceAppearanceChanged = true;
        }
        // inactive 对象被 Instantiate 时不会执行克隆脚本的 Awake；先剥离逻辑组件再激活。
        if (wasActive) source.SetActive(false);
        clone = UnityEngine.Object.Instantiate(source) as UnityEngine.GameObject;
        clone.name = "MPB_RemotePlayer_" + packet.ownerId;
        const animator = clone.GetComponent("Animator") as UnityEngine.Animator;
        if (!animator) throw new Error("远端玩家克隆体缺少 Animator");
        log("正在准备远端玩家可视模型: " + String(packet.playerName || packet.ownerId));
        // 剥离脚本和未启用节点之前，按该玩家的资料启用衣服、发型和脸型。
        applyRemoteAppearance(clone, remoteProfile);
        const materialSnapshots = captureRemoteMaterials(clone.transform);
        const remoteArmature = (clone.GetComponent("Player") as Player).bodyModel.armature;
        const clothBonePairs = collectRemoteClothBonePairs(clone, remoteArmature);
        stripRemoteClone(clone, animator);
        const ownedMaterials = restoreRemoteMaterials(materialSnapshots,
            !!(remoteProfile && remoteProfile.customization && remoteProfile.customization.skinTan === true));
        animator.applyRootMotion = false;
        clone.transform.position = new UnityEngine.Vector3(packet.position.x, packet.position.y, packet.position.z);
        clone.transform.rotation = new UnityEngine.Quaternion(packet.rotation.x, packet.rotation.y, packet.rotation.z, packet.rotation.w);
        // 玩家模型跨场景保留，避免每次切图都重新禁用本机角色并触发 MagicaCloth 异步重建。
        UnityEngine.Object.DontDestroyOnLoad(clone);
        clone.SetActive(true);
        const remote: RemotePlayer = {
            id: packet.ownerId,
            name: String(packet.playerName || "Player"),
            root: clone,
            animator,
            targetPosition: clone.transform.position,
            targetRotation: clone.transform.rotation,
            lastSeen: Number(UnityEngine.Time.unscaledTime),
            animationHashes: [],
            diagnosticPosition: clone.transform.position,
            diagnosticActionKey: "",
            clothBonePairs,
            ownedMaterials
        };
        remotePlayers[String(packet.ownerId)] = remote;
        log("已创建远端玩家模型: " + remote.name + " (peer=" + packet.ownerId + ")");
        return remote;
    } catch (error) {
        if (clone) UnityEngine.Object.Destroy(clone);
        log("创建远端玩家模型失败: " + error);
        return null;
    } finally {
        if (wasActive && !source.activeSelf) source.SetActive(true);
        if (sourceAppearanceChanged && local.cloth) {
            try { setRuntimeClothes(local.cloth, originalClothes); }
            catch (error) { log("恢复本地玩家衣服失败: " + error); }
        }
        // 防御性恢复：即使未来游戏版本改变 Awake 时机，也不能让克隆体替换本地玩家单例。
        Player.LocalPlayer = local;
    }
}

function applyRemotePlayerState(packet: PlayerStatePacket): void {
    if (!validPlayerState(packet) || packet.ownerId === localNetworkId) return;
    const key = String(packet.ownerId);
    const sequence = Math.trunc(Number(packet.sequence));
    if (lastRemoteSequences[key] !== undefined && sequence <= lastRemoteSequences[key]) return;
    lastRemoteSequences[key] = sequence;
    latestPlayerStates[key] = packet;
    if (!GameManager.InGame || packet.scene !== String(GameManager.NowSceneName || "")) {
        // 房主是世界场景权威。客户端收到房主（ownerId=0）的不同场景后自动跟随，
        // 避免两边连接正常却永远互相不可见。普通客户端不能反向强制房主换场景。
        if (role === "client" && packet.ownerId === 0 && GameManager.InGame && packet.scene &&
            pendingHostScene !== packet.scene) {
            pendingHostScene = packet.scene;
            log("正在跟随房主切换场景: " + packet.scene);
            try {
                GameManager.MoveToScene(packet.scene, () => {
                    pendingHostScene = "";
                    try {
                        if (Player.LocalPlayer) {
                            Player.LocalPlayer.transform.position = new UnityEngine.Vector3(
                                packet.position.x + 1.0, packet.position.y, packet.position.z);
                        }
                    } catch (_error) { }
                    log("已进入房主场景: " + packet.scene);
                });
            } catch (error) {
                pendingHostScene = "";
                log("跟随房主场景失败: " + error);
            }
        }
        return;
    }
    // 等完整资料到达后再建立一次模型，避免先用默认外观创建、随后立即销毁重建。
    if (!remoteProfiles[key]) return;
    let remote = remotePlayers[String(packet.ownerId)] || createRemotePlayer(packet);
    if (!remote) return;
    remote.name = String(packet.playerName || remote.name);
    remote.lastSeen = Number(UnityEngine.Time.unscaledTime);
    remote.targetPosition = new UnityEngine.Vector3(packet.position.x, packet.position.y, packet.position.z);
    remote.targetRotation = new UnityEngine.Quaternion(packet.rotation.x, packet.rotation.y, packet.rotation.z, packet.rotation.w);
    try {
        remote.animator.SetFloat("Speed", Math.sqrt(packet.move.x * packet.move.x + packet.move.z * packet.move.z));
        remote.animator.SetBool("Grounded", packet.grounded);
        remote.animator.SetBool("OnGround", packet.grounded);
        remote.animator.SetInteger("Action", Math.trunc(packet.action));
        remote.animator.SetInteger("HandAction", Math.trunc(packet.handAction));
        remote.animator.SetInteger("StateID", Math.trunc(packet.stateId));
        remote.animator.SetInteger("Attack", Math.trunc(packet.attack));
        remote.animator.SetInteger("Weapon", Math.trunc(packet.weapon));
        for (let layerIndex = 0; layerIndex < packet.animations.length; layerIndex++) {
            const layer = packet.animations[layerIndex];
            const targetTime = Math.max(0, layer.time % 1);
            const current = remote.animator.GetCurrentAnimatorStateInfo(layerIndex);
            const currentTime = Math.max(0, Number(current.normalizedTime) % 1);
            const drift = Math.min(Math.abs(currentTime - targetTime), 1 - Math.abs(currentTime - targetTime));
            if (layer.hash && (remote.animationHashes[layerIndex] !== layer.hash || drift > 0.2))
                remote.animator.Play(Math.trunc(layer.hash), layerIndex, targetTime);
            remote.animator.SetLayerWeight(layerIndex, finiteNumber(layer.weight, 1));
            remote.animationHashes[layerIndex] = layer.hash;
        }
        if (BRIDGE_CHANNEL !== "default") {
            const actionKey = packet.animations.map(layer => layer.hash).join(",") + ":" + packet.action + ":" + packet.handAction + ":" + packet.attack;
            const moved = UnityEngine.Vector3.Distance(remote.diagnosticPosition, remote.targetPosition) >= 0.1;
            if (moved || actionKey !== remote.diagnosticActionKey) {
                log("[双实例证据] 远端状态 peer=" + packet.ownerId + " seq=" + packet.sequence +
                    " pos=" + packet.position.x.toFixed(2) + "," + packet.position.y.toFixed(2) + "," + packet.position.z.toFixed(2) +
                    " anim=" + packet.animationHash + " action=" + packet.action + "/" + packet.handAction + "/" + packet.attack);
                remote.diagnosticPosition = remote.targetPosition;
                remote.diagnosticActionKey = actionKey;
            }
        }
    } catch (_error) {
        // 场景系统可能已销毁克隆体而 JS 字典尚未收到通知。丢弃失效包装器，下一包重建。
        delete remotePlayers[key];
    }
}

