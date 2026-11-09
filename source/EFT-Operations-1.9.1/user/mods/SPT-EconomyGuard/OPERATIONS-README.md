# EFT Operations — SPT 3.11.1 / Fika 2.4.3

This is the mission/operations module integrated into the existing SPT-EconomyGuard server mod. It is not a second SPT server installation.

## Included

- Authenticated Operations page inside the existing EconomyGuard admin panel.
- Graphical mission editor: title, map ID, solo/squad size, schedule, briefing, objectives, points and rouble reward definitions.
- Draft, publish, close and archive lifecycle; published missions are mirrored to the existing StatusBoard as events.
- Group acceptance, member ready state and server-side SPT account identity resolution.
- Client-side in-game mission board source (BepInEx), including new-operation banner, rank/points and reward preview. The DLL is not included in this server package; use the separate client build GUI helper.
- Exact Fika Server 2.4.3 adapter:
  - Authenticates Fika create/leave and add-player/death-update profile IDs against the SPT session that made the callback.
  - Matches PMC and Scav profile IDs to the same SPT account.
  - Links a ready mission group to a Fika match when all group members have registered in the same exact map/match.
  - Captures match end before Fika removes its match record and creates a manual review record.
- Idempotent points/rank award ledger and review audit fields.
- Regression tests for Fika 2.4.3 lifecycle, account binding, Scav identity mapping, review trust boundaries and SPT mail reward delivery.

## Mission flow

1. Admin creates and publishes a mission.
2. Players accept; the server resolves their account identity from their authenticated SPT session.
3. Members set Ready in the in-game Operations panel.
4. The host starts a Fika raid through the normal Fika flow. The adapter links the operation once every ready member is registered in the same Fika match and map.
5. At Fika match end, the group moves to the admin review queue.
6. Admin enters an evidence reference and explicitly confirms objective completion and extraction for all listed members before approving rewards.

## Security and evidence limits

- Fika 2.4.3 update callbacks now verify that the requested PMC/Scav profile belongs to the authenticated SPT session. This prevents one account from registering or removing another account's profile through the patched callbacks.
- A player's own \`/fika/update/playerdied\` flag is still client-originated. The adapter treats cached death flags and \`/raid/end\` result/extraction fields as corroborating, unverified reports—not authoritative proof.
- No public client endpoint can submit mission objective progress, approve reviews or issue rewards.
- The adapter does not have authoritative AI-kill attribution or a server-owned objective event stream yet. Objective completion therefore requires explicit admin evidence confirmation; there is no automatic kill/visit/collect proof in this version.
- Fika does not get started automatically by the plugin. The host uses the normal Fika raid start flow after the squad is ready.
- Map matching is exact against Fika's \`locationData.Id\`. A mismatched display name/ID fails closed rather than linking the wrong mission.

## Rewards

- Approved points are immediately credited to the Operations points/rank ledger.
- Rouble and item rewards are recorded as \`pending_delivery\`; this version does not mutate player inventory or automatically send reward mail. Do not advertise rouble/item delivery as active until the SPT inventory/mail delivery adapter is implemented and tested.
- Award keys are idempotent per mission/group/player, preventing duplicate point awards.

## Storage and upgrade

Operations state is stored at:

\`SPT-EconomyGuard-Data/operations/operations.json\`

The Fika event log is stored beside it under \`operations/fika-events.jsonl\`. These are runtime data files and are not part of the distributable mod ZIP. Back up the entire \`SPT-EconomyGuard-Data\` directory before upgrading. Stop SPT before replacing the mod folder.

## Client plugin build

The client source is at \`client/EFT.Operations.Client\`. Double-click \`BUILD-GUI.bat\`, select the EFT Managed and BepInEx core folders, then choose **Build and Install DLL**. The helper requires Visual Studio MSBuild and the .NET Framework 4.7.2 targeting pack. It installs the DLL into \`BepInEx/plugins/EFTOperations\` and writes a SHA-256 report. The script has passed Windows PowerShell syntax validation, but the DLL has not yet been compiled or runtime-tested on the user's EFT installation.

## Validation

The latest GitHub Actions server run completed:
- Static checks: PASS
- Unit tests: 27 passed, 0 failed
- Windows PowerShell build-helper syntax validation: PASS
- Server mod ZIP integrity and expected install path: PASS

These checks do not replace a live SPT 3.11.1 + Fika 2.4.3 runtime test. The server package is a CI-tested staging build, not a runtime-certified release.
