// 界面语言运行时。
// 源码使用共享全局声明，构建时严格按 source-order.json 合并为 Mod 启动器入口。
function loadLanguageFile(code: string): Record<string, string> {
    try {
        const text = ReadModFile("i18n/" + code + "/strings.json");
        const parsed = text ? JSON.parse(text) : null;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        log("Failed to load language pack " + code + ": " + error);
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
    let runtimeLanguage = -1;
    try { runtimeLanguage = Number(Localization.Language); } catch (_error) { }

    const valid = (value: number) => Number.isInteger(value) && value >= 0 && value < LANGUAGE_CODES.length;
    if (!valid(runtimeLanguage)) runtimeLanguage = -1;
    languagePollFrames += 1;

    // 游戏初始化主菜单时会快速遍历多种语言。只有运行时语言连续稳定 8 帧才采用它，
    // 这样既支持游戏内实时切换，也不会让联机界面在启动时跟着闪烁。
    if (runtimeLanguage === runtimeLanguageCandidate) runtimeLanguageStableFrames += 1;
    else {
        runtimeLanguageCandidate = runtimeLanguage;
        runtimeLanguageStableFrames = 1;
    }

    let nextIndex = languageIndex;
    if (force) nextIndex = runtimeLanguage >= 0 ? runtimeLanguage : 0;
    else if (runtimeLanguage >= 0 && runtimeLanguageStableFrames >= 8 && languagePollFrames >= 30) nextIndex = runtimeLanguage;
    else if (nextIndex < 0) nextIndex = runtimeLanguage >= 0 ? runtimeLanguage : 0;

    if (!force && nextIndex === languageIndex) return;
    languageIndex = nextIndex;
    languageCode = LANGUAGE_CODES[nextIndex];
    if (Object.keys(englishMessages).length === 0) englishMessages = loadLanguageFile("en");
    messages = languageCode === "en" ? englishMessages : loadLanguageFile(languageCode);
    refreshLocalizedUi();
    log("Multiplayer UI language changed to: " + languageCode);
}
