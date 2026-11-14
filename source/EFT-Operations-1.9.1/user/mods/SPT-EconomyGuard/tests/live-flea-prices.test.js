'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-live-flea-prices-'));
const tpl = 'live-flea-prices-item-0001';
const priceTable = { [tpl]: 1000 };
let dynamicCache = { [tpl]: 1000 };
let refreshCount = 0;
const instance = {
    databaseService: {
        getPrices() { return priceTable; },
        getItems() { return { [tpl]: { _id: tpl, _type: 'Item' } }; }
    },
    handbookHelper: { getTemplatePrice(id) { return id === tpl ? 1000 : 0; } },
    ragfairPriceService: {
        getDynamicPriceForItem(id) { return dynamicCache[id] || 0; },
        refreshDynamicPrices() { dynamicCache = { ...priceTable }; refreshCount++; }
    }
};
const guard = new EconomyGuard(root, {
    enabled: true, mode: 'audit', dataDirectory: path.join(root, 'data'),
    storage: {}, price: { referenceDisagreementRatio: 5 }, flea: {}
}, { info() {}, warn() {}, error() {} }, {});

try {
    let ref = guard.getPriceSources(tpl, instance);
    assert.equal(ref.source, 'ragfair-dynamic');
    assert.equal(ref.value, 1000);

    // Mirrors LiveFleaPrices: write the updated DB prices table, then refresh
    // SPT's dynamic-price cache. EconomyGuard must consume that refreshed value.
    priceTable[tpl] = 4000;
    instance.ragfairPriceService.refreshDynamicPrices();
    ref = guard.getPriceSources(tpl, instance);
    assert.equal(refreshCount, 1);
    assert.equal(ref.source, 'ragfair-dynamic');
    assert.equal(ref.dynamicRaw, 4000);
    assert.equal(ref.value, 4000);
    assert.equal(ref.confidence, 'HIGH');

    // If a dynamic cache has not refreshed or returns SPT's 1-RUB sentinel,
    // EconomyGuard falls back to the actual database price table and does not
    // mistake the sentinel for a trusted price.
    dynamicCache[tpl] = 1;
    ref = guard.getPriceSources(tpl, instance);
    assert.equal(ref.dynamicRaw, 1);
    assert.equal(ref.marketRaw, 4000);
    assert.equal(ref.value, 4000);
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write('LiveFleaPrices dynamic-price integration tests passed.\\n');
