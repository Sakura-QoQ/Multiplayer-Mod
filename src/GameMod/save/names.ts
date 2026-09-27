// 线上存档名称、槽位隔离与稳定玩家标识。
function activeSaveName(onlineName: string): string {
    return onlineName.startsWith(ONLINE_SAVE_PREFIX)
        ? ACTIVE_SAVE_PREFIX + onlineName.substring(ONLINE_SAVE_PREFIX.length)
        : "";
}

function onlineActiveSaveName(): string {
    if (role === "off") return "";
    return activeSaveName(selectedSaveName);
}

function normalizedSaveSlot(value: string, fallback = ""): string {
    const normalized = String(value || fallback).replace(/\\/g, "/");
    return normalized.substring(normalized.lastIndexOf("/") + 1).replace(/\.save$/i, "");
}

function isDefaultAutoSaveName(value: string): boolean {
    return normalizedSaveSlot(value, "AutoSave").toLowerCase() === "autosave";
}

function isOnlineSaveSlot(value: string): boolean {
    const lowerName = normalizedSaveSlot(value).toLowerCase();
    return lowerName.startsWith(ONLINE_SAVE_PREFIX.toLowerCase()) ||
        lowerName.startsWith(ACTIVE_SAVE_PREFIX.toLowerCase());
}

function isUuidV7(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function createUuidV7(): string {
    // UUIDv7: 48-bit Unix millisecond time, version 7, RFC 9562 variant, and random remainder.
    const bytes: number[] = [];
    for (let index = 0; index < 16; index++) bytes.push(Math.floor(Math.random() * 256));
    let timestamp = Date.now();
    for (let index = 5; index >= 0; index--) {
        bytes[index] = timestamp % 256;
        timestamp = Math.floor(timestamp / 256);
    }
    bytes[6] = 0x70 | (bytes[6] & 0x0f);
    bytes[8] = 0x80 | (bytes[8] & 0x3f);
    const hex = bytes.map(value => ("0" + Math.floor(value).toString(16)).slice(-2)).join("");
    return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-" +
        hex.substring(16, 20) + "-" + hex.substring(20);
}

function getOrCreateOnlineSaveId(): string {
    if (hasUuidV7OnlineName(selectedSaveName))
        return selectedSaveName.substring(ONLINE_SAVE_PREFIX.length).toLowerCase();
    const state = readBridgeState();
    const existing = state && state.saves
        ? state.saves.find(save => hasUuidV7OnlineName(save.name)) : null;
    return existing ? existing.name.substring(ONLINE_SAVE_PREFIX.length).toLowerCase() : createUuidV7();
}

function hasUuidV7OnlineName(value: string): boolean {
    return value.startsWith(ONLINE_SAVE_PREFIX) && isUuidV7(value.substring(ONLINE_SAVE_PREFIX.length));
}

function makeOnlineSaveName(): string {
    return ONLINE_SAVE_PREFIX + getOrCreateOnlineSaveId();
}
