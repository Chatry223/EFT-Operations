
## 1.5.0 — EFT Operations foundation
- Added persistent OperationsService with validated mission definitions and lifecycle.
- Added squad acceptance, readiness and raid registration primitives.
- Added server-side objective event ingestion contract and verified completion gate.
- Added idempotent award ledger and configurable rank calculation.
- Added authenticated admin API endpoints for missions, awards and leaderboard.
- Publishing a mission mirrors its summary into the existing StatusBoard as an `event` announcement.
- Added a sample squad-clearance mission and automated service tests.
- Fika event/host adapter, in-game BepInEx UI and automatic item delivery are not included in this foundation release; these require exact-version API verification before implementation.


## 1.6.0 — EFT Operations mission authoring UI
- Integrated graphical mission authoring into the authenticated admin panel.
- Added JSON import/export, objectives editor, schedule/briefing/reward fields, publish/close actions, rank leaderboard and award ledger.
- Mission publication creates an `event` in the existing public StatusBoard.
- Added authenticated API integration coverage and mission input validation.
- Fixed flaky board server tests caused by stale Keep-Alive connections after port changes.
- Full automatic reward delivery and live Fika mission event integration remain separate follow-up work.


## 1.7.0 — Raid review and lifecycle safety
- Added raid review queue: unverified raid outcomes are held for admin review and never award points automatically.
- Added explicit approve/deny review decisions with mandatory reviewer note and evidence reference; approval requires all required objectives plus survival/extraction evidence for every squad member.
- Players with a pending review cannot join another operation until the review is resolved.
- Enforced Solo/Squad player-count rules and mission start/end windows at the service layer.
- Mission close now disables its linked public StatusBoard Event; publish rollback clears the event link.
- Corrupt Operations storage is preserved as a timestamped backup before safe defaults are loaded.
- Added Raid Reviews tab to the existing authenticated admin panel.
- Verified the Fika Server v2.4.8 source tag targets SPT ~3.11 and inspected its match lifecycle APIs; no unverified runtime hooks were added.


## 1.7.1 — Fika 2.4.3 compatibility observer
- Corrected the target from the previously inspected upstream 2.4.8 tag to the user's actual Library build: Fika Server 2.4.3 (`sptVersion: ~3.11`).
- Confirmed client-side `Fika.Core.dll` and config identify Fika.Core 1.2.3; server and client version numbers are separate tracks.
- Added a version-gated, read-only Fika 2.4.3 observer for SPT raid-end and Fika match-end lifecycle.
- Added a bounded Fika audit JSONL log, protected `/api/operations/fika` endpoint, and Operations > Fika Link tab.
- Raid-end payload values are marked untrusted; no automatic mission completion or rewards are issued from them.
- Added Fika adapter tests for correct version gating, identity correlation, lifecycle capture and non-interference with original method return values.


## 1.8.0 — Authenticated mission player bridge

- Added SPT player routes for published mission discovery, player state, mission acceptance, squad Ready Check, and leaving a forming squad.
- Player identity is resolved from the authenticated SPT session and server-side PMC profile; client-supplied profile IDs are ignored.
- Group responses omit private profile IDs.
- The player API cannot submit objectives or raid outcomes, start raids, approve reviews, or issue rewards.
- Fika Server 2.4.3 observer remains version-targeted and read-only.


## 1.9.0 — BepInEx client source

- Added a separate .NET Framework 4.7.2 BepInEx client plugin source project for the SPT 3.11.1 game client.
- Added F8 mission board UI, mission acceptance, squad roster, Ready/Not Ready and leave-while-forming actions.
- Client requests target the server's `EFTOperations` static-router prefix and attempt to reuse the active SPT PHP session cookie; no fabricated player ID or credential is used.
- The client project is source-only in this release; it was not compiled in this Linux environment and must be built against the user's Windows game assemblies.
- Raid start, kill/extract proof, rewards, 3D briefing room and synchronized video remain out of scope for this milestone.



## 1.9.1 — Fika 2.4.3 per-player lifecycle evidence
- Added version-gated observation of Fika Server 2.4.3 `FikaMatchService.addPlayerToMatch`, `setPlayerDead`, and `removePlayerFromMatch` mutations.
- Match review records now retain per-member join, server-accepted death-state, and roster-removal evidence with timestamps, source, and explicit trust labels.
- A roster removal is recorded with an unknown reason and is never treated as extraction.
- Death-state evidence is labeled as a server-accepted client event, not independent server proof, because the Fika callback originates from the client.
- All lifecycle evidence remains ineligible for automatic rewards; unverified raids continue to require individual admin review.
- Added regression coverage for lifecycle hooks, trust labels, review persistence, and required-hook readiness.
- Added a read-only observer at the exact Fika 2.4.3 `FikaSendItemController.sendItem` execution boundary; records sender/receiver profile references, item-tree TPL/count summary, and whether the sender inventory debit was observed.
- The transfer observer preserves Fika's original response/exception behavior, records uncertain outcomes without claiming delivery, and never makes item transfers reward-eligible.
- The authenticated Fika admin panel distinguishes a closed route, an enabled-and-observed route, and an enabled-but-unmonitored route.
- Added regression tests for successful debit observation, failed/uncertain transfer, exception propagation, item-tree aggregation, and non-interference.
