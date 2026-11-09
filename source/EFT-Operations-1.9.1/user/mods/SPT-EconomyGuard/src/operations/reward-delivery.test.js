'use strict';

const assert = require('assert');
const { RewardDeliveryService, ROUBLE_TPL } = require('./reward-delivery');

let idCounter = 1;
const hashUtil = { generate() { return String(idCounter++).padStart(24, '0'); } };
const templates = {
    [ROUBLE_TPL]: { _props: { StackMaxSize: 500000 } },
    'abcdef0123456789abcdef01': { _props: { StackMaxSize: 20 } },
    'abcdef0123456789abcdef02': { _props: { StackMaxSize: 1 } }
};
const award = {
    id: 'award-1', groupId: 'group-1', missionId: 'mission-1', profileId: 'profile-1',
    points: 50, roubles: 600000,
    items: [{ tpl: 'abcdef0123456789abcdef01', count: 25 }, { tpl: 'abcdef0123456789abcdef02', count: 1 }],
    status: 'pending_delivery'
};
const operations = {
    state: { awards: [award], missions: [{ id: 'mission-1', title: 'Woods Sweep' }] },
    persistCalls: 0,
    persist() { this.persistCalls++; }
};
const mailCalls = [];
const service = new RewardDeliveryService({
    operations,
    saveServer: { getProfiles() { return { 'session-1': { characters: { pmc: { _id: 'profile-1' }, scav: { _id: 'scav-1' } } } }; } },
    mailSendService: { sendSystemMessageToPlayer(...args) { mailCalls.push(args); } },
    hashUtil,
    databaseService: { getItems() { return templates; } },
    logger: { warn() {} }
});

const delivered = service.deliverGroup('group-1');
assert.equal(delivered.length, 1);
assert.equal(delivered[0].status, 'delivered');
assert.equal(award.status, 'delivered');
assert.equal(award.deliveryMethod, 'system_mail');
assert.equal(award.deliveredItemCount, 5, '600k roubles split into two stacks, 25 stackable items into two stacks, plus one non-stackable');
assert.equal(mailCalls.length, 1);
assert.equal(mailCalls[0][0], 'session-1');
assert.match(mailCalls[0][1], /Woods Sweep/);
assert.equal(mailCalls[0][2].length, 5);
assert.equal(mailCalls[0][2][0]._tpl, ROUBLE_TPL);
assert.equal(mailCalls[0][2][0].upd.StackObjectsCount, 500000);
assert.equal(mailCalls[0][2][1].upd.StackObjectsCount, 100000);
assert.equal(mailCalls[0][3], 604800);
assert.equal(service.deliverGroup('group-1').length, 0, 'delivered awards must never be mailed twice');
assert.equal(mailCalls.length, 1);

// Missing templates must fail closed without sending a partial reward.
const badAward = { id: 'award-2', groupId: 'group-2', missionId: 'mission-1', profileId: 'profile-1', points: 10,
    roubles: 0, items: [{ tpl: 'abcdef0123456789abcdef99', count: 1 }], status: 'pending_delivery' };
operations.state.awards.push(badAward);
const bad = service.deliverGroup('group-2');
assert.equal(bad[0].status, 'delivery_attention_required');
assert.equal(badAward.status, 'delivery_attention_required');
assert.equal(mailCalls.length, 1);
assert.equal(service.deliverGroup('group-2').length, 0, 'attention-required awards are not retried automatically');

// If the mail transport fails, the in-flight marker and error are recorded and no automatic retry occurs.
const failedAward = { id: 'award-3', groupId: 'group-3', missionId: 'mission-1', profileId: 'profile-1', points: 10,
    roubles: 100, items: [], status: 'pending_delivery' };
operations.state.awards.push(failedAward);
const failing = new RewardDeliveryService({
    operations,
    saveServer: { getProfiles() { return { 'session-1': { characters: { pmc: { _id: 'profile-1' } } } }; } },
    mailSendService: { sendSystemMessageToPlayer() { throw new Error('mail unavailable'); } },
    hashUtil,
    databaseService: { getItems() { return templates; } },
    logger: { warn() {} }
});
const failure = failing.deliverGroup('group-3');
assert.equal(failure[0].status, 'delivery_attention_required');
assert.equal(failedAward.deliveryAttempt, 1);
assert.match(failedAward.deliveryError, /mail unavailable/);
assert.equal(failing.deliverGroup('group-3').length, 0);

// Manual reconciliation is explicit and audited. A retry is never automatic.
assert.equal(failing.reconcileAward('award-3', 'retry', 'Checked mailbox; no reward message exists').status, 'delivery_attention_required');
assert.equal(failedAward.deliveryAttempt, 2, 'manual retry creates a second recorded attempt');
assert.equal(failedAward.deliveryReconciliation.decision, 'retry');
assert.throws(() => failing.reconcileAward('award-3', 'retry', ''), /DELIVERY_RECONCILIATION_NOTE_REQUIRED/);
assert.equal(failing.reconcileAward('award-3', 'mark_delivered', 'Verified in-game mail was received').status, 'delivered');
assert.equal(failedAward.deliveryMethod, 'admin_reconciled');
assert.equal(failedAward.deliveryReconciliation.decision, 'mark_delivered');

// Points-only awards do not require SPT mail or inventory services.
const pointsAward = { id: 'award-4', groupId: 'group-4', missionId: 'mission-1', profileId: 'offline-profile', points: 5,
    roubles: 0, items: [], status: 'pending_delivery' };
operations.state.awards.push(pointsAward);
const pointsOnly = new RewardDeliveryService({ operations, logger: { warn() {} } });
assert.equal(pointsOnly.deliverGroup('group-4')[0].status, 'delivered');
assert.equal(pointsAward.deliveryMethod, 'points_only');

console.log('RewardDeliveryService: all tests passed');
