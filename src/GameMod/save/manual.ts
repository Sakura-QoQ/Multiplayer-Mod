// 线上手动保存。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function writeOnlineSaveSnapshot(manager: GameManager): string {
    if (!bridgeAvailable || !selectedSaveName.startsWith(ONLINE_SAVE_PREFIX)) return "-2";
    if (!onlineSaveWriteEnabled) {
        log("Blocked an online-save write while the saved state is still loading");
        return "-8";
    }
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

function saveOnlineAtBed(): void {
    if (bedSaveInProgress || role === "off" || !GameManager.InGame) return;
    bedSaveInProgress = true;
    try {
        const manager = GameManager.Singleton;
        if (!manager) throw new Error("GameManager is not initialized");
        const result = writeOnlineSaveSnapshot(manager);
        if (result !== "0") {
            log("Manual online save at the bed failed; error code=" + result);
            toast(tr("toast.manualSaveFailed"));
            return;
        }
        log("Manual online save completed at the bed: " + selectedSaveName);
        toast(tr("toast.manualSaveComplete"));
        try {
            if (WindowManager.IsOpened("BedWindow")) WindowManager.CloseWindow("BedWindow");
        } catch (_error) { }
    } catch (error) {
        log("Manual online save at the bed failed: " + error);
        toast(tr("toast.manualSaveFailed"));
    } finally {
        bedSaveInProgress = false;
    }
}
