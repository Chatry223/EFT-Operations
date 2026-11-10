'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eftops-svm-trader-sell-'));
const traderId = '54cb50c76803fa8b248b4571';
const profile = {
    Inventory: { items: [{ _id: 'item-1', _tpl: 'abcdef0123456789abcdef01' }] },
    TradersInfo: { [traderId]: { loyaltyLevel: 2 } }
};

// SVM 1.11.1 writes buy_price_coef = 100 - TraderMarkup to every loyalty row.
// TraderMarkup 20 therefore means an 80 coefficient and a 20% sell-to-trader rate.
const loyaltyLevels = [
    { buy_price_coef: 80 },
    { buy_price_coef: 80 },
    { buy_price_coef: 80 },
    { buy_price_coef: 80 }
];
const traderBase = { currency: 'RUB', loyaltyLevels };
const instance = {
    traderHelper: {
        // SPT 3.11.1 getTrader returns ITraderBase directly (not { base: ITraderBase }).
        getTrader(id) { assert.equal(id, traderId); return traderBase; },
        getLoyaltyLevel(id, pmc) {
            assert.equal(id, traderId);
            return traderBase.loyaltyLevels[pmc.TradersInfo[id].loyaltyLevel - 1];
        }
    },
    handbookHelper: { inRUB(value, currency) { assert.equal(currency, 'RUB'); return value; } }
};

const guard = new EconomyGuard(root, {
    dataDirectory: path.join(root, 'data'),
    mode: 'audit',
    storage: {},
    price: {},
    flea: { maxTrackedEventsInMemory: 100 },
    trader: { maxSellPayoutMultiplier: 3, sellPayoutSafetyFactor: 1.35 }
}, { info() {}, warn() {}, error() {} }, {});
guard.itemValue = () => ({ value: 100000, confidence: 'HIGH' });

try {
    const within = guard.checkTraderSell(instance, profile, {
        tid: traderId, items: [{ id: 'item-1' }], price: 81000
    }, 'session-1');
    assert.equal(within.known, true, 'SPT TraderHelper.getTrader returns the base object directly');
    assert.equal(within.buyPriceCoef, 80);
    assert.equal(within.buybackPercent, 20, 'SVM TraderMarkup 20 must mean a 20% buyback rate, not 80%');
    assert.equal(within.expectedRub, 20000);
    assert.equal(within.ceiling, 81000);
    assert.equal(within.valid, true);

    const over = guard.checkTraderSell(instance, profile, {
        tid: traderId, items: [{ id: 'item-1' }], price: 81001
    }, 'session-1');
    assert.equal(over.known, true);
    assert.equal(over.valid, false, 'payout above the SVM-adjusted 20% buyback ceiling must be rejected');

    // Fallback path for SPT-compatible wrappers or test doubles that do not expose getLoyaltyLevel.
    const fallbackInstance = {
        traderHelper: { getTrader() { return { base: traderBase }; } },
        handbookHelper: instance.handbookHelper
    };
    const fallback = guard.checkTraderSell(fallbackInstance, profile, {
        tid: traderId, items: [{ id: 'item-1' }], price: 20000
    }, 'session-1');
    assert.equal(fallback.known, true);
    assert.equal(fallback.buybackPercent, 20);

    // A 0% buyback rate is valid SVM configuration and must not be treated as missing data.
    const zeroMarkup = { currency: 'RUB', loyaltyLevels: [{ buy_price_coef: 100 }] };
    const zeroInstance = {
        traderHelper: { getTrader() { return zeroMarkup; }, getLoyaltyLevel() { return zeroMarkup.loyaltyLevels[0]; } },
        handbookHelper: instance.handbookHelper
    };
    const zero = guard.checkTraderSell(zeroInstance, profile, {
        tid: traderId, items: [{ id: 'item-1' }], price: 0
    }, 'session-1');
    assert.equal(zero.known, true);
    assert.equal(zero.expectedRub, 0);
    assert.equal(zero.valid, true);
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('SVM trader payout integration tests passed.');
