'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-controller-'));
const cfg = {
  enabled: true, mode: 'audit', dataDirectory: path.join(temp, 'data'),
  diagnostics: { traceTransactions: true },
  trader: { blockInsufficientFunds: true },
  flea: {}, storage: { maxFileSizeMb: 1 }
};
const logs = [];
const logger = { info: m => logs.push(m), warn: m => logs.push(m), error: m => logs.push(m) };
const guard = new EconomyGuard(__dirname, cfg, logger, {});
let originalCalls = 0;
const output = { warnings: [] };
const controller = {
  eventOutputHolder: { getOutput: () => output },
  ragfairServer: { getOffer: id => ({ _id: id, root: 'usd-root', count: 190775, user: { id: 'peacekeeper-id' }, requirements: [{ _tpl: '5449016a4bdc2d6f028b456f', count: 83530834 }] }) },
  httpResponse: { appendErrorToOutput(out, message) { out.warnings.push({ errmsg: message }); return out; } },
  confirmRagfairTrading() { originalCalls++; return output; },
  confirmTrading() { originalCalls++; return output; }
};
guard.installTradeController(controller);
const profile = { Inventory: { items: [
  { _id: 'rubles', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 1044411 } },
  { _id: 'usd', _tpl: '5696686a4bdc2da3298b456a', upd: { StackObjectsCount: 4904883 } }
] } };
const req = { Action: 'RagFairBuyOffer', offers: [{ id: 'offer-1', count: 190775, items: [{ id: 'rubles', count: 83530834 }] }] };
controller.confirmRagfairTrading(profile, req, 'session-1');
assert.strictEqual(originalCalls, 1, 'audit mode should allow original method to execute');
const auditPath = path.join(cfg.dataDirectory, 'logs');
const auditFiles = fs.readdirSync(auditPath).filter(x => x.startsWith('audit-'));
assert.ok(auditFiles.length > 0, 'ragfair preflight should write transaction trace in audit mode');
const trace = fs.readFileSync(path.join(auditPath, auditFiles[0]), 'utf8');
assert.ok(trace.includes('TRADE_CONTROLLER_RAGFAIR_PURCHASE'), 'trace must identify ragfair purchase controller path');
assert.ok(trace.includes('INSUFFICIENT_CURRENCY'), 'trace must identify the shortfall');
assert.ok(trace.includes('combinedFundsValid'), 'trace must include aggregate payment validation');

// Two individually affordable offers must still be rejected when their combined payment exceeds balance.
const comboReq = { Action: 'RagFairBuyOffer', offers: [
  { id: 'offer-2', count: 1, items: [{ id: 'rubles', count: 600000 }] },
  { id: 'offer-3', count: 1, items: [{ id: 'rubles', count: 600000 }] }
] };
controller.confirmRagfairTrading(profile, comboReq, 'session-1');
assert.strictEqual(originalCalls, 2, 'audit mode should continue after combined shortfall');

cfg.mode = 'protect';
output.warnings.length = 0;
controller.confirmRagfairTrading(profile, req, 'session-1');
assert.strictEqual(originalCalls, 2, 'protect mode must reject before original Ragfair purchase method');
assert.ok(output.warnings.length > 0, 'protect rejection must return a visible warning');

fs.rmSync(temp, { recursive: true, force: true });
console.log('PASS TradeController RagFairBuyOffer preflight diagnostic/block tests');
