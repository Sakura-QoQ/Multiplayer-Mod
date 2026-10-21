# 本机 WSL PostgreSQL 线上存储实验

客户端仍为开发实验，未替换 GitHub 上已发布的玩家安装包。PostgreSQL 后端已经部署；本次直连 IP 的 TLS 配置尚未上传。实验期间数据库是角色的唯一持久来源，不导入本机旧存档。原版单机文件保留。

## 数据库与配置

当前部署配置为 localhost:5432，数据库 FallenFlowerServer，专用账号 fallenflower_app。完整配置位于 server/config/database.json，按项目要求随仓库保存并自动上传；不需要数据库配置 Secrets。模板为 server/config/database.example.json。此处 localhost 指部署服务器自身，不能用于 Windows 直连 WSL 私有地址的旧实验环境。

开始实验前保持一个 WSL 终端打开，避免 WSL 空闲退出使数据库停止；在该终端检查服务：

```bash
sudo pg_ctlcluster 18 main start
pg_lsclusters
```

在 server/ 执行：

```powershell
npm ci
npm run build
# 仅新建空数据库时执行；本机实验库已经初始化，勿重复执行。
# npm run db:migrate
npm run start:storage
```

代码按职责分为 storage/api.ts（框架与错误边界）、storage/auth.ts（账号接口与可复用 JWT 验证）、storage/saves.ts（本人存档接口）、storage/http.ts（复用响应格式），database.ts/config.ts/password.ts 分别负责数据库、配置和密码摘要。

当前源码配置让账号 API 通过 HTTPS 监听 0.0.0.0:27777，可直接使用 https://13.40.7.1:27777，无需域名或反向代理。config/tls/server.crt 与 server.key 分别是证书和服务端私钥；配置中的相对路径以 database.json 所在目录为基准。客户端仅携带公开证书 account-server.pem，验证证书及 IP，拒绝不可信证书。更换证书时必须同步更新客户端信任文件。allowInsecureLoopback 仅用于本机 HTTP 实验；外部地址必须配置 TLS。房间 TCP 与账号 HTTPS 共用 27777，入口按协议分流，HTTPS 内通过 /auth/register、/auth/login、/me/save 等路径区分接口。共用端口要求 http.host 与 FF_ROOM_LISTEN 一致且配置 TLS；不再需要额外开放 27778。部署后需在服务器安全组和防火墙开放 TCP 27777；PostgreSQL 5432 无需对外开放。客户端不连接 PostgreSQL，也不持有数据库配置。FF_DATABASE_CONFIG 可指定配置文件路径；缺省文件不存在时仅启动既有 TCP 房间服务。

## UTC 与数据保留

所有数据库连接固定 TimeZone=UTC，时间字段使用 timestamptz；本机 WSL 实验数据库的默认时区也已设为 UTC。API 时间序列化为 ISO 8601 UTC（Z）。服务器操作系统的本地时区不参与聊天保留规则。

users 长期保存，没有每日清理或登录超时自动删除；player_saves 与 save_assets 同样不参与聊天清理。JWT 过期只使令牌失效，不删除用户。

使用 node-cron 在每天 UTC 00:00 清理 chat_messages：永久删除 created_at 早于当天 UTC 00:00 的消息，包含房间聊天与私聊；恰好零点及之后的消息保留。这是按自然日清理，不是逐条保留 24 小时。启动时先补清理，再开放存储 API；服务停止时关闭任务并等待当前清理结束。

会话、成员、已读游标和消息序号保留，不清空账号或存档，也不重置 next_sequence。当前聊天尚无对外 API/UI；这项任务先落实数据库保留策略。

已有数据库若尚无索引，可手动执行 CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON chat_messages(created_at)。其他应用直连 PostgreSQL 时，也应使用 UTC 会话；数据库所有者可执行 ALTER DATABASE 数据库名 SET timezone TO 'UTC'，对新连接生效。

## 用户验证与存档接口

| 方法与路径          | 行为                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| POST /auth/register | username、password；displayName 可选，默认用户名；成功返回 UUID id 与用户名 |
| POST /auth/login    | username、password；返回 15 分钟 JWT、userId、expiresIn                     |
| POST /auth/logout   | Bearer JWT；使当前账号旧令牌失效                                            |
| GET /me/save        | Bearer JWT；只读取本人槽位 0；无角色返回 404                                |
| PUT /me/save        | Bearer JWT；按 expectedRevision 创建或更新完整原生 JSON；冲突返回 409       |
| GET /health/storage | 检查数据库和存档表可访问                                                    |

