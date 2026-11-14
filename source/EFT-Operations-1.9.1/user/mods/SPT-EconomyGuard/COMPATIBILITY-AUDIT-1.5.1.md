# EconomyGuard Enterprise 1.5.1 compatibility audit

Audit date: 2026-11-14
Reviewed input: user-provided `SPT-EconomyGuard-Enterprise-1_5_1.zip`
Target branch: `dev/mission-trust-accounting` (package 1.9.1)
Target runtime: SPT 3.11.1, Fika Server 2.4.3, EFT 0.16.1.3.35392

## Decision

The 1.5.1 archive is relevant and was reviewed. It must **not** be copied over the current 1.9.1 branch or installed as a replacement: the branch contains later mission APIs, review/reward accounting, Fika 2.4.3 observer code, SVM integration and client-plugin source. Replacing it with 1.5.1 would remove those later features and likely break the mission integration.

The 1.5.1 archive is treated as a compatibility and regression reference, not as the new source of truth.

## Confirmed overlap and compatibility

- Both package manifests target SPT `~3.11.0`, which includes SPT 3.11.1.
- The archive's economy engine covers trader/flea validation, custom currencies, bulk item trees, account restrictions, admin panel and status board.
- The 1.9.1 branch retains those subsystems and adds mission services, authenticated player API, individual raid review, idempotent reward delivery and the Fika 2.4.3 adapter.
- The branch's SVM service is explicitly version-gated to SVM 1.11.1 / SPT 3.11.x, reads the active preset and its revision, and refuses writes if the preset changed since the editor was opened.
- The branch has a dedicated regression test for SVM TraderMarkup=20: it expects `buy_price_coef=80`, a 20% buyback rate, Handbook valuation for trader sell payout, and validation against the live SVM-adjusted trader assort for purchases. This is more precise than the 1.5.1 audit's broad `max(c, 100-c)` fallback and should remain the implementation to validate.
- The branch's Fika integration is explicitly version-gated to Fika Server 2.4.3. Its admin UI exposes hook readiness and the `allowItemSending` state.

## Important security finding retained from 1.5.1

The archive explicitly reports Fika Item Sending as `NOT_HOOKED`. The current 1.9.1 Fika adapter also reads the `allowItemSending` setting but does not claim to intercept the transfer controller. The admin UI correctly warns:
- ENABLED — transfer route is not monitored
- DISABLED — transfer route closed
- UNKNOWN — verify `fika.jsonc`

Until an exact Fika 2.4.3 server-side interception and regression test are implemented, keep `allowItemSending: false` if unmonitored item transfers are not permitted. Do not treat flea/trader anti-cheat as covering this separate transfer path.

## Version nuance

The 1.5.1 guide contains references to Fika 2.4.6 and also warns that a prior runtime log showed 2.4.3. The user's target is Fika 2.4.3. Therefore 2.4.6-only claims or endpoint assumptions from that guide are not accepted as proof for this project. The branch's Fika adapter remains pinned to the 2.4.3 server package and must be tested against that exact tag.

## Local test execution of the uploaded archive

Executed `node --test tests/*.test.js` with Node.js 22. The test runner reported 26 of 27 test files passing. The sole failure was `tests/board-server.test.js`, which terminated with `ECONNRESET / socket hang up` while exercising local HTTP listener/bind/rebind behavior. This is an environment-level socket failure in this run, not a demonstrated assertion failure; it still means the complete local suite cannot be reported green. Re-run that test in the project's GitHub Actions/Windows runtime before treating it as passed.

The successful files include the anti-cheat regression suite (27 assertions), access-control tests, SVM-adjacent trader/flea logic, admin panel, Fika presence, status-board collector, board delivery and storage. These are unit/integration tests with mocks; they do not replace an actual SPT 3.11.1 + Fika 2.4.3 server test.

## Follow-up gates

1. Keep the 1.5.1 source archive as a regression reference; do not overwrite the 1.9.1 branch with it.
2. Re-run the uploaded archive's board-server test on CI/Windows to isolate the socket reset.
3. Run the 1.9.1 full test workflow after the current mission/Fika lifecycle changes.
4. Validate SVM 1.11.1 active-preset reading and trader price behavior using the actual server preset with TraderMarkup=20; do not infer from a stale preset or from `Items.ItemPriceMult`.
5. Keep Fika item sending disabled until the 2.4.3 server transfer route is either intercepted and audited or explicitly accepted as an unmonitored feature.
6. Perform an in-game test with the exact EFT 0.16.1.3.35392 + SPT 3.11.1 + Fika 2.4.3 + installed mod set. CI alone cannot certify runtime compatibility.
