# SVM integration in EFT Operations

EFT Operations reads the active SVM preset from the installed server mod folder:

- `user/mods/[SVM] Server Value Modifier/Loader/loader.json`
- `user/mods/[SVM] Server Value Modifier/Presets/<active preset>.json`

The editor is intentionally version-gated to SVM `1.11.1` with SPT target `3.11.x`, matching the supplied server package. It does not change the active preset selection and does not rewrite unrelated JSON keys. The panel also reads `Traders.EnableTraders` and `Items.EnableItems` so it can distinguish stored values from settings that SVM will actually apply.

## Admin panel

Open EconomyGuard Admin Center on the server and choose **EFT Operations → SVM / Economy**.

The page reads and displays:

- Per-trader `Traders.TraderMarkup` values, expressed as the SVM preset's percentage values.
- Per-trader `Traders.TraderSell` multipliers.
- `Items.ItemPriceMult`, a separate global item-price setting (not the same as trader markup).
- Fence price/preset multipliers and stock-time range.

For the supplied `v6` preset, the inspected values include Skier markup `20`, Prapor `25`, Therapist `15`, Fence `17`, Mechanic `34`, Ragman `27`, Jaeger `33`, Peacekeeper `0`, and Ref `56`. These are the file's current values at audit time, not enforced defaults. SVM applies each TraderMarkup value by setting the trader loyalty-level `buy_price_coef` to `100 - value`; the UI labels this as the raw SVM value to avoid implying it is a direct price multiplier. The supplied preset has `Traders.EnableTraders=true`, but `Items.EnableItems=false`, so `ItemPriceMult=1` is currently stored but the Items section is inactive.

## Safe write behavior

- Only the selected preset is edited.
- Only the explicitly supported numeric keys are writable.
- Trader names must already exist in the selected preset.
- Numeric values and Fence stock-time ordering are validated.
- A timestamped copy of the original preset is stored under `SPT-EconomyGuard-Data/backups/svm/` before each write.
- The write uses a temporary file followed by an atomic rename.
- SVM applies its preset during server startup; restart the SPT server after saving.

If the SVM package version or SPT target does not match the audited package, the panel remains read-only and the write API rejects changes.

## Not claimed

This integration does not replace Greed.exe, does not change SVM code, and does not hot-reload SVM inside a running server. A successful unit-test run and a real SPT restart with SVM + LiveFleaPrices enabled are still required before calling the full integration runtime-verified.
