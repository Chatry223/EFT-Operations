# Price-mod and nested-container compatibility review

Date: 2026-11-14  
Target: SPT 3.11.1 / EFT 0.16.1.3.35392 / Fika Server 2.4.3

## LiveFleaPrices

The upstream DrakiaXYZ SPT LiveFleaPrices implementation for the SPT 3.11 line applies its selected price dataset to the live `databaseServer.getTables().templates.prices` table, honors its blacklist and price-limiter settings, optionally raises values to 110% of the highest trader sell price when SPT's `useTraderPriceForOffersIfHigher` is enabled, and then calls `RagfairPriceService.refreshDynamicPrices()`.

EconomyGuard's current `getPriceSources()` reads `RagfairPriceService.getDynamicPriceForItem(tpl)` first and falls back to the current database prices table. This is the correct integration point: it consumes the final in-memory value after LiveFleaPrices has applied its own blacklist, limiter and trader-price behavior. Reading LiveFleaPrices' raw `prices.json` directly would bypass those effective runtime decisions and could disagree with what SPT actually uses.

A new regression test simulates the LiveFleaPrices update sequence (database price mutation followed by dynamic-cache refresh) and verifies that EconomyGuard reads the refreshed price. It also verifies that SPT's 1-RUB dynamic-price sentinel is not treated as a real reference and that the current database price remains the fallback.

Trader buyback deliberately remains based on the SPT Handbook value and the active trader loyalty-level `buy_price_coef`. LiveFleaPrices changes flea reference prices; it must not inflate the amount the trader is expected to pay for a sale. The existing SVM 1.11.1 / `TraderMarkup=20` regression remains the guard for this behavior.

## PackNStrap and nested inventory valuation

SPT stores a container and its contents as separate inventory item rows connected by `parentId`. EconomyGuard already expands item trees for Flea listings and Fika item-transfer audit records. The trader-sell path previously valued only the explicitly selected item rows. When a player sold a container root, contained items could therefore be omitted from the payout reference.

The trader-sell path now expands only the selected root IDs using the shared cycle-safe `core.itemTree()` traversal, then values every descendant using its own template Handbook value and stack count. Unrelated inventory rows are excluded. If the selected tree cannot be resolved completely, the valuation is marked unknown and is not hard-blocked from an incomplete reference.

A regression case models a PackNStrap-style container with 60 rounds nested inside it. It confirms that the root plus the contained stack are included, unrelated inventory is excluded, and the SVM 20% buyback rate is applied to the complete tree.

This is a compatibility improvement at the SPT inventory-model boundary; it does not depend on PackNStrap-specific class names or hardcoded item IDs. It does not yet prove behavior against every PackNStrap custom item or client-side container feature in a live raid.

## Trader payout threshold — intentionally unchanged

The current hard-block cap is `maxSellPayoutMultiplier=3` multiplied by `sellPayoutSafetyFactor=1.35`, which permits up to 4.05 times the computed SPT Handbook/SVM expected payout. It was not tightened without representative legitimate-sale data. A separate non-blocking review threshold, `reviewSellPayoutMultiplier=2`, now creates a medium-severity review for valid sales above 2x expected payout while leaving the transaction untouched. Only sales above the existing hard ceiling are blocked in Protect mode. The expected payout, actual payout, ratio, review threshold, ceiling, Handbook breakdown, SVM coefficient and selected item count remain available for audit.

## Validation boundary

The new automated tests exercise the LiveFleaPrices runtime price-table/cache contract and nested container valuation. CI must pass on the new branch head. A live test with the user's exact installed LiveFleaPrices and PackNStrap builds is still required before calling the integrations runtime-verified.
