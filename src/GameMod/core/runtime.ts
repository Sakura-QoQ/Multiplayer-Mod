// 通用运行时工具。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function isCurrentGeneration(): boolean {
    try {
        const current = UnityEngine.GameObject.Find(GENERATION_OBJECT_NAME);
        return !!current && !!SCRIPT_GENERATION_OBJECT &&
            Number(current.GetInstanceID()) === SCRIPT_GENERATION &&
            Number(SCRIPT_GENERATION_OBJECT.GetInstanceID()) === SCRIPT_GENERATION;
    } catch (_error) { return false; }
}

function log(message: string): void { print(MOD_TAG + " " + message); }

// 以固定时间轴推进周期任务，避免使用“当前时间 + 间隔”时把一帧取整误差永久累加。
// 如果游戏曾卡顿超过一个周期，则直接从当前时刻重新起算，不在恢复后突发补发旧状态。
function advanceFixedDeadline(previous: number, now: number, interval: number): number {
    if (previous <= 0 || previous < now - interval) return now + interval;
    return previous + interval;
}

function toast(message: string): void {
    // 本地化 UI 文本只显示在游戏中，不写入诊断日志；运行日志必须始终使用英语。
    try {
        if (Toast.Singleton) Toast.Show(tr("mod.name") + ": " + message, 5);
    } catch (_error) { }
}
