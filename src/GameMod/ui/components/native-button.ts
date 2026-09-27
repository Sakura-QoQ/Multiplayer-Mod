// 克隆原版按钮并统一替换事件与文字，页面不再重复操作 Unity 组件。
type NativeButtonClone = {
    root: UnityEngine.GameObject;
    button: UnityEngine.UI.Button;
    label: UnityEngine.UI.Text | null;
};

function cloneNativeButton(template: UnityEngine.UI.Button, parent: UnityEngine.Transform,
    name: string, labelText: string, onClick: () => void): NativeButtonClone {
    const root = UnityEngine.Object.Instantiate(template.gameObject, parent) as UnityEngine.GameObject;
    root.name = name;
    const button = root.GetComponent("Button") as UnityEngine.UI.Button;
    if (!button) throw new Error("The cloned object does not contain a Button component");
    button.onClick.RemoveAllListeners();
    let listenerAdded = false;
    try { button.onClick.AddListener(onClick); listenerAdded = true; } catch (_error) { }
    if (!listenerAdded) {
        try { Extensions.SetListener(button.onClick, onClick); listenerAdded = true; } catch (_error) { }
    }
    if (!listenerAdded) throw new Error("Could not bind the cloned button click handler");
    const label = findTextInChildren(root.transform);
    if (label) label.text = labelText;
    return { root, button, label };
}
