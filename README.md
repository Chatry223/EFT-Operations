# EFT Operations

Mission / campaign operations and EconomyGuard integration for SPT.

## Compatibility target

- EFT build: 0.16.1.3.35392-P2P
- Unity: 2022.3.43f1
- SPT Server: 3.11.1
- Fika Server: 2.4.3
- Fika client target: 1.2.3.0
- Client plugin: .NET Framework 4.7.2 / C# 7.3 / BepInEx 5.4.22.0.

The supplied BepInEx, Fika and SPT Common assemblies declare .NET Framework 4.7.1. The Client plugin uses reflection for EFT/Fika/SPT runtime implementation types; compile-time references include BepInEx, Harmony and Unity modules. Exact target archives are checked by the build helper, but archive validation and compile success do not replace loading the plugin under the actual EFT Mono runtime.

A detailed version and event-source audit is maintained in docs/COMPATIBILITY-AUDIT.md. The current implementation truth and Persian development roadmap are in docs/IMPLEMENTATION-AUDIT-FA.md. The SVM preset reader/editor is documented in docs/SVM-ADMIN.md and docs/SVM-ADMIN-FA.md.

## Project layout

- source/EFT-Operations-1.9.1/user/mods/SPT-EconomyGuard: server mod, admin panel, mission API, Fika adapter, SVM service and tests.
- source/EFT-Operations-1.9.1/client/EFT.Operations.Client: BepInEx client plugin source and graphical build helper.
- .github/workflows/server-checks.yml: Node server checks/tests and package creation.
- source/EscapeFromTarkov_Data.zip and source/BepInEx.zip: build-time dependency archives; do not copy them into the installable mod or redistribute game files without permission.
- .github/workflows/build-client.yml: dependency verification and Windows-hosted Client build.

## Mission and reward flow

The Admin panel creates/publishes missions and creates a matching Event in the public StatusBoard. Authenticated SPT player routes resolve the account from the SPT session; private profile IDs are not exposed in the public group DTO. The Client plugin renders an F8 mission panel, campaign/rank locks, squad readiness, notifications and an in-raid HUD.

The Fika 2.4.3 adapter links a mission group only after all accepted Ready members are present in the same match and map. The leader can invoke Fika 1.2.3's native Start button from the native Host UI. Other members still join via Fika's raid list; automatic auto-join is not implemented.

Production objective event producers currently present:
- Host client Hook for AI kills and required place visits; the server validates authenticated host/member/match binding and records these as host_attested.
- SPT accepted inventory delta at raid end; recorded as spt_accepted_client_delta.
- Extract/survive/raid-complete end reports; recorded as client_report_only.

These trust levels are review evidence, not server-authoritative proof. Fika match end intentionally sends groups to manual review with verified=false. Do not enable automatic rewards based only on host or client reports. Duplicate event IDs are idempotent, and kill/visit/collect actor identity is bound to a mission member.

After an administrator approves a review with an evidence note and explicit confirmation, points are credited and RUB/items are sent through SPT system mail. Uncertain mail delivery is held for manual reconciliation; blind automatic retry is intentionally avoided.

## Current implementation boundaries

- Mission CRUD, campaign sequences, rank points, squad readiness, Fika match linking, host-attested kill/visit, SPT-accepted inventory delta, manual review and reward ledger are present in source.
- Briefing data has kind/media/body, but the current game HUD renders text only. Video/audio playback, media cache and a 3D briefing room are not implemented.
- The current Fika integration does not auto-join squad members.
- No current production Objective event path is server_verified; final award approval remains manual.
- Fika allowItemSending is false in the supplied config and is surfaced in Admin. The separate transfer route is not hooked; keep it disabled unless a version-specific interception is added and tested.

## SVM / trader settings

SVM editor resolves the active preset from the installed Loader, shows the actual TraderMarkup/TraderSell/Items/Fence values, checks the preset revision before write, backs up the original, and requires an SPT restart. TraderMarkup=20 means approximately 20% trader buyback value against the relevant Handbook baseline (SVM maps to buy_price_coef = 100 - value); it is not a 20x price. TraderSell is a separate currency-based trader offer cost multiplier. Items.ItemPriceMult is separate and inactive when Items.EnableItems=false. Full runtime SVM/LiveFleaPrices load-order validation remains outstanding.

## Build and validation status

Earlier Server Checks at commit c22445de000ca803c37fab1031347557105e3f88 passed 28 tests; that does not validate later main-branch changes. The last documented successful Windows Client build was at 248e5924bc331167a908f050f8eee7a6574dde12; Client source changed after it. Latest Server and Client Actions runs currently fail without usable logs, so current main must not be called CI-verified. No actual EFT/Fika raid, real SPT Mail delivery or whole-mod-stack soak test has been completed.

See docs/COMPATIBILITY-AND-BUILD-READINESS.md for the acceptance matrix. The inner server mod ZIP is installed under user/mods/SPT-EconomyGuard; SPT-EconomyGuard-Data is live server data and is not part of the mod package. Back up the existing mod and data before testing a package on a live server.
