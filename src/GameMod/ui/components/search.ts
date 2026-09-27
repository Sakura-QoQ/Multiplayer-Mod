// 原版界面查找工具。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function findOldUiFont(): any {
    try {
        const old = UnityEngine.GameObject.Find(UI_ROOT_NAME);
        if (!old) return null;
        const status = old.transform.Find("Panel/Status");
        const text = status ? status.gameObject.GetComponent("Text") : null;
        return text ? (text as any).font : null;
    } catch (_error) { return null; }
}

function findTextInChildren(transform: UnityEngine.Transform): UnityEngine.UI.Text | null {
    try {
        const own = transform.gameObject.GetComponent("Text");
        if (own) return own as UnityEngine.UI.Text;
        for (let index = 0; index < transform.childCount; index++) {
            const found = findTextInChildren(transform.GetChild(index));
            if (found) return found;
        }
    } catch (_error) { }
    return null;
}

function findNamedChild(parent: UnityEngine.Transform, name: string): UnityEngine.Transform | null {
    try {
        for (let index = 0; index < parent.childCount; index++) {
            const child = parent.GetChild(index);
            if (String(child.gameObject.name) === name) return child;
        }
    } catch (_error) { }
    return null;
}

function findNamedDescendant(parent: UnityEngine.Transform, name: string): UnityEngine.Transform | null {
    const direct = findNamedChild(parent, name);
    if (direct) return direct;
    try {
        for (let index = 0; index < parent.childCount; index++) {
            const found = findNamedDescendant(parent.GetChild(index), name);
            if (found) return found;
        }
    } catch (_error) { }
    return null;
}

function setChildText(parent: UnityEngine.Transform, childName: string, value: string): void {
    try {
        const child = findNamedDescendant(parent, childName);
        const text = child ? findTextInChildren(child) : null;
        if (text) text.text = value;
    } catch (_error) { }
}

