// 主菜单联机页面。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function buildMainMenuButton(menu: MainMenu): void {
    if (!menu.newGame || !menu.newGame.gameObject || !uiPanel) return;
    let stage = "prepare";
    try {
        const parent = menu.newGame.transform.parent;
        const old = findNamedChild(parent, MENU_BUTTON_NAME);
        if (old) UnityEngine.Object.Destroy(old.gameObject);

        stage = "clone button";
        const clonedButton = cloneNativeButton(menu.newGame, parent, MENU_BUTTON_NAME,
            tr("menu.multiplayer"), () => {
            if (!isCurrentGeneration() || !uiPanel) return;
            const opening = !uiPanel.activeSelf;
            if (opening) openPanel();
            else closePanel();
        });
        const cloned = clonedButton.root;

        stage = "calculate button position";
        const sourceRect = menu.newGame.transform as any;
        const clonedRect = cloned.transform as any;
        const loadRect = menu.LoadGame ? menu.LoadGame.transform as any : null;
        const sourcePosition = sourceRect.anchoredPosition;
        let spacing = 70;
        if (loadRect && loadRect.anchoredPosition) {
            const measured = Math.abs(Number(sourcePosition.y) - Number(loadRect.anchoredPosition.y));
            if (measured > 1) spacing = measured;
        }
        clonedRect.anchoredPosition = new UnityEngine.Vector2(Number(sourcePosition.x), Number(sourcePosition.y) + spacing);
        // 如果原菜单使用 VerticalLayoutGroup，兄弟序号会让布局系统把它排在“新建游戏”正上方。
        stage = "set menu order";
        cloned.transform.SetSiblingIndex(menu.newGame.transform.GetSiblingIndex());
        cloned.SetActive(true);
        uiMenuButton = cloned;
        log("Created the native-style Multiplayer button above New Game");
    } catch (error) {
        uiMenuButton = null;
        log("Failed to create the main-menu Multiplayer button (" + stage + "): " + error);
    }
}

// 暂停菜单入口直接复制游戏自己的“设置”按钮，保留字体、背景、悬停和点击音效。
