'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-native-stock-'));
const cfg = { enabled: true, mode: 'protect', dataDirectory: dir, storage: {} };
const guard = new EconomyGuard(__dirname, cfg, { info(){}, warn(){}, error(){} }, {});
const stockItem = { _id: 'assort-item', _tpl: 'tpl-item', upd: { StackObjectsCount: 50 } };
const instance = {
  traderHelper: { getTraderAssortsByTraderId: () => ({ items: [stockItem] }) },
  itemHelper: { hasBuyRestrictions: () => false }
};
let check = guard.checkNativeTraderPurchase(instance, {}, { type: 'buy_from_trader', tid: 'trader', item_id: 'assort-item', count: 51 }, 'profile');
assert.strictEqual(check.valid, false);
assert.strictEqual(check.code, 'TRADER_STOCK_INSUFFICIENT');
check = guard.checkNativeTraderPurchase(instance, {}, { type: 'buy_from_trader', tid: 'trader', item_id: 'assort-item', count: 50 }, 'profile');
assert.strictEqual(check.valid, true);

instance.itemHelper.hasBuyRestrictions = () => true;
instance.checkPurchaseIsWithinTraderItemLimit = () => { throw new Error('BUY_RESTRICTION_EXCEEDED'); };
check = guard.checkNativeTraderPurchase(instance, {}, { type: 'buy_from_trader', tid: 'trader', item_id: 'assort-item', count: 1 }, 'profile');
assert.strictEqual(check.valid, false);
assert.strictEqual(check.code, 'TRADER_BUY_RESTRICTION_EXCEEDED');
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS native Trader stock and account buy-restriction preflight');
