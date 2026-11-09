'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../src/core');
const { EconomyGuard } = require('../src/engine');

const customMoneyTpl = 'abcdef0123456789abcdef01';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-custom-money-'));
const paymentHelper = { isMoneyTpl: tpl => tpl === customMoneyTpl || core.MONEY_TPLS.has(tpl) };
const guard = new EconomyGuard(__dirname, {
  enabled: true, mode: 'protect', dataDirectory: path.join(temp, 'data'),
  price: {}, flea: {}, trader: {}, storage: { caseRetentionDays: 90 }
}, { info(){}, warn(){}, error(){} }, {
  paymentHelper,
  inventoryConfig: { customMoneyTpls: [customMoneyTpl] }
});

const profile = { Inventory: { items: [
  { _id: 'custom-cash-a', _tpl: customMoneyTpl, upd: { StackObjectsCount: 400 } },
  { _id: 'custom-cash-b', _tpl: customMoneyTpl, upd: { StackObjectsCount: 600 } }
] } };
const instance = { paymentHelper };
const moneyTpls = guard.refreshMoneyTpls(instance, profile, [], [{ _tpl: customMoneyTpl, count: 1000 }]);
assert.strictEqual(moneyTpls.has(customMoneyTpl), true, 'customMoneyTpls from SPT inventory config is discovered');

const availability = core.validatePaymentAvailability([
  { id: 'custom-cash-a', count: 400 },
  { id: 'custom-cash-b', count: 600 }
], profile.Inventory.items, moneyTpls);
assert.strictEqual(availability.valid, true, 'custom currency is aggregated across multiple owned stacks');

const directTplAvailability = core.validatePaymentAvailability([
  { id: customMoneyTpl, count: 900 }
], profile.Inventory.items, moneyTpls);
assert.strictEqual(directTplAvailability.valid, true, 'trusted internal custom-currency TPL requests are checked against real aggregate balance');

const mismatch = core.comparePaymentToRequirements(
  [{ id: 'custom-cash-a', count: 400 }, { id: 'custom-cash-b', count: 599 }],
  profile.Inventory.items,
  [{ _tpl: customMoneyTpl, count: 1000 }], 1, moneyTpls
);
assert.strictEqual(mismatch.valid, false, 'custom money must match exact server-required amount');
assert.strictEqual(mismatch.diffs[0].paid, 999);

const balances = guard.currencyBalances(profile, moneyTpls);
assert.strictEqual(balances[customMoneyTpl], 1000, 'health and evidence balances include SPT custom money');

const gp = '5d235b4d86f7742e017bc88a';
assert.strictEqual(core.MONEY_TPLS.has(gp), true, 'SPT-native GP coin is treated as money');

// SPT ConfigTypes.INVENTORY is the literal key "spt-inventory" in 3.11.1.
let requestedConfigType = null;
const configServerGuard = new EconomyGuard(__dirname, {
  enabled: true, mode: 'protect', dataDirectory: path.join(temp, 'config-data'), storage: {}
}, { info(){}, warn(){}, error(){} }, {
  configServer: { getConfig: type => { requestedConfigType = type; return type === 'spt-inventory' ? { customMoneyTpls: [customMoneyTpl] } : null; } }
});
configServerGuard.refreshMoneyTpls(null, profile, [], []);
assert.strictEqual(requestedConfigType, 'spt-inventory');
assert.strictEqual(configServerGuard.moneyTpls.has(customMoneyTpl), true, 'custom currency discovery uses the exact SPT 3.11.1 Inventory config type');

const largeCurrencyByOneStackId = core.comparePaymentToRequirements(
  [{ id: 'custom-cash-a', count: 900 }], profile.Inventory.items,
  [{ _tpl: customMoneyTpl, count: 900 }], 1, moneyTpls
);
assert.strictEqual(largeCurrencyByOneStackId.valid, true, 'SPT money payment is aggregated by currency TPL, not limited to the referenced stack ID');
const aggregateAvailable = core.validatePaymentAvailability(
  [{ id: 'custom-cash-a', count: 900 }], profile.Inventory.items, moneyTpls
);
assert.strictEqual(aggregateAvailable.valid, true, 'aggregate real balance across custom-money stacks is sufficient');

fs.rmSync(temp, { recursive: true, force: true });
console.log('PASS SPT GP and customMoneyTpl payment handling');
