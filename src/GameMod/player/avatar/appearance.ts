// 远端模型外观。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function applyRemoteAppearance(clone: UnityEngine.GameObject, profile: PlayerProfile | undefined): void {
    if (!profile) return;
    try {
        const clonedPlayer = clone.GetComponent("Player") as Player;
        const playerCloth = clonedPlayer ? clonedPlayer.cloth : null;
        const allCloths = playerCloth ? playerCloth.All : null;
        const equippedCloths = playerCloth ? playerCloth.cloths : null;
        const findDress = (id: string): any => {
            // Jint 的字典索引器在键不存在时会把 KeyNotFoundException 穿透 JS try/catch。
            // 必须先调用 ContainsKey，再调用 get_Item；不能使用 dictionary[id] 探测。
            if (allCloths && (allCloths as any).ContainsKey(id)) {
                const value = (allCloths as any).get_Item(id);
                if (value) return value as Dress;
            }
            if (equippedCloths && (equippedCloths as any).ContainsKey(id)) {
                const value = (equippedCloths as any).get_Item(id);
                if (value) return value as Dress;
            }
            // PlayerCloth 的字典由 Awake/Start 初始化，而远端克隆必须在未激活状态先剥离
            // 游戏逻辑脚本，因此该字典可能为空。衣服实际位于 Player/ClothRoot/<ID>，
            // 直接按节点名查找即可启用渲染对象，不需要运行 PlayerCloth。
            const clothRoot = clone.transform.Find("ClothRoot");
            if (clothRoot) {
                for (let index = 0; index < clothRoot.childCount; index++) {
                    const child = clothRoot.GetChild(index);
                    if (String(child.name) === id) return { gameObject: child.gameObject };
                }
            }
            return null;
        };

        // 克隆源带着本机当前服装，先按本机存档中的明确 ID 关闭，再启用远端服装。
        // 不能枚举 Dictionary，否则启动器环境会得到空数组并把本机服装错误保留在远端模型上。
        try {
            const localSave = JSON.parse(GameManager.Singleton ? (GameManager.Singleton.GetSave() || "{}") : "{}");
            const localCloth = Array.isArray(localSave.Cloth) ? localSave.Cloth : [];
            for (const rawId of localCloth) {
                const dress = findDress(String(rawId));
                if (dress && dress.gameObject) dress.gameObject.SetActive(false);
            }
        } catch (_error) { }
        let appliedCloth = 0;
        const remoteArmature = clonedPlayer && clonedPlayer.bodyModel ? clonedPlayer.bodyModel.armature : null;
        for (const rawId of profile.cloth) {
            const id = String(rawId);
            const dress = findDress(id);
            if (dress && dress.gameObject) {
                dress.gameObject.SetActive(true);
                if (!remoteArmature) {
                    dress.gameObject.SetActive(false);
                    log("远端衣服缺少目标 Armature，已禁用: " + id);
                    continue;
                }
                const binding = bindRemoteClothBones(dress.gameObject.transform, remoteArmature, clone.transform);
                if (binding.renderers <= 0 || binding.missing > 0 || binding.mapped !== binding.total) {
                    dress.gameObject.SetActive(false);
                    log("远端衣服骨骼重绑失败 dress=" + id + " renderers=" + binding.renderers +
                        " bones=" + binding.mapped + "/" + binding.total + " missing=" + binding.missing +
                        " names=" + binding.missingNames.slice(0, 24).join(","));
                    continue;
                }
                appliedCloth += 1;
                log("远端衣服骨骼绑定完成 dress=" + id + " renderers=" + binding.renderers +
                    " bones=" + binding.mapped + "/" + binding.total + " local=" + binding.preserved +
                    " missing=0 root=" + remoteArmature.name);
            } else log("远端衣服 ID 在本机资源中不存在: " + id);
        }
        log("远端衣服映射完成: " + appliedCloth + "/" + profile.cloth.length);

        const customization = clonedPlayer ? clonedPlayer.customization : null;
        const data = profile.customization || {};
        if (customization && customization.hairs) {
            const hair = Math.trunc(finiteNumber(data.hair, -1));
            for (let index = 0; index < customization.hairs.childCount; index++)
                customization.hairs.GetChild(index).gameObject.SetActive(index === hair);
        }
        if (customization && customization.body && PlayerCustomization.BlendShapeNames) {
            const keys = Object.keys(data);
            for (let index = 0; index < PlayerCustomization.BlendShapeNames.length; index++) {
                const name = String(PlayerCustomization.BlendShapeNames[index]);
                const key = keys.find(item => item.toLowerCase() === name.toLowerCase());
                if (key && typeof data[key] === "number")
                    customization.body.SetBlendShapeWeight(index, finiteNumber(data[key]) * 100);
            }
        }
    } catch (error) { log("应用远端玩家衣服/外观失败: " + error); }
}

