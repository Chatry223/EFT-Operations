'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-prototype-di-'));
const config = {
  enabled: true, mode: 'protect', dataDirectory: path.join(temp, 'data'),
  diagnostics: { traceTransactions: true },
  trader: { blockInsufficientFunds: true }, flea: {}, fence: {},
  storage: { maxFileSizeMb: 1, auditRetentionDays: 60, ledgerRetentionDays: 180, caseRetentionDays: 0 }
};
const logger = { info(){}, warn(){}, error(){} };
const guard = new EconomyGuard(__dirname, config, logger, {});

let controllerOriginalCalls = 0;
class MockTradeController {
  constructor() {
    this.ragfairServer = { getOffer: id => ({ _id: id, root: 'usd', quantity: 190775, user: { id: 'peacekeeper', memberType: 4 }, requirementsCost: 438, sellInOnePiece: false, requirements: [{ _tpl: '5449016a4bdc2d6f028b456f', count: 437.85 }] }) };
    this.eventOutputHolder = { getOutput: () => ({ warnings: [] }) };
    this.httpResponse = { appendErrorToOutput(out, message) { out.warnings.push({ errmsg: message }); return out; } };
  }
  confirmRagfairTrading() { controllerOriginalCalls++; return { warnings: [] }; }
  confirmTrading() { controllerOriginalCalls++; return { warnings: [] }; }
  sellScavItemsToFence() { controllerOriginalCalls++; return { warnings: [] }; }
}

// Simulate SPT DI: one transient controller is resolved and patched, while the active
// TradeCallbacks keeps a different instance created earlier. Prototype patch must cover both.
const diResolvedController = new MockTradeController();
guard.installTradeController(diResolvedController);
const activeControllerHeldByTradeCallbacks = new MockTradeController();
const lowCashProfile = { Inventory: { items: [
  { _id: 'rubles-stack', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 1044411 } },
  { _id: 'usd-stack', _tpl: '5696686a4bdc2da3298b456a', upd: { StackObjectsCount: 4904883 } }
] } };
const request = { Action: 'RagFairBuyOffer', offers: [
  { id: 'peacekeeper-offer', count: 190775, items: [{ id: 'rubles-stack', count: 83530834 }] }
] };
const blocked = activeControllerHeldByTradeCallbacks.confirmRagfairTrading(lowCashProfile, request, 'profile-1');
assert.strictEqual(controllerOriginalCalls, 0, 'prototype hook must block on a separate DI controller instance');
assert.ok(blocked.warnings.length > 0, 'prototype hook must produce a warning');
assert.strictEqual(guard.health.runtime.ragfairPurchaseCalls, 1, 'runtime counter must increment on the active DI instance');

let helperOriginalCalls = 0;
class MockTradeHelper {
  constructor() {
    this.httpResponse = { appendErrorToOutput(out, message) { out.warnings.push({ errmsg: message }); return out; } };
    this.traderAssortHelper = { getAssort: () => null };
  }
  buyItem() { helperOriginalCalls++; }
  sellItem() { helperOriginalCalls++; }
}
const diResolvedHelper = new MockTradeHelper();
guard.installTradeHelper(diResolvedHelper);
const helperHeldByController = new MockTradeHelper();
const helperOut = { warnings: [] };
helperHeldByController.buyItem(lowCashProfile, {
  tid: '54cb57776803fa99248b456e', type: 'buy_from_ragfair', item_id: 'usd', count: 190775,
  scheme_items: [{ id: 'rubles-stack', count: 83530834 }]
}, 'profile-1', false, helperOut);
assert.strictEqual(helperOriginalCalls, 0, 'prototype TradeHelper hook must block on a separate DI instance');
assert.ok(helperOut.warnings.length > 0, 'TradeHelper preflight must return a warning');
assert.strictEqual(guard.health.runtime.buyItemCalls, 1, 'TradeHelper runtime counter must increment on active DI instance');

// Callback instrumentation is also prototype-safe and demonstrates the actual ItemEvent path.
let callbackOriginalCalls = 0;
class MockTradeCallbacks {
  constructor(controller) { this.tradeController = controller; }
  processRagfairTrade(pmc, body, sessionId) {
    callbackOriginalCalls++;
    return this.tradeController.confirmRagfairTrading(pmc, body, sessionId);
  }
}
const callbackResolvedByDi = new MockTradeCallbacks(activeControllerHeldByTradeCallbacks);
guard.installTradeCallbacks(callbackResolvedByDi);
const activeCallbackUsedByRouter = new MockTradeCallbacks(activeControllerHeldByTradeCallbacks);
const callbackResult = activeCallbackUsedByRouter.processRagfairTrade(lowCashProfile, {
  Action: 'RagFairBuyOffer',
  offers: [{ id: 'peacekeeper-offer', count: 190775, items: [] }]
}, 'profile-1');
assert.strictEqual(callbackOriginalCalls, 0, 'callback-level preflight must stop an unaffordable request before the controller callback');
assert.ok(callbackResult.warnings.length > 0, 'callback path must preserve preflight rejection');
assert.strictEqual(guard.health.runtime.ragfairCallbackCalls, 1, 'callback runtime counter should increment on separate DI instance');
assert.strictEqual(guard.health.runtime.callbackPreflightBlocks, 1, 'callback-level payment preflight should record a block');

fs.rmSync(temp, { recursive: true, force: true });
console.log('PASS prototype-safe DI hooks across separately constructed SPT instances');
