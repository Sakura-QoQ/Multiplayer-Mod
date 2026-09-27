// 消息队列与校验。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function send(peerId: number, message: any): void {
    // 命令最终写入 Player.log；先进入游戏侧队列以控制每帧发送量和消息优先级。
    const data = JSON.stringify(message);
    const type = String(message && message.type || "");
    const priority = type === "playerState" || type === "worldTime" ? 1 :
        (type === "playerProfile" || type === "playerProfileChunk" ? 2 : 0);
    if (outgoingMessages.length >= 1024) {
        // 队列满时只丢可替代的旧位置/时间包；不能把资料分片头部删掉导致永远无法重组。
        const disposable = outgoingMessages.findIndex(item => item.priority === 1);
        if (disposable >= 0) outgoingMessages.splice(disposable, 1);
        else if (priority === 1) return;
        else outgoingMessages.shift();
    }
    outgoingMessages.push({ peerId, data, priority });
}

// 玩家完整存档数据可能超过桥接层单帧 64 KiB 限制。资料包超过安全值时拆分发送，
// 接收端重组后仍按一个带修订号的 playerProfile 处理，避免静默丢失手机、联系人等字段。
function sendPlayerProfilePacket(peerId: number, packet: PlayerProfilePacket): void {
    const serialized = JSON.stringify(packet);
    if (serialized.length <= 50000) {
        send(peerId, packet);
        return;
    }
    const count = Math.ceil(serialized.length / PLAYER_PROFILE_CHUNK_SIZE);
    if (count > MAX_PLAYER_PROFILE_CHUNKS) {
        log("The complete player profile exceeds the synchronization limit and was skipped: " + serialized.length);
        return;
    }
    const transferId = packet.ownerId + "-" + packet.revision + "-" + Date.now();
    for (let index = 0; index < count; index++) {
        send(peerId, {
            type: "playerProfileChunk", transferId, index, count,
            payload: serialized.substring(index * PLAYER_PROFILE_CHUNK_SIZE, (index + 1) * PLAYER_PROFILE_CHUNK_SIZE)
        } as PlayerProfileChunkPacket);
    }
}

function validPlayerProfileChunk(packet: any): packet is PlayerProfileChunkPacket {
    return packet && packet.type === "playerProfileChunk" && typeof packet.transferId === "string" &&
        packet.transferId.length <= 128 && Number.isInteger(Number(packet.index)) &&
        Number.isInteger(Number(packet.count)) && Number(packet.count) > 0 &&
        Number(packet.count) <= MAX_PLAYER_PROFILE_CHUNKS && Number(packet.index) >= 0 &&
        Number(packet.index) < Number(packet.count) && typeof packet.payload === "string" &&
        packet.payload.length <= PLAYER_PROFILE_CHUNK_SIZE;
}

function receivePlayerProfileChunk(packet: PlayerProfileChunkPacket, sourcePeerId: number): PlayerProfilePacket | null {
    const now = Number(UnityEngine.Time.unscaledTime);
    for (const pendingKey of Object.keys(pendingProfileChunks)) {
        if (now - pendingProfileChunks[pendingKey].createdAt > 30) delete pendingProfileChunks[pendingKey];
    }
    // 房主按来源 peer 隔离 transferId，防止不同客户端碰撞；客户端来源固定为服务器。
    const key = sourcePeerId + ":" + packet.transferId;
    let pending = pendingProfileChunks[key];
    if (!pending || pending.count !== packet.count) {
        pending = { parts: [], received: 0, count: packet.count, createdAt: now };
        pendingProfileChunks[key] = pending;
    }
    if (pending.parts[packet.index] === undefined) {
        pending.parts[packet.index] = packet.payload;
        pending.received += 1;
    }
    if (pending.received < pending.count) return null;
    delete pendingProfileChunks[key];
    try {
        const completed = JSON.parse(pending.parts.join(""));
        return validPlayerProfile(completed) ? completed : null;
    } catch (error) {
        log("Failed to reassemble the complete player profile: " + error);
        return null;
    }
}

