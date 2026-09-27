// 网络事件路由。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function processEvent(rawEvent: string): void {
    const event = JSON.parse(rawEvent);
    if (!event || !event.type) return;
    if (event.type === "listening") {
        updateStatusText();
        return;
    }
    if (event.type === "connected") {
        log("Connection established peer=" + event.peerId);
        // 客户端建立 TCP 连接后先发送协议版本和玩家名，由房主确认兼容性。
        if (role === "client") {
            localNetworkId = -1;
            send(0, { type: "hello", protocol: PROTOCOL_VERSION, playerName: currentPlayerName });
        }
        updateStatusText();
        return;
    }
    if (event.type === "message") {
        const packet = JSON.parse(event.message);
        if (role === "host" && packet.type === "hello") {
            if (packet.protocol !== PROTOCOL_VERSION) { log("Client protocol mismatch peer=" + event.peerId); return; }
            const isNewPeer = peerNames[String(event.peerId)] === undefined;
            peerNames[String(event.peerId)] = String(packet.playerName || "Player");
            log("Player joined: " + peerNames[String(event.peerId)] + " peer=" + event.peerId);
            send(event.peerId, { type: "welcome", protocol: PROTOCOL_VERSION, peerId: event.peerId });
            // 新玩家需要立即收到房主和已在线玩家的完整外观/个人进度，而不是等待资料变化。
            if (isNewPeer) {
                lastLocalProfileJson = "";
                for (const ownerKey of Object.keys(remoteProfiles)) {
                    sendPlayerProfilePacket(event.peerId, {
                        type: "playerProfile", ownerId: Number(ownerKey),
                        playerName: peerNames[ownerKey] || "Player",
                        revision: remoteProfileRevisions[ownerKey] || 1, profile: remoteProfiles[ownerKey]
                    });
                }
                toast(tr("toast.playerJoined", { player: packet.playerName }));
            }
        } else if (role === "client" && packet.type === "welcome") {
            if (packet.protocol !== PROTOCOL_VERSION) return;
            const firstWelcome = localNetworkId < 0;
            localNetworkId = Math.trunc(Number(packet.peerId));
            if (firstWelcome) {
                lastLocalProfileJson = "";
                toast(tr("toast.joinedRoom", { peer: packet.peerId }));
            }
            // 加入房间不是只建立 TCP：握手成功后必须进入本机专属线上存档，才能创建
            // Player、开始状态同步并在场景里真正看到其他玩家。诊断自动加载模式自行进场。
            if (!clientEntryStarted && mainMenuInstance && !loadConfig().smokeTestAutoLoad) {
                clientEntryStarted = true;
                enterOnlineSave();
            }
        } else if (packet.type === "playerState" && validPlayerState(packet)) {
            if (role === "host") {
                packet.ownerId = Math.trunc(Number(event.peerId));
                packet.playerName = peerNames[String(event.peerId)] || String(packet.playerName || "Player");
                applyRemotePlayerState(packet);
                // 房主是星型拓扑中心：转发后客户端之间也能互相看到。
                send(0, packet);
            } else applyRemotePlayerState(packet);
        } else if (packet.type === "playerLiveData" && validPlayerLiveData(packet)) {
            if (role === "host") {
                packet.ownerId = Math.trunc(Number(event.peerId));
                packet.playerName = peerNames[String(event.peerId)] || String(packet.playerName || "Player");
                applyRemotePlayerLiveData(packet);
                send(0, packet);
            } else applyRemotePlayerLiveData(packet);
        } else if (packet.type === "worldTime" && validWorldTime(packet)) {
            // 星型拓扑中只有客户端接受服务器发来的权威时间；房主忽略客户端伪造的时间包。
            if (role === "client") applyAuthoritativeWorldTime(packet);
        } else if (packet.type === "sleepRequest" && role === "host" && validSleepMode(packet.mode)) {
            sleepReady[String(event.peerId)] = {
                mode: packet.mode,
                at: Number(UnityEngine.Time.unscaledTime)
            };
            tryApproveSleep();
        } else if (packet.type === "sleepApproved" && role === "client" && validSleepMode(packet.mode) &&
            Number.isInteger(Number(packet.sequence))) {
            const sequence = Number(packet.sequence);
            // 睡眠会立即切换游戏状态，期间 Player.Update 可能暂停。必须先把 ACK 强制刷入桥接，
            // 不能留在普通发送队列里等待下一帧，否则房主会一直重发直到确认超时。
            send(0, { type: "sleepAck", sequence } as SleepAckPacket);
            nextOutgoingMessageAt = 0;
            flushOutgoingMessage();
            if (sequence > lastSleepApprovalSequence) {
                lastSleepApprovalSequence = sequence;
                log("Received unanimous sleep approval: " + packet.mode + "; sequence=" + sequence);
                invokeApprovedSleep(packet.mode);
            }
            // 重复批准同样会在上方立即 ACK，但绝不重复执行睡眠。
        } else if (packet.type === "sleepAck" && role === "host" && pendingSleepApproval &&
            Number(packet.sequence) === pendingSleepApproval.packet.sequence) {
            pendingSleepApproval.acknowledged[String(event.peerId)] = true;
        } else if (packet.type === "playerProfileChunk" && validPlayerProfileChunk(packet)) {
            const completed = receivePlayerProfileChunk(packet, Number(event.peerId) || 0);
            if (completed) processPlayerProfilePacket(completed, Number(event.peerId) || 0);
        } else if (packet.type === "playerProfile" && validPlayerProfile(packet)) {
            processPlayerProfilePacket(packet, Number(event.peerId) || 0);
        } else if (packet.type === "playerLeft") {
            destroyRemotePlayer(Math.trunc(Number(packet.ownerId)));
            delete remoteProfiles[String(packet.ownerId)];
            delete remoteProfileRevisions[String(packet.ownerId)];
            delete latestPlayerStates[String(packet.ownerId)];
            delete lastRemoteSequences[String(packet.ownerId)];
            delete lastRemoteLiveDataSequences[String(packet.ownerId)];
        }
        return;
    }
    if (event.type === "error") { log("Network error: " + event.message); updateStatusText(tr("status.networkError", { error: event.message })); }
    else if (event.type === "disconnected") {
        log("Connection disconnected peer=" + event.peerId);
        if (role === "host") {
            destroyRemotePlayer(Number(event.peerId));
            delete peerNames[String(event.peerId)];
            delete remoteProfiles[String(event.peerId)];
            delete remoteProfileRevisions[String(event.peerId)];
            delete latestPlayerStates[String(event.peerId)];
            delete lastRemoteSequences[String(event.peerId)];
            delete lastRemoteLiveDataSequences[String(event.peerId)];
            delete sleepReady[String(event.peerId)];
            send(0, { type: "playerLeft", ownerId: Number(event.peerId) });
        } else {
            localNetworkId = -1;
            clearRemotePlayers();
        }
        updateStatusText();
    }
}

function processPlayerProfilePacket(packet: PlayerProfilePacket, sourcePeerId: number): void {
    if (role === "host") {
        packet.ownerId = Math.trunc(sourcePeerId);
        packet.playerName = peerNames[String(sourcePeerId)] || String(packet.playerName || "Player");
        adoptLatestRoomDay(packet.profile);
        applyRemotePlayerProfile(packet);
        sendPlayerProfilePacket(0, packet);
    } else applyRemotePlayerProfile(packet);
}

