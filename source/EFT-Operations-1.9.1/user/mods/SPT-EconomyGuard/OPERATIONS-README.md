# EFT Operations — Phase 2 mission authoring

This package adds a persistent mission/campaign domain service to EconomyGuard.

## Included in this phase

- Integrated Operations page inside the existing authenticated EconomyGuard admin panel.
- Graphical mission editor for title, map, squad size, schedule, briefing, objectives and point/rouble rewards.
- Add/remove objective rows, JSON mission import/export, draft editing, publish and close actions.
- Mission publishing mirrors the mission to the existing public StatusBoard as an `event`.
- Rank leaderboard and award ledger views.
- Server-side validation for schedule windows, duplicate objective IDs and 24-character item template IDs.
- Duplicate active group membership prevention.

- Mission definition validation and persistent JSON storage.
- Draft -> published -> closed -> archived lifecycle.
- Solo/squad size constraints.
- Group acceptance and ready-check state.
- Host/raid start registration (the Fika adapter is intentionally not guessed).
- Server-side event ingestion interface for objective progress.
- Verified outcome gate requiring all required objectives, survival and extraction.
- Idempotent award ledger and player points/rank calculation.
- Authenticated loopback admin API endpoints:
  - `GET /api/operations`
  - `GET /api/operations/awards`
  - `GET /api/operations/leaderboard`
  - `GET /operations-admin.js` (authenticated API calls; panel asset itself is served on loopback)
  - `POST /api/operations/save`
  - `POST /api/operations/publish`
  - `POST /api/operations/close`
- Publishing creates a matching `event` announcement on the existing StatusBoard when available.
- Example squad mission template.

## Important integration boundary

`recordRaidEvent`, `startGroup`, and `finishGroup` are domain service methods, not public client endpoints. They must only be called by a verified server-side SPT/Fika adapter. This release does not claim to have that adapter, a BepInEx HUD, automatic item delivery, or Fika lobby/host automation. Those require exact matching SPT/Fika source/API inspection and integration tests. Client-submitted objective progress must never be trusted.

## Storage

Data is stored below the existing EconomyGuard data directory:

`SPT-EconomyGuard-Data/operations/operations.json`

Back up this file before upgrades. The server should be stopped before manually editing it.

## Test

Run the complete suite with a supported Node.js runtime:

`npm test`

Syntax-check the principal runtime and UI files:

`npm run check`

The suite covers the existing EconomyGuard tests plus mission validation, publishing lifecycle, squad readiness, objective progress, verified extraction, rank awards, persistence, API authorization, event creation and duplicate completion protection.


## 1.6.0 — Mission authoring UI
- Added an Operations navigation entry and graphical mission editor to the existing admin panel.
- Added JSON import/export for mission definitions. Imported definitions are treated as new drafts.
- Added rank leaderboard and award ledger screens.
- Added authenticated API integration tests for mission save/publish and StatusBoard event creation.
- Fixed the board-server test client to avoid stale Keep-Alive sockets across intentional port restarts.
- Tightened mission schedule, objective ID and item template validation; prevented a profile from joining a second active group for the same mission.
- Reward points update rank immediately. Rouble/item awards remain `pending_delivery` until the SPT inventory delivery adapter is implemented; no automatic inventory mutation is claimed.
