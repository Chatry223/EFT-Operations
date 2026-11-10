'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-test-'));
const config = {
    enabled: true, mode: 'protect', dataDirectory: path.join(temp, 'data'),
    price: { maxOvervalueRatio: 20, minUndervalueRatio: 0.05, referenceDisagreementRatio: 5, allowSingleReferenceSourceForBlocking: true, minimumReferenceRoubles: 100 },
    trader: { blockInvalidPaymentScheme: true, maxSellPayoutMultiplier: 3, sellPayoutSafetyFactor: 1.35 },
    flea: { blockSelfPurchase: true, blockPaymentMismatch: true, blockExtremePrice: true, maxTrackedEventsInMemory: 20000, pairWindowMinutes: 10, pairCaseThreshold: 5 },
    fence: { absoluteMaxPayoutRoubles: 50000000, blockAbsoluteCap: true },
    storage: { auditRetentionDays: 60, ledgerRetentionDays: 180, maxFileSizeMb: 8 }
};
const logger = { info(){}, warn(){}, error(){} };
const guard = new EconomyGuard(__dirname, config, logger, {});
let originalBuyCalls = 0;
const instance = {
    traderAssortHelper: { getAssort: () => ({ barter_scheme: { offerA: [[{ _tpl: '5449016a4bdc2d6f028b456f', count: 10000 }]] } }) },
    httpResponse: { appendErrorToOutput(output, message) { output.warnings.push({ errmsg: message }); return output; } },
    buyItem() { originalBuyCalls++; }
};
guard.installTradeHelper(instance);
const profile = { Inventory: { items: [{ _id: 'cash', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 50000 } }] } };
const blockedOutput = { warnings: [] };
instance.buyItem(profile, { tid: 'traderA', item_id: 'offerA', count: 1, scheme_id: 0, scheme_items: [{ id: 'cash', count: 500 }] }, 'profile-a', false, blockedOutput);
assert.strictEqual(originalBuyCalls, 0, 'bad trader payment must stop before original buyItem');
assert.ok(blockedOutput.warnings.length > 0, 'blocked transaction must return warning');

const allowedOutput = { warnings: [] };
instance.buyItem(profile, { tid: 'traderA', item_id: 'offerA', count: 1, scheme_id: 0, scheme_items: [{ id: 'cash', count: 10000 }] }, 'profile-a', false, allowedOutput);
assert.strictEqual(originalBuyCalls, 1, 'valid payment should reach original buyItem');

// Regression: SPT 3.11.x adds offer items before payMoney checks whether cash exists.
// EconomyGuard must stop this before the original buyItem runs.
let fleaTraderOriginalCalls = 0;
const fleaTraderInstance = {
    traderAssortHelper: { getAssort: () => ({ barter_scheme: { moneyOffer: [[{ _tpl: '5449016a4bdc2d6f028b456f', count: 83530834 }]] } }) },
    httpResponse: { appendErrorToOutput(output, message) { output.warnings.push({ errmsg: message }); return output; } },
    buyItem() { fleaTraderOriginalCalls++; }
};
guard.installTradeHelper(fleaTraderInstance);
const lowCashProfile = { Inventory: { items: [
    { _id: 'rubles-stack', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 1044411 } },
    { _id: 'dollars-stack', _tpl: '5696686a4bdc2da3298b456a', upd: { StackObjectsCount: 4904883 } }
] } };
const noFundsOutput = { warnings: [] };
fleaTraderInstance.buyItem(lowCashProfile, {
    tid: '54cb50c76803fa8b248b4571', item_id: 'moneyOffer', count: 190775, scheme_id: 0,
    scheme_items: [{ id: 'rubles-stack', count: 83530834 }]
}, 'profile-low-cash', false, noFundsOutput);
assert.strictEqual(fleaTraderOriginalCalls, 0, 'unaffordable trader Flea offer must be rejected before SPT adds the bought item');
assert.ok(noFundsOutput.warnings.length > 0, 'insufficient funds must return a server warning');

let originalSellCalls = 0;
const sellInstance = {
    traderHelper: {
        // SPT 3.11.1 returns ITraderBase directly and exposes the effective buyback
        // coefficient through the player's current loyalty-level row.
        getTrader: () => ({ currency: '5449016a4bdc2d6f028b456f', loyaltyLevels: [{ buy_price_coef: 50 }] }),
        getLoyaltyLevel: () => ({ buy_price_coef: 50 })
    },
    databaseService: { getPrices: () => ({ tplA: 10000 }), getItems: () => ({ tplA: {} }) },
    handbookHelper: { getTemplatePrice: () => 10000, inRUB: amount => amount },
    itemHelper: { getItemQualityModifierForItems: () => 1 },
    ragfairPriceService: { getDynamicPriceForItem: () => 1000000 },
    httpResponse: { appendErrorToOutput(output, message) { output.warnings.push({ errmsg: message }); return output; } },
    sellItem() { originalSellCalls++; }
};
guard.installTradeHelper(sellInstance);
const sellProfile = { Inventory: { items: [{ _id: 'valuable', _tpl: 'tplA', parentId: 'hideout', upd: { StackObjectsCount: 1 } }] } };
const sellOutput = { warnings: [] };
sellInstance.sellItem(sellProfile, sellProfile, { tid: 'traderA', items: [{ id: 'valuable' }], price: 1000000 }, 'profile-a', sellOutput);
assert.strictEqual(originalSellCalls, 0, 'grossly excessive trader payout must be blocked before inventory removal');
assert.ok(sellOutput.warnings.length > 0);

fs.rmSync(temp, { recursive: true, force: true });
console.log('PASS TradeHelper hook integration smoke tests (3 assertions groups)');
