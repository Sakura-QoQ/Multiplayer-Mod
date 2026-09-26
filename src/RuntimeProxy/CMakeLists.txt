cmake_minimum_required(VERSION 3.20)
project(PlayerHostedMultiplayerRuntime LANGUAGES C CXX)
# MinHook 直接以源码静态编入 version.dll，玩家端无需额外安装或携带 MinHook DLL。
set(MINHOOK_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../third_party/minhook")
add_library(version SHARED
    version_proxy.cpp
    version.def
    "${MINHOOK_ROOT}/src/buffer.c"
    "${MINHOOK_ROOT}/src/hook.c"
    "${MINHOOK_ROOT}/src/trampoline.c"
    "${MINHOOK_ROOT}/src/hde/hde64.c")
target_include_directories(version PRIVATE "${MINHOOK_ROOT}/include" "${MINHOOK_ROOT}/src" "${MINHOOK_ROOT}/src/hde")
target_compile_features(version PRIVATE cxx_std_20)
target_compile_definitions(version PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
# 使用静态 MSVC 运行库，避免玩家电脑缺少对应 VC++ Redistributable。
set_property(TARGET version PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set_target_properties(version PROPERTIES PREFIX "" OUTPUT_NAME "version")
if(MSVC)
    target_compile_options(version PRIVATE /W4 /utf-8)
endif()
