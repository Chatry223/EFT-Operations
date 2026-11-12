# EFT Operations compatibility audit

Audit snapshot: 2026-11-13  
Repository HEAD: 37f591e49fc7d2d13ef789d9387484bee5570dc3

## Locked runtime and framework

| Component | Observed version / property |
|---|---|
| EFT | 0.16.1.3.35392-P2P |
| Unity | 2022.3.43f1 (from supplied UnityPlayer.dll) |
| SPT Server | 3.11.1 |
| Fika Server | 2.4.3, package target ~3.11 |
| Fika Client | 1.2.3 / assembly 1.2.3.0 |
| SPT Common | 3.11.1.0 |
| BepInEx | 5.4.22.0 |
| BepInEx / Fika / SPT Common assembly TFM | .NET Framework 4.7.1 |
| Client project | .NET Framework 4.7.2 / C# 7.3 |

The client bridge uses reflection for EFT, Fika and SPT runtime types. BepInEx, Harmony and Unity references are compile-time dependencies. The builder validates the bundled target archives and fingerprints. A successful compile still does not prove the plugin loads correctly in the game's Mono runtime.

## Supplied server mod manifests

| Mod | Version | Declared SPT target |
|---|---:|---|
| Fika Server | 2.4.3 | ~3.11 |
| [SVM] Server Value Modifier | 1.11.1 | 3.11.x |
| Skwizzy LootingBots ServerMod | 1.5.2 | ~3.11 |
| WTT-PackNStrap | 1.1.13 | ~3.11 |
| zSolarint SAIN ServerMod | 2.3.0 | ~3.11.0 |
| zzDrakiaXYZ LiveFleaPrices | 1.5.2 | ~3.11 |
| SPT-EconomyGuard | 1.9.1 | ~3.11.0 |

Manifest target matching is not a no-conflict guarantee. Whole-stack runtime tests remain required.

## Mission event producers — current source truth

The current code DOES contain production event producers. The previous wording that said recordRaidEvent had no production callers and that kill/visit/collect were not wired was stale and has been corrected.

| Objective | Producer | Trust boundary |
|---|---|---|
| kill / kill_type | Client plugin host hook on EFT.Player.OnBeenKilledByAggressor; authenticated SPT host API validates account, match, actor roster and AI victim | host_attested; review only |
| visit | Client plugin host hook on EFT.Player.SpecialPlaceVisited(string,int) for mission-required place keys | host_attested; review only |
| collect | Raid-start inventory snapshot compared with SPT-accepted SaveServer profile after raid end | spt_accepted_client_delta; stronger than raw report, not proof of item origin |
| extract / survive / raid_complete | Authenticated SPT endLocalRaid report fields | client_report_only; review only |

The Fika adapter links a forming mission group only when all Ready members are present in the same Fika match and map. It calls startGroup with the observed match ID. On match end, finishMissionGroup intentionally supplies verified:false, so the group enters manual review. There is no production server_verified Objective event producer in the currently inspected path.

recordRaidEvent requires unique event IDs, checks the accepted member identity for kill/visit/collect, checks map/match association, restricts trust/source combinations and bounds the processed-event list. These guards protect the ingestion layer; they do not make host-originated telemetry unforgeable.

## Fika client and UI integration

The client plugin uses SPT's native RequestHandler session, host and HttpClient through reflection. It renders an F8 mission interface, rank/campaign lock state, squad readiness, notifications and an in-raid mission HUD.

Only the squad leader can request the native Fika 1.2.3 Start button, and only from the active host UI with the required map selected. Other squad members still join through Fika's normal raid list. Automatic member auto-join is not implemented.

Mission briefing data currently contains kind, media and body, but the HUD renders text only. Video/audio playback, media cache and a 3D briefing room are not implemented.

## Economy and SVM integration

- Supplied SVM package: 1.11.1; active preset selector in the supplied snapshot: v6.
- Traders.TraderMarkup and Traders.TraderSell are separate values.
- SVM maps TraderMarkup to buy_price_coef = 100 - value; a value of 20 is approximately a 20% trader buyback rate against the relevant Handbook baseline, not a 20x price multiplier.
- TraderSell changes currency-based trader offer costs; barter-only offers are not adjusted by that field.
- Items.ItemPriceMult is independent and applies only when Items.EnableItems is true. In the supplied preset, Items.EnableItems=false, so the stored value 1 is inactive.
- The SVM admin service resolves the active preset dynamically, validates SVM 1.11.1/SPT 3.11.x, checks a raw-file revision token, backs up the preset and writes only approved fields. SPT restart is required.
- Supplied LiveFleaPrices 1.5.2 updates SPT dynamic price data; EconomyGuard reads the active dynamic price and DB fallback. Its reference-disagreement guard still marks large divergences ambiguous. Actual load order and live runtime values remain to be tested.

## Fika item sending

The supplied Fika server config has server.allowItemSending=false. EconomyGuard reads and surfaces this value. If the operator enables the setting, this build does not intercept the Fika item transfer route; keep it disabled until a version-specific route hook is implemented and tested.

## CI and runtime validation

- An earlier server test run at commit c22445de000ca803c37fab1031347557105e3f88 passed 28 tests. It does not validate later commits.
- The last documented successful Windows client build was at commit 248e5924bc331167a908f050f8eee7a6574dde12. Client source changed after that; the latest Client run for commit 6db724310824221d41411da0afdb72a4c5444985 failed in source/dependency preparation and the Windows build job was skipped.
- Latest Server Checks for current HEAD 37f591e49fc7d2d13ef789d9387484bee5570dc3 failed with no readable steps/logs exposed by GitHub. Root cause is not established.
- No real EFT/Fika raid, actual SPT system mail delivery, or complete mod-stack soak test has been completed.

See IMPLEMENTATION-AUDIT-FA.md for the Persian implementation map and prioritized development plan.
