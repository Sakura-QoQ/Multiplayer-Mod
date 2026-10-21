# 项目文档

| 文档                                           | 内容                                    |
| ---------------------------------------------- | --------------------------------------- |
| [架构](ARCHITECTURE.md)                        | 客户端/服务端职责、同步、存档和安全边界 |
| [开发](DEVELOPMENT.md)                         | 目录、artifacts、构建、格式与测试       |
| [协议](PROTOCOL.md)                            | TCP 帧、请求响应和错误码                |
| [验证](VERIFICATION.md)                        | 已完成检查与未验收项目                  |
| [服务器部署](../server/README.zh-CN.md)        | Linux 单文件构建、SSH 上传与 systemd    |
| [玩家资料字段](PLAYER_PROFILE_FIELDS.zh-CN.md) | 允许同步的字段与原始标识符              |
| [许可证](LICENSE)                              | 正式许可文本；[中文参考](LICENSE.zh-CN) |

只保留当前说明，不保留历史审查、临时诊断或重复报告。

## 线上存储实验

- [数据库存档与聊天可行性](DATABASE_PLAN.md)：独立剧情/个人天数、房间时钟、账号、存档和聊天设计。
- [存档字段与恢复入口](SAVE_FIELDS.md)：当前版本固定结构、动态字段及覆盖限制。
- [数据库初始化 SQL](../server/migrations/001_storage.sql)：六表 UUID 主键，仅手动初始化。
- [实验运行步骤](ONLINE_STORAGE.md)：本机 WSL PostgreSQL、JWT API 与无盘游戏验证。
