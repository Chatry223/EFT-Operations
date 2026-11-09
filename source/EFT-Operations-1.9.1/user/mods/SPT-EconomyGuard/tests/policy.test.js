'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-policy-'));
const profileId = '0123456789abcdef01234567';
const guard = new EconomyGuard(__dirname, {
  enabled:true, mode:'protect', dataDirectory:tmp,
  restrictions:{ enabled:true }, flea:{ maxTrackedEventsInMemory:100 }, storage:{ caseRetentionDays:90 }
}, { info(){}, warn(){}, error(){} }, {});
guard.restrictions = {
  enabled:true,
  players:{
    [profileId]:{
      reason:'Reviewed repeated barter exploit attempts',
      expiresAt:'2099-01-01T00:00:00.000Z',
      rules:[{ tpl:'high-value-item-tpl', channel:'trader-barter', traderId:'trader-a', dailyLimit:1, maxPerTransaction:1 }]
    }
  }
};
const player = { _id:profileId };
let check = guard.checkPlayerPurchasePolicy(player, 'high-value-item-tpl', 1, 'trader-barter', 'trader-a', profileId);
assert.strictEqual(check.valid, true, 'first allowed purchase is within per-day limit');
guard.recordPolicyPurchase(profileId, 'high-value-item-tpl', 1, 'trader-barter', 'trader-a', 'offer-1');
check = guard.checkPlayerPurchasePolicy(player, 'high-value-item-tpl', 1, 'trader-barter', 'trader-a', profileId);
assert.strictEqual(check.valid, false);
assert.strictEqual(check.reason, 'PLAYER_DAILY_PURCHASE_LIMIT');
check = guard.checkPlayerPurchasePolicy(player, 'high-value-item-tpl', 1, 'trader-money', 'trader-a', profileId);
assert.strictEqual(check.valid, true, 'restriction does not spill into a different channel');
check = guard.checkPlayerPurchasePolicy({ _id:'another-profile' }, 'high-value-item-tpl', 1, 'trader-barter', 'trader-a', 'another-profile');
assert.strictEqual(check.valid, true, 'clean profiles have no default daily caps');
fs.rmSync(tmp, { recursive:true, force:true });
console.log('PASS account-specific purchase policy and daily limits tests');
