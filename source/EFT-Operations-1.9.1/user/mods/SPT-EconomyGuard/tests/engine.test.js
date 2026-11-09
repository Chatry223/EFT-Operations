'use strict';

const assert = require('assert');
const core = require('../src/core');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; process.stdout.write(`PASS ${name}\n`); }
    catch (err) { process.stderr.write(`FAIL ${name}: ${err.stack || err.message}\n`); process.exitCode = 1; }
}

const priceConfig = { maxOvervalueRatio: 20, minUndervalueRatio: 0.05 };
test('normal 1.5x flea price remains allowed', () => {
    const r = core.comparePriceToReference(15000, 10000, priceConfig);
    assert.strictEqual(r.suspicious, false);
});
test('extreme high price is suspicious', () => {
    const r = core.comparePriceToReference(5000000, 10000, priceConfig);
    assert.strictEqual(r.reason, 'FLEA_PRICE_TOO_HIGH');
});
test('extreme low price is suspicious', () => {
    const r = core.comparePriceToReference(100, 10000, priceConfig);
    assert.strictEqual(r.reason, 'FLEA_PRICE_TOO_LOW');
});
test('unknown reference never becomes a price verdict', () => {
    const r = core.comparePriceToReference(1000000, 0, priceConfig);
    assert.strictEqual(r.known, false);
    assert.strictEqual(r.suspicious, false);
});
test('single reference floor can be enforced by caller', () => {
    const r = core.comparePriceToReference(100000, 1000, priceConfig);
    assert.strictEqual(r.ratio, 100);
});

test('payment IDs resolve to actual inventory template IDs', () => {
    const inventory = [{ _id: 'stackA', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 50000 } }];
    const p = core.aggregatePaymentItems([{ id: 'stackA', count: 25000 }], inventory);
    assert.strictEqual(p.problems.length, 0);
    assert.strictEqual(p.totals.get('5449016a4bdc2d6f028b456f'), 25000);
});
test('unknown non-money payment ID is rejected', () => {
    const p = core.aggregatePaymentItems([{ id: 'notOwned', count: 1 }], []);
    assert.strictEqual(p.problems[0].reason, 'PAYMENT_ITEM_NOT_OWNED');
});
test('payment above stack quantity is rejected', () => {
    const inventory = [{ _id: 'stackA', _tpl: 'tplA', upd: { StackObjectsCount: 2 } }];
    const p = core.aggregatePaymentItems([{ id: 'stackA', count: 3 }], inventory);
    assert.strictEqual(p.problems[0].reason, 'PAYMENT_EXCEEDS_STACK');
});
test('exact trader scheme payment is accepted', () => {
    const inventory = [{ _id: 'cash', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 100000 } }];
    const r = core.comparePaymentToRequirements([{ id: 'cash', count: 10000 }], inventory, [{ _tpl: '5449016a4bdc2d6f028b456f', count: 10000 }], 1);
    assert.strictEqual(r.valid, true);
});
test('underpayment versus trader scheme is rejected', () => {
    const inventory = [{ _id: 'cash', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 100000 } }];
    const r = core.comparePaymentToRequirements([{ id: 'cash', count: 1000 }], inventory, [{ _tpl: '5449016a4bdc2d6f028b456f', count: 10000 }], 1);
    assert.strictEqual(r.reason, 'PAYMENT_SCHEME_MISMATCH');
});
test('non-money barter item must exist in inventory', () => {
    const r = core.comparePaymentToRequirements([{ id: 'missingBarterItem', count: 1 }], [], [{ _tpl: 'tplBarter', count: 1 }], 1);
    assert.strictEqual(r.valid, false);
});
test('currency partial stack requirement is rounded to whole units', () => {
    const inventory = [{ _id: 'cash', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 100000 } }];
    const r = core.comparePaymentToRequirements([{ id: 'cash', count: 3333 }], inventory, [{ _tpl: '5449016a4bdc2d6f028b456f', count: 10000 }], 1/3);
    assert.strictEqual(r.valid, true);
});

test('purchase funds must exist in real currency stacks, not only in a claimed request', () => {
    const inventory = [
        { _id: 'rubles-1', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 1044411 } },
        { _id: 'dollars-1', _tpl: '5696686a4bdc2da3298b456a', upd: { StackObjectsCount: 4904883 } }
    ];
    const result = core.validatePaymentAvailability([{ id: 'rubles-1', count: 83530834 }], inventory);
    assert.strictEqual(result.valid, false);
    assert.ok(result.problems.some(p => p.reason === 'INSUFFICIENT_CURRENCY'));
});
test('aggregated currency payment across multiple stacks is checked against total balance', () => {
    const inventory = [
        { _id: 'rubles-1', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 500000 } },
        { _id: 'rubles-2', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 500000 } }
    ];
    const result = core.validatePaymentAvailability([
        { id: 'rubles-1', count: 500000 },
        { id: 'rubles-2', count: 500000 }
    ], inventory);
    assert.strictEqual(result.valid, true);
});
test('currency TPL request is accepted only when aggregate real balance is sufficient', () => {
    const insufficient = core.validatePaymentAvailability([
        { id: '5449016a4bdc2d6f028b456f', count: 83530834 }
    ], [{ _id: 'rubles', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 1044411 } }]);
    assert.strictEqual(insufficient.valid, false);
    assert.strictEqual(insufficient.problems[0].reason, 'INSUFFICIENT_CURRENCY');
    const sufficient = core.validatePaymentAvailability([
        { id: '5449016a4bdc2d6f028b456f', count: 90000 }
    ], [{ _id: 'rubles', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 100000 } }]);
    assert.strictEqual(sufficient.valid, true);
});
test('currency payment can span multiple cash stacks even when one referenced stack is smaller', () => {
    const inventory = [
        { _id: 'rubles-1', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 50000 } },
        { _id: 'rubles-2', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 70000 } }
    ];
    const result = core.validatePaymentAvailability([{ id: 'rubles-1', count: 100000 }], inventory);
    assert.strictEqual(result.valid, true);
});
test('duplicate request rows cannot spend the same stack twice', () => {
    const inventory = [{ _id: 'rubles-1', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 50000 } }];
    const result = core.validatePaymentAvailability([
        { id: 'rubles-1', count: 30000 },
        { id: 'rubles-1', count: 30000 }
    ], inventory);
    assert.strictEqual(result.valid, false);
    assert.ok(result.problems.some(p => p.reason === 'INSUFFICIENT_CURRENCY'));
});

