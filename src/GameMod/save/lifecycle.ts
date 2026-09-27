// 线上存档进入、首次创建和离开联机会话。
function enterOnlineSave(): void {
    const menu = mainMenuInstance;
    if (!menu) {
        // 暂停菜单可以修改联机参数，但创建或切换线上存档必须回到主菜单，避免覆盖当前单机进度。
        if (!GameManager.InGame) toast(tr("toast.onlineSaveFailed"));
        return;
    }

    const config = loadConfig();
    onlineSaveWriteEnabled = false;
    onlineSaveSessionReady = false;
    const forcedTestSave = BRIDGE_CHANNEL !== "default" && config.smokeTestOnlineLifecycle &&
        hasUuidV7OnlineName(config.smokeTestOnlineSaveName) ? config.smokeTestOnlineSaveName : "";
    if (forcedTestSave) {
        selectedSaveName = forcedTestSave;
    }
    const state = readBridgeState();
    // 自动化只允许访问本次随机 UUID，绝不能因为开发机已有线上档而切换到用户文件。
    const saves = forcedTestSave ? [] : (state && state.saves ? state.saves : []);
    // 当前脚本内存中的选择是首选依据。state.json 正在刷新或桥接刚启动时，saves 可能
    // 暂时为空；不能因此直接创建新档，必须让桥接程序到磁盘上验证。
    let rememberedSave = selectedSaveName.startsWith(ONLINE_SAVE_PREFIX) ? selectedSaveName : "";
    const rememberedIsListed = rememberedSave && saves.some(save => save.name === rememberedSave);
    // 索引非空时以磁盘结果为准：旧选择已丢失就续读最近的现存档，而不是另建一个。
    if (saves.length > 0 && !rememberedIsListed) {
        selectedSaveName = saves[0].name;
        rememberedSave = selectedSaveName;
    }

    if (!hasUuidV7OnlineName(rememberedSave) && rememberedSave) {
        // 旧版时间戳文件只迁移名称，桥接程序不会解密或改写其中的存档内容。
        const migratedName = makeOnlineSaveName();
        const migrateSequence = submitBridgeCommandTracked("renameSave?name=" + encodeURIComponent(rememberedSave) +
            "&target=" + encodeURIComponent(migratedName));
        if (migrateSequence < 0) { toast(tr("toast.onlineSaveFailed")); return; }
        waitForBridgeResponse(menu, migrateSequence, result => {
            if (result === "0" || result === "-4") {
                selectedSaveName = migratedName;
                log("Migrated the legacy online save to the player's UUIDv7 slot: " + selectedSaveName);
                enterOnlineSave();
                return;
            }
            if (result === "-3") {
                log("The legacy online save no longer exists; creating the player's first UUIDv7 online save");
                createInitialOnlineSave(menu);
                return;
            }
            log("Failed to migrate the UUIDv7 online save; error code=" + result);
            toast(tr("toast.onlineSaveFailed"));
        });
        return;
    }

    // 即使脚本内存和刚启动时的状态快照都为空，也必须让桥接程序权威扫描磁盘。
    // prepareSave 只有在正式档与工作副本都不存在时才返回 -3，此时才允许创建首个线上档。
    const requestedSaveName = rememberedSave || selectedSaveName;
    // 自动化随机 UUID 必须严格隔离，不能回退到开发机上的真实玩家存档。
    const strictTestName = forcedTestSave ? "&strict=1" : "";
    const sequence = submitBridgeCommandTracked("prepareSave?name=" + encodeURIComponent(requestedSaveName) + strictTestName);
    if (sequence < 0) { toast(tr("toast.onlineSaveFailed")); return; }
    waitForBridgeResponse(menu, sequence, result => {
            if (result === "-3") {
                log("No formal online save or recovery copy exists; creating the first online save");
                createInitialOnlineSave(menu);
                return;
            }
            if (result !== "0") { log("Failed to prepare the online save; error code=" + result); toast(tr("toast.onlineSaveFailed")); return; }
            try {
                preparedOnlineSaveMetadata = readPreparedSaveMetadata(requestedSaveName);
                if (!preparedOnlineSaveMetadata || !hasUuidV7OnlineName(preparedOnlineSaveMetadata.save))
                    throw new Error("The bridge did not return valid UUIDv7 online-save metadata");
                selectedSaveName = preparedOnlineSaveMetadata.save;
                const activeName = activeSaveName(selectedSaveName);
                if (!activeName) throw new Error("Could not create the online working-copy name");
                // 桥接实际选中的磁盘文件具有最高优先级；文件名本身持久保存 UUIDv7。
                // 在 StartGame 执行任何原版默认读取之前就切换到联机专属名称。
                GameManager.SaveName = activeName;
                onlineLoadRedirectedDuringStart = false;
                menu.StartGame();
                waitForPlayableGame(gameCoroutineOwner(menu), manager => {
                    // StartGame 内的早期 LoadGame 会在新游戏初始化期间被出生点覆盖。无论该 Hook
                    // 是否触发，都必须等新场景玩家建立后再由当前 GameManager 正式载入一次。
                    GameManager.SaveName = activeName;
                    manager.LoadGame(activeName);
                    closePanel();
                    log("Loaded online save: " + selectedSaveName);
                    // 原版晚加载不会再执行初始化阶段的 PlayerPosition；等订阅组件收尾后补应用场景位置。
                    JintCoroutine.WaitForSeconds(manager, 2, () => {
                        // 原版晚加载在部分版本不会重新构建 PlayerCloth，显式应用存档中已装备服装。
                        applyPreparedOnlineClothing();
                        applyPreparedOnlineLocation(() => {
                            const releaseResult = submitBridgeCommandAndWait("releaseSave");
                            if (releaseResult !== "0")
                                log("Failed to release the temporary online-save working copy; error code=" + releaseResult);
                            const enableResult = releaseResult === "0"
                                ? submitBridgeCommandAndWait("enableSaveWrites") : "-8";
                            onlineSaveWriteEnabled = enableResult === "0";
                            onlineSaveSessionReady = onlineSaveWriteEnabled;
                            if (!onlineSaveWriteEnabled)
                                log("Online-save writes remain blocked because loading did not finish safely; error code=" + enableResult);
                            if (config.smokeTestOnlineLifecycle) waitForSavableGame(manager, () => {
                                log("Diagnostics: resumed online save reached a playable state save=" + selectedSaveName);
                            });
                        });
                    });
                });
            } catch (error) { log("Failed to load the online save: " + error); toast(tr("toast.onlineSaveFailed")); }
    });
}

