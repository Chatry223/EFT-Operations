# EFT Operations compatibility audit

Audit basis: the user's supplied Takove Server - SPT 3.11.1.zip, EscapeFromTarkov_Data.zip, and BepInEx-(no server-is player).zip, plus the repository source at the time of this audit.

## Locked runtime and framework

| Component | Observed version / property | Evidence |
|---|---|---|
| EFT | 0.16.1.3.35392-P2P | User's supplied install/archive name |
| Unity | 2022.3.43f1 | Version string in the supplied UnityPlayer.dll |
| SPT | 3.11.1 | User's server package and mod manifests |
| Fika Server | 2.4.3, sptVersion: ~3.11 | Supplied user/mods/fika-server/package.json |
| Fika Client | 1.2.3 config marker; Fika.Core.dll assembly version 1.2.3.0 | Supplied BepInEx archive |
| SPT Common | 3.11.1.0 | Supplied spt-common.dll assembly version |
| BepInEx | 5.4.22.0 | Supplied BepInEx.dll assembly version |
| BepInEx / Fika / SPT Common TFM | .NETFramework v4.7.1 | Assembly metadata in supplied DLLs |
| EFT Managed | Contains mscorlib.dll, netstandard.dll, System.Runtime.dll | Supplied EFT Data archive |

The client plugin deliberately targets .NET Framework 4.7.2 / C# 7.3. This is a higher compatible target for the pinned .NETFramework v4.7.1 BepInEx, Fika and SPT Common references. The EFT Unity version and presence of netstandard.dll were checked; blindly changing the project to netstandard2.1 would be unsafe while the pinned references remain .NET Framework assemblies. The project file now documents this choice, and the client logs the actual Unity, CLR and BepInEx versions at startup. Runtime loading still needs an in-game test.

## Server-side mod manifest audit

The supplied server archive contains these manifests:

| Mod | Version | Declared SPT target | Assessment |
|---|---:|---|---|
| Fika Server | 2.4.3 | ~3.11 | Exact pinned target |
| [SVM] Server Value Modifier | 1.11.1 | 3.11.x | Declared target matches |
| Skwizzy LootingBots ServerMod | 1.5.2 | ~3.11 | Declared target matches |
| WTT-PackNStrap | 1.1.13 | ~3.11 | Declared target matches |
| zSolarint SAIN ServerMod | 2.3.0 | ~3.11.0 | Declared target matches |
| zzDrakiaXYZ LiveFleaPrices | 1.5.2 | ~3.11 | Declared target matches |
| SPT-EconomyGuard | 1.9.1 | ~3.11.0 | Declared target matches |

Manifest compatibility is not the same as a tested no-conflict guarantee. These mods affect different areas (AI, loot, prices and inventory), and the final check must still be made on the actual server with the whole mod set enabled.

## Verified integration paths and boundaries

- **Fika lifecycle:** the adapter is version-gated to Fika Server 2.4.3 / SPT 3.11.x. It observes match membership, raid lifecycle and authenticated SPT profile ownership. It does not intentionally replace Fika's native raid flow.
- **Mission progress trust:** internal raid-event intake now requires a unique eventId, a server-adapter trust label, the mission map, and an accepted member identity for kill / kill-type / collect / visit events. Duplicate IDs are idempotent. This hardens the intake contract; it does not mean those objective event producers are already wired into live Fika callbacks.
- **Kill evidence:** Fika player-death callbacks identify a dead player, not a proven killer. Client victim/kill summaries remain review evidence and must not auto-award.
- **Extraction / survival:** match roster and death flags are useful corroboration. The current finish path deliberately sets verified: false and sends outcomes to manual review rather than auto-awarding based on client extraction reports.
- **Loot and LiveFleaPrices:** LiveFleaPrices 1.5.2 updates SPT's templates.prices table and calls RagfairPriceService.refreshDynamicPrices(). The supplied config is pvePrices=false, maxIncreaseMult=10, maxLimiter=false, and disablePriceFetching=false; it therefore uses regular flea prices and allows fetched prices without the optional 10x limiter. EconomyGuard reads the active RagfairPriceService.getDynamicPriceForItem() value first and the current database price table as fallback, so its valuation path can observe the effective SPT price table after price mods have applied. Its handbook-vs-market disagreement threshold still marks strongly divergent references ambiguous rather than treating the live price as unquestionable. Mod load order and final runtime values still need a live test.
- **SVM:** SVM 1.11.1 declares SPT 3.11.x and the supplied `Loader/loader.json` selects `v6`. In that exact preset, `Traders.TraderMarkup` is a per-trader map (for example Skier=20, Prapor=25, Therapist=15, Fence=17, Mechanic=34, Ragman=27, Jaeger=33, Peacekeeper=0 and Ref=56); `Traders.TraderSell` is a separate set of sell multipliers. `Items.ItemPriceMult=1` is a different, global item-price option and must not be confused with trader markup. The supplied preset has `Traders.EnableTraders=true` but `Items.EnableItems=false`, so the item-price multiplier is currently stored but inactive. SVM's source maps each `TraderMarkup` value to the trader's `buy_price_coef` as `100 - value`; the admin UI therefore displays the raw SVM value, not a direct price multiplier. EFT Operations now reads the selected preset and exposes trader markup, sell multipliers, item-price multiplier and selected Fence multipliers in the authenticated admin panel. It edits only the active preset, accepts only the audited SVM 1.11.1 / SPT 3.11.x package, creates a timestamped backup before writes, validates numeric ranges, and requires an SPT restart to apply. The reader/editor has unit tests; GitHub Actions still needs a successful run before this addition can be called CI-verified. Runtime SVM/Greed.exe and full mod-load-order tests remain outstanding.
- **Fika item sending:** the supplied fika.jsonc has server.allowItemSending: false. EconomyGuard now reads this setting and reports whether the separate transfer route is closed, enabled-but-unmonitored, or could not be verified. It does not hook Fika's item-sending route itself.
- **SAIN / LootingBots / PackNStrap:** their manifests declare the SPT 3.11 line. EFT Operations does not patch their AI logic. Loot/visit objectives are not yet supported by authoritative live event producers.

## Validation status

1. Dependency ZIP integrity and exact reference fingerprints were checked by the repository's build workflow in the earlier green run.
2. Earlier CI commit c22445de000ca803c37fab1031347557105e3f88 passed 28 server tests and compiled the Windows client DLL.
3. Later event-intake and Fika config-detection commits triggered GitHub Actions runs that failed before usable step details were exposed by the connected GitHub interface. These later changes must not be described as CI-verified yet.
4. No actual EFT game session, real Fika raid, multi-mod soak test, or in-game reward-mail test has been run in this environment.

## Required final runtime matrix

- Clean SPT 3.11.1 + Fika 2.4.3 startup with EconomyGuard only.
- Add SVM and LiveFleaPrices; compare handbook, database and dynamic prices before / after each mod load.
- Add SAIN, LootingBots and PackNStrap in batches; inspect server logs and run a Fika raid after each batch.
- Verify BepInEx plugin startup fingerprint and absence of TypeLoadException, MissingMethodException, ReflectionTypeLoadException and Harmony patch errors.
- Test squad ready / Fika host / member join / map mismatch / raid end / review.
- Verify no automatic reward from client kill or extraction reports; verify manual review and actual SPT mail delivery.
- Confirm allowItemSending=false remains in the live Fika config, and verify the admin status reflects it.
