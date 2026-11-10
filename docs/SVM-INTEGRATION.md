# SVM Integration — SPT 3.11.1

EconomyGuard reads the active SVM preset through `Loader/loader.json` and the selected `Presets/vN.json`. It does not hardcode a preset name or assume that a stored value is active.

## Verified supplied preset snapshot

The supplied SPT 3.11.1 server archive selects preset `v6` and contains SVM `1.11.1`:
- `Traders.EnableTraders = true`
- `Traders.TraderMarkup.Skier = 20` — Skier buyback is 20% of the reference value (SVM writes `buy_price_coef = 80`)
- `Traders.TraderSell.Skier = 5.1` — currency-based Skier offer requirements are multiplied by 5.1
- `Items.EnableItems = false` with `Items.ItemPriceMult = 1` — this item multiplier is stored but inactive

These are the values in the supplied archive, not a promise that a later server-side preset has not changed.

## Field meanings

- `Traders.EnableTraders` gates the SVM trader section.
- `TraderMarkup` is the effective percentage a trader pays when buying an item from the player. SVM writes `buy_price_coef = 100 - TraderMarkup`; SPT 3.11.1 converts that coefficient back to the buyback percentage. It is **not** the multiplier for prices the player pays when buying from the trader.
- `TraderSell` multiplies currency-based costs in trader offers. Offers that are barter-only are not changed by this field.
- EconomyGuard does not multiply `TraderMarkup` a second time: it reads the already-modified runtime `buy_price_coef` from SPT's current trader loyalty row.
- EconomyGuard validates trader purchases against SPT's resolved trader assort requirements, so it sees the active SVM-adjusted currency offer counts. For player-to-trader sales, SPT 3.11.1 `TraderHelper.getTrader()` returns the trader base directly and the effective `buy_price_coef` is on the player's current `loyaltyLevels` row. EconomyGuard reads that row and converts the inverse coefficient to the buyback percentage (`100 - buy_price_coef`). The payout reference is SPT Handbook value plus the game's item-quality modifier; LiveFleaPrices/Ragfair dynamic prices are deliberately excluded because trader buyback is based on Handbook value, not flea value.
- `Items.EnableItems` gates the item section. `Items.ItemPriceMult` is only effective when that section is enabled.
- `Traders.Fence.EnableFence` gates the Fence-specific values. Stored Fence multipliers must be shown as inactive when this flag is false.

## Values in the supplied server archive

The supplied SPT 3.11.1 archive contains SVM 1.11.1 with `v6` selected:
- `Traders.EnableTraders = true`
- Skier `TraderMarkup = 20` and `TraderSell = 5.1`
- `Items.EnableItems = false` and `ItemPriceMult = 1` (stored, inactive)
- `Fence.EnableFence = false` (stored Fence values, inactive)

Therefore, Skier's `20` means a 20% buyback rate when the player sells to Skier. The 5.1 currency-offer multiplier is what raises Skier's trader offer costs. The global item-price multiplier is not active in this preset.

## Safety

EconomyGuard preserves unrelated SVM settings, backs up the active preset before writing, and reports the selected preset and section enable flags. It must not silently enable the Items or Fence sections just because their stored numeric values are present.
