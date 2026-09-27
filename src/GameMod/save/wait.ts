// 场景切换期间，以有限帧数等待游戏状态稳定。
type GameReadyPredicate = (manager: GameManager) => boolean;

function waitForGameState(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void,
    predicate: GameReadyPredicate, remaining: number, settleFrames = 0): void {
    if (!isCurrentGeneration()) return;
    if (settleFrames > 0) {
        JintCoroutine.WaitForNextFrame(owner,
            () => waitForGameState(owner, callback, predicate, remaining, settleFrames - 1));
        return;
    }
    try {
        const manager = GameManager.Singleton;
        if (manager && predicate(manager)) { callback(manager); return; }
    } catch (_error) { }
    if (remaining <= 0) { toast(tr("toast.onlineSaveFailed")); return; }
    JintCoroutine.WaitForNextFrame(owner,
        () => waitForGameState(owner, callback, predicate, remaining - 1));
}

function waitForGameManager(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void,
    remaining = 180, settleFrames = 2): void {
    waitForGameState(owner, callback, _manager => true, remaining, settleFrames);
}

function waitForPlayableGame(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void, remaining = 600): void {
    waitForGameState(owner, callback, _manager => Boolean(GameManager.InGame && Player.LocalPlayer), remaining);
}

function waitForSavableGame(owner: UnityEngine.MonoBehaviour, callback: (manager: GameManager) => void, remaining = 900): void {
    waitForGameState(owner, callback, manager => {
        if (!GameManager.InGame || !Player.LocalPlayer) return false;
        const raw = manager.GetSave();
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
    }, remaining);
}

function gameCoroutineOwner(menu: MainMenu): UnityEngine.MonoBehaviour {
    if (coroutineRunner) return coroutineRunner;
    try { if (GameManager.Singleton) return GameManager.Singleton; } catch (_error) { }
    try {
        const manager = menu.gameManager ? menu.gameManager.GetComponent("GameManager") : null;
        if (manager) return manager as GameManager;
    } catch (_error) { }
    return menu;
}
