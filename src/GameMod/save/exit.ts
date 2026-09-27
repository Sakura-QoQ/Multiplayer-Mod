// 退出保存流程。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function writeOnlineSaveSnapshot(manager: GameManager): string {
    if (!bridgeAvailable || !selectedSaveName.startsWith(ONLINE_SAVE_PREFIX)) return "-2";
    try {
        const raw = manager.GetSave() || "";
        if (!raw) { log("线上存档快照无内容"); return "-7"; }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            log("线上存档快照根类型无效 type=" + typeof parsed + " array=" + Array.isArray(parsed));
            return "-7";
        }
        const json = JSON.stringify(parsed);
        if (BRIDGE_CHANNEL !== "default") log("诊断模式：线上存档规范 JSON 长度=" + json.length);
        const chunkSize = 6000;
        const chunks = Math.max(1, Math.ceil(json.length / chunkSize));
        let result = submitBridgeCommandAndWait("beginRawSave?name=" + encodeURIComponent(selectedSaveName) +
            "&chunks=" + chunks);
        if (result !== "0") { log("beginRawSave 失败 code=" + result); return result; }
        for (let index = 0; index < chunks; index++) {
            const part = json.substring(index * chunkSize, Math.min(json.length, (index + 1) * chunkSize));
            result = submitBridgeCommandAndWait("appendRawSave?index=" + index + "&data=" + encodeURIComponent(part));
            if (result !== "0") { log("appendRawSave 失败 index=" + index + " code=" + result); return result; }
        }
        result = submitBridgeCommandAndWait("commitRawSave");
        if (result !== "0") log("commitRawSave 失败 code=" + result);
        return result;
    } catch (error) {
        log("采集并写入线上存档失败: " + error);
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
        if (!manager) throw new Error("GameManager 尚未初始化");
        const saveName = activeSaveName(selectedSaveName);
        if (!saveName) throw new Error("没有有效的线上临时存档名");
        GameManager.SaveName = saveName;
        const result = writeOnlineSaveSnapshot(manager);
        if (result === "0") {
            log("退出前已自动保存并验证: " + saveName);
            try { if (beforeQuit) beforeQuit(); } catch (_error) { }
            UnityEngine.Application.Quit();
        } else {
            exitSaveInProgress = false;
            log("退出前自动保存失败，错误码=" + result);
            toast(tr("toast.exitSaveFailed"));
        }
    } catch (error) {
        exitSaveInProgress = false;
        log("退出前自动保存失败: " + error);
        toast(tr("toast.exitSaveFailed"));
    }
}

// 联机模式下把游戏所有默认 AutoSave 读写改到专属 MPActive_ 名称。
// Hook API 不能原地修改参数，因此先拦截原调用，再用防递归标记调用正确文件名。
