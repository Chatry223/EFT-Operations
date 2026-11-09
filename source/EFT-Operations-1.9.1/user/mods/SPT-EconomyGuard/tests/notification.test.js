'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-notification-'));
const guard = new EconomyGuard(__dirname, {
  enabled: true, mode: 'protect', dataDirectory: dir,
  notifications: { enabled: true, prefix: 'BRONSON IS WATCHING YOU', separator: '\\n', includeCaseId: true,
    messages: { FLEA_MISSING_PAYMENT_ITEMS: 'Purchase blocked. Required: {requiredPayment}.' } },
  storage: { caseRetentionDays: 90 }
}, { info(){}, warn(){}, error(){} }, {});
const message = guard.renderNotification('FLEA_MISSING_PAYMENT_ITEMS', { requiredPaymentText: '100 RUB' }, 'EG-TEST');
assert.ok(message.startsWith('BRONSON IS WATCHING YOU\nPurchase blocked.'), 'prefix and message are separated by a real newline');
assert.ok(message.includes('Required: 100 RUB.\nCase EG-TEST'));
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS custom notification prefix, placeholders and newline rendering');
