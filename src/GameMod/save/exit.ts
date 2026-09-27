// 退出保存流程。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function writeOnlineSaveSnapshot(manager: GameManager): string {
    if (!bridgeAvailable || !selectedSaveName.startsWith(ONLINE_SAVE_PREFIX)) return "-2";
    try {
        const raw = manager.GetSave() || "";
        if (!raw) { log("Online-save snapshot is empty"); return "-7"; }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            log("Online-save snapshot root type is invalid type=" + typeof parsed + " array=" + Array.isArray(parsed));
            return "-7";
        }
        const json = JSON.stringify(parsed);
        if (BRIDGE_CHANNEL !== "default") log("Diagnostics: canonical online-save JSON length=" + json.length);
        const chunkSize = 6000;
        const chunks = Math.max(1, Math.ceil(json.length / chunkSize));
        let result = submitBridgeCommandAndWait("beginRawSave?name=" + encodeURIComponent(selectedSaveName) +
            "&chunks=" + chunks);
        if (result !== "0") { log("beginRawSave failed code=" + result); return result; }
        for (let index = 0; index < chunks; index++) {
            const part = json.substring(index * chunkSize, Math.min(json.length, (index + 1) * chunkSize));
            result = submitBridgeCommandAndWait("appendRawSave?index=" + index + "&data=" + encodeURIComponent(part));
            if (result !== "0") { log("appendRawSave failed index=" + index + " code=" + result); return result; }
        }
        result = submitBridgeCommandAndWait("commitRawSave");
        if (result !== "0") log("commitRawSave failed code=" + result);
        return result;
    } catch (error) {
        log("Failed to capture and write the online save: " + error);
        return "-1";
    }
}

// 线上退出必须拦截原回调：SaveGame 会跨多个 Unity 帧写盘，不能在按钮回调里同步等待。
// 写盘完成并由桥接程序验证双层密文后再退出，实现一次点击自动保存并退出。
function beginOnlineExitSave(owner: UnityEngine.MonoBehaviour, beforeQuit?: () => void): void {
    if (exitSaveInProgress || !GameManager.InGame) return;
    exitSaveInProgress = true;
    try {
        const manager = GameManager.Singleton;
        if (!manager) throw new Error("GameManager is not initialized");
        const saveName = activeSaveName(selectedSaveName);
        if (!saveName) throw new Error("No valid online working-copy name is available");
        GameManager.SaveName = saveName;
        const result = writeOnlineSaveSnapshot(manager);
        if (result === "0") {
            log("Autosaved and verified before exit: " + saveName);
            try { if (beforeQuit) beforeQuit(); } catch (_error) { }
            UnityEngine.Application.Quit();
        } else {
            exitSaveInProgress = false;
            log("Autosave before exit failed; error code=" + result);
            toast(tr("toast.exitSaveFailed"));
        }
    } catch (error) {
        exitSaveInProgress = false;
        log("Autosave before exit failed: " + error);
        toast(tr("toast.exitSaveFailed"));
    }
}

// 联机模式下把游戏所有默认 AutoSave 读写改到专属 MPActive_ 名称。
// Hook API 不能原地修改参数，因此先拦截原调用，再用防递归标记调用正确文件名。
