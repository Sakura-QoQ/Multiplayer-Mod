// 线上存档进入流程。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function activeSaveName(onlineName: string): string {
    return onlineName.startsWith(ONLINE_SAVE_PREFIX)
        ? ACTIVE_SAVE_PREFIX + onlineName.substring(ONLINE_SAVE_PREFIX.length)
        : "";
}

function onlineActiveSaveName(): string {
    if (role === "off") return "";
    return activeSaveName(selectedSaveName);
}

function isDefaultAutoSaveName(value: string): boolean {
    const normalized = String(value || "AutoSave").replace(/\\/g, "/");
    const fileName = normalized.substring(normalized.lastIndexOf("/") + 1).replace(/\.save$/i, "");
    return fileName.toLowerCase() === "autosave";
}

function isOnlineSaveSlot(value: string): boolean {
    // 原版不同页面传入的可能是槽位名、文件名或完整路径；统一提取文件名并忽略大小写。
    const normalized = String(value || "").replace(/\\/g, "/");
    const fileName = normalized.substring(normalized.lastIndexOf("/") + 1).replace(/\.save$/i, "");
    const lowerName = fileName.toLowerCase();
    return lowerName.startsWith(ONLINE_SAVE_PREFIX.toLowerCase()) ||
        lowerName.startsWith(ACTIVE_SAVE_PREFIX.toLowerCase());
}

