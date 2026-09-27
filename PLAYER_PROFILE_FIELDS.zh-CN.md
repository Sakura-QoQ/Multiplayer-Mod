# 玩家资料字段映射

本文记录 PlayerHostedMultiplayer 同步的《Fallen Flower》玩家资料真实字段名。游戏内玩家资料卡不再翻译字段标识符，只有资料卡标题跟随语言切换。

v0.13.0 中这些数据包经过 Ubuntu 公开权威服务。服务器校验数据包类型和已经认证的成员身份，
但不解释资料字段；资料提取、分片、字段校验和应用仍全部在玩家电脑执行。

## 资料卡显示字段

| 存档 JSON 字段 | 游戏运行时字段 | UI 显示标识符 | UI 数值含义 |
|---|---|---|---|
| `Cloth` | 服装存档列表 | `Cloth` | 数组项目数 |
| `Quests` | `QuestsData.quests` | `Quests` | 任务 ID 数量 |
| 顶层 `PlayFlag*` | 游戏各个 PlayFlag 字段 | `PlayFlag*` | 值为 `true` 的字段数量 |
| `ConditionSave` | RuntimeCondition 存档数据 | `ConditionSave` | 已存储条件 ID 数量 |
| `XContactData` | `XData.contactData` / `XData.ContactSaveStruct` | `XContactData` | 联系人数量 |
| `PlayerStatusData.health` | `PlayerStatus.Health` | `PlayerStatus.Health` | 当前生命值（`health × maxHealth`） |
| `PlayerStatusData.maxHealth` | `PlayerStatus.MaxHealth` | `PlayerStatus.MaxHealth` | 最大生命值 |
| `PlayerStatusData.stamina` | `PlayerStatus.Stamina` | `PlayerStatus.Stamina` | 当前耐力（`stamina × maxStamina`） |
| `PlayerStatusData.maxStamina` | `PlayerStatus.MaxStamina` | `PlayerStatus.MaxStamina` | 最大耐力 |
| `PlayerStatusData.money` | `PlayerStatus.Money` | `PlayerStatus.Money` | 解码存档 `PlayerData.money` 后的游戏数值 |
| `PlayerStatusData.day` | `PlayerStatus.Data.day` | `PlayerStatus.Data.day` | 存档中的天数 |
| `PlayerStatusData.timeOfDay` | `PlayerStatus.TimeOfDay` | `PlayerStatus.TimeOfDay` | 当前时段索引 |

游戏存档里没有名为 `Achievements` 的字段。旧版 Mod 把值为真的 `PlayFlag*` 数量与 `ConditionSave` 项目数相加后自行命名为“成就”；现在资料卡会分别显示这两个真实字段。

`PlayerData.money` 和部分其他整数在存档里使用游戏自己的 `PlayerStatus.XOR_KEY`（`730807045`）保存。资料卡只对 `money` 做显示解码，使其与 `PlayerStatus.Money` 一致，不会修改线上存档内容。

## 完整同步的存档资料组

`PlayerProfile.progress` 保存 `GameManager.GetSave()` 返回的完整对象。当前游戏版本中已观察到的重要顶层字段如下：

| 存档 JSON 字段 | 游戏对象或含义 |
|---|---|
| `PlayerPosition` | 本机玩家 Transform 位置 |
| `PlayerRotation` | 本机玩家 Transform 旋转 |
| `GameTime` | 当前世界时间 |
| `Scene` | `GameManager.NowSceneName` |
| `CustomizationData` | 角色捏脸数据 |
| `PlayerStatusData` | 序列化的 `PlayerStatus.Data`（`PlayerData`） |
| `SexData` | `PlayerStatus.sexData` |
| `ParcelData` | `PlayerStatus.parcelData`（`ParcelData[]`） |
| `TimeOffset` | `PlayerStatus.timeOffset` |
| `PlayerHelper` | Helper/进度存档数据 |
| `Quests` | `QuestsData.quests`；每项使用 `QuestsData.QuestStatus`（`state`、`addTime`） |
| `ConditionSave` | RuntimeCondition 状态 |
| `XPostData` | `XData.postData`（`XData.PostSaveStruct[]`） |
| `XContactData` | `XData.contactData` 的存档（`XData.ContactSaveStruct[]`） |
| `Photo` | 照片索引/元数据；照片图片文件不在 JSON 内 |
| `LastTakePhoto` | 最近一次拍照引用 |
| `Cloth` | 当前外观使用的服装 ID |
| `UnlockedCloth` | 服装解锁状态 |
| `PlayFlag*` | 游戏的各个进度旗标；保留每个原始键名 |

网络包另外保留 `PlayerProfile.cloth` 和 `PlayerProfile.customization`，作为 `Cloth` 与 `CustomizationData` 的便捷镜像，用于远端模型渲染；完整权威快照仍是 `progress`。

这里的“同步”是指传输给远端模型和玩家资料页面显示。接收端不会把其他玩家的任务、背包、旗标或其他进度合并到自己的本地/线上存档。

## 证据与版本范围

本映射已对照当前安装游戏的 IL2CPP 元数据转储，并核对运行时 `GameManager.GetSave()` 返回的 JSON。

- `GameAssembly.dll` SHA-256：`639279AA2243F584BE294CA5AA6AC1BD12687B9220584F4FB2AC5C9A97BD1EE3`
- 已核对运行时类型：`GameManager`、`PlayerData`、`PlayerStatus`、`QuestsData`、`XData`
- 同步 JSON 的已核对来源：`GameManager.GetSave()`

游戏更新可能增加或重命名字段。即使资料卡没有显示未知字段，`PlayerProfile.progress` 仍会原样保留它们。
