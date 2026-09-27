// 输入框组件。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function makeInput(parent: UnityEngine.Transform, name: string, value: string, placeholder: string, font: any, x: number, y: number, width: number): UnityEngine.UI.InputField {
    const go = uiObject(name, parent);
    rect(go, 0, 1, x, -y, width, 46);
    const image = go.AddComponent("Image");
    image.sprite = makeRoundedPanelSprite();
    image.type = UnityEngine.UI.Type.Sliced;
    image.color = new UnityEngine.Color(0.16, 0.16, 0.16, 0.7);
    const input = go.AddComponent("InputField");
    input.targetGraphic = image;
    const content = makeText(go.transform, "Text", value, font, 12, 0, width - 24, 46, 24);
    content.color = new UnityEngine.Color(1, 1, 1, 1);
    const hint = makeText(go.transform, "Placeholder", placeholder, font, 12, 0, width - 24, 46, 24);
    hint.color = new UnityEngine.Color(0.55, 0.6, 0.68, 1);
    input.textComponent = content;
    input.placeholder = hint;
    input.text = value;
    return input;
}

// 生成一张硬边圆角白色纹理，再由 Image.color 统一染成面板颜色。
// 圆角边缘只使用 0 或 1 两种透明度，避免半透明抗锯齿造成“淡化”边框。
// 纹理只在创建界面时生成一次，不会进入每帧更新路径。
