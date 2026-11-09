'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');

function createGuardAndCallback(profile, offerQuantity = 190775) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-ragfair-v104-'));
  const config = {
    enabled: true, mode: 'protect', dataDirectory: path.join(temp, 'data'),
    trader: { blockInsufficientFunds: true },
    flea: { blockPaymentMismatch: true },
    notifications: {
      enabled: true, prefix: 'BRONSON IS WATCHING YOU', separator: '\n', includeCaseId: true,
      messages: {}
    },
    storage: { maxFileSizeMb: 1, auditRetentionDays: 60, ledgerRetentionDays: 180, caseRetentionDays: 0 }
  };
  const logger = { info(){}, warn(){}, error(){} };
  const guard = new EconomyGuard(__dirname, config, logger, {});
  let originalCalls = 0;
  const outputHolder = { getOutput: () => ({ warnings: [] }) };
  const controller = {
    ragfairServer: {
      getOffer: id => id === 'offer-1' ? {
        _id: 'offer-1',
        root: 'usd-root',
        quantity: offerQuantity,
        sellInOnePiece: false,
        requirementsCost: 438,
        requirements: [{ _tpl: '5449016a4bdc2d6f028b456f', count: 437.85 }],
        user: { id: '5935c25fb3acc3127c3d8cd9', memberType: 4 },
        items: [{ _id: 'usd-root', _tpl: '5696686a4bdc2da3298b456a', upd: { StackObjectsCount: offerQuantity } }]
      } : null
    },
    eventOutputHolder: outputHolder,
    httpResponse: { appendErrorToOutput(out, message) { out.warnings.push({ errmsg: message }); return out; } },
    confirmRagfairTrading() { originalCalls++; return { warnings: [] }; }
  };
  const callbacks = {
    tradeController: controller,
    processRagfairTrade(pmc, body, session) { return controller.confirmRagfairTrading(pmc, body, session); }
  };
  guard.installTradeCallbacks(callbacks);
  return { guard, callbacks, controller, temp, getOriginalCalls: () => originalCalls, profile };
}

const rub = '5449016a4bdc2d6f028b456f';
const lowCash = { Inventory: { items: [
  { _id: 'rub-stack', _tpl: rub, upd: { StackObjectsCount: 1044411 } }
] } };

{
  const ctx = createGuardAndCallback(lowCash);
  const output = ctx.callbacks.processRagfairTrade(lowCash, {
    Action: 'RagFairBuyOffer',
    offers: [{ id: 'offer-1', count: 190775, items: [] }]
  }, 'profile-low');
  assert.strictEqual(ctx.getOriginalCalls(), 0, 'empty payment items must block before SPT controller');
  assert.match(output.warnings[0].errmsg, /^BRONSON IS WATCHING YOU\n/);
  const records = fs.readFileSync(path.join(ctx.temp, 'data', 'logs', 'audit-' + new Date().toISOString().slice(0,7) + '.jsonl'), 'utf8');
  assert.match(records, /FLEA_MISSING_PAYMENT_ITEMS/);
  assert.doesNotMatch(records, /INSUFFICIENT_FLEA_FUNDS/);
  fs.rmSync(ctx.temp, { recursive: true, force: true });
}

{
  const profile = { Inventory: { items: [
    { _id: 'rub-stack', _tpl: rub, upd: { StackObjectsCount: 100000000 } }
  ] } };
  const ctx = createGuardAndCallback(profile);
  const output = ctx.callbacks.processRagfairTrade(profile, {
    Action: 'RagFairBuyOffer',
    offers: [{ id: 'offer-1', count: 190775, items: [{ id: 'rub-stack', count: 438 }] }]
  }, 'profile-underpay');
  assert.strictEqual(ctx.getOriginalCalls(), 0, 'one-item payment must not satisfy 190775 item purchase');
  assert.match(output.warnings[0].errmsg, /BRONSON IS WATCHING YOU/);
  fs.rmSync(ctx.temp, { recursive: true, force: true });
}

{
  const profile = { Inventory: { items: [
    { _id: 'rub-stack', _tpl: rub, upd: { StackObjectsCount: 100000000 } }
  ] } };
  const ctx = createGuardAndCallback(profile);
  const output = ctx.callbacks.processRagfairTrade(profile, {
    Action: 'RagFairBuyOffer',
    offers: [{ id: 'offer-1', count: 190775, items: [{ id: 'rub-stack', count: 83530834 }] }]
  }, 'profile-valid');
  assert.strictEqual(ctx.getOriginalCalls(), 1, 'exact server-required payment with sufficient funds must pass');
  assert.strictEqual(output.warnings.length, 0);
  fs.rmSync(ctx.temp, { recursive: true, force: true });
}

{
  const profile = { Inventory: { items: [
    { _id: 'rub-stack', _tpl: rub, upd: { StackObjectsCount: 1044411 } }
  ] } };
  const ctx = createGuardAndCallback(profile);
  const output = ctx.callbacks.processRagfairTrade(profile, {
    Action: 'RagFairBuyOffer',
    offers: [{ id: 'offer-1', count: 190775, items: [{ id: 'rub-stack', count: 83530834 }] }]
  }, 'profile-insufficient');
  assert.strictEqual(ctx.getOriginalCalls(), 0, 'correct requirement with insufficient balance must block');
  assert.match(output.warnings[0].errmsg, /BRONSON IS WATCHING YOU/);
  fs.rmSync(ctx.temp, { recursive: true, force: true });
}


{
  const userTraceProfile = { Inventory: { items: [
    { _id: 'rub-stack', _tpl: rub, upd: { StackObjectsCount: 959940 } },
    { _id: 'usd-stack', _tpl: '5696686a4bdc2da3298b456a', upd: { StackObjectsCount: 4904611 } }
  ] } };
  const ctx = createGuardAndCallback(userTraceProfile, 4904611);
  // The user trace had a trader-origin offer for 4,904,611 items at 437.85 RUB each.
  const output = ctx.callbacks.processRagfairTrade(userTraceProfile, {
    Action: 'RagFairBuyOffer',
    offers: [{ id: 'offer-1', count: 4904611, items: [] }]
  }, 'profile-user-trace');
  assert.strictEqual(ctx.getOriginalCalls(), 0, 'missing payment entries must block the exact user exploit trace');
  assert.match(output.warnings[0].errmsg, /2,147,483,926 RUB/);
  assert.match(output.warnings[0].errmsg, /959,940 RUB/);
  const caseDir = path.join(ctx.temp, 'data', 'cases');
  const caseFile = fs.readdirSync(caseDir).find(name => name.endsWith('.json'));
  const record = JSON.parse(fs.readFileSync(path.join(caseDir, caseFile), 'utf8'));
  assert.strictEqual(record.type, 'FLEA_MISSING_PAYMENT_ITEMS');
  assert.strictEqual(record.evidence.currencyShortfalls[0].required, 2147483926);
  assert.strictEqual(record.evidence.currencyShortfalls[0].available, 959940);
  assert.strictEqual(record.evidence.availability, null, 'empty submitted payment must not be mislabeled as funds-valid');
  assert.strictEqual(record.evidence.paymentStatus, 'MISSING_PAYMENT_ITEMS');
  fs.rmSync(ctx.temp, { recursive: true, force: true });
}

console.log('PASS v1.0.4 Flea callback exact payment preflight (empty, underpay, exact, insufficient, exact user trace)');
