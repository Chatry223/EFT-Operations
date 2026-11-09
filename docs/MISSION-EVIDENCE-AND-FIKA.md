# EFT Operations — Mission Evidence and Fika Integration

Target stack:
- EFT client: 0.16.1.3.35392-P2P
- SPT server: 3.11.1
- Fika server: 2.4.3
- Fika client: 1.2.3.0
- BepInEx: 5.4.22.0

## Objective event sources

| Objective | Event source | Evidence level | Meaning |
|---|---|---|---|
| `kill`, `kill_type` | Fika host client hook on EFT `Player.OnBeenKilledByAggressor` | `host_attested` | Host observes an AI victim and a non-AI squad aggressor. Server checks the host identity, active match, actor roster, victim identity and category. |
| `visit` | Fika host client hook on EFT `Player.SpecialPlaceVisited(string, int)` | `host_attested` | EFT's `ExperienceTrigger.TriggerEnter` invokes this callback with the trigger's place key. The client sends only place keys required by the active mission. |
| `collect` | SPT profile delta at raid end | `spt_accepted_client_delta` | A new/stack-increased item is counted only when its item ID is present in the SPT-accepted profile and the raid report marks it as spawned in session. This is stronger than a raw client claim, but the source data still originates from the client. |
| `extract` | Authenticated SPT `endLocalRaid` report | `client_report_only` | Counts a reported successful exit with an exit name. |
| `survive` | Authenticated SPT `endLocalRaid` report | `client_report_only` | Counts a reported `Survived` or `Runner` result. |
| `raid_complete` | Authenticated SPT `endLocalRaid` report | `client_report_only` | Counts a raid-end report, regardless of whether the player survived. Use `extract` or `survive` when success is required. |

## Campaign and rank progression

- Missions may share a normalized Campaign ID and a sequence number (1, 2, 3…).
- A player must have an approved award for every earlier numbered mission in that campaign before accepting a later one.
- A mission may also require a minimum accumulated rank-point total.
- The in-game mission board displays locked reasons and missing campaign operations. The admin mission library groups entries by campaign and sequence.
- Points and campaign completion are credited only when an admin approves the raid review and the award ledger records the result.

## Trust and reward policy

- `server_verified` is reserved for genuinely server-owned evidence. It must not be assigned to a client-originated kill, visit, inventory or raid-end report.
- `host_attested`, `spt_accepted_client_delta` and `client_report_only` all advance visible mission progress, but they are review evidence, not automatic reward authorization.
- Fika host events are bound to the active Fika match ID. The reporter must be the host profile (PMC or Scav), and the actor must belong to the accepted mission squad.
- Kill evidence requires an AI victim and rejects squad-member victims. Visit evidence is tied to the host-observed player profile and the exact place key.
- Duplicate event IDs are ignored. Host telemetry is rate-limited.
- Fika raid completion currently moves the operation to the admin review queue. Rewards are not issued from client-only or host-attested reports.

## Mission target formats

- Mission map: use an SPT location ID, not a display name (for example, `bigmap` = Customs and `woods` = Woods).
- `kill` / `kill_type`: category such as `scav`, `boss`, `boss_guard`, `raider`, `rogue`, `cultist`, `pmc`, `other` or `unknown`.
- `collect`: exact item template ID (`_tpl`).
- `visit`: exact EFT place key used by the built-in visit-place trigger (for example, `bunker2`).
- `extract`: optional exit name; blank means any successful exit.
- `survive` / `raid_complete`: target can be blank.

## Validation status

The code paths and exact EFT callback signatures were checked against the supplied EFT 0.16.1.3.35392 assembly and the supplied SPT/Fika package versions. Automated test/build execution is still pending: GitHub Actions currently rejects jobs before assigning a runner (runner ID 0, no steps). Do not interpret that as a code-test pass or failure. A real EFT/Fika raid test is still required before treating these hooks as runtime-verified.