function isUuidV7(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function createUuidV7(): string {
    // UUIDv7：前 48 位是 Unix 毫秒时间，版本位固定为 7，variant 固定为 RFC 9562 的 10。
    // 其余 74 位使用 Jint 的随机源；时间有序且每位玩家发生碰撞的概率可以忽略。
    const bytes: number[] = [];
    for (let index = 0; index < 16; index++) bytes.push(Math.floor(Math.random() * 256));
    let timestamp = Date.now();
    for (let index = 5; index >= 0; index--) {
        bytes[index] = timestamp % 256;
        timestamp = Math.floor(timestamp / 256);
    }
    bytes[6] = 0x70 | (bytes[6] & 0x0f);
    bytes[8] = 0x80 | (bytes[8] & 0x3f);
    const hex = bytes.map(value => ("0" + Math.floor(value).toString(16)).slice(-2)).join("");
    return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-" +
        hex.substring(16, 20) + "-" + hex.substring(20);
}

function getOrCreateOnlineSaveId(): string {
    const existing = UnityEngine.PlayerPrefs.GetString(ONLINE_SAVE_ID_KEY, "");
    if (isUuidV7(existing)) return existing.toLowerCase();
    const created = createUuidV7();
    UnityEngine.PlayerPrefs.SetString(ONLINE_SAVE_ID_KEY, created);
    UnityEngine.PlayerPrefs.Save();
    return created;
}

function hasUuidV7OnlineName(value: string): boolean {
    return value.startsWith(ONLINE_SAVE_PREFIX) && isUuidV7(value.substring(ONLINE_SAVE_PREFIX.length));
}

function makeOnlineSaveName(): string {
    // 每位玩家只生成一次 UUIDv7；之后建房、自动保存和重新进入都复用同一专属 ID。
    return ONLINE_SAVE_PREFIX + getOrCreateOnlineSaveId();
}

type GameReadyPredicate = (manager: GameManager) => boolean;

function waitForGameState(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void,
    predicate: GameReadyPredicate, remaining: number, settleFrames = 0): void {
    if (!isCurrentGeneration()) return;
    // 场景切换期间旧单例仍可能存活；调用者可要求先让出若干帧，再检查目标状态。
    if (settleFrames > 0) {
        JintCoroutine.WaitForNextFrame(owner,
            () => waitForGameState(owner, callback, predicate, remaining, settleFrames - 1));
        return;
    }
    try {
        const manager = GameManager.Singleton;
        if (manager && predicate(manager)) { callback(manager); return; }
    } catch (_error) { }
    if (remaining <= 0) { toast(tr("toast.onlineSaveFailed")); return; }
    JintCoroutine.WaitForNextFrame(owner,
        () => waitForGameState(owner, callback, predicate, remaining - 1));
}

function waitForGameManager(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void,
    remaining = 180, settleFrames = 2): void {
    waitForGameState(owner, callback, _manager => true, remaining, settleFrames);
}

function waitForPlayableGame(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void, remaining = 600): void {
    waitForGameState(owner, callback, _manager => Boolean(GameManager.InGame && Player.LocalPlayer), remaining);
}

function waitForSavableGame(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void, remaining = 900): void {
    waitForGameState(owner, callback, manager => {
        if (!GameManager.InGame || !Player.LocalPlayer) return false;
        const raw = manager.GetSave();
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
    }, remaining);
}

function gameCoroutineOwner(menu: MainMenu): UnityEngine.MonoBehaviour {
    // UI 根节点使用 DontDestroyOnLoad，优先让等待任务绑定到它的常驻 MonoBehaviour。
    if (coroutineRunner) return coroutineRunner;
    try { if (GameManager.Singleton) return GameManager.Singleton; } catch (_error) { }
    try {
        const manager = menu.gameManager ? menu.gameManager.GetComponent("GameManager") : null;
        if (manager) return manager as GameManager;
    } catch (_error) { }
    return menu;
}

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
        UnityEngine.PlayerPrefs.SetString(prefKey("MPB.SelectedSave"), selectedSaveName);
        UnityEngine.PlayerPrefs.SetString(ONLINE_SAVE_ID_KEY,
            selectedSaveName.substring(ONLINE_SAVE_PREFIX.length).toLowerCase());
        UnityEngine.PlayerPrefs.Save();
    }
    const state = readBridgeState();
    // 自动化只允许访问本次随机 UUID，绝不能因为开发机已有线上档而切换到用户文件。
    const saves = forcedTestSave ? [] : (state && state.saves ? state.saves : []);
    // PlayerPrefs 中的上次线上档名是首选依据。state.json 正在刷新或桥接刚启动时，
    // saves 可能暂时为空；不能因此直接创建新档，必须让桥接程序到磁盘上验证。
    let rememberedSave = selectedSaveName.startsWith(ONLINE_SAVE_PREFIX) ? selectedSaveName : "";
    const rememberedIsListed = rememberedSave && saves.some(save => save.name === rememberedSave);
    // 索引非空时以磁盘结果为准：旧选择已丢失就续读最近的现存档，而不是另建一个。
    if (saves.length > 0 && !rememberedIsListed) {
        selectedSaveName = saves[0].name;
        rememberedSave = selectedSaveName;
        UnityEngine.PlayerPrefs.SetString(prefKey("MPB.SelectedSave"), selectedSaveName);
        UnityEngine.PlayerPrefs.Save();
    }

    if (hasUuidV7OnlineName(rememberedSave)) {
        // 从其他电脑复制来的 UUIDv7 线上档也应成为当前玩家后续固定使用的专属 ID。
        UnityEngine.PlayerPrefs.SetString(ONLINE_SAVE_ID_KEY,
            rememberedSave.substring(ONLINE_SAVE_PREFIX.length).toLowerCase());
        UnityEngine.PlayerPrefs.Save();
    } else if (rememberedSave) {
        // 旧版时间戳文件只迁移名称，桥接程序不会解密或改写其中的存档内容。
        const migratedName = makeOnlineSaveName();
        const migrateSequence = submitBridgeCommandTracked("renameSave?name=" + encodeURIComponent(rememberedSave) +
            "&target=" + encodeURIComponent(migratedName));
        if (migrateSequence < 0) { toast(tr("toast.onlineSaveFailed")); return; }
        waitForBridgeResponse(menu, migrateSequence, result => {
            if (result === "0" || result === "-4") {
                selectedSaveName = migratedName;
                UnityEngine.PlayerPrefs.SetString(prefKey("MPB.SelectedSave"), selectedSaveName);
                UnityEngine.PlayerPrefs.Save();
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

    // 即使 PlayerPrefs 和刚启动时的状态快照都为空，也必须让桥接程序权威扫描磁盘。
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
                // 桥接实际选中的磁盘文件具有最高优先级，同时修复被清除或过期的 PlayerPrefs。
                UnityEngine.PlayerPrefs.SetString(prefKey("MPB.SelectedSave"), selectedSaveName);
                UnityEngine.PlayerPrefs.SetString(ONLINE_SAVE_ID_KEY,
                    selectedSaveName.substring(ONLINE_SAVE_PREFIX.length).toLowerCase());
                UnityEngine.PlayerPrefs.Save();
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
    UnityEngine.PlayerPrefs.SetString(prefKey("MPB.SelectedSave"), selectedSaveName);
    UnityEngine.PlayerPrefs.Save();
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
