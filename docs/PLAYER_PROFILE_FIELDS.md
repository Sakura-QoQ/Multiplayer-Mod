# Player profile field map

Version 1.1.1 deliberately does **not** synchronize the complete object returned by `GameManager.GetSave()`. Story, quest content, contacts, posts, photos, inventory, NPC state, flags and save-location data stay on the player's computer.

## Network profile

| Packet field | Source | Purpose |
| --- | --- | --- |
| `cloth[]` | `GetSave().Cloth` | Equipped remote clothing IDs, maximum 128 |
| `customization{}` | `GetSave().CustomizationData` | Primitive appearance values only; bounded keys and values |
| `progress.ProfileCounts.quests` | Number of `Quests` entries | Aggregate profile-card display |
| `progress.ProfileCounts.playFlags` | Number of true `PlayFlag*` values | Aggregate profile-card display |
| `progress.ProfileCounts.conditions` | Number of `ConditionSave` entries | Aggregate profile-card display |
| `progress.ProfileCounts.contacts` | Length of `XContactData` | Aggregate profile-card display |

The separate `playerLiveData` packet contains bounded live status, local day/time display and scene for remote UI. It is not written into another player's save. Public-room identity is replaced by the authenticated server connection, so clients cannot choose another member's owner ID or name.

## Explicitly excluded

The network profile excludes `PlayerPosition`, `PlayerRotation`, full `PlayerStatusData`, `SexData`, `ParcelData`, `PlayerHelper`, quest bodies, `XPostData`, contact bodies, photos, unlock lists, individual `PlayFlag*` keys, NPC data and any unknown future save fields. Position/action synchronization uses a separate bounded real-time packet.

This allowlist is both a privacy boundary and a protocol-size boundary. New fields require an explicit review rather than being copied automatically from future game-save versions.
