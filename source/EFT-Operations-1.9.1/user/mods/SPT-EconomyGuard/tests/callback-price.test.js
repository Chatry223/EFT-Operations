'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');

const RUB = '5449016a4bdc2d6f028b456f';
const tpl = 'price-test-item';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-callback-price-'));
const cfg = {
  enabled: true, mode: 'protect', dataDirectory: dir,
  price: { maxOvervalueRatio: 20, minUndervalueRatio: 0.05, referenceDisagreementRatio: 5, allowSingleReferenceSourceForBlocking: false, minimumReferenceRoubles: 100 },
  flea: { blockExtremePrice: true }, storage: { auditRetentionDays: 60, ledgerRetentionDays: 180, caseRetentionDays: 90 }
};
const guard = new EconomyGuard(__dirname, cfg, { info(){}, warn(){}, error(){} }, {});
const offer = {
  _id: 'offer-1', quantity: 20, sellInOnePiece: false,
  user: { id: 'seller-profile', memberType: 0 },
  items: [{ _id: 'root-1', _tpl: tpl, upd: { StackObjectsCount: 20 } }],
  requirements: [{ _tpl: RUB, count: 500 }], requirementsCost: 500
};
const tradeController = {
  ragfairServer: { getOffer: id => id === 'offer-1' ? offer : null },
  databaseService: { getPrices: () => ({ [tpl]: 10 }), getItems: () => ({ [tpl]: { _id: tpl } }) },
  handbookHelper: { getTemplatePrice: () => 10, inRUB: n => n },
  itemHelper: { getItemQualityModifierForItems: () => 1 },
  ragfairOfferService: { getOffersOfType: () => [] },
  ragfairOfferHelper: { offerIsFromTrader: () => false }
};
const callbacks = { tradeController };
const profile = { id: 'buyer-profile', Inventory: { items: [
  { _id: 'cash', _tpl: RUB, upd: { StackObjectsCount: 20000 } }
] } };
const result = guard.checkRagfairCallbackOffer(callbacks, profile, {
  id: 'offer-1', count: 20, items: [{ id: 'cash', count: 10000 }]
}, 'buyer-profile');
assert.strictEqual(result.valid, true);
assert.strictEqual(result.priceCheck.known, true);
assert.strictEqual(result.priceCheck.blockable, true);
assert.strictEqual(result.priceCheck.reason, 'FLEA_PRICE_TOO_HIGH');
assert.strictEqual(result.priceCheck.ratio, 50);
assert.strictEqual(result.requestedAssetValue, 200);

const unknownTpl = 'custom-no-price';
const unknownOffer = {
  ...offer, _id: 'offer-unknown',
  items: [{ _id: 'root-2', _tpl: unknownTpl, upd: { StackObjectsCount: 1 } }]
};
tradeController.ragfairServer.getOffer = id => id === 'offer-unknown' ? unknownOffer : offer;
tradeController.databaseService.getPrices = () => ({});
tradeController.databaseService.getItems = () => ({ [unknownTpl]: { _id: unknownTpl } });
tradeController.handbookHelper.getTemplatePrice = () => 0;
const unknown = guard.checkRagfairCallbackOffer(callbacks, profile, {
  id: 'offer-unknown', count: 20, items: [{ id: 'cash', count: 10000 }]
}, 'buyer-profile');
assert.strictEqual(unknown.valid, true, 'unknown custom item remains purchasable when exact payment is valid');
assert.strictEqual(unknown.priceCheck.blockable, false);
assert.strictEqual(unknown.priceCheck.known, false);

// Partial player offer: SPT reduces offer.quantity after partial sales, while the original
// root StackObjectsCount may remain unchanged. A valid remaining partial purchase is not ambiguous.
const partialOffer = {
  ...offer, _id: 'offer-partial', quantity: 50,
  items: [{ _id: 'partial-root', _tpl: tpl, upd: { StackObjectsCount: 100 } }],
  requirements: [{ _tpl: RUB, count: 10 }], requirementsCost: 10
};
tradeController.ragfairServer.getOffer = id => id === 'offer-partial' ? partialOffer : null;
tradeController.databaseService.getPrices = () => ({ [tpl]: 10 });
tradeController.databaseService.getItems = () => ({ [tpl]: { _id: tpl } });
tradeController.handbookHelper.getTemplatePrice = () => 10;
const partial = guard.checkRagfairCallbackOffer(callbacks, profile, {
  id: 'offer-partial', count: 20, items: [{ id: 'cash', count: 200 }]
}, 'buyer-profile');
assert.strictEqual(partial.quantityRepresentationMatches, true);
assert.strictEqual(partial.requestedAssetValue, 200);
assert.strictEqual(partial.priceCheck.known, true);

