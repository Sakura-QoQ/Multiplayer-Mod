// 远端模型骨骼映射。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function destroyRemotePlayer(ownerId: number): void {
    const key = String(ownerId);
    const remote = remotePlayers[key];
    if (!remote) return;
    try { if (remote.root) UnityEngine.Object.Destroy(remote.root); } catch (_error) { }
    // 远端渲染器使用独立材质，销毁代理时同步释放，避免频繁换装造成显存泄漏。
    try {
        for (const material of remote.ownedMaterials) {
            if (material) UnityEngine.Object.Destroy(material);
        }
    } catch (_error) { }
    delete remotePlayers[key];
}

function bindRemoteClothBones(dressRoot: UnityEngine.Transform, armature: UnityEngine.Transform,
    cloneRoot: UnityEngine.Transform): { renderers: number; mapped: number; total: number; missing: number;
        preserved: number; missingNames: string[] } {
    const result = { renderers: 0, mapped: 0, total: 0, missing: 0, preserved: 0, missingNames: [] as string[] };
    const dress = dressRoot.gameObject.GetComponent("Dress") as Dress;
    if (!dress) throw new Error("The clothing root has no Dress component");

    const belongsToClone = (bone: UnityEngine.Transform | null): boolean => {
        let node = bone;
        for (let guard = 0; node && guard < 160; guard++) {
            if (String(node.name) === String(cloneRoot.name)) return true;
            node = node.parent;
        }
        return false;
    };
    const belongsToDress = (bone: UnityEngine.Transform | null): boolean => {
        let node = bone;
        for (let guard = 0; node && guard < 160; guard++) {
            if (String(node.name) === String(dressRoot.name)) return true;
            node = node.parent;
        }
        return false;
    };
    const visit = (node: UnityEngine.Transform): void => {
        const renderer = node.gameObject.GetComponent("SkinnedMeshRenderer") as UnityEngine.SkinnedMeshRenderer;
        if (renderer) {
            result.renderers += 1;
            const bones = renderer.bones;
            for (let boneIndex = 0; boneIndex < bones.length; boneIndex++) {
                result.total += 1;
                const bone = bones[boneIndex];
                if (bone && belongsToClone(bone)) {
                    result.mapped += 1;
                    if (belongsToDress(bone)) result.preserved += 1;
                } else {
                    result.missing += 1;
                    const missingName = bone ? String(bone.name) : "<null>";
                    if (result.missingNames.indexOf(missingName) < 0) result.missingNames.push(missingName);
                }
            }
            renderer.updateWhenOffscreen = true;
        }
        for (let index = 0; index < node.childCount; index++) visit(node.GetChild(index));
    };
    visit(dressRoot);
    return result;
}

function collectRemoteClothBonePairs(clone: UnityEngine.GameObject, armature: UnityEngine.Transform):
    { driven: UnityEngine.Transform; source: UnityEngine.Transform }[] {
    const sourceByName: Record<string, UnityEngine.Transform> = {};
    const collectSources = (node: UnityEngine.Transform): void => {
        sourceByName[String(node.name)] = node;
        for (let index = 0; index < node.childCount; index++) collectSources(node.GetChild(index));
    };
    collectSources(armature);
    const pairs: { driven: UnityEngine.Transform; source: UnityEngine.Transform }[] = [];
    const clothRoot = clone.transform.Find("ClothRoot");
    const collectDriven = (node: UnityEngine.Transform): void => {
        // stripRemoteNode 会删除所有未启用分支；这里不能把那些即将销毁的 Transform
        // 放入持久映射，否则下一次状态包访问失效包装器会抛 NullReferenceException。
        if (node !== clothRoot && !node.gameObject.activeSelf) return;
        const source = sourceByName[String(node.name)];
        if (source) pairs.push({ driven: node, source });
        for (let index = 0; index < node.childCount; index++) collectDriven(node.GetChild(index));
    };
    if (clothRoot) collectDriven(clothRoot);
    log("Remote clothing bone driver mapping complete: " + pairs.length + " pairs");
    return pairs;
}

