# 存档字段与恢复入口

这是数据库迁移的字段调查；无盘存档实验状态见 [线上存储实验](ONLINE_STORAGE.md)。当前游戏版本 1.1.3，元数据版本 31。只记录字段和类型，不记录玩家的字段值、剧情进度或照片内容。

## 覆盖范围

- 对当前 GameAssembly.dll 与进程中解密后的元数据重新解析，运行时枚举 639 个游戏类型；没有沿用旧版方法地址。
- 本机 4 个原版存档全部通过 HMAC 校验并可解析为 JSON，联合观察到 52 个顶层键：21 个普通键与 31 个 PlayFlag 动态键；共有 186 条观察路径。
- 这不是“游戏所有剧情的全部可能键”。任务、条件、NPC、照片、联系人属性、剧情标记和第三方 Mod 均可能动态增键，空集合也不能证明没有子结构。
- 数据库应保存完整 JSON，并对已知结构单独校验；不能只保留样本已出现的键，或用固定 SQL 列替代整个原版对象。

## 普通顶层字段

| 字段                | 样本类型 | 归属/用途                                  |
| ------------------- | -------- | ------------------------------------------ |
| `Cloth`             | array    | 已穿戴衣物 ID                              |
| `ConditionSave`     | object   | 按动态条件 ID 索引的个人条件进度           |
| `CustomizationData` | object   | 角色捏脸和外观参数                         |
| `FirstExperience`   | string   | 个人剧情状态                               |
| `GameTime`          | number   | 个人累计运行时间；并非房间公共天数         |
| `LastTakePhoto`     | string   | 最后拍照标识                               |
| `LoadedMod`         | array    | 保存时加载的 Mod 列表，恢复兼容性检查使用  |
| `NPCData`           | object   | 按 NPC 标识索引的个人世界状态              |
| `ParcelData`        | array    | 个人包裹列表                               |
| `Photo`             | object   | 照片名称到分类标记数组的映射，不含图片字节 |
| `PlayerHelper`      | array    | 个人提示/帮助解锁集合                      |
| `PlayerPosition`    | object   | 原版位置坐标                               |
| `PlayerRotation`    | object   | 原版旋转坐标                               |
| `PlayerStatusData`  | object   | 个人数值、天数、时段、装备与姓名           |
| `Quests`            | object   | 按任务 ID 索引的个人任务状态               |
| `Scene`             | string   | 个人恢复场景；剧情阶段不同不得直接强制覆盖 |
| `SexData`           | object   | 动态个人统计字典                           |
| `TimeOffset`        | number   | 原版时间偏移，需与个人计时语义一起验证     |
| `UnlockedCloth`     | array    | 已解锁衣物 ID                              |
| `XContactData`      | array    | 游戏内联系人及剧情对话，不是玩家私聊       |
| `XPostData`         | array    | 游戏内剧情社交帖子，不是玩家聊天室消息     |

所有字段默认仅属于当前账号的私有存档。其他玩家只能获取原有的外观/状态展示投影；完整剧情和 NPC 联系人不得经房间广播。

## 原版固定结构

以下来自当前运行时的原始字段声明。字段名中的拼写必须原样保留；例如 unlockedRife、unlockedPistor、PohotStruct 不能在兼容层直接纠正。C# 引用类型可能为 null，样本中的整数外观值不意味着原类型是 int。

### PlayerData（34 个字段）

| 字段              | 原版类型         |
| ----------------- | ---------------- |
| `lastBonfire`     | `System.String`  |
| `aroused`         | `System.Single`  |
| `health`          | `System.Single`  |
| `stamina`         | `System.Single`  |
| `magic`           | `System.Single`  |
| `maxMagic`        | `System.Single`  |
| `maxHealth`       | `System.Single`  |
| `maxStamina`      | `System.Single`  |
| `clothDurability` | `System.Single`  |
| `hypnosis`        | `System.Single`  |
| `unlockedRife`    | `System.Boolean` |
| `unlockedPistor`  | `System.Boolean` |
| `unlockedKnife`   | `System.Boolean` |
| `day`             | `System.Int32`   |
| `debt`            | `System.Int32`   |
| `lust`            | `System.Int32`   |
| `timeOfDay`       | `System.Int32`   |
| `money`           | `System.Int32`   |
| `ammo`            | `System.Int32`   |
| `ammoInGun`       | `System.Int32`   |
| `ammoInPistor`    | `System.Int32`   |
| `maxAmmoInGun`    | `System.Int32`   |
| `selectedWeapon`  | `System.Int32`   |
| `medicineNum`     | `System.Int32`   |
| `upgradeTimes`    | `System.Int32`   |
| `damage`          | `System.Int32`   |
| `lucky`           | `System.Int32`   |
| `maxMedicineNum`  | `System.Int32`   |
| `moneyKeeper`     | `System.Int32`   |
| `gameTimes`       | `System.Int32`   |
| `follower`        | `System.Int32`   |
| `paidFollower`    | `System.Int32`   |
| `playerName`      | `System.String`  |
| `moneyKeeperPos`  | `Coordinate`     |

