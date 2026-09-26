#include <windows.h>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <string>
#include <string_view>
#include <vector>
#include "MinHook.h"

// 该 DLL 同时承担两项职责：
// 1. 完整转发 Windows 系统 version.dll 的 17 个导出，保证 UcModLauncher 等程序正常运行；
// 2. 仅在 FallenFlower.exe 中安装受版本校验保护的 ReadModFile 挂钩。
namespace {
extern "C" __declspec(dllexport) int PlayerHostedMultiplayerRuntimeVersion() { return 1; }
constexpr uintptr_t kReadModFileRva = 0x1CCBF50;
constexpr DWORD kExpectedTimestamp = 0x6AB0FF10;
constexpr DWORD kExpectedImageSize = 0x049CB000;
constexpr unsigned char kExpectedPrologue[] = { 0x48, 0x89, 0x74, 0x24, 0x10, 0x57, 0x48, 0x83, 0xEC, 0x20, 0x80, 0x3D };
constexpr wchar_t kCommandPrefix[] = L"__mpb__/";

struct Il2CppString { void* klass; void* monitor; int32_t length; wchar_t chars[1]; };
// version.dll 的函数指针必须保持与 Windows SDK 相同的调用约定和参数布局。
using GetFileVersionInfoSizeAFn = DWORD(WINAPI*)(LPCSTR, LPDWORD);
using GetFileVersionInfoSizeWFn = DWORD(WINAPI*)(LPCWSTR, LPDWORD);
using GetFileVersionInfoSizeExAFn = DWORD(WINAPI*)(DWORD, LPCSTR, LPDWORD);
using GetFileVersionInfoSizeExWFn = DWORD(WINAPI*)(DWORD, LPCWSTR, LPDWORD);
using GetFileVersionInfoAFn = BOOL(WINAPI*)(LPCSTR, DWORD, DWORD, LPVOID);
using GetFileVersionInfoWFn = BOOL(WINAPI*)(LPCWSTR, DWORD, DWORD, LPVOID);
using GetFileVersionInfoExAFn = BOOL(WINAPI*)(DWORD, LPCSTR, DWORD, DWORD, LPVOID);
using GetFileVersionInfoExWFn = BOOL(WINAPI*)(DWORD, LPCWSTR, DWORD, DWORD, LPVOID);
using GetFileVersionInfoByHandleFn = DWORD(WINAPI*)(DWORD, HANDLE, DWORD, LPVOID);
using VerFindFileAFn = DWORD(WINAPI*)(DWORD, LPCSTR, LPCSTR, LPCSTR, LPSTR, PUINT, LPSTR, PUINT);
using VerFindFileWFn = DWORD(WINAPI*)(DWORD, LPCWSTR, LPCWSTR, LPCWSTR, LPWSTR, PUINT, LPWSTR, PUINT);
using VerInstallFileAFn = DWORD(WINAPI*)(DWORD, LPCSTR, LPCSTR, LPCSTR, LPCSTR, LPCSTR, LPSTR, PUINT);
using VerInstallFileWFn = DWORD(WINAPI*)(DWORD, LPCWSTR, LPCWSTR, LPCWSTR, LPCWSTR, LPCWSTR, LPWSTR, PUINT);
using VerLanguageNameAFn = DWORD(WINAPI*)(DWORD, LPSTR, DWORD);
using VerLanguageNameWFn = DWORD(WINAPI*)(DWORD, LPWSTR, DWORD);
using VerQueryValueAFn = BOOL(WINAPI*)(LPCVOID, LPCSTR, LPVOID*, PUINT);
using VerQueryValueWFn = BOOL(WINAPI*)(LPCVOID, LPCWSTR, LPVOID*, PUINT);
using ReadModFileFn = Il2CppString*(__fastcall*)(void*, Il2CppString*, const void*);
using StringNewUtf16Fn = Il2CppString*(__cdecl*)(const wchar_t*, int32_t);
using BridgeHostFn = int(__cdecl*)(int, int);
using BridgeJoinFn = int(__cdecl*)(const char*, int);
using BridgeSendFn = int(__cdecl*)(int64_t, const char*);
using BridgePollFn = int(__cdecl*)(char*, int);
using BridgeStatusFn = int(__cdecl*)(char*, int);
using BridgeStopFn = void(__cdecl*)();
using BridgeProtocolFn = int(__cdecl*)();

HMODULE g_realVersion{};
GetFileVersionInfoSizeAFn g_getFileVersionInfoSizeA{};
GetFileVersionInfoSizeWFn g_getFileVersionInfoSizeW{};
GetFileVersionInfoSizeExAFn g_getFileVersionInfoSizeExA{};
GetFileVersionInfoSizeExWFn g_getFileVersionInfoSizeExW{};
GetFileVersionInfoAFn g_getFileVersionInfoA{};
GetFileVersionInfoWFn g_getFileVersionInfoW{};
GetFileVersionInfoExAFn g_getFileVersionInfoExA{};
GetFileVersionInfoExWFn g_getFileVersionInfoExW{};
GetFileVersionInfoByHandleFn g_getFileVersionInfoByHandle{};
VerFindFileAFn g_verFindFileA{};
VerFindFileWFn g_verFindFileW{};
VerInstallFileAFn g_verInstallFileA{};
VerInstallFileWFn g_verInstallFileW{};
VerLanguageNameAFn g_verLanguageNameA{};
VerLanguageNameWFn g_verLanguageNameW{};
VerQueryValueAFn g_verQueryValueA{};
VerQueryValueWFn g_verQueryValueW{};
ReadModFileFn g_originalReadModFile{};
StringNewUtf16Fn g_stringNewUtf16{};
HMODULE g_bridgeModule{};
BridgeHostFn g_bridgeHost{};
BridgeJoinFn g_bridgeJoin{};
BridgeSendFn g_bridgeSend{};
BridgePollFn g_bridgePoll{};
BridgeStatusFn g_bridgeStatus{};
BridgeStopFn g_bridgeStop{};
BridgeProtocolFn g_bridgeProtocol{};

std::wstring GetGameRoot() {
    std::vector<wchar_t> path(32768);
    const DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (!length || length >= path.size()) return {};
    std::wstring result(path.data(), length);
    const auto slash = result.find_last_of(L"\\/");
    return slash == std::wstring::npos ? std::wstring{} : result.substr(0, slash);
}

void Log(std::string_view text) {
    const std::wstring root = GetGameRoot();
    if (root.empty()) return;
    const std::wstring path = root + L"\\Mods\\PlayerHostedMultiplayer\\runtime.log";
    HANDLE file = CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return;
    DWORD written{};
    WriteFile(file, text.data(), static_cast<DWORD>(text.size()), &written, nullptr);
    WriteFile(file, "\r\n", 2, &written, nullptr);
    CloseHandle(file);
}

bool LoadRealVersion() {
    // 使用绝对的 System32 路径，避免再次加载游戏目录中的代理 DLL 形成递归。
    if (g_realVersion) return true;
    wchar_t systemDirectory[MAX_PATH]{};
    const UINT length = GetSystemDirectoryW(systemDirectory, MAX_PATH);
    if (!length || length >= MAX_PATH) return false;
    std::wstring path(systemDirectory, length);
    path += L"\\version.dll";
    g_realVersion = LoadLibraryW(path.c_str());
    if (!g_realVersion) return false;
    g_getFileVersionInfoSizeA = reinterpret_cast<GetFileVersionInfoSizeAFn>(GetProcAddress(g_realVersion, "GetFileVersionInfoSizeA"));
    g_getFileVersionInfoSizeW = reinterpret_cast<GetFileVersionInfoSizeWFn>(GetProcAddress(g_realVersion, "GetFileVersionInfoSizeW"));
    g_getFileVersionInfoSizeExA = reinterpret_cast<GetFileVersionInfoSizeExAFn>(GetProcAddress(g_realVersion, "GetFileVersionInfoSizeExA"));
    g_getFileVersionInfoSizeExW = reinterpret_cast<GetFileVersionInfoSizeExWFn>(GetProcAddress(g_realVersion, "GetFileVersionInfoSizeExW"));
    g_getFileVersionInfoA = reinterpret_cast<GetFileVersionInfoAFn>(GetProcAddress(g_realVersion, "GetFileVersionInfoA"));
    g_getFileVersionInfoW = reinterpret_cast<GetFileVersionInfoWFn>(GetProcAddress(g_realVersion, "GetFileVersionInfoW"));
    g_getFileVersionInfoExA = reinterpret_cast<GetFileVersionInfoExAFn>(GetProcAddress(g_realVersion, "GetFileVersionInfoExA"));
    g_getFileVersionInfoExW = reinterpret_cast<GetFileVersionInfoExWFn>(GetProcAddress(g_realVersion, "GetFileVersionInfoExW"));
    g_getFileVersionInfoByHandle = reinterpret_cast<GetFileVersionInfoByHandleFn>(GetProcAddress(g_realVersion, "GetFileVersionInfoByHandle"));
    g_verFindFileA = reinterpret_cast<VerFindFileAFn>(GetProcAddress(g_realVersion, "VerFindFileA"));
    g_verFindFileW = reinterpret_cast<VerFindFileWFn>(GetProcAddress(g_realVersion, "VerFindFileW"));
    g_verInstallFileA = reinterpret_cast<VerInstallFileAFn>(GetProcAddress(g_realVersion, "VerInstallFileA"));
    g_verInstallFileW = reinterpret_cast<VerInstallFileWFn>(GetProcAddress(g_realVersion, "VerInstallFileW"));
    g_verLanguageNameA = reinterpret_cast<VerLanguageNameAFn>(GetProcAddress(g_realVersion, "VerLanguageNameA"));
    g_verLanguageNameW = reinterpret_cast<VerLanguageNameWFn>(GetProcAddress(g_realVersion, "VerLanguageNameW"));
    g_verQueryValueA = reinterpret_cast<VerQueryValueAFn>(GetProcAddress(g_realVersion, "VerQueryValueA"));
    g_verQueryValueW = reinterpret_cast<VerQueryValueWFn>(GetProcAddress(g_realVersion, "VerQueryValueW"));
    return g_getFileVersionInfoSizeA && g_getFileVersionInfoSizeW &&
        g_getFileVersionInfoSizeExA && g_getFileVersionInfoSizeExW &&
        g_getFileVersionInfoA && g_getFileVersionInfoW &&
        g_getFileVersionInfoExA && g_getFileVersionInfoExW &&
        g_getFileVersionInfoByHandle && g_verFindFileA && g_verFindFileW &&
        g_verInstallFileA && g_verInstallFileW && g_verLanguageNameA &&
        g_verLanguageNameW && g_verQueryValueA && g_verQueryValueW;
}

bool IsGameProcess() {
    // 同目录的 UcModLauncher 也可能加载 version.dll；只有游戏本体才允许启动联机线程。
    std::vector<wchar_t> path(32768);
    const DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (!length || length >= path.size()) return false;
    const wchar_t* name = path.data();
    for (DWORD i = 0; i < length; ++i) {
        if (path[i] == L'\\' || path[i] == L'/') name = path.data() + i + 1;
    }
    return _wcsicmp(name, L"FallenFlower.exe") == 0;
}

std::wstring_view StringView(Il2CppString* value) {
    return (!value || value->length < 0) ? std::wstring_view{} : std::wstring_view(value->chars, static_cast<size_t>(value->length));
}

std::string WideToUtf8(std::wstring_view value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    std::string result(static_cast<size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
    return result;
}

std::wstring Utf8ToWide(std::string_view value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (size <= 0) return {};
    std::wstring result(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size);
    return result;
}

std::string PercentDecode(std::string_view value) {
    auto hex = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    std::string result;
    result.reserve(value.size());
    for (size_t i = 0; i < value.size(); ++i) {
        if (value[i] == '%' && i + 2 < value.size()) {
            const int high = hex(value[i + 1]);
            const int low = hex(value[i + 2]);
            if (high >= 0 && low >= 0) { result.push_back(static_cast<char>((high << 4) | low)); i += 2; continue; }
        }
        result.push_back(value[i] == '+' ? ' ' : value[i]);
    }
    return result;
}

std::string QueryValue(std::string_view command, std::string_view name) {
    // 私有命令使用简单查询字符串格式，例如 host?port=27777&max=4。
    const std::string key = std::string(name) + "=";
    const auto query = command.find('?');
    if (query == std::string_view::npos) return {};
    size_t cursor = query + 1;
    while (cursor < command.size()) {
        const size_t end = command.find('&', cursor);
        const auto item = command.substr(cursor, end == std::string_view::npos ? command.size() - cursor : end - cursor);
        if (item.starts_with(key)) return PercentDecode(item.substr(key.size()));
        if (end == std::string_view::npos) break;
        cursor = end + 1;
    }
    return {};
}

int ToInt(const std::string& value, int fallback = 0) {
    if (value.empty()) return fallback;
    char* end{};
    const long parsed = std::strtol(value.c_str(), &end, 10);
    return end == value.c_str() ? fallback : static_cast<int>(parsed);
}

Il2CppString* MakeString(std::string_view utf8) {
    const std::wstring wide = Utf8ToWide(utf8);
    return g_stringNewUtf16 ? g_stringNewUtf16(wide.data(), static_cast<int32_t>(wide.size())) : nullptr;
}

Il2CppString* Dispatch(std::string_view command) {
    // 这里只暴露联机所需的有限命令，不给脚本开放任意文件、进程或 Socket 权限。
    if (command == "protocol") return MakeString(g_bridgeProtocol ? std::to_string(g_bridgeProtocol()) : "-1");
    if (command.starts_with("host?")) {
        const int result = g_bridgeHost ? g_bridgeHost(ToInt(QueryValue(command, "port")), ToInt(QueryValue(command, "max"), 4)) : -1;
        Log("command host result=" + std::to_string(result));
        return MakeString(std::to_string(result));
    }
    if (command.starts_with("join?")) {
        const std::string address = QueryValue(command, "address");
        return MakeString(std::to_string(g_bridgeJoin ? g_bridgeJoin(address.c_str(), ToInt(QueryValue(command, "port"))) : -1));
    }
    if (command.starts_with("send?")) {
        const std::string data = QueryValue(command, "data");
        return MakeString(std::to_string(g_bridgeSend ? g_bridgeSend(ToInt(QueryValue(command, "peer")), data.c_str()) : -1));
    }
    if (command == "poll") {
        if (!g_bridgePoll) return MakeString("");
        std::vector<char> buffer(65536);
        int result = g_bridgePoll(buffer.data(), static_cast<int>(buffer.size()));
        if (result == 0) return MakeString("");
        if (result < 0) { buffer.resize(static_cast<size_t>(-result)); result = g_bridgePoll(buffer.data(), static_cast<int>(buffer.size())); }
        if (result > 0) {
            Log("event " + std::string(buffer.data(), static_cast<size_t>(result)));
            return MakeString(std::string_view(buffer.data(), static_cast<size_t>(result)));
        }
        return MakeString("");
    }
    if (command == "status") {
        if (!g_bridgeStatus) return MakeString("{\"state\":\"unavailable\",\"port\":0,\"peers\":0}");
        std::vector<char> buffer(512);
        int result = g_bridgeStatus(buffer.data(), static_cast<int>(buffer.size()));
        if (result < 0) { buffer.resize(static_cast<size_t>(-result)); result = g_bridgeStatus(buffer.data(), static_cast<int>(buffer.size())); }
        return result > 0 ? MakeString(std::string_view(buffer.data(), static_cast<size_t>(result))) : MakeString("");
    }
    if (command == "stop") { if (g_bridgeStop) g_bridgeStop(); return MakeString("0"); }
    return MakeString("-2");
}

Il2CppString* __fastcall HookReadModFile(void* self, Il2CppString* relativePath, const void* method) {
    const std::wstring_view path = StringView(relativePath);
    const std::wstring_view prefix(kCommandPrefix, (sizeof(kCommandPrefix) / sizeof(wchar_t)) - 1);
    // 仅拦截 __mpb__/ 前缀；普通 Mod 文件仍交给游戏原函数读取。
    if (path.starts_with(prefix)) return Dispatch(WideToUtf8(path.substr(prefix.size())));
    return g_originalReadModFile(self, relativePath, method);
}

bool ValidateGameAssembly(HMODULE module) {
    // RVA 挂钩强依赖游戏版本。时间戳、映像大小和函数序言任一不符都拒绝修改。
    const auto base = reinterpret_cast<const unsigned char*>(module);
    const auto dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) return false;
    const auto nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE) return false;
    if (nt->FileHeader.TimeDateStamp != kExpectedTimestamp || nt->OptionalHeader.SizeOfImage != kExpectedImageSize) return false;
    return std::memcmp(base + kReadModFileRva, kExpectedPrologue, sizeof(kExpectedPrologue)) == 0;
}

