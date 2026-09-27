// 游戏 Hook 与入口。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
RegisterHook("System.Void GameManager::LoadGame(System.String)",
    (self: GameManager, saveName: string, ctx: IHookContext) => {
        if (!isCurrentGeneration() || saveNameRedirectInProgress || !isDefaultAutoSaveName(saveName)) return;
        const onlineName = onlineActiveSaveName();
        if (!onlineName) return;
        ctx.Intercept();
        saveNameRedirectInProgress = true;
        try {
            GameManager.SaveName = onlineName;
            onlineLoadRedirectedDuringStart = true;
            self.LoadGame(onlineName);
            log("Redirected the default load request to the online save: " + onlineName);
        } finally {
            saveNameRedirectInProgress = false;
        }
    });

RegisterHook("System.Void GameManager::SaveGame(System.String)",
    (self: GameManager, saveName: string, ctx: IHookContext) => {
        if (!isCurrentGeneration() || saveNameRedirectInProgress || !isDefaultAutoSaveName(saveName)) return;
        const onlineName = onlineActiveSaveName();
        if (!onlineName) return;
        ctx.Intercept();
        if (!onlineSaveWriteEnabled) {
            log("Ignored the default autosave while the online save is loading");
            return;
        }
        GameManager.SaveName = onlineName;
        const result = writeOnlineSaveSnapshot(self);
        if (result === "0") log("Redirected the default autosave to the online save: " + onlineName);
        else log("Online autosave failed; error code=" + result);
    });

// Player.Update 是进入存档后的稳定逐帧入口，用于处理网络队列和刷新界面状态。
RegisterHook("System.Void Player::Update()", (self: Player) => { updateBridge(self); });
// 客户端不能自行推进日期或时段。所有时间变化只接受房主的 worldTime 包；
// 应用房主数据以及全员睡眠获批时用布尔标记临时放行原版方法。
RegisterHook("System.Void PlayerStatus::AddTime()", (_self: PlayerStatus, ctx: IHookContext) => {
    if (isCurrentGeneration() && role === "client" && !applyingAuthoritativeTime && !sleepConsensusExecuting) ctx.Intercept();
});
RegisterHook("System.Void PlayerStatus::AddDay()", (_self: PlayerStatus, ctx: IHookContext) => {
    if (isCurrentGeneration() && role === "client" && !applyingAuthoritativeTime && !sleepConsensusExecuting) ctx.Intercept();
});
RegisterHook("System.Void PlayerStatus::SetTime(System.Int32)", (_self: PlayerStatus, _time: number, ctx: IHookContext) => {
    if (isCurrentGeneration() && role === "client" && !applyingAuthoritativeTime && !sleepConsensusExecuting) ctx.Intercept();
});
// 两种睡觉按钮都必须经过房主的全员确认；只有所有在线玩家在 20 秒内选择同一种
// 睡眠方式时，才在所有电脑上同时放行原版回调，单个玩家不能独自跳过夜晚。
RegisterHook("System.Void BedWindow::Start()", (self: BedWindow) => {
    if (!isCurrentGeneration()) return;
    bedWindowInstance = self;
    JintCoroutine.WaitForNextFrame(self, () => {
        if (isCurrentGeneration()) buildBedSaveButton(self);
    });
});
RegisterHook("System.Void BedWindow::<Start>b__2_0()", (_self: BedWindow, ctx: IHookContext) => {
    if (isCurrentGeneration()) requestConsensusSleep("short", ctx);
});
RegisterHook("System.Void BedWindow::<Start>b__2_1()", (_self: BedWindow, ctx: IHookContext) => {
    if (isCurrentGeneration()) requestConsensusSleep("tomorrow", ctx);
});
// PauseWindow.Start 的原生初始化完成后，在下一帧复制“设置”按钮，避免覆盖游戏自己的监听器。
RegisterHook("System.Void PauseWindow::Start()", (self: PauseWindow) => {
    if (!isCurrentGeneration()) return;
    JintCoroutine.WaitForNextFrame(self, () => {
        if (!isCurrentGeneration()) return;
        try {
            const nativeLabel = self.setting ? findTextInChildren(self.setting.transform) : null;
            ensureUi(nativeLabel ? (nativeLabel as any).font : null);
            // updateBridge 可能已在窗口打开时主动补建，避免同一帧重复克隆和绑定按钮。
            if (!pauseButtonLayout) buildPauseMenuButton(self);
            // 联机暂停菜单只打开 UI，不冻结世界时间；其他玩家和网络状态继续更新。
            keepOnlineWorldRunning();
            syncGameLanguage();
        } catch (error) { log("Pause-menu UI initialization failed: " + error); }
    });
});
// MainMenu.Awake 用于尽早创建联机面板；面板会跨场景保留。
RegisterHook("System.Void MainMenu::Awake()", (self: MainMenu) => {
    if (!isCurrentGeneration()) return;
    try {
        mainMenuInstance = self;
        syncGameLanguage();
        const nativeLabel = self.newGame ? findTextInChildren(self.newGame.transform) : null;
        ensureUi(nativeLabel ? (nativeLabel as any).font : (self.version ? (self.version as any).font : null));
        buildMainMenuButton(self);
        startMainMenuInputLoop(self);
    } catch (error) { log("Main-menu UI initialization failed: " + error); }
    const config = loadConfig();
    if (config.smokeTestOnlineLifecycle) {
        if (!smokeTestScheduled) {
            smokeTestScheduled = true;
            log("Diagnostics: waiting for the real online-save lifecycle test");
            scheduleSmokeOnlineLifecycle(self);
        }
        return;
    }
    if (!config.smokeTestAutoLoad || smokeTestScheduled) return;
    smokeTestScheduled = true;
    log("Diagnostics: waiting for main-menu initialization");
    if (config.smokeTestUiOpen) {
        JintCoroutine.WaitForSeconds(self, 1, () => {
            if (!isCurrentGeneration()) return;
            openPanel();
            log("Diagnostics: opened the multiplayer UI for capture");
        });
    }
    JintCoroutine.WaitForSeconds(self, config.smokeTestUiOpen ? 7 : 2, () => {
        if (!isCurrentGeneration()) return;
        try {
            closePanel();
            self.StartGame();
            if (GameManager.Singleton) {
                log("Diagnostics: loading AutoSave");
                GameManager.Singleton.LoadGame("AutoSave");
            } else log("Diagnostics: GameManager is still unavailable after StartGame");
        } catch (error) { log("Diagnostics: game loading failed: " + error); }
    });
});

