// 联机页面的顶层画布、协程宿主和原版风格卡片骨架。
type MultiplayerCanvasShell = {
    root: UnityEngine.GameObject;
    runner: UnityEngine.MonoBehaviour;
    panel: UnityEngine.GameObject;
    body: UnityEngine.GameObject;
};

function createMultiplayerCanvasShell(): MultiplayerCanvasShell {
    const old = UnityEngine.GameObject.Find(UI_ROOT_NAME);
    if (old) UnityEngine.Object.Destroy(old);

    const root = new UnityEngine.GameObject(UI_ROOT_NAME);
    root.AddComponent("RectTransform");
    const canvas = root.AddComponent("Canvas");
    canvas.renderMode = UnityEngine.RenderMode.ScreenSpaceOverlay;
    canvas.overrideSorting = true;
    canvas.sortingOrder = 32000;
    const scaler = root.AddComponent("CanvasScaler");
    scaler.uiScaleMode = UnityEngine.UI.ScaleMode.ScaleWithScreenSize;
    scaler.referenceResolution = new UnityEngine.Vector2(1920, 1080);
    scaler.matchWidthOrHeight = 0.5;
    root.AddComponent("GraphicRaycaster");
    UnityEngine.Object.DontDestroyOnLoad(root);

    // 透明 Image 同时是跨场景 MonoBehaviour，可安全承载联机存档协程。
    const runnerObject = uiObject("CoroutineRunner", root.transform);
    rect(runnerObject, 0.5, 0.5, 0, 0, 0, 0);
    const runnerImage = runnerObject.AddComponent("Image") as UnityEngine.UI.Image;
    runnerImage.color = new UnityEngine.Color(0, 0, 0, 0);
    runnerImage.raycastTarget = false;

    const panel = uiObject("Panel", root.transform);
    rect(panel, 0.5, 0.5, 0, 0, 760, 820);
    const panelImage = panel.AddComponent("Image");
    panelImage.color = new UnityEngine.Color(0, 0, 0, 0);

    const body = uiObject("ConfigBody", panel.transform);
    rect(body, 0, 1, 20, -92, 720, 620);
    const bodyImage = body.AddComponent("Image");
    bodyImage.color = new UnityEngine.Color(0.34, 0.34, 0.34, 0.58);
    addOriginalFrameCorners(panel.transform, 12, 84, 736, 636);
    return { root, runner: runnerImage as UnityEngine.MonoBehaviour, panel, body };
}
