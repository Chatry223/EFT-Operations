# Fika compatibility and Operations integration — exact installed versions

## Version evidence checked from the user's Library archives

| Component | Exact evidence | Target |
|---|---|---|
| EFT client assemblies | `EscapeFromTarkov_Data.zip` contains `Managed/Assembly-CSharp.dll` and Unity modules | EFT `0.16.1.3.35392-P2P` (user-provided target) |
| SPT client common assembly | `BepInEx/plugins/spt/spt-common.dll`, assembly version `3.11.1.0`; embedded build string `3.11.1+d5cda27a...` | SPT `3.11.1` |
| Fika client | `BepInEx/plugins/Fika.Core.dll`, assembly version `1.2.3.0`; `com.fika.core.cfg` says `Fika.Core v1.2.3` and `Last Version = 1.2.3` | Fika client `1.2.3` |
| Fika server | `Takove Server - SPT 3.11.1.zip` → `user/mods/fika-server/package.json`: version `2.4.3`, `sptVersion: ~3.11` | Fika Server `2.4.3` |

**Important:** Fika Server `2.4.3` and Fika client plugin `1.2.3` are separate version tracks. The client plugin must check `com.fika.core` against `1.2.3`, not `2.4.3`. The admin panel labels both independently. The hidden config `Last Version` value is advisory only; the loaded BepInEx plugin metadata is authoritative at runtime.

## Exact Fika client 1.2.3 API checked

The upstream Fika Plugin `v1.2.3` source was inspected:
- `Fika.Core.UI.Custom.MatchMakerUIScript` stores `fikaMatchMakerUi` and `raidSettings` using lower-camel field names.
- The nested `MatchMakerUI` exposes `StartButton` and `DedicatedToggle`.
- The Operations client bridge uses those exact field names first, with fallback names for later Fika builds.
- The bridge invokes the existing native Fika Start button only. It does not fabricate a match, bypass Force IP / Force Bind IP validation, or create a second matchmaking implementation.

## Fika Server 2.4.3 integration currently implemented

The version-gated adapter activates only when the sibling `fika-server/package.json` reports Fika `2.4.3` and SPT `~3.11`.

- Observes `FikaUpdateCallbacks.handleRaidAddPlayer` and `handlePlayerDied`, validating each profile against the authenticated SPT session's PMC/Scav profiles. Player-death reports are retained as `authenticated_client_report` evidence with the in-game display name where available; no killer identity is supplied.
- Observes `FikaRaidCallbacks.handleRaidCreate` and `handleRaidLeave`; validates the host nickname or member profile against the authenticated account. Fika's synthetic host `serverId` sentinel is handled separately from normal member profile IDs.
- Observes `FikaMatchService.addPlayerToMatch`. An Operations group is linked only after all accepted, Ready members appear in the same Fika match and the match map equals the mission map. It then calls `OperationsService.startGroup` to move the group into `in_raid`.
- Observes `FikaMatchService.endMatch` and direct `deleteMatch` paths while the roster is still available, then calls `OperationsService.finishGroup` with roster/death flags and matching raid-end reports. A per-match dedupe guard prevents double finalization when `endMatch` calls `deleteMatch`; a reused server ID is reset by `createMatch`. The group moves to `review` with `verified: false`.
- Observes SPT/Fika `LocationLifecycleService.endLocalRaid`, retaining the client-supplied raid-end fields for review with the trust label `untrusted_client_report`.
- At raid start, snapshots the mission member's PMC/Scav inventory. At raid end, compares new `SpawnedInSession` items against the pre-raid snapshot and the profile retained by SPT after its post-raid processing; only items still present in the SPT profile are listed as accepted loot evidence.
- Captures client-reported `Stats.Eft.Victims`, session counters and quest-item reports. Victim profile IDs are cross-checked against authenticated Fika player-death reports where available; the admin UI displays names/roles and corroboration without exposing profile IDs.
- Stores a bounded Fika evidence stream in `SPT-EconomyGuard-Data/operations/fika-events.jsonl`.
- All kill/loot/exit reports remain untrusted or corroborated client evidence, not server-verified objective progress. No automatic points or item rewards are issued from these records.
- The protected admin Fika Link tab shows observer state, hook status, event records, and evidence trust labels.

**Important objective-progress gap:** the production adapter does not yet call `OperationsService.recordRaidEvent`. The current test manually injects a synthetic extract event to test the service; it does not prove live objective telemetry. Therefore the HUD can display objectives, but real kill/loot/visit/extract counters do not yet advance automatically.

## Operations client plugin source

- SPT client authentication uses `SPT.Common.Http.RequestHandler.SessionId`, `Host`, and `HttpClient` from the user's SPT `3.11.1` assembly. Requests use the native SPT client, cookie, compression, and configured TLS behavior.
- The F8 panel supports mission discovery, acceptance, squad membership, Ready/Not Ready, and leaving while the group is still forming.
- The squad leader can request the native Fika host action after every required member is Ready and the selected EFT map matches the mission. Other members still join from Fika's normal raid list.
- The active-raid HUD shows mission title, map, briefing, objectives, and announced reward. Raid start/end notices are displayed at the top of the screen.
- The HUD does **not** claim live objective progress. The current build does not yet have an authoritative server-side stream for kills, visits, loot, or other mission objectives.

## Trust boundaries and remaining production work

Fika 2.4.3's server callbacks expose match creation/join/leave, roster registration, and match-end lifecycle. They do not provide independent server-authoritative proof of every in-raid kill, extraction, or mission objective. A client-supplied raid-end payload is not enough to grant rewards.

Still required:
1. The client DLL has now compiled successfully on a Windows-hosted runner from the verified dependency ZIPs. Build commit: `248e5924bc331167a908f050f8eee7a6574dde12`; artifact ID: `13705463291`; DLL SHA-256: `443602390928327e748d6e8d7cc6e810b7d04bf8e0abed9b9d8fe325b0e0d4ef`. The graphical builder checks exact SHA-256 fingerprints, SPT Common `3.11.1.0`, and Fika Core `1.2.3.0`, then installs only into the separately selected actual BepInEx root.
2. Run a live disposable SPT `3.11.1` + Fika Server `2.4.3` + Fika client `1.2.3` test covering host/client, PMC/Scav, map matching, Ready Check, match linking, raid end, and review.
3. Implement and independently validate objective evidence before enabling automatic mission completion or rewards. Admin review remains mandatory.