### CustomizationData（15 个字段）

| 字段           | 原版类型         |
| -------------- | ---------------- |
| `hair`         | `System.Int32`   |
| `skinTan`      | `System.Boolean` |
| `EyeSize`      | `System.Single`  |
| `EyeUp`        | `System.Single`  |
| `EyeDis`       | `System.Single`  |
| `EyeAngle`     | `System.Single`  |
| `EyebrowUp`    | `System.Single`  |
| `EyebrowDis`   | `System.Single`  |
| `EyebrowAngle` | `System.Single`  |
| `NosePos`      | `System.Single`  |
| `NoseSize`     | `System.Single`  |
| `MouthPos`     | `System.Single`  |
| `MouthSize`    | `System.Single`  |
| `JawSize`      | `System.Single`  |
| `FaceShape`    | `System.Single`  |

### Coordinate（3 个字段）

| 字段 | 原版类型        |
| ---- | --------------- |
| `x`  | `System.Single` |
| `y`  | `System.Single` |
| `z`  | `System.Single` |

### ParcelData（2 个字段）

| 字段      | 原版类型        |
| --------- | --------------- |
| `clothID` | `System.String` |
| `addDay`  | `System.Int32`  |

### QuestStatus（2 个字段）

| 字段      | 原版类型        |
| --------- | --------------- |
| `state`   | `System.Int32`  |
| `addTime` | `System.String` |

### NPCData（4 个字段）

| 字段       | 原版类型         |
| ---------- | ---------------- |
| `died`     | `System.Boolean` |
| `health`   | `System.Single`  |
| `position` | `Coordinate`     |
| `rotation` | `Coordinate`     |

### PostSaveStruct（7 个字段）

| 字段          | 原版类型         |
| ------------- | ---------------- |
| `time`        | `System.String`  |
| `content`     | `System.String`  |
| `img`         | `System.String`  |
| `attraction`  | `System.Int32`   |
| `preciseTime` | `System.Single`  |
| `selfLike`    | `System.Boolean` |
| `onlyPaid`    | `System.Boolean` |

### LinaModel.ContactSaveStruct

| 字段            | 原版类型          |
| --------------- | ----------------- |
| `seed`          | `System.Int32`    |
| `savepointGuid` | `System.String`   |
| `history`       | `System.String[]` |

### XData.ContactSaveStruct

| 字段          | 原版类型                                                             |
| ------------- | -------------------------------------------------------------------- |
| `unread`      | `System.Int32`                                                       |
| `name`        | `System.String`                                                      |
| `type`        | `System.String`                                                      |
| `lastAddTime` | `System.String`                                                      |
| `history`     | `System.String[]`                                                    |
| `contactData` | `System.Collections.Generic.Dictionary<System.String,System.Object>` |

### PhotoData.PohotStruct

持久字段只有 `flags: System.Int32[]`。`fullSizeSprite`、`fullSizeTexture`、`lowResSprite`、`lowResTexture`、`lastAccessTime` 均带 NonSerialized 标记，不能当成数据库中的 Unity 对象恢复。

`GetFullSizePhoto` 当前 RVA 为 `0x7a7f40`，原生路径包含 `Photos`、`.png`、`File.ReadAllBytes` 和 `ImageConversion.LoadImage`。因此只上传 JSON 会丢失照片；还需要按账号保存图片字节，并在客户端安全地重建运行时纹理。完全无本地照片文件的适配尚未验证。

## 动态字典与剧情标记

