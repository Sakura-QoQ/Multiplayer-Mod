// 暂停菜单联机页面。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function buildPauseMenuButton(pause: PauseWindow): void {
    if (!pause.setting || !pause.setting.gameObject) return;
    let stage = "准备";
    try {
        const parent = pause.setting.transform.parent;
        const old = findNamedChild(parent, PAUSE_BUTTON_NAME);
        if (old) UnityEngine.Object.Destroy(old.gameObject);

        stage = "复制设置按钮";
        const clonedButton = cloneNativeButton(pause.setting, parent, PAUSE_BUTTON_NAME,
            tr("menu.multiplayer"), () => { if (isCurrentGeneration()) openPanel(); });
        const cloned = clonedButton.root;
        const button = clonedButton.button;

        stage = "重新排列暂停菜单";
        cloned.transform.SetSiblingIndex(pause.setting.transform.GetSiblingIndex() + 1);
        // 原菜单的五个按钮已经占满竖向空间。插入“联机”后，把六个按钮等距放进
        // 原来“设置”到“退出”的世界坐标范围。原版按钮分属不同容器，不能比较 anchoredPosition。
        uiPauseLoadButton = pause.load ? pause.load.gameObject : null;
        pauseButtonLayout = {
            setting: pause.setting, multiplayer: button, load: pause.load,
            secret: pause.secret, bugFeedback: pause.bugFeedback, exit: pause.exit
        };
        lastPauseLayoutOnline = null;
        refreshPauseMenuLayout();
        cloned.SetActive(true);
        uiPauseButton = cloned;
        log("已在 ESC 暂停菜单中创建原生样式的“联机”按钮，并重新等距排列菜单");
    } catch (error) {
        uiPauseButton = null;
        log("创建暂停菜单联机按钮失败（" + stage + "）: " + error);
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

