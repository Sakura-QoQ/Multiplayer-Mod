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
        selectedSaveName = UnityEngine.PlayerPrefs.GetString(prefKey("MPB.SelectedSave"), "");
        buildPlayerListPage(shell.root.transform, font);
        buildRoomInfoPage(shell.panel.transform, font);

        uiTitle = makeText(shell.panel.transform, "Title", tr("panel.title"), font, 80, 4, 600, 72, 44);
        (uiTitle as any).alignment = 4;

        const configBody = shell.body;

        uiStatus = makeText(configBody.transform, "Status", statusLabel(), font, 30, 18, 660, 46, 27);
        (uiStatus as any).alignment = 4;
        makeText(configBody.transform, "AddressLabel", tr("field.address"), font, 30, 78, 135, 46, 24);
        makeText(configBody.transform, "PortLabel", tr("field.port"), font, 440, 78, 72, 46, 24);
        uiAddress = makeInput(configBody.transform, "Address", UnityEngine.PlayerPrefs.GetString(prefKey("MPB.Address"), config.address), tr("placeholder.address"), font, 170, 76, 250);
        uiPort = makeInput(configBody.transform, "Port", UnityEngine.PlayerPrefs.GetString(prefKey("MPB.Port"), String(config.port)), tr("placeholder.port"), font, 520, 76, 170);
        makeText(configBody.transform, "NameLabel", tr("field.playerName"), font, 30, 136, 135, 46, 24);
        uiName = makeInput(configBody.transform, "PlayerName", UnityEngine.PlayerPrefs.GetString(prefKey("MPB.PlayerName"), config.playerName), tr("placeholder.playerName"), font, 170, 134, 520);

        makeButton(configBody.transform, "Host", tr("button.host"), font, 30, 202, 205, startHostFromUi, 56);
        makeButton(configBody.transform, "Join", tr("button.join"), font, 257, 202, 205, joinFromUi, 56);
        makeButton(configBody.transform, "Stop", tr("button.stop"), font, 484, 202, 205, stopFromUi, 56);
        // 联机存档由建房流程自动选择最近的有效存档，不再创建“选择存档”子页面，
        // 也不提供与自动续档规则冲突的“新建线上存档”按钮。
        makeText(configBody.transform, "Privacy", tr("privacy"), font, 30, 298, 660, 70, 20);
        uiPlayerInfo = makeText(configBody.transform, "Players", tr("players.title"), font, 30, 365, 660, 235, 18);
        (uiPlayerInfo as any).alignment = 0;
        refreshPlayerInfoUi();

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
        if (uiPanel && uiPanel.activeSelf && Input.GetKeyDown(KeyCode.Escape)) closePanel();
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