- `Player.AddFlag(string)`、`HasFlag(string)`、`RemoveFlag(string)` 使用字面前缀 `PlayFlag` 与传入名称构造键；不是一个固定字段枚举。
- `Quests.*` 使用 QuestStatus；`NPCData.*` 使用 NPCData；`ParcelData[]` 使用 ParcelData。
- `XContactData[].contactData.*` 是任意对象值字典，包含对话树属性；不能固定为只有一个 string 或 bool 类型。
- `ConditionSave`、`PlayerHelper`、`SexData` 与各动态 ID 的业务允许范围仍需覆盖不同存档和剧情路径，不能把空样本解释为可丢弃。

本次已出现的 31 个 PlayFlag 键（只列名称，不列状态）：

- `PlayFlagAlreadySendBra`
- `PlayFlagAlreadySendBreast`
- `PlayFlagBeforeUnlockedPaidX`
- `PlayFlagBiggerBattery`
- `PlayFlagCompleteExposureInstructor_0`
- `PlayFlagCompleteExposureInstructor_1`
- `PlayFlagCompleteMystery_0`
- `PlayFlagCompleteMystery_1`
- `PlayFlagCompleteMystery_2`
- `PlayFlagCompleteMystery_3`
- `PlayFlagCompleteSorryToHomeless`
- `PlayFlagDogRemovedByOwner`
- `PlayFlagFirstOnlineShopping`
- `PlayFlagInteractedMirror`
- `PlayFlagLiveDevice`
- `PlayFlagManInBlackCompleted`
- `PlayFlagOpenedPhone`
- `PlayFlagOpenedSelfPhoto`
- `PlayFlagPetplayShoesEventDone`
- `PlayFlagPunishmentEvent_0Done`
- `PlayFlagPunishmentEvent_1Done`
- `PlayFlagSayBeTreatedLikeDog`
- `PlayFlagSchoolExposureEventDone`
- `PlayFlagSendDogXPost`
- `PlayFlagSendPhotoMystery`
- `PlayFlagSorryToHomelessEventDone`
- `PlayFlagTalkToRescueDog`
- `PlayFlagTalkToRescueDogBack`
- `PlayFlagTouchedDog`
- `PlayFlagTrainStationOverThere`
- `PlayFlagUnlockedPaidX`

## 当前原生入口证据

| 入口                 | 当前 RVA   | 已确认行为                                                                                                 |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| GameManager.GetSave  | `0x8183e0` | 调用 onSaveGame，再对 _saveData 调用 LitJson.JsonData.ToJson；有组件回调副作用，不是任意线程可调用的纯函数 |
| GameManager.LoadGame | `0x818990` | 组合本地路径，检查文件，读取并解密文本，再经 LitJson.JsonMapper.ToObject 写入 _saveData                    |
| GameManager.SaveGame | `0x819d10` | 收集保存回调，序列化/加密并写本地文件                                                                      |
| GameManager.InitGame | `0x818420` | 存档驱动的时间、场景及恢复流程；具体无文件调用顺序仍需原型验证                                             |
| PlayerStatus.SetTime | `0x8ad570` | 原版时段入口，需保留事件/剧情回调语义                                                                      |
| PlayerStatus.AddDay  | `0x8abaa0` | 个人加天入口；不能再用于追赶房间绝对日期                                                                   |
| Player.AddFlag       | `0x89cf80` | 动态 PlayFlag 键写入                                                                                       |

GameManager._saveData 当前偏移为 `0x48`，onSaveGame 为 `0x50`，onLoadGame 为 `0x58`。这些只用于当前构建的取证，不能作为跨版本固定偏移发布。InitGame 地址须以本次 runtime-schema.json 为准。

## 证据与限制

- GameAssembly.dll SHA256：`a233c2c01537620def42f3cbf8481afb6192179a895715f916a64ce3864c1e8a`。
- 解密元数据 SHA256：`4f8229498b156375ebde88d0793768b26e67be4c057a7639bec7bd61cf643a2c`。
- 原始类型、调用和字面量引用位于本机 `work/database-feasibility/`；没有把完整游戏反编译输出或玩家存档提交到项目。
- 检查仅枚举类型、读取已有存档并离线分析原生代码，没有调用 LoadGame/GetSave/SaveGame，没有写入存档。检查前后 Saves 目录所有文件的 SHA256 一致。
- 完整动态字段覆盖、全程不落盘恢复、新账号初始化和照片恢复仍未验收；不能宣称已经逆向出全部剧情状态。
