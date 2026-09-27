// 布局基础组件。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function rect(go: UnityEngine.GameObject, anchorX: number, anchorY: number, x: number, y: number, width: number, height: number): UnityEngine.RectTransform {
    const rt = go.GetComponent("RectTransform") || go.AddComponent("RectTransform");
    rt.anchorMin = new UnityEngine.Vector2(anchorX, anchorY);
    rt.anchorMax = new UnityEngine.Vector2(anchorX, anchorY);
    rt.pivot = new UnityEngine.Vector2(anchorX, anchorY);
    rt.anchoredPosition = new UnityEngine.Vector2(x, y);
    rt.sizeDelta = new UnityEngine.Vector2(width, height);
    return rt;
}

function uiObject(name: string, parent: UnityEngine.Transform): UnityEngine.GameObject {
    const go = new UnityEngine.GameObject(name);
    try { go.AddComponent("RectTransform"); } catch (_error) { }
    go.transform.SetParent(parent, false);
    return go;
}

function makeSolidRect(parent: UnityEngine.Transform, name: string, color: UnityEngine.Color, x: number, y: number, width: number, height: number): UnityEngine.GameObject {
    const go = uiObject(name, parent);
    rect(go, 0, 1, x, -y, width, height);
    const image = go.AddComponent("Image");
    image.color = color;
    return go;
}

