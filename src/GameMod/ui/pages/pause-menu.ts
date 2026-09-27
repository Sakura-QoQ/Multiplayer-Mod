// 暂停菜单联机页面。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function buildPauseMenuButton(pause: PauseWindow): void {
    if (!pause.setting || !pause.setting.gameObject) return;
    let stage = "prepare";
    try {
        const parent = pause.setting.transform.parent;
        const old = findNamedChild(parent, PAUSE_BUTTON_NAME);
        if (old) UnityEngine.Object.Destroy(old.gameObject);

        stage = "clone settings button";
        const clonedButton = cloneNativeButton(pause.setting, parent, PAUSE_BUTTON_NAME,
            tr("menu.multiplayer"), () => {
                if (!isCurrentGeneration()) return;
                // 已进入联机会话后，暂停菜单只提供只读房间状态，不允许在游戏中改地址、
                // 建房或停止连接；主菜单入口仍保留完整联机配置。
                if (role !== "off") openRoomInfoPanel();
                else openPanel();
            });
        const cloned = clonedButton.root;
        const button = clonedButton.button;

        stage = "rearrange pause menu";
        cloned.transform.SetSiblingIndex(pause.setting.transform.GetSiblingIndex() + 1);
        // 原菜单的五个按钮已经占满竖向空间。插入“联机”后，把六个按钮等距放进
        // 原来“设置”到“退出”的世界坐标范围。原版按钮分属不同容器，不能比较 anchoredPosition。
        pauseButtonLayout = {
            setting: pause.setting, multiplayer: button, load: pause.load,
            secret: pause.secret, bugFeedback: pause.bugFeedback, exit: pause.exit
        };
        lastPauseLayoutOnline = null;
        refreshPauseMenuLayout();
        cloned.SetActive(true);
        uiPauseButton = cloned;
        log("Created the native-style Multiplayer button in the ESC pause menu and evenly spaced the menu items");
    } catch (error) {
        uiPauseButton = null;
        log("Failed to create the pause-menu Multiplayer button (" + stage + "): " + error);
    }
}

function refreshPauseMenuLayout(): void {
    if (!pauseButtonLayout) return;
    const online = role !== "off";
    if (lastPauseLayoutOnline === online) return;
    lastPauseLayoutOnline = online;
    // 联机时删除原版“读取”入口，防止切回单机档；离线时恢复并参与六按钮等距布局，
    // 不能只恢复可见性而留在旧坐标，否则会再次与“联机/秘密”重叠。
    pauseButtonLayout.load.gameObject.SetActive(!online);
    const orderedButtons: UnityEngine.UI.Button[] = online
        ? [pauseButtonLayout.setting, pauseButtonLayout.multiplayer, pauseButtonLayout.secret,
            pauseButtonLayout.bugFeedback, pauseButtonLayout.exit]
        : [pauseButtonLayout.setting, pauseButtonLayout.multiplayer, pauseButtonLayout.load,
            pauseButtonLayout.secret, pauseButtonLayout.bugFeedback, pauseButtonLayout.exit];
    const startPosition = pauseButtonLayout.setting.transform.position;
    const endPosition = pauseButtonLayout.exit.transform.position;
    const stepY = (endPosition.y - startPosition.y) / (orderedButtons.length - 1);
    for (let index = 0; index < orderedButtons.length; index++) {
        const itemTransform = orderedButtons[index].transform;
        const current = itemTransform.position;
        itemTransform.position = new UnityEngine.Vector3(current.x, startPosition.y + stepY * index, current.z);
    }
}
