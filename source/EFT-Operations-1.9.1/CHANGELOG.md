# EconomyGuard Enterprise 1.4.0

## Public status site — redesign, announcements and layout editor
- New glass-style design: header banner with a single live **Online** counter and small summary lines, rotating announcement banner, optional info cards, pill tabs. EN/FA (RTL, Jalali dates in Persian).
- **Online** = everyone present right now: real players on the server, AI PMCs inside an active raid and (switchable) flea-market sellers with live offers. Each name counts once; anyone who leaves those lists is shown offline. The leaderboard has a live Online/Offline status column.
- **Raids completed**: summed from the profiles' raid counters and always rounded *down* (for example `470+`).
- The PMC badge and the Players/PMC filter are now optional (`showPmcBadge`, default off).
- Removed the separate "players online / in raid / PMC in raid / active raids" cards; the Flea offers card stays. All cards and the header lines are optional and reorderable.
- **Announcements**: title, text, type (news/update/event/notice), optional image/video (media folder or file path), optional button link, show-from / show-until dates, draft/hide. Only currently-scheduled items are public; media of drafts or expired items is not served.
- **Admin Center -> Status Site** now has sub-pages: Overview, Look & content, Layout (drag & drop / arrow buttons / tick boxes with a live wireframe preview, saved only on Save), Announcements, Players.
- Search box focus is preserved while the page refreshes.

## Safety
- Announcement links must be http(s) and are re-checked in the browser; all text is rendered as text, never HTML; the public payload contains no server paths.
- The new code is still isolated in `src/board/` and `web-public/`; changes to original files are additive (admin routes `/api/board/news`).

## Tests
- Added tests for the Online count (deduplication, switches, offline transitions), raid rounding, layout validation, announcement validation and scheduling, media serving rules, admin routes, and a Chromium run of the admin editor and public page.

---

# EconomyGuard Enterprise 1.3.0

## Added — public status site (isolated add-on)
- Separate read-only website with leaderboard, online list, active raids, recent raid results, flea-market summary, recent flea trades and an event feed. Default address `http://<SPT/Fika IP>:1234` (listens on `0.0.0.0`).
- New **Status Site** page in the Admin Center: on/off, listen address, port (with automatic rollback if the new address cannot be bound), server name/tagline, language (EN/FA with RTL), accent colour, background image/video (from a media folder or a file path), section toggles, score weights, per-player hide.
- Privacy: only in-game PMC nicknames are published. Account usernames, passwords, profile IDs, account IDs and IPs are never part of the public payload; rows use keyed-hash public IDs. Banned accounts and manually hidden players are removed from every list and event. Fika headless-host profiles are excluded.
- AI-controlled PMCs are tracked from real data: names and levels from bot generation, kills/deaths from end-of-raid reports, online status while their raid is active, and flea-market PMC sellers from live offers. AI PMCs carry a `PMC` badge. Statistics for AI PMCs start from the moment tracking begins.
- The public name/title is configurable and cannot be set to the main mod's name; public assets contain no reference to it.

## Isolation guarantees
- New code lives in `src/board/` and `web-public/`; own HTTP server, own data folder (`user/mods/SPT-EconomyGuard/SPT-EconomyGuard-Data/statusboard`), own settings.
- The original firewall and panel logic is unchanged. Additive touch points only: `mod.js` (guarded start), `admin-panel.js` (new `/api/board*` routes and one script file), `web/index.html` (one script tag), `config.json` (`statusBoard`).
- All SPT hooks (`BotController.generate`, `MatchCallbacks.endLocalRaid`, `LocationLifecycleService.endLocalRaid`) call the original first-class, return its value unchanged, never throw into SPT, and a circuit breaker disables the collector after repeated internal errors.
- A failure to bind the port is logged and ignored; the firewall and admin panel keep running.

## Tests
- Added tests for anonymisation/leak checks, scoring and ranking, market summary, hook behaviour under Fika's instance-level override, de-duplication, circuit breaker, HTTP hardening (methods, traversal, rate limit, range requests), admin control (port change, rollback, reserved ports) and admin-panel integration. Verified rendering in Chromium (EN/FA, desktop/mobile) with no console or CSP errors.
- Local tests do not replace integration testing on the user's exact Windows SPT + Fika server.

---

# EconomyGuard Enterprise 1.2.1