// 原版 PlayerSkin.OnDestroy 会清理它缓存的实例材质。远端克隆剥离脚本前，必须先从
// sharedMaterials 复制一套未挂到渲染器上的材质；脚本销毁后再装回，避免引用已释放材质时
// 显示成 Unity 的红色/洋红色错误材质，同时保证远端晒黑参数不会污染本地玩家。
function captureRemoteMaterials(root: UnityEngine.Transform): RemoteMaterialSnapshot[] {
    const snapshots: RemoteMaterialSnapshot[] = [];
    const visit = (node: UnityEngine.Transform): void => {
        const renderer = node.gameObject.GetComponent("Renderer") as UnityEngine.Renderer;
        if (renderer) {
            const copied = renderer.sharedMaterials as UnityEngine.Material[];
            for (let index = 0; copied && index < copied.length; index++) {
                if (copied[index]) copied[index] = UnityEngine.Object.Instantiate(copied[index]) as UnityEngine.Material;
            }
            snapshots.push({ renderer, materials: copied });
        }
        for (let index = 0; index < node.childCount; index++) {
            const child = node.GetChild(index);
            if (child.gameObject.activeSelf) visit(child);
        }
    };
    visit(root);
    return snapshots;
}

function restoreRemoteMaterials(snapshots: RemoteMaterialSnapshot[], skinTan: boolean): UnityEngine.Material[] {
    const owned: UnityEngine.Material[] = [];
    let tanMaterials = 0;
    let invalidShaders = 0;
    let unsupportedTanProperties = 0;
    for (const snapshot of snapshots) {
        for (let index = 0; snapshot.materials && index < snapshot.materials.length; index++) {
            const material = snapshot.materials[index];
            if (!material) continue;
            owned.push(material);
            const shader = material.shader;
            const shaderName = shader ? String(shader.name || "") : "";
            if (!shader || shaderName.indexOf("InternalErrorShader") >= 0) {
                invalidShaders += 1;
                continue;
            }
            if (!material.HasProperty("_Tan")) continue;
            // Unity ShaderPropertyType: Color=0, Vector=1, Float=2, Range=3, Texture=4, Int=5。
            // 只对原版定义为 Float/Range 的 _Tan 写浮点值；若未来版本改成颜色，绝不能把
            // SetFloat 写成 (1,0,0,0) 而把整个角色染红。
            const propertyIndex = shader.FindPropertyIndex("_Tan");
            const propertyType = propertyIndex >= 0 ? Number(shader.GetPropertyType(propertyIndex)) : -1;
            if (propertyType === 2 || propertyType === 3) {
                material.SetFloat("_Tan", skinTan ? 1 : 0);
                tanMaterials += 1;
            } else unsupportedTanProperties += 1;
        }
        snapshot.renderer.sharedMaterials = snapshot.materials;
    }
    log("远端材质恢复完成: 渲染器=" + snapshots.length + "，材质=" + owned.length +
        "，tan=" + skinTan + "/" + tanMaterials + "，无效Shader=" + invalidShaders +
        "，跳过非浮点Tan=" + unsupportedTanProperties);
    if (BRIDGE_CHANNEL !== "default") {
        log("[双实例证据] 远端材质检查 invalid=" + invalidShaders + " tan=" + tanMaterials +
            " unsupported=" + unsupportedTanProperties);
    }
    return owned;
}

function readCurrentClothIds(): string[] {
    try {
        const manager = GameManager.Singleton;
        const data = manager ? JSON.parse(manager.GetSave() || "{}") : {};
        return Array.isArray(data.Cloth) ? data.Cloth.map((id: any) => String(id)).slice(0, 128) : [];
    } catch (_error) { return []; }
}

// Unity 只会把已经实例化到 ClothRoot 下的服装一起克隆。创建远端模型前临时把本地
// 源角色换成远端服装，完成 Instantiate 后立即恢复；整个过程位于同一主线程回调，
// 不会渲染出中间状态，也不会调用 SaveGame 或改写玩家存档。
function setRuntimeClothes(cloth: PlayerCloth, ids: string[]): void {
    cloth.TakeOffAll();
    for (const rawId of ids) {
        const id = String(rawId);
        try {
            const dress = cloth.DressUp(id);
            if (!dress) log("本机不存在远端衣服资源: " + id);
        } catch (error) { log("准备衣服资源失败 " + id + ": " + error); }
    }
}

