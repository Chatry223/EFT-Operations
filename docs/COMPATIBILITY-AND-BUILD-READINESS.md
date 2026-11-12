# Compatibility and build readiness

Audit snapshot: 2026-11-13  
Repository HEAD: 37f591e49fc7d2d13ef789d9387484bee5570dc3

## Target matrix

| Component | Target |
|---|---|
| EFT | 0.16.1.3.35392-P2P |
| Unity | 2022.3.43f1 |
| SPT Server | 3.11.1 |
| Fika Server | 2.4.3 |
| Fika client | 1.2.3.0 |
| SPT Common | 3.11.1.0 |
| BepInEx | 5.4.22.0 |
| Client plugin | .NET Framework 4.7.2 / C# 7.3 |

The pinned BepInEx, Fika and SPT Common assemblies declare .NET Framework 4.7.1. The client project targets net472. EFT/Fika/SPT implementation types are discovered reflectively; the compile-time references are BepInEx, Harmony and Unity modules. The dependency verifier checks the exact target inputs but compile success is not a runtime load test.

## Client source and build status

The Client Plugin source currently includes:
- Native SPT session bridge (RequestHandler SessionId/Host/HttpClient).
- F8 mission panel and in-raid HUD.
- Mission list, campaign/rank locks, rewards and objective status.
- Ready/Leave flow and leader-only invocation of Fika's native Start button from the Host UI.
- Harmony hook bootstrap for Fika 1.2.3 host-observed AI kills and EFT place-visit callbacks.
- Startup runtime fingerprint logging for Unity, CLR and BepInEx.

The last documented successful Windows build was at commit 248e5924bc331167a908f050f8eee7a6574dde12. Client code changed after that, including commit 6db724310824221d41411da0afdb72a4c5444985. The Actions run for that latest client source commit (42919678967) failed during Source/Dependency preparation; the Windows compile job was skipped. The present Client source must not be called CI-verified.

## Server mission implementation truth

Production code does call OperationsService.recordRaidEvent:
- host client kill/kill_type evidence uses host_attested;
- host client place visits use host_attested;
- SPT-accepted inventory delta uses spt_accepted_client_delta;
- extract/survive/raid-complete data uses client_report_only.

The former statement that no production caller exists was stale. The Fika adapter still ends a mission group with verified:false, and no current production Objective producer issues server_verified. The normal flow is manual review before awards.

## Lifecycle and security boundaries

- SPT session is mapped server-side to the PMC/Scav profiles; client responses omit private profile IDs.
- Mission groups link to a Fika match only after member readiness, roster and map checks pass.
- The leader starts through the native Fika host UI. Other group members join through the normal Fika raid list.
- Host telemetry is not unforgeable server proof. It is constrained by authenticated host identity, match ID, actor roster, event type and rate limits.
- Duplicate event IDs do not increase progress twice.
- Admin review requires a note and explicit confirmation. Award delivery uses SPT mail; uncertain delivery is held for manual reconciliation instead of blind retry.

## Economy integration

SVM editor resolves the active preset from the installed SVM Loader. It displays the active TraderMarkup, TraderSell, Items and Fence values; checks the active file revision before write; writes a backup; validates known keys/ranges; and requires SPT restart.

TraderMarkup is the trader buyback percentage (buy_price_coef = 100 - value), TraderSell is a distinct currency-offer cost multiplier, and ItemPriceMult is an independent item section setting. In the supplied preset, Items is disabled, so ItemPriceMult is stored but inactive. These settings must not be treated as one global multiplier.

LiveFleaPrices and SVM interaction still requires a test on the running server with actual load order and final Handbook/database/dynamic price observations.

## CI status

- The earlier Server Checks at commit c22445de000ca803c37fab1031347557105e3f88 passed 28 tests. Later source changes are not covered by that green run.
- Current HEAD server workflow 43318263778 failed, but GitHub returned no usable step list or job logs. The cause is unknown.
- Latest Client workflow 42919678967 failed in its Source/Dependency preparation job; Windows compile was skipped, and no readable logs were exposed.
- No current-main artifact should be described as a fresh verified release.

## Required acceptance matrix

1. Restore actionable CI logs and pass Node static checks plus all server unit tests on current HEAD.
2. Build the current Client DLL on Windows using the bundled archives and verify its SHA/report.
3. Start an isolated SPT 3.11.1 server with EconomyGuard only; confirm no startup/runtime exceptions.
4. Add Fika 2.4.3 and validate host/match/member linking, map mismatch rejection, death/visit hooks and match-end review.
5. Test the SPT accepted inventory delta against actual SaveServer profile updates; no automatic rewards from client-originated outcomes.
6. Validate manual approval/denial, rank/campaign unlock and duplicate prevention.
7. Validate real SPT Mail delivery for RUB/items, online/offline users, server interruption and manual reconciliation.
8. Add SVM and LiveFleaPrices; capture active preset before/after restart and verify actual Handbook/dynamic price effects.
9. Add SAIN, LootingBots and PackNStrap incrementally and soak-test Fika raids.
10. Verify plugin load in EFT Mono and check for TypeLoadException, MissingMethodException, ReflectionTypeLoadException and Harmony patch errors.

A detailed Persian implementation audit and ordered roadmap is available at IMPLEMENTATION-AUDIT-FA.md.