// 原版读取/保存窗口枚举同一 Saves 目录。拦截联机正式档和运行期临时档，保证单机模式
// 永远不会显示、读取或覆盖它们；联机面板只读取桥接程序提供的线上存档列表。
RegisterHook("System.Void LoadSaveWindow::CreateLoadSlot(System.String,System.IO.FileInfo)",
    (_self: LoadSaveWindow, saveName: string, _fileInfo: any, ctx: IHookContext) => {
        if (isOnlineSaveSlot(saveName)) ctx.Intercept();
    });
// 第二层保护：即使其他 Mod 手动创建了联机槽位，也禁止原版单机读取窗口加载它。
RegisterHook("System.Void LoadSaveWindow::Load(System.String)",
    (_self: LoadSaveWindow, saveName: string, ctx: IHookContext) => {
        if (isOnlineSaveSlot(saveName)) {
            log("Blocked the single-player load window from opening an online save: " + saveName);
            ctx.Intercept();
        }
    });
RegisterHook("System.Void SaveTab::CreateSlotUI(System.String,System.IO.FileInfo)",
    (_self: SaveTab, saveName: string, _fileInfo: any, ctx: IHookContext) => {
        if (isOnlineSaveSlot(saveName)) ctx.Intercept();
    });
// 保存页同样不能覆盖联机正式档或运行期临时档。
RegisterHook("System.Void SaveTab::ExecuteSave(System.String)",
    (_self: SaveTab, saveName: string, ctx: IHookContext) => {
        if (isOnlineSaveSlot(saveName)) {
            log("Blocked the single-player save window from overwriting an online save: " + saveName);
            ctx.Intercept();
        }
    });
// 联机期间原版暂停/保存界面不拥有线上档的删除权限。即使其他 Mod 重新显示了
// 删除按钮或直接调用 DeleteSave，也会在真正触碰磁盘前被阻止。
RegisterHook("System.Void SaveTab::DeleteSave(System.String)",
    (_self: SaveTab, saveName: string, ctx: IHookContext) => {
        if (role !== "off" || isOnlineSaveSlot(saveName)) {
            log("Blocked the pause menu from deleting a save during online mode: " + saveName);
            ctx.Intercept();
        }
    });

// 原版 Translate 会在当前调用末尾重新写入克隆按钮的“新建游戏”文本，所以必须等到下一帧
// 再强制刷新联机入口；仅检测语言编号变化不够，因为这时语言编号可能已经是新值。
RegisterHook("System.Void MainMenu::Translate(UnityEngine.Transform,System.Boolean)", (self: MainMenu) => {
    if (!isCurrentGeneration() || mainMenuTranslationRefreshPending) return;
    mainMenuTranslationRefreshPending = true;
    JintCoroutine.WaitForNextFrame(self, () => {
        mainMenuTranslationRefreshPending = false;
        if (!isCurrentGeneration()) return;
        syncGameLanguage(true);
    });
});

syncGameLanguage(true);
log("Script initialized; protocol=" + PROTOCOL_VERSION + "; UI generation=" + SCRIPT_GENERATION);
startBridge();
