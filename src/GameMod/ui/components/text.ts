// 文本组件。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function makeText(parent: UnityEngine.Transform, name: string, value: string, font: any, x: number, y: number, width: number, height: number, size = 20): UnityEngine.UI.Text {
    const go = uiObject(name, parent);
    rect(go, 0, 1, x, -y, width, height);
    const text = go.AddComponent("Text");
    (text as any).font = font;
    text.fontSize = size;
    text.color = new UnityEngine.Color(0.94, 0.96, 1, 1);
    (text as any).alignment = 3;
    text.supportRichText = true;
    text.text = value;
    // 原版 UI 的白字带明显黑色描边，在复杂场景背景上仍能保持清晰。
    const outline = go.AddComponent("Outline");
    outline.effectColor = new UnityEngine.Color(0, 0, 0, 0.92);
    outline.effectDistance = new UnityEngine.Vector2(2, -2);
    outline.useGraphicAlpha = true;
    return text;
}

