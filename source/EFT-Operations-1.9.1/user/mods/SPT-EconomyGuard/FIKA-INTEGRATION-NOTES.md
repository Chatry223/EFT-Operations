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

- Observes `FikaUpdateCallbacks.handleRaidAddPlayer` and `handlePlayerDied`, validating each profile against the authenticated SPT session's PMC/Scav profiles.
- Observes `FikaRaidCallbacks.handleRaidCreate` and `handleRaidLeave`; validates the host nickname or member profile against the authenticated account. Fika's synthetic host `serverId` sentinel is handled separately from normal member profile IDs.
- Observes `FikaMatchService.addPlayerToMatch`. An Operations group is linked only after all accepted, Ready members appear in the same Fika match and the match map equals the mission map.
- Observes `FikaMatchService.endMatch` while the match roster is still available.
- Observes SPT/Fika `LocationLifecycleService.endLocalRaid`, retaining the client-supplied raid-end fields for review with the trust label `untrusted_client_report`.
- Stores a bounded Fika evidence stream in `SPT-EconomyGuard-Data/operations/fika-events.jsonl`.
- At match end, the group moves to `review`; no automatic points or item rewards are issued from client-originated extraction data or match-end lifecycle evidence.
- The protected admin Fika Link tab shows observer state, hook status, event records, and evidence trust labels.

## Operations client plugin source

- SPT client authentication uses `SPT.Common.Http.RequestHandler.SessionId`, `Host`, and `HttpClient` from the user's SPT `3.11.1` assembly. Requests use the native SPT client, cookie, compression, and configured TLS behavior.
- The F8 panel supports mission discovery, acceptance, squad membership, Ready/Not Ready, and leaving while the group is still forming.
- The squad leader can request the native Fika host action after every required member is Ready and the selected EFT map matches the mission. Other members still join from Fika's normal raid list.
- The active-raid HUD shows mission title, map, briefing, objectives, and announced reward. Raid start/end notices are displayed at the top of the screen.
- The HUD does **not** claim live objective progress. The current build does not yet have an authoritative server-side stream for kills, visits, loot, or other mission objectives.

## Trust boundaries and remaining production work

Fika 2.4.3's server callbacks expose match creation/join/leave, roster registration, and match-end lifecycle. They do not provide independent server-authoritative proof of every in-raid kill, extraction, or mission objective. A client-supplied raid-end payload is not enough to grant rewards.

Still required:
1. Build the client DLL on Windows using Visual Studio/MSBuild and the exact local EFT Managed + BepInEx assemblies. The graphical builder now checks SPT Common `3.11.1.0` and Fika Core `1.2.3.0` before building. No compiled DLL has yet been produced in this environment.
2. Run a live disposable SPT `3.11.1` + Fika Server `2.4.3` + Fika client `1.2.3` test covering host/client, PMC/Scav, map matching, Ready Check, match linking, raid end, and review.
3. Implement and independently validate objective evidence before enabling automatic mission completion or rewards. Admin review remains mandatory.


## Fika Server 2.4.3 lifecycle evidence extension — 2026-11-14

The exact upstream tag `project-fika/Fika-Server@v2.4.3` was inspected, including `src/services/FikaMatchService.ts`, `src/controllers/FikaUpdateController.ts`, and `src/controllers/FikaRaidController.ts`.

The adapter now observes these actual server-side mutations:

- `FikaMatchService.addPlayerToMatch(matchId, playerId, data)`: records the player being added to the in-memory match roster.
- `FikaMatchService.setPlayerDead(matchId, playerId)`: records the server-accepted dead-state mutation. The triggering callback is still client-originated, so its trust label is `fika_server_accepted_client_event`, not independent server proof.
- `FikaMatchService.removePlayerFromMatch(matchId, playerId)`: records removal from the server-side roster. Fika's method does not supply a reason, so the record explicitly uses `leaveReason: unknown`; it must never be interpreted as successful extraction.

These lifecycle records are linked to the matching mission review by Match ID and the member's PMC/Scav profile IDs. Review data preserves each event's ID, type, player ID, timestamp, trust label and source. All lifecycle records have `rewardEligible: false`.

The review still remains unverified because Fika 2.4.3 does not independently prove a successful extraction or every in-raid objective. `player_raid_end` client payloads remain untrusted. Automatic mission rewards remain disabled unless a future independently validated server source can satisfy the strict `server_verified` completion gate.

Regression coverage now checks join/death/leave observation, exact trust labels, preservation of the review evidence, and readiness failure when the required lifecycle hooks are unavailable.


## Fika Server 2.4.3 item-transfer observer — 2026-11-14

The exact upstream tag `project-fika/Fika-Server@v2.4.3` was inspected for the item-send path:

`FikaItemEventRouter.handleItemEvent("SendToPlayer")` → `FikaSendItemCallbacks.handleSendItem` → `FikaSendItemController.sendItem(pmcData, body, sessionID)`.

The controller:
- resolves sender and receiver profiles using SPT session IDs;
- obtains the selected root item and its descendants from the sender PMC inventory;
- queues a system message containing the item tree for the receiver;
- removes the root item from the sender inventory;
- returns the original SPT item-event response.

The adapter now patches the registered `FikaSendItemController` instance (not the HTTP callback, because `SendToPlayer` is handled by Fika's item-event router). It snapshots the server profile's PMC item tree before and after the original async method, then writes an audit event to the existing bounded Fika JSONL stream.

Evidence fields include sender/receiver session and profile references, root item ID, descendant item count, aggregated TPL/stack counts, transfer state, source method, timestamp, and trust label. The wrapper returns the exact original response object and rethrows the original exception.

**Important trust boundary:** observing the controller and seeing the sender inventory root disappear proves that the server-side debit was observed; it does not independently prove that the receiver later opened or retained the mail. If the root remains, the operation throws, or either profile cannot be inspected, the event is marked uncertain/not confirmed. These records are audit evidence only and always have `rewardEligible: false`.

The Fika admin panel now reports:
- **DISABLED** — Fika's item-transfer route is closed by configuration;
- **ENABLED — server controller observed** — the observer is installed, but individual delivery still needs outcome review;
- **ENABLED — UNMONITORED** — configuration permits transfers but the controller hook is unavailable.

The observer does not change `allowItemSending`, does not block or alter transfers, and does not alter Fika's response semantics. A regression test covers tree aggregation, observed sender debit, uncertain responses, thrown errors, hook idempotence, and response preservation.

## Fika Server 2.4.3 match-status observer — 2026-11-14

The exact upstream `project-fika/Fika-Server@v2.4.3` implementation of `FikaMatchService.setMatchStatus(matchId, status)` and `EFikaMatchStatus` was inspected. The status enum is `LOADING = 0`, `IN_GAME = 1`, `COMPLETE = 2`. The adapter now wraps the service method after the original async mutation completes and records the status, match ID, current roster, mission association, timestamp, source and `fika_server_lifecycle` trust label. It preserves the original Promise result and does not change Fika state.

`COMPLETE` is corroborating lifecycle evidence only. It does not prove that any player extracted, survived, or completed a mission objective. Every status event has `rewardEligible: false`; the mission still enters admin review at match end and automatic awards remain disabled without independent server proof. The new hook is included in the observer readiness calculation and has a regression test for async result preservation and trust boundaries.
