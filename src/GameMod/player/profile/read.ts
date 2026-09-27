// 本地玩家资料读取。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function playerProfileSignature(profile: PlayerProfile): string {
    // GetSave 含位置、时间、NPC 坐标、耐力等持续变化值。对完整对象签名会每两秒发送一次
    // 巨型快照，淹没位置/场景包。签名只覆盖玩家长期资料；真正发送时仍携带完整 GetSave。
    const progress = profile.progress || {};
    const stable: any = {};
    const stableKeys = ["SexData", "ParcelData", "PlayerHelper", "Quests", "ConditionSave",
        "XPostData", "XContactData", "Photo", "LastTakePhoto", "UnlockedCloth", "FirstExperience"];
    for (const key of stableKeys) {
        if (progress[key] !== undefined) stable[key] = progress[key];
    }
    for (const key of Object.keys(progress)) {
        if (key.startsWith("PlayFlag")) stable[key] = progress[key];
    }
    if (progress.PlayerStatusData && typeof progress.PlayerStatusData === "object") {
        const status = JSON.parse(JSON.stringify(progress.PlayerStatusData));
        for (const key of ["day", "timeOfDay", "health", "stamina", "magic", "aroused", "clothDurability", "gameTimes"])
            delete status[key];
        stable.PlayerStatusData = status;
    }
    return JSON.stringify({ cloth: profile.cloth, customization: profile.customization, stable });
}

function captureLocalPlayerProfile(): PlayerProfile | null {
    try {
        const manager = GameManager.Singleton;
        if (!manager || !GameManager.InGame) return null;
        const diagnosticAppearance = BRIDGE_CHANNEL !== "default" && loadConfig().smokeTestAppearance;
        if (diagnosticAppearance && Player.LocalPlayer && Player.LocalPlayer.cloth &&
            !Player.LocalPlayer.cloth.Dressed("Sailor")) {
            // 只改变双实例测试进程的内存，不调用 SaveGame。这样源角色真实生成 Dress、骨骼和材质，
            // Instantiate 时 Unity 才能把该服装映射进远端克隆体。
            const diagnosticDress = Player.LocalPlayer.cloth.DressUp("Sailor");
            diagnosticAppearanceReadyAt = Number(UnityEngine.Time.unscaledTime) + 3;
            log("Diagnostics: equipped the Sailor appearance sample in memory");
            // 服装由 PlayerCloth 动态实例化，通常不在 Player.gameObject 子树内。记录真实层级与
            // copyFrom 骨骼源，供双实例测试确认远端克隆应该复制哪一个对象并绑定哪套骨骼。
            try {
                const describeChain = (start: UnityEngine.Transform | null): string => {
                    const names: string[] = [];
                    let node = start;
                    for (let guard = 0; node && guard < 16; guard++) {
                        names.unshift(String(node.name));
                        node = node.parent;
                    }
                    return names.join("/");
                };
                log("[DualInstanceEvidence] Local clothing object path=" +
                    describeChain(diagnosticDress ? diagnosticDress.gameObject.transform : null) +
                    " copyFrom=" + describeChain(diagnosticDress ? diagnosticDress.copyFrom : null) +
                    " player=" + describeChain(Player.LocalPlayer.gameObject.transform));
            } catch (error) { log("Failed to inspect the diagnostic clothing hierarchy: " + error); }
        }
        if (diagnosticAppearance && diagnosticAppearanceReadyAt > Number(UnityEngine.Time.unscaledTime))
            return null;
        const data = JSON.parse(manager.GetSave() || "{}");
        // 仅双实例诊断通道注入一个确定的非空外观，不写回游戏存档。这样自动测试能证明
        // 衣服字典查找、启用与晒黑材质映射确实运行，而不只是验证 JSON 字段存在。
        if (diagnosticAppearance) {
            data.Cloth = ["Sailor"];
            if (!data.CustomizationData || typeof data.CustomizationData !== "object") data.CustomizationData = {};
            data.CustomizationData.skinTan = true;
            data.CustomizationData.EyeSize = 0.15;
        }
        return {
            cloth: Array.isArray(data.Cloth) ? data.Cloth.map((id: any) => String(id)).slice(0, 128) : [],
            customization: data.CustomizationData && typeof data.CustomizationData === "object" ? data.CustomizationData : {},
            // 保留 GetSave 返回的完整角色资料：手机联系人/X 动态、照片索引、包裹、NPC、
            // 任务、状态、成就旗标、时间、场景和位置均在内。照片图片文件本身不属于存档 JSON。
            progress: data
        };
    } catch (error) {
        log("Failed to capture player clothing and personal progress: " + error);
        return null;
    }
}