bool LoadBridge() {
    // 网络桥接是随 Mod 分发的 NativeAOT DLL，玩家电脑不需要安装 .NET Runtime。
    const std::wstring root = GetGameRoot();
    if (root.empty()) return false;
    g_bridgeModule = LoadLibraryW((root + L"\\Mods\\PlayerHostedMultiplayer\\Native\\MultiplayerBridge.dll").c_str());
    if (!g_bridgeModule) return false;
    g_bridgeHost = reinterpret_cast<BridgeHostFn>(GetProcAddress(g_bridgeModule, "mpb_host"));
    g_bridgeJoin = reinterpret_cast<BridgeJoinFn>(GetProcAddress(g_bridgeModule, "mpb_join"));
    g_bridgeSend = reinterpret_cast<BridgeSendFn>(GetProcAddress(g_bridgeModule, "mpb_send"));
    g_bridgePoll = reinterpret_cast<BridgePollFn>(GetProcAddress(g_bridgeModule, "mpb_poll_event"));
    g_bridgeStatus = reinterpret_cast<BridgeStatusFn>(GetProcAddress(g_bridgeModule, "mpb_status"));
    g_bridgeStop = reinterpret_cast<BridgeStopFn>(GetProcAddress(g_bridgeModule, "mpb_stop"));
    g_bridgeProtocol = reinterpret_cast<BridgeProtocolFn>(GetProcAddress(g_bridgeModule, "mpb_protocol_version"));
    return g_bridgeHost && g_bridgeJoin && g_bridgeSend && g_bridgePoll && g_bridgeStatus && g_bridgeStop && g_bridgeProtocol;
}

