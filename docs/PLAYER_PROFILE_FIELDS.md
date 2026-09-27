# Player profile field map

This document records the exact identifiers used by Fallen Flower for the player profile synchronized by PlayerHostedMultiplayer. Field identifiers are never translated in the in-game profile card; only the card title follows the selected language.

In v0.14.1 these packets travel through the public Ubuntu authority service. It validates packet type
and authenticated member identity but does not interpret profile fields; extraction, chunking,
field validation and application remain on player computers.

## Fields shown in the profile card

| Stored JSON field | Game runtime field | UI identifier | Displayed value |
|---|---|---|---|
| `Cloth` | clothing save list | `Cloth` | Number of array entries |
| `Quests` | `QuestsData.quests` | `Quests` | Number of quest IDs |
| top-level `PlayFlag*` | game play-flag fields | `PlayFlag*` | Number whose value is `true` |
| `ConditionSave` | runtime-condition save data | `ConditionSave` | Number of stored condition IDs |
| `XContactData` | `XData.contactData` / `XData.ContactSaveStruct` | `XContactData` | Number of contacts |
| `PlayerStatusData.health` | `PlayerStatus.Health` | `PlayerStatus.Health` | Current health (`health × maxHealth`) |
| `PlayerStatusData.maxHealth` | `PlayerStatus.MaxHealth` | `PlayerStatus.MaxHealth` | Maximum health |
| `PlayerStatusData.stamina` | `PlayerStatus.Stamina` | `PlayerStatus.Stamina` | Current stamina (`stamina × maxStamina`) |
| `PlayerStatusData.maxStamina` | `PlayerStatus.MaxStamina` | `PlayerStatus.MaxStamina` | Maximum stamina |
| `PlayerStatusData.money` | `PlayerStatus.Money` | `PlayerStatus.Money` | Game value after decoding the stored `PlayerData.money` integer |
| `PlayerStatusData.day` | `PlayerStatus.Data.day` | `PlayerStatus.Data.day` | Stored day number |
| `PlayerStatusData.timeOfDay` | `PlayerStatus.TimeOfDay` | `PlayerStatus.TimeOfDay` | Current time-of-day index |

There is no game save field named `Achievements`. Earlier Mod versions created that label by adding the number of true `PlayFlag*` fields to the number of `ConditionSave` entries. The profile card now reports both real fields separately.

`PlayerData.money` and several other integer members are stored with the game's `PlayerStatus.XOR_KEY` (`730807045`). The profile card decodes `money` so that the value matches `PlayerStatus.Money`; the online save itself is not changed.

## Complete synchronized save-profile groups

`PlayerProfile.progress` contains the complete object returned by `GameManager.GetSave()`. The important top-level groups observed in the current game build are:

| Stored JSON field | Game owner or meaning |
|---|---|
| `PlayerPosition` | local player transform position |
| `PlayerRotation` | local player transform rotation |
| `GameTime` | current world time |
| `Scene` | `GameManager.NowSceneName` |
| `CustomizationData` | character customization values |
| `PlayerStatusData` | serialized `PlayerStatus.Data` (`PlayerData`) |
| `SexData` | `PlayerStatus.sexData` |
| `ParcelData` | `PlayerStatus.parcelData` (`ParcelData[]`) |
| `TimeOffset` | `PlayerStatus.timeOffset` |
| `PlayerHelper` | saved helper/progression data |
| `Quests` | `QuestsData.quests`; each value follows `QuestsData.QuestStatus` (`state`, `addTime`) |
| `ConditionSave` | saved runtime-condition states |
| `XPostData` | `XData.postData` (`XData.PostSaveStruct[]`) |
| `XContactData` | saved `XData.contactData` (`XData.ContactSaveStruct[]`) |
| `Photo` | saved photo index/metadata; image files are separate |
| `LastTakePhoto` | last captured-photo reference |
| `Cloth` | equipped clothing IDs used for the current appearance |
| `UnlockedCloth` | clothing unlock state |
| `PlayFlag*` | individual game progression flags; each original key is preserved |

The packet also keeps `PlayerProfile.cloth` and `PlayerProfile.customization` as convenient mirrors of `Cloth` and `CustomizationData` for remote-model rendering. `progress` remains the authoritative complete snapshot.

“Synchronized” here means transferred for remote representation and player-information display. The receiver does not merge another player's quests, inventory, flags or other progress into its own local/online save.

## Evidence and version scope

This map was checked against the IL2CPP metadata dump for the installed game and against the JSON returned at runtime by `GameManager.GetSave()`.

- `GameAssembly.dll` SHA-256: `639279AA2243F584BE294CA5AA6AC1BD12687B9220584F4FB2AC5C9A97BD1EE3`
- Verified runtime types: `GameManager`, `PlayerData`, `PlayerStatus`, `QuestsData`, `XData`
- Verified source of synchronized JSON: `GameManager.GetSave()`

Game updates may add or rename fields. Unknown fields are still retained in `PlayerProfile.progress`, even when the profile card does not display them.
