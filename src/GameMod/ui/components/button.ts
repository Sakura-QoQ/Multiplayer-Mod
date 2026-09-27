// 按钮组件。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function makeButton(parent: UnityEngine.Transform, name: string, label: string, font: any, x: number, y: number, width: number, onClick: () => void, height = 42): UnityEngine.GameObject {
    const go = uiObject(name, parent);
    rect(go, 0, 1, x, -y, width, height);
    const image = go.AddComponent("Image");
    image.sprite = makeRoundedPanelSprite();
    image.type = UnityEngine.UI.Type.Sliced;
    image.color = new UnityEngine.Color(0.18, 0.18, 0.18, 0.66);
    const button = go.AddComponent("Button");
    button.targetGraphic = image;
    button.onClick.AddListener(() => { if (isCurrentGeneration()) onClick(); });
    const text = makeText(go.transform, "Label", label, font, 0, 0, width, height, height >= 54 ? 27 : 23);
    (text as any).alignment = 4;
    return go;
}

