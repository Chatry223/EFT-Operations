# SVM Integration — SPT 3.11.1

EconomyGuard reads the active SVM preset through `Loader/loader.json` and the selected `Presets/vN.json`. It does not hardcode a preset name or assume that a stored value is active.

## Field meanings

- `Traders.EnableTraders` gates the SVM trader section.
- `TraderMarkup` is the effective percentage a trader pays when buying an item from the player. SVM writes `buy_price_coef = 100 - TraderMarkup`; SPT 3.11.1 converts that coefficient back to the buyback percentage. It is **not** the multiplier for prices the player pays when buying from the trader.
- `TraderSell` multiplies currency-based costs in trader offers. Offers that are barter-only are not changed by this field.
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