function flushOutgoingMessage(): void {
    if (!bridgeAvailable || outgoingMessages.length === 0) return;
    // join 命令返回只代表开始异步连接；TCP 尚未进入 connected 时保留队列，不能调用
    // Send 让桥接产生误导性的 “bridge is not connected” 错误事件。
    if ((role === "client" && bridgeNetworkState !== "connected") ||
        (role === "host" && bridgeNetworkState !== "hosting")) return;
    const now = Number(UnityEngine.Time.unscaledTime);
    if (now < nextOutgoingMessageAt) return;
    nextOutgoingMessageAt = advanceFixedDeadline(nextOutgoingMessageAt, now, OUTGOING_MESSAGE_INTERVAL);
    // 每帧最多四条：控制优先，至少给一个资料分片机会，其余发送最新实时状态。
    // 这让四名客户端的房主基础流量不会超过消费速度，同时避免大资料饿死。
    for (let sent = 0; sent < 4 && outgoingMessages.length > 0; sent++) {
        let index = outgoingMessages.findIndex(item => item.priority === 0);
        if (index < 0 && sent === 0) index = outgoingMessages.findIndex(item => item.priority === 2);
        if (index < 0) index = outgoingMessages.findIndex(item => item.priority === 1);
        if (index < 0) index = 0;
        const item = outgoingMessages.splice(index, 1)[0];
        const result = bridgeCall("send?peer=" + item.peerId + "&data=" + encodeURIComponent(item.data));
        if (result !== "0") log("Send failed; error code=" + result);
    }
}

function finiteNumber(value: any, fallback = 0): number {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function validPlayerState(packet: any): packet is PlayerStatePacket {
    const layersValid = Array.isArray(packet && packet.animations) && packet.animations.length <= 8 &&
        packet.animations.every((layer: any) => layer && Number.isFinite(Number(layer.hash)) &&
            Number.isFinite(Number(layer.time)) && Number.isFinite(Number(layer.weight)));
    return packet && packet.type === "playerState" && Number.isInteger(Number(packet.ownerId)) &&
        Number.isInteger(Number(packet.sequence)) && Number(packet.sequence) >= 0 &&
        packet.position && packet.rotation && packet.move && typeof packet.scene === "string" &&
        packet.scene.length <= 128 && String(packet.playerName || "").length <= 64 && layersValid &&
        [packet.position.x, packet.position.y, packet.position.z, packet.rotation.x, packet.rotation.y,
            packet.rotation.z, packet.rotation.w, packet.move.x, packet.move.y, packet.move.z]
            .every(value => Number.isFinite(Number(value)) && Math.abs(Number(value)) < 1000000);
}

function validPlayerProfile(packet: any): packet is PlayerProfilePacket {
    if (!packet || packet.type !== "playerProfile" || !Number.isInteger(Number(packet.ownerId)) ||
        !Number.isInteger(Number(packet.revision)) || !packet.profile || !Array.isArray(packet.profile.cloth) ||
        !packet.profile.customization || typeof packet.profile.customization !== "object" ||
        !packet.profile.progress || typeof packet.profile.progress !== "object") return false;
    if (packet.profile.cloth.length > 128) return false;
    return packet.profile.cloth.every((id: any) => typeof id === "string" && id.length <= 128);
}

function validPlayerLiveData(packet: any): packet is PlayerLiveDataPacket {
    return packet && packet.type === "playerLiveData" && Number.isInteger(Number(packet.ownerId)) &&
        Number.isInteger(Number(packet.sequence)) && Number(packet.sequence) >= 0 &&
        packet.status && typeof packet.status === "object" && Object.keys(packet.status).length <= 128 &&
        Number.isFinite(Number(packet.gameTime)) && Number.isFinite(Number(packet.timeOffset)) &&
        typeof packet.scene === "string" && packet.scene.length <= 128 &&
        String(packet.playerName || "").length <= 64;
}

function validWorldTime(packet: any): packet is WorldTimePacket {
    return packet && packet.type === "worldTime" && Number.isInteger(Number(packet.sequence)) &&
        Number.isFinite(Number(packet.gameTime)) && Number(packet.gameTime) >= 0 &&
        Number.isFinite(Number(packet.day)) && Number.isFinite(Number(packet.timeOfDay)) &&
        Number.isFinite(Number(packet.timeOffset));
}

