// 屏幕中央的房间玩家名单卡片，复用联机面板的灰黑背景和白色四角框线。
type PlayerListCard = {
    root: UnityEngine.GameObject;
    title: UnityEngine.UI.Text;
    count: UnityEngine.UI.Text;
    body: UnityEngine.UI.Text;
};

function createPlayerListCard(parent: UnityEngine.Transform, font: any): PlayerListCard {
    const root = uiObject("PlayerListCard", parent);
    rect(root, 0.5, 0.5, 0, 0, 620, 470);
    const background = root.AddComponent("Image") as UnityEngine.UI.Image;
    background.color = new UnityEngine.Color(0.22, 0.22, 0.22, 0.86);
    background.raycastTarget = false;
    addOriginalFrameCorners(root.transform, 0, 0, 620, 470);

    const title = makeText(root.transform, "PlayerListTitle", tr("playerList.title"), font,
        40, 24, 540, 58, 36);
    (title as any).alignment = 4;
    const count = makeText(root.transform, "PlayerListCount", "", font,
        40, 86, 540, 40, 21);
    (count as any).alignment = 4;
    const body = makeText(root.transform, "PlayerListBody", "", font,
        58, 140, 504, 280, 27);
    (body as any).alignment = 0;
    root.SetActive(false);
    return { root, title, count, body };
}
