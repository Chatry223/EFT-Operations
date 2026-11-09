'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');
const core = require('../src/core');

const RUB = '5449016a4bdc2d6f028b456f';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-bulk-price-'));
const cfg = {
  enabled: true, mode: 'protect', dataDirectory: tmp,
  price: { maxOvervalueRatio: 20, minUndervalueRatio: 0.05, referenceDisagreementRatio: 5, allowSingleReferenceSourceForBlocking: false, minimumReferenceRoubles: 100, unknownItemReviewThresholdRoubles: 1000000 },
  flea: {}, storage: { auditRetentionDays: 60, ledgerRetentionDays: 180, caseRetentionDays: 90 }
};
const guard = new EconomyGuard(__dirname, cfg, { info(){}, warn(){}, error(){} }, {});
const tpl = 'custom-ammo-tpl-0001';
const prices = { [tpl]: 100 };
const dbItems = { [tpl]: { _id: tpl, _type: 'Item', _props: { StackMaxSize: 60 } } };
const activeOffers = [];
const instance = {
  databaseService: { getPrices: () => prices, getItems: () => dbItems },
  handbookHelper: { getTemplatePrice: id => id === tpl ? 100 : 0, inRUB: x => x },
  itemHelper: { getItemQualityModifierForItems: () => 1 },
  ragfairConfig: { dynamic: { itemPriceMultiplier: {} } },
  ragfairOfferService: { getOffersOfType: () => activeOffers },
  ragfairOfferHelper: { offerIsFromTrader: offer => Number(offer.user && offer.user.memberType) === 4 },
  ragfairTaxService: { calculateTax: () => 50 }
};
function inv(ids, count=60) {
  return ids.map((id, i) => ({ _id: id, _tpl: tpl, parentId: 'hideout', upd: { StackObjectsCount: count } }));
}

// Ten selected 60-round stacks are 600 units. SPT 3.11 treats non-pack listing price as per-unit.
const profile = { Inventory: { items: inv(Array.from({length:10}, (_,i)=>`ammo-${i}`)) } };
const normalBulk = guard.checkFleaListing(instance, profile, {
  items: Array.from({length:10}, (_,i)=>`ammo-${i}`),
  requirements: [{ _tpl: RUB, count: 500 }],
  sellInOnePiece: false
});
assert.strictEqual(normalBulk.quantity, 600);
assert.strictEqual(normalBulk.askUnitPriceRub, 500);
assert.strictEqual(normalBulk.referenceUnitRub, 100);
assert.strictEqual(normalBulk.priceCheck.ratio, 5);
assert.strictEqual(normalBulk.blockPrice, false, 'normal bulk listing must not be compared against total stack reference as if it were unit price');
assert.strictEqual(normalBulk.askTotalPriceRub, 300000);
assert.strictEqual(normalBulk.taxEstimateRub, 50);

// Pack price is total package price and is compared against total package value.
const packProfile = { Inventory: { items: inv(['pack-ammo'], 600) } };
const pack = guard.checkFleaListing(instance, packProfile, {
  items: ['pack-ammo'], requirements: [{ _tpl: RUB, count: 60000 }], sellInOnePiece: true
});
assert.strictEqual(pack.pack, true);
assert.strictEqual(pack.askTotalPriceRub, 60000);
assert.strictEqual(pack.referenceTotalRub, 60000);
assert.strictEqual(pack.priceCheck.ratio, 1);
assert.strictEqual(pack.blockPrice, false);

// Unknown custom templates stay UNKNOWN and are not auto-blocked.
const unknownInstance = {
  ...instance,
  databaseService: { getPrices: () => ({}), getItems: () => ({ 'custom-rig': { _id: 'custom-rig', _type: 'Item' } }) },
  handbookHelper: { getTemplatePrice: () => 0, inRUB: x => x },
  ragfairOfferService: { getOffersOfType: () => [] }
};
const unknown = guard.checkFleaListing(unknownInstance, { Inventory: { items: [{ _id:'rig-1', _tpl:'custom-rig', parentId:'hideout' }] } }, {
  items: ['rig-1'], requirements: [{ _tpl: RUB, count: 2500000 }], sellInOnePiece: false
});
assert.strictEqual(unknown.asset.complete, false);
assert.strictEqual(unknown.priceCheck.known, false);
assert.strictEqual(unknown.blockPrice, false, 'unknown WTT/custom item must not be auto-blocked just because its reference is absent');

// A non-pack multi listing with mixed templates is structurally ambiguous in SPT 3.11 and is blocked.
const mixed = guard.checkFleaListing(instance, { Inventory: { items: [
  { _id:'a', _tpl:tpl, parentId:'hideout', upd:{ StackObjectsCount:60 } },
  { _id:'b', _tpl:'another-tpl', parentId:'hideout', upd:{ StackObjectsCount:1 } }
] } }, { items:['a','b'], requirements:[{_tpl:RUB,count:100}], sellInOnePiece:false });
assert.strictEqual(mixed.blockStructural, true);
assert.ok(mixed.structuralProblems.some(x => x.reason === 'MULTI_OFFER_MIXED_TEMPLATE_IDS'));

// Active offers are context-only and require enough independent sellers.
activeOffers.push(...[
  [400,'s1'], [450,'s2'], [500,'s3'], [550,'s4'], [600,'s5']
].map(([value,seller]) => ({ user:{ id:seller, memberType:0 }, requirements:[{_tpl:RUB,count:value}], requirementsCost:value, sellInOnePiece:false, items:[{_id:`${seller}-offer`,_tpl:tpl,upd:{StackObjectsCount:60}}] })));
const market = guard.getMarketEvidence(instance, tpl);
assert.strictEqual(market.known, true);
assert.strictEqual(market.median, 500);
assert.strictEqual(market.sellerCount, 5);

// Active offers are context-only and must not silently downgrade a high-confidence server reference.
// This prevents a group of fabricated listings from overriding the database/Handbook price.
const contextConfig = { ...cfg, price: { ...cfg.price, maxOvervalueRatio: 2 } };
const contextGuard = new EconomyGuard(__dirname, contextConfig, { info(){}, warn(){}, error(){} }, {});
const context = contextGuard.checkFleaListing(instance, { Inventory: { items: [{_id:'one',_tpl:tpl,parentId:'hideout',upd:{StackObjectsCount:1}}] } }, {
  items:['one'], requirements:[{_tpl:RUB,count:500}], sellInOnePiece:false
});
assert.strictEqual(context.priceCheck.suspicious, true);
assert.strictEqual(context.marketRatio, 1);
assert.strictEqual(context.blockPrice, true);

// Core math helpers are independently deterministic.
const qty = core.rootStackQuantity(['a','b'], inv(['a','b'],60));
assert.strictEqual(qty.valid, true);
assert.strictEqual(qty.total, 120);
assert.strictEqual(core.median([400,450,500,550,600]), 500);
fs.rmSync(tmp, { recursive:true, force:true });
console.log('PASS bulk listing normalization, pack pricing, unknown custom safety, structural validation and market context tests');