test('inventory tree includes parent and nested children once', () => {
    const inv = [
        { _id: 'root', _tpl: 'weapon', parentId: 'hideout' },
        { _id: 'mod1', _tpl: 'scope', parentId: 'root' },
        { _id: 'mod2', _tpl: 'mount', parentId: 'mod1' }
    ];
    const tree = core.itemTree(['root', 'mod1'], inv);
    assert.deepStrictEqual(tree.map(x => x._id), ['root', 'mod1', 'mod2']);
});
test('repeated trades between same pair are detected', () => {
    const now = Date.now();
    const events = Array.from({ length: 4 }, (_, i) => ({ sellerId: 'A', buyerId: 'B', timestamp: now - i * 1000, valueRub: 10000 }));
    const r = core.analyzePairBehavior(events, { sellerId: 'A', buyerId: 'B', timestamp: now, valueRub: 10000 }, { pairWindowMinutes: 10, pairCaseThreshold: 5 });
    assert.strictEqual(r.suspicious, true);
    assert.strictEqual(r.totalTrades, 5);
});
test('bidirectional trade behavior is detected', () => {
    const now = Date.now();
    const events = [
        { sellerId: 'A', buyerId: 'B', timestamp: now - 5000, valueRub: 20000 },
        { sellerId: 'B', buyerId: 'A', timestamp: now - 4000, valueRub: 19000 },
        { sellerId: 'A', buyerId: 'B', timestamp: now - 3000, valueRub: 18000 }
    ];
    const r = core.analyzePairBehavior(events, { sellerId: 'B', buyerId: 'A', timestamp: now, valueRub: 17000 }, { pairWindowMinutes: 10, pairCaseThreshold: 10 });
    assert.strictEqual(r.suspicious, true);
});
test('three-player circulation is detected', () => {
    const now = Date.now();
    const events = [
        { sellerId: 'A', buyerId: 'B', timestamp: now, valueRub: 1 },
        { sellerId: 'B', buyerId: 'C', timestamp: now, valueRub: 1 }
    ];
    const r = core.detectThreePartyCycle(events, { sellerId: 'C', buyerId: 'A', timestamp: now, valueRub: 1 }, 86400000);
    assert.strictEqual(r.detected, true);
});
test('no cycle is reported for a simple one-way trade', () => {
    const r = core.detectThreePartyCycle([], { sellerId: 'A', buyerId: 'B', timestamp: Date.now(), valueRub: 100 }, 86400000);
    assert.strictEqual(r.detected, false);
});


test('currency requirement can be paid by total balance across stacks even when one referenced stack is smaller', () => {
    const inventory = [
        { _id: 'cash-a', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 400 } },
        { _id: 'cash-b', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 600 } }
    ];
    const exactScheme = core.comparePaymentToRequirements([{ id: 'cash-a', count: 900 }], inventory, [
        { _tpl: '5449016a4bdc2d6f028b456f', count: 900 }
    ], 1);
    const actualBalance = core.validatePaymentAvailability([{ id: 'cash-a', count: 900 }], inventory);
    assert.strictEqual(exactScheme.valid, true, 'SPT money is consumed across stacks by TPL');
    assert.strictEqual(actualBalance.valid, true, 'aggregate balance covers the payment');
});

process.stdout.write(`\n${passed} tests passed.\n`);

test('explicit invalid StackObjectsCount never defaults to one', () => {
    assert.strictEqual(core.readStackCount({ upd: {} }).count, 1);
    for (const value of [0, -1, 1.5, 2147483648]) {
        assert.strictEqual(core.readStackCount({ upd: { StackObjectsCount: value } }).valid, false);
    }
    const check = core.validatePaymentAvailability([{ id: 'zero-cash', count: 1 }], [
        { _id: 'zero-cash', _tpl: '5449016a4bdc2d6f028b456f', upd: { StackObjectsCount: 0 } }
    ]);
    assert.strictEqual(check.valid, false);
    assert.ok(check.problems.some(problem => problem.reason === 'INVALID_STACK_COUNT'));
});
