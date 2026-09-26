#pragma once
#include <stdint.h>

#if defined(_WIN32)
#define MPB_API __declspec(dllimport)
#else
#define MPB_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* C ABI 边界：C++ 代理通过这些导出控制 NativeAOT 网络节点。 */
MPB_API int32_t mpb_host(int32_t port, int32_t max_clients);
MPB_API int32_t mpb_join(const char* host_utf8, int32_t port);
MPB_API int32_t mpb_send(int64_t peer_id, const char* message_utf8);

/* 队列为空返回 0；成功返回 UTF-8 字节数；缓冲区过小时返回含 NUL 在内所需容量的负数。 */
MPB_API int32_t mpb_poll_event(char* destination, int32_t capacity);
MPB_API int32_t mpb_status(char* destination, int32_t capacity);
MPB_API void mpb_stop(void);
MPB_API int32_t mpb_protocol_version(void);

#ifdef __cplusplus
}
#endif
