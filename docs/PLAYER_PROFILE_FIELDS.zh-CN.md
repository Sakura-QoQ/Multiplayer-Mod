# 玩家资料字段映射

1.0.0 明确**不再同步** `GameManager.GetSave()` 返回的完整对象。剧情、任务内容、联系人、动态、照片、背包、NPC 状态、旗标和存档位置全部留在玩家本机。

## 网络资料白名单

| 包字段 | 来源 | 用途 |
| --- | --- | --- |
| `cloth[]` | `GetSave().Cloth` | 远端当前服装 ID，最多 128 项 |
| `customization{}` | `GetSave().CustomizationData` | 仅限有界的基础外观键值 |
| `progress.ProfileCounts.quests` | `Quests` 项目数量 | 玩家资料卡聚合显示 |
| `progress.ProfileCounts.playFlags` | 值为真的 `PlayFlag*` 数量 | 玩家资料卡聚合显示 |
| `progress.ProfileCounts.conditions` | `ConditionSave` 项目数量 | 玩家资料卡聚合显示 |
| `progress.ProfileCounts.contacts` | `XContactData` 长度 | 玩家资料卡聚合显示 |

独立的 `playerLiveData` 包只携带有界实时状态、本机日期/时段显示和场景，用于远端 UI，不写入其他玩家存档。公开房间会用认证连接覆盖玩家自报的 owner ID 和名字，客户端不能冒充其他成员。

## 明确排除

网络资料不包含 `PlayerPosition`、`PlayerRotation`、完整 `PlayerStatusData`、`SexData`、`ParcelData`、`PlayerHelper`、任务正文、`XPostData`、联系人正文、照片、解锁列表、逐个 `PlayFlag*`、NPC 数据或未来新增的未知存档字段。位置与动作使用另一条有界实时包同步。

该白名单同时是隐私和协议体积边界。游戏未来增加字段时必须单独审查，不能自动复制整个存档对象。