## Added
- Online Players page in the local Admin Center.
- Live presence integration with Fika 2.4.x `FikaPresenceService` via its add/update/remove player methods.
- Player nickname, launcher username, profile ID, level, connected-since time, last-seen time, last HTTP source IP, Fika activity and raid location/side/time.
- Live counters for online, in-raid, in-menu and other activity categories.
- Search by nickname, username, Profile ID, last IP, activity and map; Profile ID copy action.
- Dashboard polling every 15 seconds using the authenticated `/api/online` endpoint.
- Explicit unavailable state when the Fika presence service hooks are not installed; no online status is inferred from stale HTTP traffic.

## Presence semantics
- Online means the Fika Notification WebSocket is connected and its server-side presence entry exists.
- Disconnect is detected through Fika's WebSocket close handler and the `removePlayerPresence` call.
- Presence is volatile/in-memory; it is rebuilt from current connections after server restart.
- Last IP shown comes from the latest SPT HTTP request associated with that profile, not necessarily the direct Fika UDP peer address.

## Tests
- Added local tests for Fika presence connect/update/disconnect tracking, activity and raid details, IP correlation, live API response and token authentication.
- Local tests do not replace integration testing on the user's exact Windows SPT + Fika server.

---

# EconomyGuard Enterprise 1.2.0

## Added
- Login-time account bans keyed by SPT Profile ID, permanent or time-limited.
- Approval-only login policy for existing accounts and accounts created from the local Admin Center.
- Default-deny SPT Launcher registration (`/launcher/profile/register`) with an administrator-controlled open-registration switch.
- Admin account provisioning through SPT's native `LauncherController.register` method; returned credentials are displayed once.
- Exact IP and CIDR allowlisting (IPv4/IPv6), trusted-proxy handling and recent connection IP visibility.
- Backend HTTP session gate for active banned/revoked profiles.
- Fail-closed behavior if the external access-control registry is corrupt; preserves the damaged registry as a `.bak` copy and refuses to overwrite it automatically.
- Security & Access page for account creation, approvals, bans, registration policy and IP allowlist management.

## Security and scope
- Login denial and IP/session controls are independent of economy Audit/Protect mode.
- Ban blocks new launcher login and subsequent SPT HTTP backend requests for an existing session.
- Fika 2.4.6 does not expose the newer documented `/fika/api/logout` endpoint in the source tag inspected. Immediate disconnect from an already-active P2P UDP raid is not claimed or guaranteed.
- `launcherListAllProfiles` is only launcher profile visibility, not a security/registration control.
- Panel stays loopback-only and uses the existing random bearer token.

## Existing functionality
- Retains economic preflight, Trader/Flea checks, item/profile purchase restrictions, ledger, case dashboard and HTML report export.
- Fika Item Sending remains NOT_HOOKED and must be disabled in `fika.jsonc` if direct item sending must be closed.

## Tests
- Added tests for corrupt-registry fail-closed behavior, approved/revoked login, launcher registration block, account provisioning, login bans/unbans, IP/CIDR, trusted proxies and HTTP session blocking.
- Local tests do not replace integration testing on the user's exact Windows SPT 3.11.1 + Fika build.

## 1.7.0 — Raid review and lifecycle safety
- Added Raid review queue for unverified outcomes; no automatic points are awarded until an admin decision.
- Added approve/deny decisions with mandatory evidence/review note and completion evidence checks.
- Enforced Solo/Squad player-count rules and mission schedule windows on the server.
- Linked mission announcements to StatusBoard Events and disable the linked Event when a mission closes.
- Preserve corrupt Operations data in a timestamped backup before safe defaults are loaded.
- Inspected official Fika Server v2.4.8 source tag (SPT ~3.11) to map the integration surface; runtime hooks remain disabled pending installed-build validation.


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


## 1.9.1 — Native SPT session bridge

- Replaced heuristic session discovery with the exact SPT 3.11.1 `RequestHandler.SessionId` field.
- Reused `RequestHandler.HttpClient` and the launcher's configured backend host, preserving SPT's PHPSESSID cookie, POST compression and TLS handling.
- Corrected the client URL to include the `EFTOperations` static-router prefix.
- Serialized client requests and fixed callback refresh ordering to avoid mission/state request races.
- Updated client setup notes; C# compilation and in-game runtime verification remain pending on Windows.
