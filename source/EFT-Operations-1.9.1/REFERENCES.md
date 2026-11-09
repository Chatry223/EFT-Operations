# Technical references and compatibility notes — 1.4.0

## SPT 3.11.1 source examined

- [SPT LauncherCallbacks](https://github.com/sp-tarkov/server/blob/3.11.1/project/src/callbacks/LauncherCallbacks.ts): the launcher's `register` callback delegates to `LauncherController.register`; `login` delegates to `LauncherController.login`.
- [SPT LauncherController](https://github.com/sp-tarkov/server/blob/3.11.1/project/src/controllers/LauncherController.ts): account registration creates an `Info` record via `SaveServer`, then loads/saves the profile; login resolves a profile/session ID from the username.
- [SPT HttpServer](https://github.com/sp-tarkov/server/blob/3.11.1/project/src/servers/HttpServer.ts): incoming HTTP requests include the `PHPSESSID` cookie and socket remote address; request processing passes the session ID to the HTTP listener/router.
- [SPT ProfileCallbacks](https://github.com/sp-tarkov/server/blob/3.11.1/project/src/callbacks/ProfileCallbacks.ts): `client/game/profile/create` creates the in-game PMC/Scav character for an already registered account; it is distinct from launcher account registration.
- [SPT SaveServer](https://github.com/sp-tarkov/server/blob/3.11.1/project/src/servers/SaveServer.ts): loaded account profiles are held in memory and written to `user/profiles`.

## Fika Server v2.4.6 tag examined

- [Fika v2.4.6 package.json](https://github.com/project-fika/Fika-Server/blob/v2.4.6/package.json): exact Fika Server package version and SPT target `~3.11`.
- [Fika v2.4.6 IFikaConfigServer](https://github.com/project-fika/Fika-Server/blob/v2.4.6/src/models/fika/config/IFikaConfigServer.ts): contains `launcherListAllProfiles`, `allowItemSending`, etc.; it does not declare an `apiKey` or a generic logout API setting.
- [Fika v2.4.6 FikaRaidController](https://github.com/project-fika/Fika-Server/blob/v2.4.6/src/controllers/FikaRaidController.ts): implements `handleRaidLeave` and delegates per-player removal to `FikaMatchService`.
- [Fika v2.4.6 FikaMatchService](https://github.com/project-fika/Fika-Server/blob/v2.4.6/src/services/FikaMatchService.ts): `removePlayerFromMatch` removes a player from the server-side match map and updates presence; this source alone does not demonstrate forcing an established direct raid network connection to close.
- [Fika v2.4.6 FikaRaidStaticRouter](https://github.com/project-fika/Fika-Server/blob/v2.4.6/src/routers/static/FikaRaidStaticRouter.ts): exposes raid routes including create/join/leave/registerPlayer; the v2.4.6 source examined does not define `/fika/api/logout`.


## Fika live presence examined (v2.4.6)

- [FikaPresenceService](https://github.com/project-fika/Fika-Server/blob/v2.4.6/src/services/FikaPresenceService.ts): stores active player presence in an in-memory object keyed by SPT session/profile ID; `addPlayerPresence` creates the entry and `removePlayerPresence` deletes it; updates include activity, activity-start timestamp and optional raid details.
- [FikaNotificationWebSocket](https://github.com/project-fika/Fika-Server/blob/v2.4.6/src/websockets/FikaNotificationWebSocket.ts): adds presence after a valid player authenticates to the notification WebSocket and removes it in the socket close handler.
- [FikaPresenceCallbacks](https://github.com/project-fika/Fika-Server/blob/v2.4.6/src/callbacks/FikaPresenceCallbacks.ts): handles `/fika/presence/get`, `/fika/presence/set` and `/fika/presence/setget`.
- [FikaPresenceStaticRouter](https://github.com/project-fika/Fika-Server/blob/v2.4.6/src/routers/static/FikaPresenceStaticRouter.ts): exposes the presence routes.
- [EFikaPlayerPresences](https://github.com/project-fika/Fika-Server/blob/v2.4.6/src/models/enums/EFikaPlayerPresences.ts): activity values are `IN_MENU=0`, `IN_RAID=1`, `IN_STASH=2`, `IN_HIDEOUT=3` and `IN_FLEA=4`.
- [Fika v2.3.0 release notes](https://newreleases.io/project/github/project-fika/Fika-Server/release/v2.3.0): note the addition of Fika Presence's online player list.

The same `FikaPresenceService` add/update/remove method shape was also checked in [Fika Server v2.4.3](https://github.com/project-fika/Fika-Server/blob/v2.4.3/src/services/FikaPresenceService.ts), matching the older version number seen in the prior server log. The mod wraps FikaPresenceService's add/update/remove methods; it does not change Fika networking or persist online status. The current list is built from the active Fika notification WebSocket presence map.

## Important version distinction

Current Fika documentation has since added a Fika API including a logout endpoint, but that API documentation says it was last updated for SPT 4.0 / Fika 2.0. Do not assume those newer API endpoints or API-key config exist in an older Fika 2.4.6 build without verifying that build's source. See [current Fika API docs](https://wiki.project-fika.com/advanced-features/fika-api) and [Fika configuration docs](https://wiki.project-fika.com/fika-configuration/server).

Fika `launcherListAllProfiles=false` hides other profiles from the launcher list; it does not prevent registration or enforce an account allowlist. See [Fika FAQ](https://wiki.project-fika.com/faqandguides).

## Security implementation model

- Registration gate: wraps SPT `LauncherCallbacks.register` and blocks standard launcher registration when `allowLauncherRegistration=false`.
- Admin provisioning: calls SPT's native `LauncherController.register`, then saves an approval record by returned Profile ID.
- Login ban/approval: wraps `LauncherController.login` and returns no session for banned or unapproved profiles.
- Session/IP gate: wraps SPT `HttpServer.handleRequest`, validates the request source IP and denies follow-up backend calls for banned/revoked sessions.
- IP forwarding: forwarded headers are ignored unless the socket peer matches an explicitly configured trusted proxy.
- Raid limitation: this does not claim a guaranteed immediate UDP kick from an already active Fika 2.4.6 raid.

## Validation

The code targets SPT `~3.11.0`, has no added npm dependencies and includes local Node.js tests for IP/CIDR, corrupt registry fail-closed behavior, login hooks, registration gate, account provisioning, ban/unban and panel APIs. This is not a replacement for testing on the operator's exact Windows SPT/Fika runtime.


## Exact client authentication contract verified for this build (SPT 3.11.1)

- [SPT 3.11.1 RequestHandler.cs](https://github.com/sp-tarkov/modules/blob/3.11.1/project/SPT.Common/Http/RequestHandler.cs): exposes static `SessionId`, `Host`, and `HttpClient`; reads `-token=` and `-config=` from process arguments.
- [SPT 3.11.1 Client.cs](https://github.com/sp-tarkov/modules/blob/3.11.1/project/SPT.Common/Http/Client.cs): `GetAsync(path)` and `PostAsync(path, data, compress=true)`; adds `Cookie: PHPSESSID=<accountId>`, zlib-compresses POST payloads, and uses the SPT certificate callback.
- The client plugin now calls those exact public members via narrowly-scoped reflection against `SPT.Common.Http.RequestHandler`; it no longer scans arbitrary Session/BackendConfig types or manually constructs cookies.
- [SPT 3.11.1 HttpServer.ts](https://github.com/sp-tarkov/server/blob/3.11.1/project/src/servers/HttpServer.ts): reads `PHPSESSID` from the Cookie header and passes it as `sessionId` to the HTTP listener/router.

## Fika 2.4.3 raid lifecycle surface verified

- [Fika Server 2.4.3 package.json](https://github.com/project-fika/Fika-Server/blob/v2.4.3/package.json): version `2.4.3`, SPT target `~3.11`.
- [FikaMatchService.ts](https://github.com/project-fika/Fika-Server/blob/v2.4.3/src/services/FikaMatchService.ts): has `getMatchIdByProfile(sessionId)`, `getMatchIdByPlayer(playerId)`, `getMatch(matchId)`, and `endMatch(matchId, reason)`; `endMatch` deletes the match after its lifecycle work.
- [FikaRaidController.ts](https://github.com/project-fika/Fika-Server/blob/v2.4.3/src/controllers/FikaRaidController.ts): raid leave calls `endMatch` for host shutdown or `removePlayerFromMatch` for a joining player.
- [SPT 3.11.1 LocationLifecycleService.ts](https://github.com/sp-tarkov/server/blob/3.11.1/project/src/services/LocationLifecycleService.ts): exposes `endLocalRaid(sessionId, request)` and processes the raid result submitted to SPT. The adapter labels this result as `untrusted_client_report`; it is not independent proof and cannot trigger automatic rewards.