DWORD WINAPI RuntimeThread(void*) {
    // 等待 Unity 的 IL2CPP 模块加载完成后再解析导出并安装挂钩。
    HMODULE gameAssembly{};
    for (int attempt = 0; attempt < 300 && !gameAssembly; ++attempt) { gameAssembly = GetModuleHandleW(L"GameAssembly.dll"); if (!gameAssembly) Sleep(100); }
    if (!gameAssembly) { Log("GameAssembly.dll was not loaded"); return 1; }
    if (!ValidateGameAssembly(gameAssembly)) { Log("Unsupported GameAssembly.dll build; hook refused"); return 2; }
    g_stringNewUtf16 = reinterpret_cast<StringNewUtf16Fn>(GetProcAddress(gameAssembly, "il2cpp_string_new_utf16"));
    if (!g_stringNewUtf16) { Log("il2cpp_string_new_utf16 export was not found"); return 3; }
    if (!LoadBridge()) { Log("MultiplayerBridge.dll or one of its exports could not be loaded"); return 4; }
    if (MH_Initialize() != MH_OK) { Log("MH_Initialize failed"); return 5; }
    void* target = reinterpret_cast<unsigned char*>(gameAssembly) + kReadModFileRva;
    if (MH_CreateHook(target, &HookReadModFile, reinterpret_cast<void**>(&g_originalReadModFile)) != MH_OK) { Log("MH_CreateHook failed"); return 6; }
    if (MH_EnableHook(target) != MH_OK) { Log("MH_EnableHook failed"); return 7; }
    Log("Runtime bridge installed");
    return 0;
}
} // namespace

