// 界面语言运行时。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function loadLanguageFile(code: string): Record<string, string> {
    try {
        const text = ReadModFile("i18n/" + code + "/strings.json");
        const parsed = text ? JSON.parse(text) : null;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        log("语言包读取失败 " + code + ": " + error);
        return {};
    }
}

function tr(key: string, values?: TranslationValues): string {
    let value = messages[key] || englishMessages[key] || key;
    if (values) {
        for (const name of Object.keys(values)) value = value.split("{" + name + "}").join(String(values[name]));
    }
    return value;
}

function syncGameLanguage(force = false): void {
    let preferenceLanguage = -1;
    let runtimeLanguage = -1;
    try {
        runtimeLanguage = Number(Localization.Language);
        preferenceLanguage = Number(UnityEngine.PlayerPrefs.GetInt("UserSelectedLanguage", runtimeLanguage));
    } catch (_error) { }

    const valid = (value: number) => Number.isInteger(value) && value >= 0 && value < LANGUAGE_CODES.length;
    if (!valid(preferenceLanguage)) preferenceLanguage = -1;
    if (!valid(runtimeLanguage)) runtimeLanguage = -1;
    languagePollFrames += 1;

    // 玩家在设置菜单确认语言后，PlayerPrefs 的变化具有最高优先级，可在下一帧立即刷新。
    const preferenceChanged = preferenceLanguage >= 0 && lastPreferenceLanguage >= 0 && preferenceLanguage !== lastPreferenceLanguage;
    if (preferenceLanguage >= 0) lastPreferenceLanguage = preferenceLanguage;

    // 游戏初始化主菜单时会快速遍历多种语言。只有运行时语言连续稳定 8 帧才采用它，
    // 这样既支持游戏内实时切换，也不会让联机界面在启动时跟着闪烁。
    if (runtimeLanguage === runtimeLanguageCandidate) runtimeLanguageStableFrames += 1;
    else {
        runtimeLanguageCandidate = runtimeLanguage;
        runtimeLanguageStableFrames = 1;
    }

    let nextIndex = languageIndex;
    if (force) nextIndex = preferenceLanguage >= 0 ? preferenceLanguage : (runtimeLanguage >= 0 ? runtimeLanguage : 0);
    else if (preferenceChanged) nextIndex = preferenceLanguage;
    else if (runtimeLanguage >= 0 && runtimeLanguageStableFrames >= 8 && languagePollFrames >= 30) nextIndex = runtimeLanguage;
    else if (nextIndex < 0) nextIndex = preferenceLanguage >= 0 ? preferenceLanguage : (runtimeLanguage >= 0 ? runtimeLanguage : 0);

    if (!force && nextIndex === languageIndex) return;
    languageIndex = nextIndex;
    languageCode = LANGUAGE_CODES[nextIndex];
    if (Object.keys(englishMessages).length === 0) englishMessages = loadLanguageFile("en");
    messages = languageCode === "en" ? englishMessages : loadLanguageFile(languageCode);
    refreshLocalizedUi();
    log("已切换联机界面语言: " + languageCode);
}
