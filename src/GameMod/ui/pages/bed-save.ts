// 床交互窗口的联机手动保存按钮。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
const BED_SAVE_BUTTON_NAME = "MultiplayerSaveButton";

function buildBedSaveButton(window: BedWindow): void {
    if (role === "off" || !window.sleepForAWhileButton || !window.sleepToTomorrowButton) return;
    try {
        const first = window.sleepForAWhileButton.transform;
        const second = window.sleepToTomorrowButton.transform;
        const parent = first.parent;
        const old = findNamedChild(parent, BED_SAVE_BUTTON_NAME);
        if (old) {
            bedSaveButton = old.gameObject;
            bedSaveButton.SetActive(true);
            return;
        }

        const firstPosition = first.localPosition;
        const secondPosition = second.localPosition;
        let step = new UnityEngine.Vector3(
            secondPosition.x - firstPosition.x,
            secondPosition.y - firstPosition.y,
            secondPosition.z - firstPosition.z);
        if (Math.abs(step.x) + Math.abs(step.y) + Math.abs(step.z) < 0.001)
            step = new UnityEngine.Vector3(0, -70, 0);

        const cloned = cloneNativeButton(window.sleepForAWhileButton, parent,
            BED_SAVE_BUTTON_NAME, tr("button.saveGame"), saveOnlineAtBed);
        cloned.root.transform.SetSiblingIndex(second.GetSiblingIndex() + 1);
        // 三个按钮保持原间距，并以原来两个按钮的中心为中心向两侧扩展。
        first.localPosition = new UnityEngine.Vector3(
            firstPosition.x - step.x * 0.5, firstPosition.y - step.y * 0.5, firstPosition.z - step.z * 0.5);
        second.localPosition = new UnityEngine.Vector3(
            secondPosition.x - step.x * 0.5, secondPosition.y - step.y * 0.5, secondPosition.z - step.z * 0.5);
        cloned.root.transform.localPosition = new UnityEngine.Vector3(
            secondPosition.x + step.x * 0.5, secondPosition.y + step.y * 0.5, secondPosition.z + step.z * 0.5);
        bedSaveButton = cloned.root;
        log("Created the native-style manual save button in the bed window");
    } catch (error) {
        bedSaveButton = null;
        log("Failed to create the bed-window save button: " + error);
    }
}