extern "C" DWORD WINAPI ProxyGetFileVersionInfoSizeA(LPCSTR name, LPDWORD handle) {
    // 以下代理函数透明调用 System32\version.dll；它们不包含联机逻辑。
    return LoadRealVersion() ? g_getFileVersionInfoSizeA(name, handle) : 0;
}
extern "C" DWORD WINAPI ProxyGetFileVersionInfoSizeW(LPCWSTR name, LPDWORD handle) {
    return LoadRealVersion() ? g_getFileVersionInfoSizeW(name, handle) : 0;
}
extern "C" DWORD WINAPI ProxyGetFileVersionInfoSizeExA(DWORD flags, LPCSTR name, LPDWORD handle) {
    return LoadRealVersion() ? g_getFileVersionInfoSizeExA(flags, name, handle) : 0;
}
extern "C" DWORD WINAPI ProxyGetFileVersionInfoSizeExW(DWORD flags, LPCWSTR name, LPDWORD handle) {
    return LoadRealVersion() ? g_getFileVersionInfoSizeExW(flags, name, handle) : 0;
}
extern "C" BOOL WINAPI ProxyGetFileVersionInfoA(LPCSTR name, DWORD handle, DWORD length, LPVOID data) {
    return LoadRealVersion() ? g_getFileVersionInfoA(name, handle, length, data) : FALSE;
}
extern "C" BOOL WINAPI ProxyGetFileVersionInfoW(LPCWSTR name, DWORD handle, DWORD length, LPVOID data) {
    return LoadRealVersion() ? g_getFileVersionInfoW(name, handle, length, data) : FALSE;
}
extern "C" BOOL WINAPI ProxyGetFileVersionInfoExA(DWORD flags, LPCSTR name, DWORD handle, DWORD length, LPVOID data) {
    return LoadRealVersion() ? g_getFileVersionInfoExA(flags, name, handle, length, data) : FALSE;
}
extern "C" BOOL WINAPI ProxyGetFileVersionInfoExW(DWORD flags, LPCWSTR name, DWORD handle, DWORD length, LPVOID data) {
    return LoadRealVersion() ? g_getFileVersionInfoExW(flags, name, handle, length, data) : FALSE;
}
extern "C" DWORD WINAPI ProxyGetFileVersionInfoByHandle(DWORD flags, HANDLE file, DWORD length, LPVOID data) {
    return LoadRealVersion() ? g_getFileVersionInfoByHandle(flags, file, length, data) : 0;
}
extern "C" DWORD WINAPI ProxyVerFindFileA(DWORD flags, LPCSTR fileName, LPCSTR windowsDirectory, LPCSTR appDirectory, LPSTR currentDirectory, PUINT currentDirectoryLength, LPSTR destinationDirectory, PUINT destinationDirectoryLength) {
    return LoadRealVersion() ? g_verFindFileA(flags, fileName, windowsDirectory, appDirectory, currentDirectory, currentDirectoryLength, destinationDirectory, destinationDirectoryLength) : 0;
}
extern "C" DWORD WINAPI ProxyVerFindFileW(DWORD flags, LPCWSTR fileName, LPCWSTR windowsDirectory, LPCWSTR appDirectory, LPWSTR currentDirectory, PUINT currentDirectoryLength, LPWSTR destinationDirectory, PUINT destinationDirectoryLength) {
    return LoadRealVersion() ? g_verFindFileW(flags, fileName, windowsDirectory, appDirectory, currentDirectory, currentDirectoryLength, destinationDirectory, destinationDirectoryLength) : 0;
}
extern "C" DWORD WINAPI ProxyVerInstallFileA(DWORD flags, LPCSTR sourceFileName, LPCSTR destinationFileName, LPCSTR sourceDirectory, LPCSTR destinationDirectory, LPCSTR currentDirectory, LPSTR temporaryFile, PUINT temporaryFileLength) {
    return LoadRealVersion() ? g_verInstallFileA(flags, sourceFileName, destinationFileName, sourceDirectory, destinationDirectory, currentDirectory, temporaryFile, temporaryFileLength) : 0;
}
extern "C" DWORD WINAPI ProxyVerInstallFileW(DWORD flags, LPCWSTR sourceFileName, LPCWSTR destinationFileName, LPCWSTR sourceDirectory, LPCWSTR destinationDirectory, LPCWSTR currentDirectory, LPWSTR temporaryFile, PUINT temporaryFileLength) {
    return LoadRealVersion() ? g_verInstallFileW(flags, sourceFileName, destinationFileName, sourceDirectory, destinationDirectory, currentDirectory, temporaryFile, temporaryFileLength) : 0;
}
extern "C" DWORD WINAPI ProxyVerLanguageNameA(DWORD language, LPSTR buffer, DWORD length) {
    return LoadRealVersion() ? g_verLanguageNameA(language, buffer, length) : 0;
}
extern "C" DWORD WINAPI ProxyVerLanguageNameW(DWORD language, LPWSTR buffer, DWORD length) {
    return LoadRealVersion() ? g_verLanguageNameW(language, buffer, length) : 0;
}
extern "C" BOOL WINAPI ProxyVerQueryValueA(LPCVOID block, LPCSTR subBlock, LPVOID* buffer, PUINT length) {
    return LoadRealVersion() ? g_verQueryValueA(block, subBlock, buffer, length) : FALSE;
}
extern "C" BOOL WINAPI ProxyVerQueryValueW(LPCVOID block, LPCWSTR subBlock, LPVOID* buffer, PUINT length) {
    return LoadRealVersion() ? g_verQueryValueW(block, subBlock, buffer, length) : FALSE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(instance);
        LoadRealVersion();
        // 管理器进程只进行系统 API 转发，不创建等待 GameAssembly.dll 的后台线程。
        if (IsGameProcess()) {
            HANDLE thread = CreateThread(nullptr, 0, RuntimeThread, nullptr, 0, nullptr);
            if (thread) CloseHandle(thread);
        }
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bridgeStop) g_bridgeStop();
    }
    return TRUE;
}
