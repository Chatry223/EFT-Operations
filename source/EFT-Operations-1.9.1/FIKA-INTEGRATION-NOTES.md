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


## 2026-11-09 — Fika 2.4.3 mission lifecycle bridge

The adapter now uses the exact v2.4.3 FikaMatchService methods verified from upstream source:
- `addPlayerToMatch(matchId, playerId, data)` — after each player registration whose profile ID has been matched to the authenticated SPT session, the adapter checks whether every accepted and ready mission member is present in the same Fika match and map. Only then does it bind the Operations group to that match and transition it to `in_raid`.
- `endMatch(matchId, reason)` — before Fika deletes its match, the adapter captures the authenticated registered-player roster and cached client death flags and correlates the match with the linked Operations group. It creates a manual review record using lifecycle evidence plus client-reported extraction data; it does not auto-award.

Fika 2.4.3 `IFikaPlayer.isDead` is a cached flag written by the client-initiated `/fika/update/playerdied` callback. The adapter now binds that request to the authenticated account, but the player's own death report remains client-originated and is not authoritative proof. The raid-end `results` payload still comes from the player's request and is therefore treated as untrusted. Extraction and mission objective proof are not fully authoritative yet. The admin review action now requires an explicit confirmation in addition to a non-empty evidence reference; approvals and denials are recorded in the review record.

The adapter deliberately requires exact map ID equality between the mission and Fika match location. If the server's configured map label differs from Fika's `locationData.Id`, the group will not auto-link; this is fail-safe and should be handled by an explicit map-alias setting after the installed map IDs are confirmed.

This is source-level integration and regression coverage, not yet a runtime validation on the user's Windows SPT 3.11.1 + Fika 2.4.3 server.


## Fika callback trust boundary and identity hardening

Fika 2.4.3 uses `serverId` as a synthetic host player key when creating a match; it is not the host's SPT profile ID. The adapter validates `hostUsername` against the authenticated session's PMC/Scav nickname at raid creation. On host shutdown, Fika sends the same synthetic key in both `serverId` and `profileId`; the adapter verifies the match's registered `hostUsername` against the caller's authenticated session. Normal member leave still requires the supplied profile ID to belong to that session.


Inspection of the exact v2.4.3 callbacks showed that `FikaUpdateCallbacks.handleRaidAddPlayer` and `handlePlayerDied` receive the authenticated SPT `sessionID` but the upstream callback ignores it before passing the request profile ID to `FikaMatchService`. The adapter now wraps both callbacks and verifies that the requested PMC or Scav profile ID belongs to the authenticated SPT session. It also wraps `FikaRaidCallbacks.handleRaidCreate` and `handleRaidLeave` to bind the host/member profile ID to that session before a match can be created or a member removed / match ended.

This prevents one logged-in account from adding, marking dead, creating a match as, or removing another account's profile through those Fika callbacks. It does **not** make a player's own death report authoritative: `/fika/update/playerdied` is still initiated by that player's client, and `endLocalRaid` result/extraction fields are client-originated. The Fika match roster is therefore an authenticated registered-player roster, while cached death flags and raid-end results remain corroborating, unverified signals. No automatic reward is issued from them.
