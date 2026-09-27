// 面板与边框组件。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function makeRoundedPanelSprite(): UnityEngine.Sprite {
    if (roundedPanelSprite) return roundedPanelSprite;
    const size = 64;
    const radius = 7;
    const texture = new UnityEngine.Texture2D(size, size, UnityEngine.TextureFormat.RGBA32, false);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            const dx = Math.max(radius - px, 0, px - (size - radius));
            const dy = Math.max(radius - py, 0, py - (size - radius));
            const distance = Math.sqrt(dx * dx + dy * dy);
            const alpha = distance <= radius ? 1 : 0;
            texture.SetPixel(x, y, new UnityEngine.Color(1, 1, 1, alpha));
        }
    }
    texture.Apply(false, true);
    roundedPanelSprite = UnityEngine.Sprite.Create(
        texture,
        new UnityEngine.Rect(0, 0, size, size),
        new UnityEngine.Vector2(0.5, 0.5),
        100,
        0,
        UnityEngine.SpriteMeshType.FullRect,
        new UnityEngine.Vector4(radius, radius, radius, radius)
    );
    return roundedPanelSprite;
}

function addOriginalFrameCorners(parent: UnityEngine.Transform, x: number, y: number, width: number, height: number): void {
    const color = new UnityEngine.Color(0.92, 0.92, 0.92, 0.9);
    const length = 28;
    const thickness = 4;
    makeSolidRect(parent, "FrameTopLeftH", color, x, y, length, thickness);
    makeSolidRect(parent, "FrameTopLeftV", color, x, y, thickness, length);
    makeSolidRect(parent, "FrameTopRightH", color, x + width - length, y, length, thickness);
    makeSolidRect(parent, "FrameTopRightV", color, x + width - thickness, y, thickness, length);
    makeSolidRect(parent, "FrameBottomLeftH", color, x, y + height - thickness, length, thickness);
    makeSolidRect(parent, "FrameBottomLeftV", color, x, y + height - length, thickness, length);
    makeSolidRect(parent, "FrameBottomRightH", color, x + width - length, y + height - thickness, length, thickness);
    makeSolidRect(parent, "FrameBottomRightV", color, x + width - thickness, y + height - length, thickness, length);
}