用户名规则为 3–32 位小写字母、数字、下划线，全库唯一。密码 12–128 字符，用 Node.js scrypt 加随机盐摘要保存。所有六张表均有 UUID id 主键；其他实体外键同为 UUID。revision、auth_version、消息 sequence 是并发/排序字段，不作为实体 ID。

注册正文只需：

```json
{ "username": "player_one", "password": "your-long-private-password" }
```

写入正文包含 expectedRevision（十进制字符串，新角色为 "0"）、schemaVersion:1、gameVersion、gameBinarySha256、payload。payload 保留未知原生字段，大小上限 1 MiB。响应统一包含 success、status、code、message、data、requestId。不要将密码、JWT 或存档正文放进 Player.log 或公开截图。

## 游戏实验

开发工具使用本机 Frida Python SDK 和 Python cryptography；它们不进入普通玩家 ZIP。账号地址文件采用 AES-GCM 混淆，仅用于封装地址；密码传输的保密性来自 TLS。自动往返测试创建随机实验账号，不使用或导入玩家已有存档：

```powershell
python mod/tools/Experiment-OnlineSave.py --game D:/FallenFlower/FallenFlower.exe --frida-path D:/FallenFlower/.tmp/reverse-libs
```

此命令运行两个无图形游戏进程，创建原生新角色、存入 PostgreSQL、把个人天数设为 17 并在第二进程恢复，检查关键字段和零 .save 打开。它仅保留数据库测试记录，不保存密码/令牌/完整快照到磁盘。

交互实验可运行：

```powershell
# 启动游戏后打开联机入口，在游戏内登录，或切换注册页面。
python mod/tools/Experiment-OnlineSave.py --game D:/FallenFlower/FallenFlower.exe --frida-path D:/FallenFlower/.tmp/reverse-libs --play
# 自动验证实际游戏内注册、错误密码提示及第二进程重新登录：
python mod/tools/Experiment-OnlineSave.py --game D:/FallenFlower/FallenFlower.exe --frida-path D:/FallenFlower/.tmp/reverse-libs --ui-test
```

交互模式每 30 秒提交快照，并处理原版自动保存/床边保存发出的内存快照请求；控制台只在数据库提交后显示新 revision。冲突或数据库失败会终止实验进程，绝不回退本地存档。最后一次成功提交之后的未提交进度可能丢失。账号凭据仅保留在启动器内存，JWT 到期前重新登录。

游戏内首先显示登录/注册页，登录成功后进入房间选择；密码输入为遮罩，取消或提交后清理输入。密码与 JWT 只留在输入控件和实验启动器会话内存，不经过 Player.log 或桥接日志。启动器通过临时 Mod 加载计划启用当前 Mod，不修改原加载计划。当前源码 Mod 必须与实验适配器配合使用；已在本机安装实验脚本，仓库 artifacts 玩家 ZIP 仍是此前发布版。账号 JWT 当前保护存档 API；旧 TCP 房间协议尚未绑定 JWT。

照片的数据库表已建立，但图片传输/内存纹理恢复尚未实现；交互模式拒绝恢复包含 Photo 数据的角色。新角色和空剧情集合的往返通过不等于全部剧情、照片和双客户端验收通过。房间共享绝对 day 的旧同步协议也还未迁移，当前不要用此实验宣称独立天数多人联机已完成。

## 检查

```powershell
npm --prefix server test
npm --prefix server run test:storage
npm --prefix mod test
# Linux/WSL，先构建 release，再验证独立程序的 JWT/数据库路径：
# npm --prefix server run test:executable:storage
```

数据库测试只创建和删除专用随机测试 schema，不清空 public 表。Linux 单文件发布仍用 npm run build:release；SQL 作为 SEA asset 内嵌，GitHub 在构建和测试后把完整 config/（含数据库配置及服务端 TLS 文件）放入发布目录，上传到 /opt/FallenFlowerServer/config/，目录权限 700、文件权限 600。服务端私钥不进入 mod/ 或玩家安装包。部署失败时程序和 config 一起回退，.env 继续保留。生产数据库表结构仍须手动初始化，部署不自动迁移。
