// 联机配置页面。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function buildUi(font: any): void {
    if (!font || uiRoot) return;
    try {
        const config = loadConfig();
        const shell = createMultiplayerCanvasShell();
        uiRoot = shell.root;
        uiPanel = shell.panel;
        uiConfigBody = shell.body;
        coroutineRunner = shell.runner;
        uiFont = font;
        const bridgeState = readBridgeState();
        selectedSaveName = bridgeState && bridgeState.saves && bridgeState.saves.length > 0
            ? bridgeState.saves[0].name : "";
        buildPlayerListPage(shell.root.transform, font);
        buildRoomInfoPage(shell.panel.transform, font);

        uiTitle = makeText(shell.panel.transform, "Title", tr("panel.title"), font, 145, 4, 470, 72, 44);
        (uiTitle as any).alignment = 4;
        uiBackButton = makeButton(shell.panel.transform, "PanelBack", tr("button.back"), font,
            610, 18, 120, navigatePanelBack, 48);
        uiBackButton.SetActive(false);

        const configBody = shell.body;

        uiStatus = makeText(configBody.transform, "Status", statusLabel(), font, 30, 18, 660, 46, 27);
        (uiStatus as any).alignment = 4;
        makeText(configBody.transform, "NameLabel", tr("field.playerName"), font, 30, 82, 135, 46, 24);
        uiName = makeInput(configBody.transform, "PlayerName", currentPlayerName || config.playerName,
            tr("placeholder.playerName"), font, 170, 80, 520);
        makeButton(configBody.transform, "LocalMultiplayer", tr("button.localMultiplayer"), font, 30, 160, 319, () => openPanelMode("local"), 58);
        makeButton(configBody.transform, "PublicServers", tr("button.publicServers"), font, 370, 160, 319, requestPublicRoomListFromUi, 58);
        makeButton(configBody.transform, "Stop", tr("button.stop"), font, 257, 240, 205, stopFromUi, 52);
        // 联机存档由建房流程自动选择最近的有效存档，不再创建“选择存档”子页面，
        // 也不提供与自动续档规则冲突的“新建线上存档”按钮。
        makeText(configBody.transform, "Privacy", tr("privacy"), font, 30, 320, 660, 70, 18);
        uiPlayerInfo = makeText(configBody.transform, "Players", tr("players.title"), font, 30, 405, 660, 200, 18);
        (uiPlayerInfo as any).alignment = 0;
        refreshPlayerInfoUi();

        uiLocalBody = makeSolidRect(shell.panel.transform, "LocalBody",
            new UnityEngine.Color(0.34, 0.34, 0.34, 0.58), 20, 92, 720, 620);
        makeText(uiLocalBody.transform, "AddressLabel", tr("field.address"), font, 30, 55, 135, 46, 24);
        // 本地多人地址每次打开游戏默认留空，避免玩家误把回环地址当成另一台电脑。
        uiAddress = makeInput(uiLocalBody.transform, "Address", "", tr("placeholder.address"), font, 170, 55, 520);
        makeText(uiLocalBody.transform, "PortLabel", tr("field.port"), font, 30, 125, 135, 46, 24);
        uiPort = makeInput(uiLocalBody.transform, "Port", String(config.port), tr("placeholder.port"), font, 170, 125, 520);
        makeButton(uiLocalBody.transform, "Host", tr("button.host"), font, 30, 210, 319, startHostFromUi, 58);
        makeButton(uiLocalBody.transform, "Join", tr("button.join"), font, 370, 210, 319, joinFromUi, 58);
        uiLocalBody.SetActive(false);

        uiPublicRoomsBody = makeSolidRect(shell.panel.transform, "PublicRoomsBody",
            new UnityEngine.Color(0.34, 0.34, 0.34, 0.58), 20, 92, 720, 620);
        makeText(uiPublicRoomsBody.transform, "PublicHint", tr("publicRoom.choose"), font, 30, 35, 660, 50, 27);
        uiPublicPreviousButton = makeButton(uiPublicRoomsBody.transform, "PublicPrevious",
            tr("button.previous"), font, 55, 430, 190, () => changePublicRoomPage(-1), 52);
        makeButton(uiPublicRoomsBody.transform, "RefreshRooms", tr("button.refresh"), font,
            265, 430, 190, requestPublicRoomListFromUi, 52);
        uiPublicNextButton = makeButton(uiPublicRoomsBody.transform, "PublicNext",
            tr("button.next"), font, 475, 430, 190, () => changePublicRoomPage(1), 52);
        uiPublicRoomsBody.SetActive(false);
        refreshPublicRoomButtons();

        makeButton(shell.panel.transform, "Cancel", tr("button.cancel"), font, 130, 740, 500, closePanel, 64);
        shell.panel.SetActive(false);
        log("Created the in-game multiplayer UI with the native load-window style");
    } catch (error) {
        uiRoot = null;
        coroutineRunner = null;
        log("Failed to create the multiplayer UI: " + error);
    }
}

function handleUiInput(): void {
    try {
        if (uiPanel && uiPanel.activeSelf && Input.GetKeyDown(KeyCode.Escape)) navigatePanelBack();
        handlePlayerListInput();
    } catch (error) { log("Failed to process the Escape key: " + error); }
}

function startMainMenuInputLoop(owner: UnityEngine.MonoBehaviour): void {
    if (uiInputLoopStarted) return;
    uiInputLoopStarted = true;
    const nextFrame = () => {
        if (!isCurrentGeneration()) return;
        updateBridge(null);
        JintCoroutine.WaitForNextFrame(owner, nextFrame);
    };
    JintCoroutine.WaitForNextFrame(owner, nextFrame);
}
