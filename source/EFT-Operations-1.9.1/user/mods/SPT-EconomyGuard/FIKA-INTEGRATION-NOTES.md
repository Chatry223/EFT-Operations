# Fika compatibility and Operations observer — user's installed build

## Exact versions found in the user's Library archives

- Server archive: `Takove Server - SPT 3.11.1.zip`
- Server mod path: `user/mods/fika-server/`
- `user/mods/fika-server/package.json`: **Fika Server 2.4.3**, `sptVersion: ~3.11`
- Client archive: `BepInEx-(no server-is player).zip`
- Client plugin: `BepInEx/plugins/Fika.Core.dll`
- Client config: `BepInEx/config/com.fika.core.cfg`
- Client config declares `Fika.Core v1.2.3` and `Last Version = 1.2.3`.

The server version (2.4.3) and client plugin version (1.2.3) are different version tracks. Do not compare them as if they should have the same number.

## Exact Fika 2.4.3 server API surface inspected

- `src/services/FikaMatchService.ts`: `createMatch`, `getMatch`, `getMatchIdByPlayer`, `getMatchIdByProfile`, `addPlayerToMatch`, `removePlayerFromMatch`, `endMatch`, and match roster data.
- `src/controllers/FikaRaidController.ts`: create, join, leave, get-host, get-settings and player registration.
- `src/controllers/FikaUpdateController.ts`: player add/death, player spawn group, host and match status updates.
- `src/overrides/services/LocationLifecycleService.ts`: Fika replaces `startLocalRaid` and `endLocalRaid`; for non-spectators it calls `LocationLifecycleService.prototype.endLocalRaid.call(...)` after its insurance bookkeeping.
- `src/websockets/FikaNotificationWebSocket.ts`: per-client and broadcast notification transport.
- `src/models/fika/IFikaMatch.ts` and `IFikaPlayer.ts`: match roster and player state shapes.

## EFT Operations 1.7.1 integration implemented

A version-gated, read-only observer is installed only when the sibling `fika-server/package.json` reports Fika `2.4.3` and SPT `~3.11`.

- Observes SPT `LocationLifecycleService.endLocalRaid` through the prototype method that Fika 2.4.3 explicitly invokes.
- Observes Fika `FikaMatchService.endMatch` before the match is removed, retaining the match roster and end reason.
- Resolves the player's PMC character ID through SPT `SaveServer`, and correlates the Fika match using `getMatchIdByProfile` / `getMatchIdByPlayer`.
- Writes a bounded audit stream to `SPT-EconomyGuard-Data/operations/fika-events.jsonl`.
- Adds the protected admin endpoint `GET /api/operations/fika` and a Fika Link tab in the Operations UI.
- If Fika is missing or a different version is installed, the observer remains disabled rather than guessing at a different API.

## Trust and safety boundaries

- A SPT `IEndLocalRaidRequestData` contains `results.result`, `exitName`, `playTime`, and `results.profile`; these values originate from the client request. The observer labels them `untrusted_client_report`.
- Match-end observation is lifecycle evidence only; it is not proof that every player extracted or completed an objective.
- This adapter does not modify Fika match state, start/join/leave raids, patch the player's profile, deliver items, or grant points.
- No mission completion or automatic award is triggered from these observed events. Admin review remains mandatory until independent authoritative evidence is available.
- Fika item sending is a separate route and is not intercepted by this adapter. Keep `allowItemSending` disabled in `fika.jsonc` unless separately reviewed.

## Still required before production activation

- Disposable SPT 3.11.1 + Fika 2.4.3 runtime test for host/client/spectator and PMC/Scav identity mapping.
- Verify actual `profileId` values used by the future in-game mission client against Fika's match roster keys.
- Test the new authenticated mission API routes on a disposable SPT 3.11.1 + Fika 2.4.3 server.
- Implement authoritative objective evidence and reward delivery; current client raid result payloads are not sufficient for automatic awards.


## EFT Operations 1.8.0 — authenticated player bridge

Added SPT static player routes for mission discovery, player state, acceptance, Ready Check, and leaving a group while it is still forming. The bridge derives identity from the authenticated SPT session and server-side PMC profile. It does not accept a client-supplied profile ID as identity and does not expose member profile IDs in group responses.

The bridge does not submit objective progress, raid outcomes, review decisions, raid start commands, or rewards. The next client-side step is a BepInEx plugin UI that consumes these routes; this release does not claim to include an in-game HUD or full Fika lobby integration.


## EFT Operations 1.9.1 — native SPT client authentication bridge

The BepInEx client source now uses the exact SPT 3.11.1 public contract: `SPT.Common.Http.RequestHandler.SessionId`, `Host`, and `HttpClient`. The native `Client.GetAsync` / `PostAsync` methods supply the `PHPSESSID` cookie, POST zlib compression, and SPT's configured TLS behavior. Calls include the `/EFTOperations` static-router prefix. The plugin no longer scans arbitrary assemblies for guessed `Session` or `BackendConfig` members.

The C# source remains uncompiled and has not yet been exercised inside the user's EFT installation; the server-side Node test suite does not validate BepInEx runtime loading.


## 2026-11-09 — Fika observer regression coverage

A dedicated adapter regression test now exercises the exact 2.4.3 version gate, match-end roster capture, PMC identity resolution, and the trust labels for both server lifecycle observations and client-originated raid-end payloads. The test asserts that neither evidence type is reward-eligible by itself. The Linux server CI run completed the static checks and **27 tests passed, 0 failed**.

### Remaining production boundary (not silently treated as complete)

The observer is still an evidence collector, not a complete raid-to-mission orchestrator. No automatic group-to-Fika-match binding, authoritative objective event stream, extraction/death verification, or reward-delivery transaction has been enabled. The admin Fika Link tab is diagnostic evidence only. Automatic rewards stay disabled until the server can independently establish those facts and the complete host/client/Scav/PMC runtime matrix passes on the exact installed build.