function createInitialOnlineSave(menu: MainMenu): void {
    // 磁盘上确实没有线上档时才从游戏的新游戏初始状态开始，绝不复制任何单机存档。
    selectedSaveName = makeOnlineSaveName();
    onlineSaveWriteEnabled = false;
    onlineSaveSessionReady = false;
    const activeName = activeSaveName(selectedSaveName);
    const sequence = submitBridgeCommandTracked("beginSave?name=" + encodeURIComponent(selectedSaveName));
    if (sequence < 0) { toast(tr("toast.onlineSaveFailed")); return; }
    waitForBridgeResponse(menu, sequence, result => {
        if (result !== "0") { log("Failed to create the online-save session; error code=" + result); toast(tr("toast.onlineSaveFailed")); return; }
        try {
            GameManager.SaveName = activeName;
            menu.StartGame();
            waitForSavableGame(gameCoroutineOwner(menu), manager => {
                GameManager.SaveName = activeName;
                // Jint 再入调用原生 SaveGame 会在部分版本留下 0 字节 StreamWriter 文件。
                // 直接提交 GetSave JSON，由桥按原版算法生成第一层，再套 Mod 第二层。
                const enableResult = submitBridgeCommandAndWait("enableSaveWrites");
                onlineSaveWriteEnabled = enableResult === "0";
                const saveResult = onlineSaveWriteEnabled ? writeOnlineSaveSnapshot(manager) : enableResult;
                if (saveResult === "0") {
                    onlineSaveSessionReady = true;
                    log("Diagnostics: first online save was committed to the formal encrypted container save=" + selectedSaveName);
                } else log("Failed to commit the first online save; error code=" + saveResult);
                closePanel();
                toast(tr("toast.onlineSaveCreated"));
                log("Created the first online save from a clean game: " + selectedSaveName);
            });
        } catch (error) { log("Failed to create the online save: " + error); toast(tr("toast.onlineSaveFailed")); }
    });
}

function stopFromUi(): void {
    try { bridgeCall("stop"); } catch (_error) { }
    role = "off";
    onlineSaveWriteEnabled = false;
    onlineSaveSessionReady = false;
    networkTransport = "direct";
    currentPublicRoom = "";
    localNetworkId = -1;
    clientEntryStarted = false;
    serverTimeSeedSent = false;
    authoritativeServerScene = "";
    lastServerSceneRequest = "";
    serverSceneTransitionPending = false;
    clearRemotePlayers();
    outgoingMessages.splice(0, outgoingMessages.length);
    for (const key of Object.keys(sleepReady)) delete sleepReady[key];
    // 下一帧统一布局函数会恢复原版“读取”按钮并重新计算间距。
    lastPauseLayoutOnline = null;
    updateStatusText(tr("status.offline"));
    toast(tr("toast.stopped"));
}