// Trader-origin unlimited offers can expose a 9,999,999 sentinel StackObjectsCount.
// The guard values the item tree as one unit, then scales by requested quantity.
const traderTpl = 'trader-offer-root';
const childTpl = 'trader-offer-child';
const unlimitedTraderOffer = {
  _id: 'offer-trader-unlimited', quantity: 9999999, unlimitedCount: true, sellInOnePiece: false,
  user: { id: '5935c25fb3acc3127c3d8cd9', memberType: 4 },
  items: [
    { _id: 'trader-root', _tpl: traderTpl, upd: { StackObjectsCount: 9999999 } },
    { _id: 'trader-child', _tpl: childTpl, parentId: 'trader-root', slotId: 'mod_scope' }
  ],
  requirements: [{ _tpl: RUB, count: 100 }], requirementsCost: 100
};
tradeController.ragfairServer.getOffer = id => id === 'offer-trader-unlimited' ? unlimitedTraderOffer : null;
tradeController.databaseService.getPrices = () => ({ [traderTpl]: 10, [childTpl]: 4 });
tradeController.databaseService.getItems = () => ({ [traderTpl]: { _id: traderTpl }, [childTpl]: { _id: childTpl } });
tradeController.handbookHelper.getTemplatePrice = id => id === traderTpl ? 10 : id === childTpl ? 4 : 0;
tradeController.ragfairOfferHelper.offerIsFromTrader = x => Number(x.user && x.user.memberType) === 4;
const traderUnlimited = guard.checkRagfairCallbackOffer(callbacks, profile, {
  id: 'offer-trader-unlimited', count: 10, items: [{ id: 'cash', count: 1000 }]
}, 'buyer-profile');
assert.strictEqual(traderUnlimited.unlimitedTrader, true);
assert.strictEqual(traderUnlimited.quantityRepresentationMatches, true);
assert.strictEqual(traderUnlimited.requestedAssetValue, 140, 'unit root plus included child value is multiplied by requested quantity, not sentinel stock');
assert.strictEqual(traderUnlimited.expectedPayment.value, 1000);

// A PACK is one indivisible package: its server requirement and full package content are compared once.
const packOffer = {
  ...offer, _id: 'offer-pack', quantity: 60, sellInOnePiece: true,
  items: [{ _id: 'pack-root', _tpl: tpl, upd: { StackObjectsCount: 60 } }],
  requirements: [{ _tpl: RUB, count: 600 }], requirementsCost: 600
};
tradeController.ragfairServer.getOffer = id => id === 'offer-pack' ? packOffer : null;
tradeController.databaseService.getPrices = () => ({ [tpl]: 10 });
tradeController.databaseService.getItems = () => ({ [tpl]: { _id: tpl } });
tradeController.handbookHelper.getTemplatePrice = () => 10;
const pack = guard.checkRagfairCallbackOffer(callbacks, profile, {
  id: 'offer-pack', count: 60, items: [{ id: 'cash', count: 600 }]
}, 'buyer-profile');
assert.strictEqual(pack.sellInOnePiece, true);
assert.strictEqual(pack.expectedPayment.value, 600);
assert.strictEqual(pack.requestedAssetValue, 600);
assert.strictEqual(pack.priceCheck.ratio, 1);

// onlyFunctional requirements retain exact payment checks but cannot produce a hard price verdict.
const functionalOffer = {
  ...offer, _id: 'offer-functional', quantity: 1,
  requirements: [{ _tpl: tpl, count: 1, onlyFunctional: true }]
};
tradeController.ragfairServer.getOffer = id => id === 'offer-functional' ? functionalOffer : null;
const functional = guard.checkRagfairCallbackOffer(callbacks, profile, {
  id: 'offer-functional', count: 1, items: [{ id: 'cash', count: 1 }]
}, 'buyer-profile');
assert.strictEqual(functional.expectedPayment.complete, false);
assert.strictEqual(functional.priceCheck.blockable, false);


// Explicitly free SPT offers remain valid; an empty requirement list is not malformed when requirementsCost is zero.
const freeOffer = { ...offer, _id: 'offer-free', quantity: 1, requirements: [], requirementsCost: 0 };
tradeController.ragfairServer.getOffer = id => id === 'offer-free' ? freeOffer : null;
const free = guard.checkRagfairCallbackOffer(callbacks, profile, { id: 'offer-free', count: 1, items: [] }, 'buyer-profile');
assert.strictEqual(free.valid, true);
assert.strictEqual(free.explicitlyFree, true);
assert.strictEqual(free.code, null);

const freeDirect = guard.checkFleaPurchase({
  ragfairServer: { getOffers: () => [freeOffer] },
  databaseService: tradeController.databaseService,
  handbookHelper: tradeController.handbookHelper,
  itemHelper: tradeController.itemHelper,
  ragfairOfferService: tradeController.ragfairOfferService,
  ragfairOfferHelper: { offerIsFromTrader: () => false }
}, profile, { item_id: 'offer-free', count: 1, scheme_items: [] }, 'buyer-profile');
assert.strictEqual(freeDirect.blockPayment, false);

// Invalid server-side payment requirements are structurally invalid, not silently ignored.
const malformedOffer = { ...offer, _id: 'offer-malformed', requirements: [{ _tpl: RUB, count: 0 }], requirementsCost: 0 };
tradeController.ragfairServer.getOffer = id => id === 'offer-malformed' ? malformedOffer : null;
const malformed = guard.checkRagfairCallbackOffer(callbacks, profile, {
  id: 'offer-malformed', count: 1, items: [{ id: 'cash', count: 1 }]
}, 'buyer-profile');
assert.strictEqual(malformed.valid, false);
assert.strictEqual(malformed.code, 'FLEA_PAYMENT_REQUIREMENTS_UNKNOWN');

fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS callback price valuation blocks only trusted extreme offers and leaves unknown custom items unblocked');
