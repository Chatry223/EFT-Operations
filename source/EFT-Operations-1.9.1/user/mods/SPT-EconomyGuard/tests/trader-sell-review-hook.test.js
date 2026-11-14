'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-trader-review-hook-'));
const dataDir = path.join(root, 'data');
const tpl = 'abcdef0123456789abcdef0101';
const itemId = 'review-root';
const profileId = 'fedcba9876543210fedcba98';
let originalCalls = 0;

const config = {
    enabled: true,
    mode: 'audit',
    dataDirectory: dataDir,
    storage: {},
    flea: { maxTrackedEventsInMemory: 100 },
    price: {},
    trader: {
        maxSellPayoutMultiplier: 3,
        sellPayoutSafetyFactor: 1.35,
        reviewSellPayoutMultiplier: 2
    }
};

try {
    const guard = new EconomyGuard(root, config, { info() {}, warn() {}, error() {} }, {});
    // Keep this test focused on the sell hook and its persisted case, not trace formatting.
    guard.traceTransaction = () => {};

    const loyalty = { buy_price_coef: 80 };
    const trader = { currency: '5449016a4bdc2d6f028b456f', loyaltyLevels: [loyalty] };
    const instance = {
        sellItem() { originalCalls++; return 'original-sell-result'; },
        databaseService: { getItems: () => ({ [tpl]: {} }) },
        handbookHelper: {
            getTemplatePrice: () => 1000,
            inRUB: value => value
        },
        traderHelper: {
            getTrader: () => trader,
            getLoyaltyLevel: () => loyalty
        },
        itemHelper: { getItemQualityModifierForItems: () => 1 }
    };
    const profile = {
        _id: profileId,
        Inventory: { items: [{ _id: itemId, _tpl: tpl, parentId: 'hideout' }] },
        TradersInfo: {}
    };
    const request = { tid: 'trader-id', items: [{ id: itemId }], price: 500 };

    guard.installTradeHelper(instance);
    const result = instance.sellItem(profile, profile, request, 'session-review', {});
    assert.equal(result, 'original-sell-result', 'review-only finding must preserve the original SPT result');
    assert.equal(originalCalls, 1, 'original SPT sell handler must execute exactly once');

    const cases = guard.storage.loadCases(20);
    assert.equal(cases.length, 1, 'medium payout finding must be persisted as an admin case');
    assert.equal(cases[0].type, 'TRADER_SELL_PAYOUT_REVIEW');
    assert.equal(cases[0].severity, 'MEDIUM');
    assert.equal(cases[0].status, 'OPEN');
    assert.equal(cases[0].evidence.profileId, profileId, 'admin case must be linked to the SPT profile, not only the login session');
    assert.equal(cases[0].evidence.sessionId, 'session-review');
    assert.equal(cases[0].evidence.playerId, 'session-review', 'legacy playerId field remains session-scoped for compatibility');
    assert.equal(cases[0].evidence.traderId, 'trader-id');
    assert.equal(cases[0].evidence.check.reviewRequired, true);
    assert.equal(cases[0].evidence.check.payoutRatio, 2.5);
    assert.equal(cases[0].evidence.check.valid, true, '2.5x is review-only and must not be blocked by the 4.05x ceiling');

    // Reinstalling the hook must not wrap SPT a second time or create duplicate cases.
    guard.installTradeHelper(instance);
    const secondResult = instance.sellItem(profile, profile, request, 'session-review', {});
    assert.equal(secondResult, 'original-sell-result');
    assert.equal(originalCalls, 2);
    assert.equal(guard.storage.loadCases(20).length, 1, 'case cooldown/idempotent hook must prevent duplicate review cases');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write('Trader sell review hook integration tests passed.\\n');
