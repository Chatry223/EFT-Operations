'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./core');
const { Storage } = require('./storage');
const { AccessControl } = require('./access-control');
const MOD_VERSION = require('../package.json').version;

const FENCE_ID = '579dc571d53a0658a154fbec';
const PROFILE_ID_RE = /^[a-f0-9]{24}$/i;

function safeCall(fn, fallback) {
    try { return fn(); } catch (_) { return fallback; }
}

function getProfileId(profile, sessionId) {
    const candidates = [sessionId, profile && profile.id, profile && profile._id];
    return candidates.find(x => typeof x === 'string' && x.length > 0) || 'unknown';
}

// SPT 3.11 resolves injected services/controllers before postDBLoad in some startup paths.
// Patching only the instance returned by container.resolve() can therefore miss the
// TradeController instance already held by TradeCallbacks. Class methods live on the
// prototype, so patching the prototype covers already-created and future DI instances.
function getPatchTarget(instance, methodName) {
    if (!instance) return null;
    const proto = Object.getPrototypeOf(instance);
    if (proto && Object.prototype.hasOwnProperty.call(proto, methodName) && typeof proto[methodName] === 'function') {
        return proto;
    }
    return instance;
}

class EconomyGuard {
    constructor(modDir, config, logger, serverContext) {
        this.modDir = modDir;
        this.config = config;
        this.logger = logger || console;
        this.serverContext = serverContext || {};
        this.moneyTpls = new Set([...core.MONEY_TPLS]);
        this.moneyTplCandidatesChecked = new Set();
        this.refreshMoneyTpls(null, null, [], []);
        const root = process.cwd();
        const dataDir = path.isAbsolute(config.dataDirectory)
            ? config.dataDirectory
            : path.resolve(root, config.dataDirectory || 'SPT-EconomyGuard-Data');
        this.storage = new Storage(dataDir, config.storage || {}, this.logger);
        this.accessControl = this.serverContext.accessControl || new AccessControl(this.storage.baseDir, this.logger);
        this.onlinePresence = new Map();
        this.recentLedger = this.storage.loadRecentLedger(Number(config.flea && config.flea.maxTrackedEventsInMemory) || 20000);
        this.caseCooldown = new Map();
        this.restrictions = this.storage.loadRestrictions();
        this.policyUsage = this.storage.loadRecentPolicyUsage(50000);
        this.health = {
            mod: 'SPT-EconomyGuard', version: MOD_VERSION, startedAt: new Date().toISOString(),
            mode: config.mode, sptTarget: '~3.11.0', hooks: {},
            coverage: { traderBuy: 'PENDING', traderSell: 'PENDING', fleaListing: 'PENDING', fleaPurchaseViaTradeHelper: 'PENDING', fleaPurchaseViaCallback: 'PENDING', fleaPurchaseController: 'PENDING', fleaPurchase: 'PENDING', paymentAffordability: 'PENDING', fenceSellAll: 'PENDING', fikaItemSending: 'NOT_HOOKED' },
            warnings: [],
            runtime: { loginBlocks: 0, loginPasses: 0, sessionBlocks: 0, ipBlocks: 0, tradeCallbackCalls: 0, ragfairCallbackCalls: 0, fenceCallbackCalls: 0, callbackPreflightBlocks: 0, buyItemCalls: 0, sellItemCalls: 0, ragfairPurchaseCalls: 0, traderConfirmCalls: 0, insufficientFundsFindings: 0, malformedOfferFindings: 0, missingPaymentItemsFindings: 0, paymentSchemeMismatches: 0, insufficientFleaFunds: 0, fleaPreflightPasses: 0, suspiciousPriceReviews: 0, unknownReferenceReviews: 0, policyBlocks: 0, stockAnomalies: 0, traderStockBlocks: 0, traderRestrictionBlocks: 0, nativeTraderStockChecks: 0, nativeTraderRestrictionChecks: 0, fleaPriceBlocks: 0, lastTransactionAt: null, lastTransaction: null },
            hookScope: {},
            adminPanel: { enabled: false, pending: true },
            onlinePlayers: { available: false, source: 'FIKA_PRESENCE_WEBSOCKET', count: 0, hooks: {} },
            accessControl: { enabled: true, degraded: this.accessControl.state.degraded === true, registrationMode: this.accessControl.state.settings.allowLauncherRegistration ? 'open' : 'admin-only', approvedLoginRequired: this.accessControl.state.settings.requireApprovedLogin, ipAllowlistEnabled: this.accessControl.state.settings.enforceIpAllowlist, activeBans: this.accessControl.getStateForPanel().activeBanCount, hooks: {} },
            currencyTemplates: Array.from(this.moneyTpls)
        };
        this.writeHealth();
    }

    log(level, message) {
        const fn = this.logger && (this.logger[level] || this.logger.info);
        if (typeof fn === 'function') fn.call(this.logger, `[EconomyGuard] ${message}`);
        else console.log(`[EconomyGuard] ${message}`);
    }

    writeHealth() {
        try {
            fs.writeFileSync(path.join(this.storage.baseDir, 'health.json'), JSON.stringify(this.health, null, 2), 'utf8');
        } catch (err) { this.log('error', `Health write failed: ${err.message}`); }
    }

    isProtect() { return this.config.enabled !== false && String(this.config.mode).toLowerCase() === 'protect'; }

    audit(type, data = {}) {
        const event = { timestamp: new Date().toISOString(), epoch: Date.now(), type, mode: this.config.mode, ...data };
        this.storage.audit(event);
        return event;
    }

    createCase(type, severity, evidence) {
        const record = this.storage.createCase({ type, severity, evidence });
        this.audit('CASE_CREATED', { caseId: record.caseId, type, severity });
        this.log(severity === 'HIGH' ? 'warn' : 'info', `${record.caseId} ${type}`);
        return record;
    }

    renderNotification(code, evidence, caseId) {
        const cfg = this.config.notifications || {};
        if (cfg.enabled === false) return '';
        const defaults = {
            FLEA_MISSING_PAYMENT_ITEMS: 'Purchase blocked: the request omitted its payment items. Required: {requiredPayment}. Available: {availablePayment}.',
            INSUFFICIENT_FLEA_FUNDS: 'Purchase blocked: insufficient funds. Required: {requiredPayment}. Available: {availablePayment}.',
            FLEA_PAYMENT_SCHEME_MISMATCH: 'Purchase blocked: the submitted payment does not match the server-required offer payment ({requiredPayment}).',
            FLEA_OFFER_NOT_FOUND: 'Purchase blocked: this offer is no longer valid.',
            FLEA_INVALID_QUANTITY: 'Purchase blocked: requested quantity is invalid.',
            INVALID_FLEA_REQUEST: 'Purchase blocked: the market request is malformed.',
            FLEA_PAYMENT_REQUIREMENTS_UNKNOWN: 'Purchase blocked: the server could not verify this offer payment.',
            CALLBACK_INSUFFICIENT_OR_MISSING_PAYMENT: 'Purchase blocked: the required payment could not be verified.',
            INSUFFICIENT_OR_INVALID_PAYMENT_ASSET: 'Purchase blocked: required money or barter items are unavailable.',
            TRADER_PAYMENT_SCHEME_MISMATCH: 'Purchase blocked: payment does not match the trader offer.',
            TRADER_STOCK_INSUFFICIENT: 'Purchase blocked: the trader has insufficient stock for the requested quantity.',
            TRADER_BUY_RESTRICTION_EXCEEDED: 'Purchase blocked: the trader purchase limit for this item has been reached.',
            FLEA_SELF_PURCHASE: 'Purchase blocked: you cannot purchase your own offer.',
            TRADER_SELL_PAYOUT_TOO_HIGH: 'Sale blocked: the payout exceeds the server-side valuation limit.',
            FENCE_ABSOLUTE_PAYOUT_CAP: 'Sale blocked: the Fence payout exceeds the configured safety limit.',
            PLAYER_PURCHASE_POLICY_RESTRICTED: 'Purchase blocked: this item has a temporary administrator restriction for your profile.',
            PLAYER_BLOCKLISTED: 'Purchase blocked: this profile is currently blocked from all purchases by the server administrator.',
            ITEM_BLOCKLISTED: 'Purchase blocked: this item is currently restricted by the server administrator.',
            FLEA_PRICE_TOO_HIGH: 'Purchase blocked: {itemTpl} is listed at {priceRatio}x its trusted reference ({transactionValueRub} vs {assetValueRub} RUB).',
            FLEA_PRICE_TOO_LOW: 'Purchase blocked: {itemTpl} is priced far below its trusted reference range.',
            TRADER_STOCK_INSUFFICIENT: 'Purchase blocked: trader stock is lower than the requested quantity.',
            TRADER_BUY_RESTRICTION_EXCEEDED: 'Purchase blocked: the trader purchase restriction has been reached.',
            PLAYER_PURCHASE_POLICY_RESTRICTED: 'Purchase blocked: this item has a temporary administrator restriction for your profile.'
        };
        const messages = cfg.messages || {};
        let body = String(messages[code] || defaults[code] || messages.default || 'Transaction blocked by server protection.');
        const replacements = {
            caseId: caseId || '',
            code,
            offerId: evidence && (evidence.offerId || (evidence.offerIds && evidence.offerIds[0])) || '',
            traderId: evidence && (evidence.traderId || evidence.tid) || '',
            player: evidence && evidence.playerName || '',
            requiredPayment: evidence && evidence.requiredPaymentText || 'server-defined payment',
            availablePayment: evidence && evidence.availablePaymentText || 'not verified',
            itemTpl: evidence && (evidence.itemTpl || evidence.offerItemTpl || (evidence.check && evidence.check.rootTpl)) || '',
            requestedQuantity: evidence && (evidence.requestedQuantity || evidence.requestedCount || evidence.count) || '',
            priceRatio: evidence && evidence.priceCheck && Number.isFinite(Number(evidence.priceCheck.ratio)) ? Number(evidence.priceCheck.ratio).toFixed(2) : '',
            assetValueRub: !evidence ? '' : (evidence.requestedAssetValue != null ? evidence.requestedAssetValue : (evidence.assetValueRub != null ? evidence.assetValueRub : (evidence.check && evidence.check.referenceTotalRub != null ? evidence.check.referenceTotalRub : ''))),
            transactionValueRub: !evidence ? '' : (evidence.expectedPayment && evidence.expectedPayment.value != null ? evidence.expectedPayment.value : (evidence.check && evidence.check.askTotalPriceRub != null ? evidence.check.askTotalPriceRub : (evidence.check && evidence.check.askPriceRub != null ? evidence.check.askPriceRub : '')))
        };
        body = body.replace(/\{(caseId|code|offerId|traderId|player|requiredPayment|availablePayment|itemTpl|requestedQuantity|priceRatio|assetValueRub|transactionValueRub)\}/g, (_match, key) => String(replacements[key] ?? ''));
        const prefix = String(cfg.prefix || '').trim();
        const includeCaseId = cfg.includeCaseId !== false && caseId;
        const parts = [];
        if (prefix) parts.push(prefix);
        parts.push(body);
        if (includeCaseId) parts.push(`Case ${caseId}`);
        const separatorSetting = String(cfg.separator || ' | ');
        const separator = separatorSetting === '\\n' || separatorSetting === '\n'
            ? '\n' : separatorSetting.replace(/\\n/g, '\n');
        return parts.join(separator);
    }

    block(instance, output, code, message, evidence) {
        const payload = { code, message, ...evidence };
        this.audit('TRANSACTION_BLOCKED', payload);
        const caseRecord = this.createCase(code, 'HIGH', payload);
        const clientMessage = this.renderNotification(code, evidence || {}, caseRecord.caseId) || `[EconomyGuard] ${message}`;
        if (instance && instance.httpResponse && typeof instance.httpResponse.appendErrorToOutput === 'function') {
            instance.httpResponse.appendErrorToOutput(output, clientMessage);
        } else if (output) {
            output.warnings = Array.isArray(output.warnings) ? output.warnings : [];
            output.warnings.push({ index: output.warnings.length, errmsg: clientMessage, code: '0' });
        }
    }

    warn(code, message, evidence) {
        this.audit(code, { message, ...evidence });
    }

    refreshMoneyTpls(instance, profile, requestItems, requirements) {
        // SPT 3.11.1 PaymentHelper.isMoneyTpl recognizes RUB/USD/EUR/GP and
        // inventory.customMoneyTpls. Discover the live set from the same service
        // used by PaymentService instead of assuming only three currencies.
        const set = this.moneyTpls || (this.moneyTpls = new Set(core.MONEY_TPLS));
        for (const tpl of core.MONEY_TPLS) set.add(tpl);
        const inventoryConfig = this.serverContext.inventoryConfig
            || safeCall(() => (this.serverContext.configServer || instance && instance.configServer).getConfig('spt-inventory'), null)
            || safeCall(() => (this.serverContext.configServer || instance && instance.configServer).getConfig('inventory'), null)
            || safeCall(() => instance && instance.inventoryConfig, null);
        const customTpls = inventoryConfig && Array.isArray(inventoryConfig.customMoneyTpls)
            ? inventoryConfig.customMoneyTpls : [];
        for (const tpl of customTpls) if (typeof tpl === 'string' && tpl.trim()) set.add(tpl.trim());

        const helper = (instance && (instance.paymentHelper || instance.tradeHelper && instance.tradeHelper.paymentHelper))
            || this.serverContext.paymentHelper;
        const candidates = new Set();
        for (const item of (profile && profile.Inventory && Array.isArray(profile.Inventory.items) ? profile.Inventory.items : [])) {
            if (item && typeof item._tpl === 'string') candidates.add(item._tpl);
        }
        for (const req of Array.isArray(requirements) ? requirements : []) {
            if (req && typeof (req._tpl || req.tpl) === 'string') candidates.add(req._tpl || req.tpl);
        }
        const byId = new Map((profile && profile.Inventory && Array.isArray(profile.Inventory.items) ? profile.Inventory.items : []).map(item => [item && item._id, item]));
        for (const entry of Array.isArray(requestItems) ? requestItems : []) {
            if (!entry || typeof entry.id !== 'string') continue;
            candidates.add(entry.id);
            const owned = byId.get(entry.id);
            if (owned && typeof owned._tpl === 'string') candidates.add(owned._tpl);
        }
        if (helper && typeof helper.isMoneyTpl === 'function') {
            for (const tpl of candidates) {
                if (set.has(tpl) || this.moneyTplCandidatesChecked.has(tpl)) continue;
                this.moneyTplCandidatesChecked.add(tpl);
                if (safeCall(() => helper.isMoneyTpl(tpl), false)) set.add(tpl);
            }
        }
        if (this.health) this.health.currencyTemplates = Array.from(set);
        return set;
    }

    isMoneyTpl(tpl, instance, profile, requestItems, requirements) {
        const set = this.refreshMoneyTpls(instance, profile, requestItems, requirements);
        return set.has(core.normalizeTpl(tpl));
    }

    currencyName(tpl) {
        const names = {
            '5449016a4bdc2d6f028b456f': 'RUB',
            '5696686a4bdc2da3298b456a': 'USD',
            '569668774bdc2da2298b456b': 'EUR',
            '5d235b4d86f7742e017bc88a': 'GP'
        };
        return names[tpl] || tpl;
    }

    getTables() {
        if (this.serverContext.tables) return this.serverContext.tables;
        return safeCall(() => this.serverContext.databaseServer.getTables(), {});
    }

    getPriceSources(tpl, instance) {
        const prices = safeCall(() => instance.databaseService.getPrices(), null)
            || safeCall(() => this.getTables().templates.prices, null)
            || {};
        const itemTable = safeCall(() => instance.databaseService.getItems(), null)
            || safeCall(() => this.getTables().templates.items, null)
            || {};
        const catalogKnown = Boolean(itemTable && itemTable[tpl]);
        const handbookRaw = safeCall(() => instance.handbookHelper.getTemplatePrice(tpl), 0);
        // Prefer the live SPT Ragfair price service (which sees the active runtime
        // price table after SVM/price mods). Fall back to the database price table.
        const dynamicRaw = Number(safeCall(() => instance.ragfairPriceService.getDynamicPriceForItem(tpl), 0)) || 0;
        const databasePriceRaw = Number(prices[tpl]) || 0;
        const marketRaw = dynamicRaw > 1 ? dynamicRaw : databasePriceRaw;
        // SPT 3.11.1 RagfairPriceService can fall back to 1 RUB when no useful
        // dynamic or Handbook value exists. This sentinel is not a reference.
        const market = marketRaw > 1 ? marketRaw : 0;
        const handbook = Number(handbookRaw) > 1 ? Number(handbookRaw) : 0;
        const disagreement = handbook > 0 && market > 0 ? Math.max(handbook, market) / Math.min(handbook, market) : null;
        let confidence = 'LOW';
        let value = 0;
        if (handbook > 0 && market > 0 && disagreement <= (Number(this.config.price.referenceDisagreementRatio) || 5)) {
            value = Math.max(handbook, market);
            confidence = 'HIGH';
        } else if (handbook > 0 && market > 0) {
            value = Math.min(handbook, market);
            confidence = 'AMBIGUOUS';
        } else if (handbook > 0) {
            value = handbook;
            confidence = 'MEDIUM';
        } else if (market > 0) {
            value = market;
            confidence = 'MEDIUM';
        }
        const override = this.config.priceOverrides && Number(this.config.priceOverrides[tpl]);
        if (Number.isFinite(override) && override > 0) {
            return { value: override, confidence: 'ADMIN', handbook, market, handbookRaw: Number(handbookRaw) || 0, marketRaw, databasePriceRaw, dynamicRaw, source: 'admin-override', disagreement, catalogKnown };
        }
        // A stray price row for a missing template is not enough to establish
        // an item identity. Keep the value for diagnostics but never hard-block.
        if (!catalogKnown && value > 0) confidence = 'LOW';
        return { value, confidence, handbook, market, handbookRaw: Number(handbookRaw) || 0, marketRaw, databasePriceRaw, dynamicRaw, source: dynamicRaw > 1 ? 'ragfair-dynamic' : databasePriceRaw > 1 ? 'database-prices' : 'none', disagreement, catalogKnown };
    }

    itemValue(items, instance, applyFleaModifiers = false) {
        let value = 0;
        let confidence = 'HIGH';
        const unknown = [];
        const breakdown = [];
        let complete = true;
        for (const item of items || []) {
            const tpl = core.normalizeTpl(item && item._tpl);
            if (!tpl) { complete = false; continue; }
            const stackInfo = core.readStackCount(item);
            const stack = stackInfo.count;
            if (!stackInfo.valid) {
                complete = false;
                confidence = 'LOW';
                breakdown.push({ tpl, count: stack, unitRoubles: null, sourceConfidence: 'LOW', reason: stackInfo.reason || 'STACK_COUNT_OUT_OF_RANGE' });
                continue;
            }
            const ref = this.getPriceSources(tpl, instance);
            if (!ref.value) {
                unknown.push(tpl);
                complete = false;
                confidence = 'LOW';
                breakdown.push({ tpl, count: stack, unitRoubles: null, sourceConfidence: ref.confidence, catalogKnown: ref.catalogKnown, handbookRaw: ref.handbookRaw, marketRaw: ref.marketRaw });
                continue;
            }
            if (ref.confidence === 'AMBIGUOUS') { confidence = 'AMBIGUOUS'; complete = false; }
            else if (ref.confidence === 'MEDIUM' && confidence === 'HIGH') confidence = 'MEDIUM';
            else if (ref.confidence === 'LOW') { confidence = 'LOW'; complete = false; }
            // SPT's Ragfair dynamic itemPriceMultiplier is per template. Apply it
            // item-by-item, not once to the listing root, so mixed PACK contents
            // and nested PackNStrap items are valued using their own template rule.
            const fleaMultiplier = applyFleaModifiers ? this.getConfiguredItemPriceMultiplier(instance, tpl) : 1;
            const unit = ref.value * fleaMultiplier;
            value += unit * stack;
            breakdown.push({ tpl, count: stack, unitRoubles: unit, baseUnitRoubles: ref.value, fleaMultiplier, sourceConfidence: ref.confidence, catalogKnown: ref.catalogKnown, handbookRoubles: ref.handbook, dynamicRoubles: ref.market, disagreement: ref.disagreement });
        }
        return { value, confidence, complete: complete && unknown.length === 0, unknown: [...new Set(unknown)], breakdown };
    }

    getTraderSellAssetValue(items, instance) {
        const itemTable = safeCall(() => instance.databaseService.getItems(), null)
            || safeCall(() => this.getTables().templates.items, null) || {};
        let value = 0;
        let confidence = 'HIGH';
        const breakdown = [];
        let complete = true;
        for (const item of items || []) {
            const tpl = core.normalizeTpl(item && item._tpl);
            if (!tpl) { complete = false; confidence = 'LOW'; continue; }
            const stackInfo = core.readStackCount(item);
            if (!stackInfo.valid) {
                complete = false;
                confidence = 'LOW';
                breakdown.push({ tpl, count: stackInfo.count, handbookRoubles: null, reason: stackInfo.reason || 'INVALID_STACK_COUNT' });
                continue;
            }
            const handbookRaw = Number(safeCall(() => instance.handbookHelper.getTemplatePrice(tpl), 0)) || 0;
            const catalogKnown = Boolean(itemTable && itemTable[tpl]);
            if (handbookRaw <= 1 || !catalogKnown) {
                complete = false;
                confidence = 'LOW';
                breakdown.push({ tpl, count: stackInfo.count, handbookRoubles: handbookRaw, catalogKnown, reason: handbookRaw <= 1 ? 'HANDBOOK_PRICE_UNAVAILABLE' : 'TEMPLATE_NOT_IN_CATALOG' });
                continue;
            }
            value += handbookRaw * stackInfo.count;
            breakdown.push({ tpl, count: stackInfo.count, handbookRoubles: handbookRaw, catalogKnown });
        }
        return { value, confidence, complete, breakdown, source: 'spt-handbook' };
    }

    getPriceQualityMultiplier(instance, items) {
        const q = Number(safeCall(() => instance.itemHelper.getItemQualityModifierForItems(items, true), 1));
        return Number.isFinite(q) && q > 0 ? q : 1;
    }

    getConfiguredItemPriceMultiplier(instance, tpl) {
        const direct = Number(safeCall(() => instance.ragfairConfig.dynamic.itemPriceMultiplier[tpl], 1));
        return Number.isFinite(direct) && direct > 0 ? direct : 1;
    }

    getMarketEvidence(instance, tpl) {
        // Live offers are useful for context only. They are excluded from hard-block
        // confidence because a group of fake listings can manipulate their average.
        const offers = safeCall(() => instance.ragfairOfferService.getOffersOfType(tpl), []);
        const rows = [];
        for (const offer of Array.isArray(offers) ? offers : []) {
            if (!offer || !Array.isArray(offer.requirements) || !offer.requirements.length || !Array.isArray(offer.items) || !offer.items.length) continue;
            if (offer.requirements.some(req => !this.isMoneyTpl(req && req._tpl, instance))) continue;
            const isTrader = safeCall(() => instance.ragfairOfferHelper.offerIsFromTrader(offer), offer.user && Number(offer.user.memberType) === 4);
            if (isTrader) continue;
            let priceRub = 0;
            let valid = true;
            for (const req of offer.requirements) {
                const tplReq = core.normalizeTpl(req && req._tpl);
                const amount = Number(req && req.count);
                if (!tplReq || !Number.isFinite(amount) || amount <= 0) { valid = false; break; }
                const converted = safeCall(() => instance.handbookHelper.inRUB(amount, tplReq), tplReq === '5449016a4bdc2d6f028b456f' ? amount : NaN);
                if (!Number.isFinite(Number(converted)) || Number(converted) <= 0) { valid = false; break; }
                priceRub += Number(converted);
            }
            if (!valid || priceRub <= 0) continue;
            if (offer.items.length !== 1 || core.normalizeTpl(offer.items[0] && offer.items[0]._tpl) !== tpl) continue;
            const root = offer.items[0];
            const rootStack = core.readStackCount(root);
            if (!rootStack.valid) continue;
            const rootCount = rootStack.count;
            const unitPriceRub = offer.sellInOnePiece === true ? priceRub / rootCount : priceRub;
            if (!Number.isFinite(unitPriceRub) || unitPriceRub <= 0) continue;
            rows.push({ sellerId: offer.user && offer.user.id, unitPriceRub });
        }
        return core.robustMarketStats(rows);
    }

    createReviewCase(type, evidence, cooldownKey) {
        const key = cooldownKey || `${type}:${evidence && evidence.sessionId || 'unknown'}:${evidence && evidence.itemTpl || 'unknown'}`;
        const now = Date.now();
        const last = this.caseCooldown.get(key) || 0;
        if (now - last < 30 * 60 * 1000) return null;
        this.caseCooldown.set(key, now);
        this.health.runtime.suspiciousPriceReviews++;
        return this.createCase(type, 'MEDIUM', evidence);
    }

    getPolicyChannel(requirements, fallback) {
        const barter = Array.isArray(requirements) && requirements.some(req => !this.isMoneyTpl(req && req._tpl));
        if (fallback === 'trader') return barter ? 'trader-barter' : 'trader-money';
        return barter ? 'flea-barter' : 'flea-money';
    }

    checkPlayerPurchasePolicy(profile, itemTpl, quantity, channel, traderId, sessionId) {
        if ((this.config.restrictions && this.config.restrictions.enabled === false) || (this.restrictions && this.restrictions.enabled === false)) return { known: true, valid: true, restricted: false };
        const now = Date.now();
        const active = entry => {
            if (!entry || entry.enabled === false) return false;
            if (entry.startsAt) {
                const start = Date.parse(entry.startsAt);
                if (!Number.isFinite(start) || start > now) return false;
            }
            if (entry.expiresAt) {
                const expiry = Date.parse(entry.expiresAt);
                if (!Number.isFinite(expiry) || expiry <= now) return false;
            }
            return true;
        };
        const profileId = getProfileId(profile, sessionId);
        const tpl = core.normalizeTpl(itemTpl);
        const itemEntry = tpl && this.restrictions && this.restrictions.items && this.restrictions.items[tpl];
        if (itemEntry && active(itemEntry) && itemEntry.blocked === true) {
            const channels = Array.isArray(itemEntry.channels) ? itemEntry.channels : ['any'];
            if (channels.includes('any') || channels.includes(channel)) {
                return { known: true, valid: false, restricted: true, reason: 'ITEM_BLOCKLISTED', profileId, itemTpl: tpl, channel, traderId, itemEntry, restrictionReason: itemEntry.reason || '' };
            }
        }
        const player = this.restrictions && this.restrictions.players && this.restrictions.players[profileId];
        if (!player) return { known: true, valid: true, restricted: false };
        // Full account suspension has its own expiry field so it cannot silently
        // disable other item/channel rules when the temporary suspension expires.
        const fullBlockExpiry = Object.prototype.hasOwnProperty.call(player, 'blockedUntil') ? player.blockedUntil : (player.expiresAt || null);
        const fullBlockActive = (player.blocked === true || player.blockAllPurchases === true)
            && active({ startsAt: player.blockedStartsAt || player.startsAt, expiresAt: fullBlockExpiry });
        if (fullBlockActive) {
            return { known: true, valid: false, restricted: true, reason: 'PLAYER_BLOCKLISTED', profileId, itemTpl: tpl, channel, traderId, playerReason: player.reason || '', playerRestriction: player };
        }
        // Backward compatibility: legacy player-level expiresAt used to suspend
        // the complete rule container when there was no dedicated blockedUntil.
        if (!Object.prototype.hasOwnProperty.call(player, 'blockedUntil') && player.expiresAt && !active(player)) return { known: true, valid: true, restricted: false };
        const rules = Array.isArray(player.rules) ? player.rules : [];
        for (const rule of rules) {
            if (!active(rule)) continue;
            if (rule.tpl && core.normalizeTpl(rule.tpl) !== tpl) continue;
            if (rule.channel && rule.channel !== 'any' && rule.channel !== channel) continue;
            if (rule.traderId && rule.traderId !== traderId) continue;
            if (rule.block === true) return { known: true, valid: false, restricted: true, reason: 'PLAYER_TPL_BLOCKED_BY_POLICY', profileId, itemTpl: tpl, channel, traderId, rule, playerReason: player.reason || '' };
            const maxPerTransaction = Number(rule.maxPerTransaction);
            if (Number.isSafeInteger(maxPerTransaction) && maxPerTransaction > 0 && quantity > maxPerTransaction) {
                return { known: true, valid: false, restricted: true, reason: 'PLAYER_PER_TRANSACTION_LIMIT', profileId, itemTpl: tpl, channel, traderId, quantity, limit: maxPerTransaction, rule, playerReason: player.reason || '' };
            }
            const dailyLimit = Number(rule.dailyLimit);
            if (Number.isSafeInteger(dailyLimit) && dailyLimit > 0) {
                const day = new Date().toISOString().slice(0, 10);
                const used = this.policyUsage.filter(x => x.profileId === profileId && x.itemTpl === tpl && (rule.channel === 'any' || !rule.channel || x.channel === channel) && x.day === day && (!traderId || !x.traderId || x.traderId === traderId)).reduce((sum, x) => sum + Number(x.quantity || 0), 0);
                if (used + quantity > dailyLimit) return { known: true, valid: false, restricted: true, reason: 'PLAYER_DAILY_PURCHASE_LIMIT', profileId, itemTpl: tpl, channel, traderId, quantity, used, limit: dailyLimit, rule, playerReason: player.reason || '' };
            }
        }
        return { known: true, valid: true, restricted: false };
    }

    recordPolicyPurchase(profileId, itemTpl, quantity, channel, traderId, transactionId) {
        if (!profileId || !itemTpl || !Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0) return;
        const event = { timestamp: Date.now(), day: new Date().toISOString().slice(0, 10), profileId, itemTpl, quantity: Number(quantity), channel, traderId: traderId || null, transactionId: transactionId || null };
        this.storage.recordPolicyUsage(event);
        this.policyUsage.push(event);
        if (this.policyUsage.length > 50000) this.policyUsage.splice(0, this.policyUsage.length - 50000);
    }

    getRootItemsAndQuantity(requestItems, inventory) {
        const ids = Array.isArray(requestItems) ? requestItems : [];
        const quantity = core.rootStackQuantity(ids, inventory);
        const byId = new Map((inventory || []).map(item => [item && item._id, item]));
        const roots = ids.map(id => byId.get(id)).filter(Boolean);
        const uniqueTpls = [...new Set(roots.map(x => core.normalizeTpl(x && x._tpl)).filter(Boolean))];
        return { roots, quantity, uniqueTpls };
    }

    requirementValue(requirements, scale, instance, profile, requestItems) {
        const moneyTpls = this.refreshMoneyTpls(instance, profile, requestItems, requirements);
        let value = 0;
        let complete = true;
        let validStructure = true;
        const breakdown = [];
        const safeScale = Number(scale);
        for (const req of requirements || []) {
            const tpl = core.normalizeTpl(req && req._tpl);
            const baseCount = core.finitePositive(req && req.count);
            const count = baseCount * safeScale;
            if (!tpl || !baseCount || !Number.isFinite(count) || count <= 0 || !Number.isSafeInteger(Math.ceil(count))) {
                complete = false;
                validStructure = false;
                breakdown.push({ tpl: tpl || null, count: req && req.count, reason: 'INVALID_SERVER_REQUIREMENT' });
                continue;
            }
            let itemValue = 0;
            if (req.onlyFunctional === true) {
                // SPT can represent onlyFunctional requirements as preset/functional
                // items, not just a bare template. Do not use them for hard price verdicts.
                complete = false;
            }
            if (moneyTpls.has(tpl)) {
                itemValue = safeCall(() => instance.handbookHelper.inRUB(count, tpl), tpl === '5449016a4bdc2d6f028b456f' ? count : 0);
            } else {
                const ref = this.getPriceSources(tpl, instance);
                itemValue = ref.value * count;
                if (!ref.value || ref.confidence === 'AMBIGUOUS' || ref.confidence === 'LOW') complete = false;
            }
            if (!Number.isFinite(itemValue) || itemValue <= 0) complete = false;
            value += Number(itemValue) || 0;
            if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) {
                complete = false;
                validStructure = false;
                breakdown.push({ tpl, count, valueRoubles: null, reason: 'UNSAFE_REQUIREMENT_VALUE' });
                value = 0;
                continue;
            }
            breakdown.push({ tpl, count, valueRoubles: itemValue, onlyFunctional: req.onlyFunctional === true });
        }
        if (!Array.isArray(requirements) || requirements.length === 0) validStructure = false;
        return { value, complete: complete && validStructure && breakdown.length > 0, validStructure, breakdown };
    }

    assessPrice(priceRub, assetValue, confidence, totalReferenceValue = assetValue) {
        const result = core.comparePriceToReference(priceRub, assetValue, this.config.price || {});
        const minimum = Number(this.config.price.minimumReferenceRoubles) || 100;
        const confOk = confidence === 'HIGH' || confidence === 'ADMIN' || (this.config.price.allowSingleReferenceSourceForBlocking && confidence === 'MEDIUM');
        result.blockable = result.known && result.suspicious && Number(totalReferenceValue) >= minimum && confOk;
        result.confidence = confidence;
        result.totalReferenceValue = Number(totalReferenceValue) || 0;
        return result;
    }

    paymentTplMap(requestItems, inventoryItems, instance, profile, requirements) {
        const moneyTpls = this.refreshMoneyTpls(instance, profile, requestItems, requirements);
        return core.aggregatePaymentItems(requestItems, inventoryItems, moneyTpls);
    }

    getOffer(allOffers, offerId) {
        if (!Array.isArray(allOffers)) return null;
        return allOffers.find(o => o && o._id === offerId) || null;
    }

    getOfferRepresentedQuantity(offer) {
        const items = Array.isArray(offer && offer.items) ? offer.items : [];
        if (!items.length) return { known: false, quantity: null, roots: 0 };
        const ids = new Set(items.map(item => item && item._id).filter(Boolean));
        const roots = items.filter(item => item && (!item.parentId || !ids.has(item.parentId)));
        let quantity = 0;
        for (const root of roots) {
            const stack = core.readStackCount(root);
            if (!stack.valid) return { known: false, quantity: null, roots: roots.length, reason: 'ROOT_STACK_COUNT_OUT_OF_RANGE', stackReason: stack.reason };
            const count = stack.count;
            quantity += count;
            if (!Number.isSafeInteger(quantity)) return { known: false, quantity: null, roots: roots.length, reason: 'ROOT_QUANTITY_OVERFLOW' };
        }
        return { known: roots.length > 0 && quantity > 0, quantity, roots: roots.length };
    }

    getRequirementsForAssort(instance, request, sessionId) {
        const assort = safeCall(() => instance.traderAssortHelper.getAssort(sessionId, request.tid), null);
        if (!assort) return null;
        const table = assort.barter_scheme || assort.barterScheme;
        const schemes = table && table[request.item_id];
        if (!Array.isArray(schemes) || !schemes.length) return null;
        const selected = schemes[Number(request.scheme_id) || 0] || schemes[0];
        return Array.isArray(selected) ? selected : null;
    }

    checkPaymentAvailability(profile, request, instance) {
        const inventory = profile && profile.Inventory && profile.Inventory.items || [];
        const moneyTpls = this.refreshMoneyTpls(instance, profile, request && request.scheme_items, []);
        return core.validatePaymentAvailability(request && request.scheme_items, inventory, moneyTpls);
    }

    checkTraderBuy(instance, profile, request, sessionId) {
        const requirements = this.getRequirementsForAssort(instance, request, sessionId);
        if (!requirements) return { known: false, valid: true, reason: 'ASSORT_SCHEME_UNAVAILABLE' };
        const scale = core.finitePositive(request.count) || 1;
        const moneyTpls = this.refreshMoneyTpls(instance, profile, request && request.scheme_items, requirements);
        const check = core.comparePaymentToRequirements(request.scheme_items, profile && profile.Inventory && profile.Inventory.items, requirements, scale, moneyTpls);
        const assort = safeCall(() => instance.traderAssortHelper.getAssort(sessionId, request.tid), null);
        const assortItems = assort && Array.isArray(assort.items) ? assort.items : [];
        const root = assortItems.find(item => item && item._id === request.item_id);
        check.itemTpl = root && root._tpl || null;
        check.count = scale;
        check.requirements = requirements;
        check.isBarter = requirements.some(req => !moneyTpls.has(core.normalizeTpl(req && req._tpl)));
        // SPT performs stock and purchase-restriction checks natively in TradeHelper.buyItem.
        // We record these values for diagnostics and only add optional account-specific policy limits.
        check.nativeStock = root && root.upd && Number.isFinite(Number(root.upd.StackObjectsCount)) ? Number(root.upd.StackObjectsCount) : null;
        check.nativeBuyRestrictionMax = root && root.upd && Number.isFinite(Number(root.upd.BuyRestrictionMax)) ? Number(root.upd.BuyRestrictionMax) : null;
        check.nativeBuyRestrictionCurrent = root && root.upd && Number.isFinite(Number(root.upd.BuyRestrictionCurrent)) ? Number(root.upd.BuyRestrictionCurrent) : null;
        return check;
    }

    checkNativeTraderPurchase(instance, profile, request, sessionId) {
        if (!request || request.type !== 'buy_from_trader' || !request.tid || request.tid === 'ragfair' || request.tid === FENCE_ID) {
            return { known: false, applicable: false, valid: true, reason: 'NOT_STANDARD_TRADER_BUY' };
        }
        const count = Number(request.count);
        if (!Number.isSafeInteger(count) || count <= 0 || count > core.EFT_MAX_STACK_COUNT) {
            return { known: true, applicable: true, valid: false, reason: 'TRADER_INVALID_BUY_COUNT', count };
        }
        const assorts = safeCall(() => instance.traderHelper.getTraderAssortsByTraderId(request.tid), null);
        const item = assorts && Array.isArray(assorts.items) ? assorts.items.find(x => x && x._id === request.item_id) : null;
        if (!item) return { known: false, applicable: true, valid: true, reason: 'NATIVE_TRADER_ASSORT_ITEM_NOT_FOUND' };
        const rawStock = item.upd && item.upd.StackObjectsCount;
        const stock = Number(rawStock);
        if (Number.isFinite(stock) && count > stock) {
            return { known: true, applicable: true, valid: false, code: 'TRADER_STOCK_INSUFFICIENT', reason: 'REQUEST_EXCEEDS_NATIVE_TRADER_STOCK', count, stock, itemTpl: item._tpl };
        }
        const hasRestrictions = safeCall(() => instance.itemHelper.hasBuyRestrictions(item), false);
        if (hasRestrictions && typeof instance.checkPurchaseIsWithinTraderItemLimit === 'function') {
            try {
                // This is SPT's own read-only limit check; native buyItem executes it
                // again during the real purchase. We run it before SPT adds the item
                // to the profile, avoiding partial delivery if it throws later.
                instance.checkPurchaseIsWithinTraderItemLimit(sessionId, profile, request.tid, item, request.item_id, count);
            } catch (err) {
                return { known: true, applicable: true, valid: false, code: 'TRADER_BUY_RESTRICTION_EXCEEDED', reason: 'NATIVE_BUY_RESTRICTION_REJECTED', count, itemTpl: item._tpl, error: String(err && err.message || err) };
            }
        }
        return {
            known: true, applicable: true, valid: true, count, stock: Number.isFinite(stock) ? stock : null,
            itemTpl: item._tpl || null, hasBuyRestrictions: Boolean(hasRestrictions),
            buyRestrictionMax: Number(item.upd && item.upd.BuyRestrictionMax) || null,
            buyRestrictionCurrent: Number(item.upd && item.upd.BuyRestrictionCurrent) || null
        };
    }

    isTraderOriginOffer(offer, instance) {
        if (!offer) return false;
        return Boolean(safeCall(() => instance.ragfairOfferHelper.offerIsFromTrader(offer), Number(offer.user && offer.user.memberType) === 4));
    }

    valueOfferForPurchase(offer, quantity, instance) {
        const items = Array.isArray(offer && offer.items) ? offer.items : [];
        const pack = offer && offer.sellInOnePiece === true;
        const traderOrigin = this.isTraderOriginOffer(offer, instance);
        const rootStack = Number(items[0] && items[0].upd && items[0].upd.StackObjectsCount) || 0;
        const unlimitedTrader = traderOrigin && !pack && (offer.unlimitedCount === true || Number(offer.quantity) >= 9999999 || rootStack >= 9999999);
        const represented = this.getOfferRepresentedQuantity(offer);
        const rawAssetItems = unlimitedTrader
            ? items.map((item) => {
                const clone = { ...item };
                if (!item.parentId || !items.some(x => x && x._id === item.parentId)) {
                    clone.upd = { ...(item.upd || {}), StackObjectsCount: 1 };
                }
                return clone;
            })
            : items;
        const asset = this.itemValue(rawAssetItems, instance, true);
        const qualityMultiplier = items.length ? this.getPriceQualityMultiplier(instance, items) : 1;
        let quantityRepresentationMatches = pack;
        let assetFraction = pack ? 1 : 0;
        if (unlimitedTrader) {
            // SPT's RagfairController may expose a trader offer with a sentinel
            // stack/quantity (e.g. 9,999,999) when its stock is unlimited. That
            // is not the item's physical StackObjectsCount. Value one unit, then
            // multiply by the buyer's requested quantity.
            quantityRepresentationMatches = Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= core.EFT_MAX_STACK_COUNT;
            assetFraction = quantityRepresentationMatches ? Number(quantity) : 0;
        } else if (!pack && represented.known) {
            quantityRepresentationMatches = Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= represented.quantity;
            assetFraction = quantityRepresentationMatches ? Math.min(1, Number(quantity) / Math.max(1, represented.quantity)) : 0;
        }
        if (!quantityRepresentationMatches && !pack) {
            asset.complete = false;
            asset.confidence = 'AMBIGUOUS';
        }
        const requestedAssetValue = asset.value * qualityMultiplier * assetFraction;
        return {
            asset, qualityMultiplier, requestedAssetValue, represented,
            quantityRepresentationMatches, traderOrigin, unlimitedTrader, pack
        };
    }

    checkFleaPurchase(instance, profile, request, sessionId) {
        const offer = this.getOffer(safeCall(() => instance.ragfairServer.getOffers(), []), request.item_id);
        if (!offer) return { known: false, valid: true, reason: 'OFFER_NOT_FOUND_FOR_PREFLIGHT' };
        const inventory = profile && profile.Inventory && profile.Inventory.items || [];
        const qty = core.finitePositive(request.count);
        if (!qty) return { known: true, valid: false, reason: 'INVALID_FLEA_QUANTITY' };
        const offerQty = core.finitePositive(offer.quantity)
            || core.finitePositive(offer.items && offer.items[0] && offer.items[0].upd && offer.items[0].upd.StackObjectsCount)
            || qty;
        const pack = offer.sellInOnePiece === true;
        const offerItems = Array.isArray(offer.items) ? offer.items : [];
        const requirementScale = pack ? 1 : qty;
        const explicitlyFree = Array.isArray(offer.requirements) && offer.requirements.length === 0 && Number(offer.requirementsCost) === 0;
        const moneyTpls = this.refreshMoneyTpls(instance, profile, request && request.scheme_items, offer.requirements);
        const expectedPayment = explicitlyFree ? { value: 0, complete: true, validStructure: true, breakdown: [] } : this.requirementValue(offer.requirements, requirementScale, instance, profile, request && request.scheme_items);
        const actual = this.paymentTplMap(request.scheme_items, inventory, instance, profile, offer.requirements);
        const requirementCheck = explicitlyFree
            ? { known: true, valid: Array.isArray(request.scheme_items) && request.scheme_items.length === 0, reason: 'FREE_OFFER', expected: {}, actual: {}, diffs: [], problems: [] }
            : core.comparePaymentToRequirements(request.scheme_items, inventory, offer.requirements, requirementScale, moneyTpls);
        const availabilityCheck = core.validatePaymentAvailability(request.scheme_items, inventory, moneyTpls);
        const ownerId = offer.user && offer.user.id;
        const buyerId = getProfileId(profile, sessionId);
        const isSelf = Boolean(ownerId && buyerId && String(ownerId) === String(buyerId));
        const valuedOffer = this.valueOfferForPurchase(offer, qty, instance);
        const asset = valuedOffer.asset;
        const qualityMultiplier = valuedOffer.qualityMultiplier;
        const adjustedAssetValue = valuedOffer.requestedAssetValue;
        const quantityRepresentationMatches = valuedOffer.quantityRepresentationMatches;
        const represented = valuedOffer.represented;
        const priceCheck = asset.complete && quantityRepresentationMatches ? this.assessPrice(expectedPayment.value, adjustedAssetValue, asset.confidence, adjustedAssetValue) : { known: false, suspicious: false, blockable: false, reason: 'UNKNOWN_OR_AMBIGUOUS_ASSET_QUANTITY', confidence: asset.confidence };
        const offerTpl = offerItems[0] && offerItems[0]._tpl || null;
        const marketEvidence = !pack && offerTpl ? this.getMarketEvidence(instance, offerTpl) : { known: false, sampleCount: 0, sellerCount: 0, reason: pack ? 'PACK_NOT_COMPARABLE_TO_UNIT_MARKET' : 'NO_ITEM_TPL' };
        const marketUnitAsk = !pack ? expectedPayment.value / qty : null;
        const marketRatio = marketEvidence.known && marketEvidence.median > 0 && Number.isFinite(marketUnitAsk) ? marketUnitAsk / marketEvidence.median : null;
        return {
            known: true, offer, ownerId, buyerId, isSelf, requestedCount: qty,
            expectedPayment, actual, requirementCheck, availabilityCheck, asset, priceCheck,
            adjustedAssetValue, qualityMultiplier, marketEvidence, marketRatio, offerTpl, pack, traderOrigin: valuedOffer.traderOrigin, unlimitedTrader: valuedOffer.unlimitedTrader, representedQuantity: represented.quantity, quantityRepresentationMatches,
            blockSelf: isSelf && this.config.flea.blockSelfPurchase !== false,
            blockPayment: !explicitlyFree && ((requirementCheck.known && !requirementCheck.valid) || !availabilityCheck.valid || (!Array.isArray(request.scheme_items) || request.scheme_items.length === 0)),
            blockPrice: expectedPayment.complete && priceCheck.blockable && this.config.flea.blockExtremePrice !== false
        };
    }

    checkRagfairCallbackOffer(controller, profile, requestedOffer, sessionId) {
        const requestItems = requestedOffer && Array.isArray(requestedOffer.items) ? requestedOffer.items : [];
        const offerId = requestedOffer && requestedOffer.id;
        const serverOffer = safeCall(() => controller.tradeController.ragfairServer.getOffer(offerId), null);
        const quantity = core.finitePositive(requestedOffer && requestedOffer.count);
        const inventory = profile && profile.Inventory && Array.isArray(profile.Inventory.items) ? profile.Inventory.items : [];
        if (!serverOffer) {
            return { known: true, valid: false, reason: 'FLEA_OFFER_NOT_FOUND', code: 'FLEA_OFFER_NOT_FOUND', offerId, requestItemCount: requestItems.length };
        }
        if (!quantity || !Number.isSafeInteger(quantity) || quantity > core.EFT_MAX_STACK_COUNT) {
            return { known: true, valid: false, reason: 'FLEA_INVALID_QUANTITY', code: 'FLEA_INVALID_QUANTITY', offerId, quantity, serverOfferFound: true };
        }
        const availableQuantity = core.finitePositive(serverOffer.quantity);
        if (serverOffer.unlimitedCount !== true && availableQuantity > 0 && quantity > availableQuantity) {
            return { known: true, valid: false, reason: 'FLEA_QUANTITY_EXCEEDS_OFFER', code: 'FLEA_INVALID_QUANTITY', offerId, quantity, availableQuantity };
        }

        // SPT 3.11.1 stores the canonical barter scheme on the server offer.
        // The client request's items[] is only the submitted payment selection;
        // it must never be used as the source of truth for the required amount.
        const requirements = Array.isArray(serverOffer.requirements) ? serverOffer.requirements : [];
        const pricingInstance = controller.tradeController || controller;
        const moneyTpls = this.refreshMoneyTpls(pricingInstance, profile, requestItems, requirements);
        const requirementsCost = Number(serverOffer.requirementsCost);
        const explicitlyFree = requirements.length === 0 && Number.isFinite(requirementsCost) && requirementsCost === 0;
        if (!requirements.length && !explicitlyFree) {
            return {
                known: true, valid: false, reason: 'FLEA_PAYMENT_REQUIREMENTS_UNKNOWN',
                code: 'FLEA_PAYMENT_REQUIREMENTS_UNKNOWN', offerId, quantity,
                serverOfferFound: true, requirementsCost: Number.isFinite(requirementsCost) ? requirementsCost : null
            };
        }

        const pack = serverOffer.sellInOnePiece === true;
        // For normal offers requirements.count is per item. For pack offers it
        // describes the whole pack and therefore must not be multiplied.
        const multiplier = pack ? 1 : quantity;
        const expectedPayment = explicitlyFree
            ? { value: 0, complete: true, validStructure: true, breakdown: [] }
            : this.requirementValue(requirements, multiplier, pricingInstance, profile, requestItems);
        const scaledRequirements = requirements.map(req => ({
            ...req,
            count: Number(req.count) * multiplier
        }));
        const balances = this.currencyBalances(profile, moneyTpls);
        const expectedCurrencyPayments = scaledRequirements
            .filter(req => moneyTpls.has(core.normalizeTpl(req && req._tpl)))
            .map(req => {
                const tpl = core.normalizeTpl(req._tpl);
                const required = Math.round(Number(req.count) || 0);
                const available = Number(balances[tpl] || 0);
                return { tpl, required, available, shortfall: Math.max(0, required - available) };
            });
        const currencyShortfalls = expectedCurrencyPayments.filter(x => x.shortfall > 0);
        const missingPayment = !explicitlyFree && requestItems.length === 0;
        // Empty items[] is not a valid proof of sufficient funds. Mark the
        // submitted-item availability as NOT_APPLICABLE, and separately
        // calculate the buyer's balances against the server's exact requirements.
        const availability = requestItems.length > 0
            ? core.validatePaymentAvailability(requestItems, inventory, moneyTpls)
            : { known: false, valid: null, reason: 'NO_PAYMENT_ITEMS_SUBMITTED', problems: [] };
        const scheme = explicitlyFree
            ? { known: true, valid: requestItems.length === 0, reason: requestItems.length ? 'UNEXPECTED_PAYMENT_FOR_FREE_OFFER' : 'FREE_OFFER', expected: {}, actual: {}, diffs: [], problems: [] }
            : core.comparePaymentToRequirements(requestItems, inventory, scaledRequirements, 1, moneyTpls);
        let code = null;
        if (!explicitlyFree && !expectedPayment.validStructure) code = 'FLEA_PAYMENT_REQUIREMENTS_UNKNOWN';
        else if (missingPayment) code = 'FLEA_MISSING_PAYMENT_ITEMS';
        else if (availability.known && !availability.valid) {
            code = availability.problems.some(x => x.reason === 'INSUFFICIENT_CURRENCY')
                ? 'INSUFFICIENT_FLEA_FUNDS' : 'FLEA_INVALID_PAYMENT_ASSET';
        } else if (!scheme.known || !scheme.valid) code = 'FLEA_PAYMENT_SCHEME_MISMATCH';
        const expectedPaymentText = expectedCurrencyPayments.length
            ? expectedCurrencyPayments.map(x => `${x.required.toLocaleString('en-US')} ${this.currencyName(x.tpl)}`).join(' + ')
            : (scaledRequirements.length ? `${scaledRequirements.map(x => `${x.count} x ${x._tpl}`).join(' + ')}` : 'FREE');
        const availablePaymentText = expectedCurrencyPayments.length
            ? expectedCurrencyPayments.map(x => `${x.available.toLocaleString('en-US')} ${this.currencyName(x.tpl)}`).join(' + ')
            : (requestItems.length ? 'payment items submitted; see case evidence' : 'no payment items submitted');

        const offerItems = Array.isArray(serverOffer.items) ? serverOffer.items : [];
        const offerTpl = offerItems[0] && core.normalizeTpl(offerItems[0]._tpl) || null;
        const ownerId = serverOffer.user && serverOffer.user.id || null;
        const buyerId = getProfileId(profile, sessionId);
        const selfPurchase = Boolean(ownerId && buyerId === ownerId);
        const valuedOffer = this.valueOfferForPurchase(serverOffer, quantity, pricingInstance);
        const asset = valuedOffer.asset;
        const qualityMultiplier = valuedOffer.qualityMultiplier;
        const represented = valuedOffer.represented;
        const quantityRepresentationMatches = valuedOffer.quantityRepresentationMatches;
        const requestedAssetValue = valuedOffer.requestedAssetValue;
        const priceCheck = expectedPayment.complete && asset.complete && quantityRepresentationMatches && requestedAssetValue > 0
            ? this.assessPrice(expectedPayment.value, requestedAssetValue, asset.confidence, requestedAssetValue)
            : { known: false, suspicious: false, blockable: false, reason: 'UNKNOWN_PRICE_REFERENCE', confidence: asset.confidence };
        const marketEvidence = !pack && offerTpl ? this.getMarketEvidence(pricingInstance, offerTpl) : { known: false, sampleCount: 0, sellerCount: 0, reason: pack ? 'PACK_NOT_COMPARABLE_TO_UNIT_MARKET' : 'NO_ITEM_TPL' };
        const marketUnitAsk = !pack ? expectedPayment.value / Math.max(1, quantity) : null;
        const marketRatio = marketEvidence.known && marketEvidence.median > 0 && Number.isFinite(marketUnitAsk) ? marketUnitAsk / marketEvidence.median : null;

        return {
            known: true,
            valid: !code && currencyShortfalls.length === 0 && !selfPurchase,
            code: code || (selfPurchase ? 'FLEA_SELF_PURCHASE' : null),
            reason: code || (selfPurchase ? 'FLEA_SELF_PURCHASE' : currencyShortfalls.length ? 'INSUFFICIENT_EXPECTED_CURRENCY_BALANCE' : 'PAYMENT_MATCH'),
            offerId,
            offerOwner: ownerId,
            buyerId,
            selfPurchase,
            sellerMemberType: serverOffer.user && serverOffer.user.memberType !== undefined ? serverOffer.user.memberType : null,
            isBarter: requirements.some(req => !moneyTpls.has(core.normalizeTpl(req && req._tpl))),
            offerRoot: serverOffer.root || (serverOffer.items && serverOffer.items[0] && serverOffer.items[0]._id) || null,
            offerItemTpl: offerTpl,
            expectedPayment,
            asset,
            qualityMultiplier,
            requestedAssetValue,
            representedQuantity: represented.quantity,
            quantityRepresentationMatches,
            traderOrigin: valuedOffer.traderOrigin,
            unlimitedTrader: valuedOffer.unlimitedTrader,
            priceCheck,
            marketEvidence,
            marketRatio,
            offerQuantity: availableQuantity || null,
            requestedQuantity: quantity,
            sellInOnePiece: pack,
            requirements,
            scaledRequirements,
            submittedItems: requestItems,
            availability,
            scheme,
            balances,
            expectedCurrencyPayments,
            currencyShortfalls,
            requiredPaymentText: expectedPaymentText,
            availablePaymentText,
            paymentStatus: missingPayment ? 'MISSING_PAYMENT_ITEMS' : availability.known && !availability.valid ? 'INVALID_OR_UNAVAILABLE_SUBMITTED_PAYMENT' : !scheme.valid ? 'PAYMENT_SCHEME_MISMATCH' : currencyShortfalls.length ? 'INSUFFICIENT_EXPECTED_CURRENCY_BALANCE' : 'VALID',
            explicitlyFree
        };
    }

    checkTraderSell(instance, profile, request, sessionId) {
        const inventory = profile && profile.Inventory && profile.Inventory.items || [];
        const selectedIds = Array.from(new Set((request.items || []).map(i => i && i.id).filter(Boolean)));
        const inventoryById = new Map(inventory.map(item => [item && item._id, item]));
        const selected = selectedIds.map(id => inventoryById.get(id)).filter(Boolean);
        if (!selected.length || selected.length !== selectedIds.length) {
            return { known: false, valid: true, reason: 'TRADER_SELL_ITEMS_UNAVAILABLE', assetValue: 0, confidence: 'LOW' };
        }
        // Trader sell requests identify the selected root item(s), while SPT's
        // inventory stores container contents as separate rows linked by parentId.
        // Expand the exact selected trees before valuation so PackNStrap cases,
        // nested containers, weapon attachments and contained stacks are counted.
        const selectedTree = core.itemTree(selectedIds, inventory);
        if (!selectedTree.length || selectedTree.length < selected.length) {
            return { known: false, valid: true, reason: 'TRADER_SELL_ITEM_TREE_INCOMPLETE', assetValue: 0, confidence: 'LOW' };
        }
        // Trader buyback is based on SPT Handbook value, not LiveFleaPrices/Ragfair
        // dynamic price. Do not let a volatile flea price inflate the trader payout ceiling.
        const asset = this.getTraderSellAssetValue(selectedTree, instance);
        const qualityMultiplier = this.getPriceQualityMultiplier(instance, selectedTree);
        // SPT 3.11.1 TraderHelper.getTrader() returns ITraderBase directly,
        // not a { base } wrapper. The effective buyback coefficient lives on the
        // player's current loyalty-level row, not on ITraderBase itself.
        const traderResult = safeCall(() => instance.traderHelper.getTrader(request.tid, sessionId), null);
        const base = traderResult && traderResult.base ? traderResult.base : traderResult;
        const loyaltyLevel = safeCall(() => instance.traderHelper.getLoyaltyLevel(request.tid, profile), null);
        let effectiveLoyalty = loyaltyLevel;
        if (!effectiveLoyalty && base && Array.isArray(base.loyaltyLevels) && base.loyaltyLevels.length) {
            const traderInfo = profile && profile.TradersInfo && profile.TradersInfo[request.tid];
            const rawLevel = Number(traderInfo && traderInfo.loyaltyLevel);
            const levelNumber = Number.isFinite(rawLevel) && rawLevel >= 1 ? Math.floor(rawLevel) : 1;
            effectiveLoyalty = base.loyaltyLevels[Math.min(base.loyaltyLevels.length, levelNumber) - 1] || base.loyaltyLevels[0];
        }
        const buyPriceCoef = Number((effectiveLoyalty && (effectiveLoyalty.buy_price_coef ?? effectiveLoyalty.buyPriceCoef))
            ?? (base && (base.buy_price_coef ?? base.buyPriceCoef)));
        const currencyTpl = base && base.currency;
        // EFT/SPT defines buy_price_coef as the inverse buyback percentage:
        // actual payout rate = 100 - buy_price_coef. SVM 1.11.1 writes
        // buy_price_coef = 100 - TraderMarkup to every loyalty level.
        if (!asset.value || !asset.complete || asset.confidence !== 'HIGH' || !Number.isFinite(buyPriceCoef)
            || buyPriceCoef < 0 || buyPriceCoef > 100 || !currencyTpl) {
            return { known: false, valid: true, reason: 'TRADER_SELL_REFERENCE_UNAVAILABLE', assetValue: asset.value, confidence: asset.confidence, priceSource: asset.source };
        }
        const buybackPercent = 100 - buyPriceCoef;
        const expectedRub = asset.value * qualityMultiplier * (buybackPercent / 100);
        const actualRub = safeCall(() => instance.handbookHelper.inRUB(Number(request.price), currencyTpl), currencyTpl === '5449016a4bdc2d6f028b456f' ? Number(request.price) : NaN);
        if (!Number.isFinite(actualRub) || actualRub < 0) return { known: false, valid: true, reason: 'TRADER_CURRENCY_CONVERSION_UNAVAILABLE' };
        const multiplier = Number(this.config.trader.maxSellPayoutMultiplier) || 3;
        const safety = Number(this.config.trader.sellPayoutSafetyFactor) || 1.35;
        const ceiling = expectedRub * multiplier * safety;
        const payoutRatio = expectedRub > 0 ? actualRub / expectedRub : null;
        // Intermediate overpayments are sent to a review queue, not blocked.
        // Keep the established hard ceiling separate until real transaction
        // samples justify changing it.
        const reviewMultiplier = Number(this.config.trader.reviewSellPayoutMultiplier) || 2;
        const reviewRequired = payoutRatio !== null && payoutRatio > reviewMultiplier;
        return { known: true, valid: actualRub <= ceiling, expectedRub, actualRub, ceiling, payoutRatio, reviewMultiplier, reviewRequired, assetValue: asset.value, selectedItemCount: selectedTree.length, assetBreakdown: asset.breakdown, qualityMultiplier, confidence: asset.confidence, priceSource: asset.source, traderId: request.tid, buyPriceCoef, buybackPercent, loyaltyLevel: Number(profile && profile.TradersInfo && profile.TradersInfo[request.tid] && profile.TradersInfo[request.tid].loyaltyLevel) || null };
    }

    checkFleaListing(instance, profile, request) {
        const inventory = profile && profile.Inventory && Array.isArray(profile.Inventory.items) ? profile.Inventory.items : [];
        const selected = this.getRootItemsAndQuantity(request.items, inventory);
        const pack = request.sellInOnePiece === true;
        const roots = core.itemTree(request.items || [], inventory);
        const asset = this.itemValue(roots, instance, true);
        const moneyTpls = this.refreshMoneyTpls(instance, profile, [], request && request.requirements);
        const totalPrice = this.requirementValue(request.requirements, 1, instance, profile);
        const structuralProblems = [];
        if (!selected.quantity.valid) structuralProblems.push({ reason: 'LISTING_ROOTS_NOT_OWNED_OR_INVALID', missing: selected.quantity.missing });
        if (request.items && new Set(request.items).size !== request.items.length) structuralProblems.push({ reason: 'DUPLICATE_LISTING_ITEM_IDS' });
        if (!pack && selected.uniqueTpls.length > 1) structuralProblems.push({ reason: 'MULTI_OFFER_MIXED_TEMPLATE_IDS', templates: selected.uniqueTpls });
        if (!totalPrice.validStructure) structuralProblems.push({ reason: 'INVALID_LISTING_PRICE_REQUIREMENTS', breakdown: totalPrice.breakdown });
        if (!Number.isSafeInteger(selected.quantity.total) || selected.quantity.total <= 0) structuralProblems.push({ reason: 'INVALID_LISTING_ROOT_QUANTITY', quantity: selected.quantity.total });
        const quantity = selected.quantity.total || 0;
        const rootTpl = selected.roots[0] && selected.roots[0]._tpl || null;
        const qualityMultiplier = this.getPriceQualityMultiplier(instance, roots);
        const itemPriceMultiplier = 1; // per-template multipliers are already applied by itemValue(..., true)
        const adjustedAssetTotal = asset.value * qualityMultiplier;
        const referenceUnit = pack ? null : adjustedAssetTotal / Math.max(1, quantity);
        const askTotal = pack ? totalPrice.value : totalPrice.value * Math.max(1, quantity);
        const askComparable = pack ? totalPrice.value : totalPrice.value;
        const refComparable = pack ? adjustedAssetTotal : referenceUnit;
        const refFloor = adjustedAssetTotal;
        const priceCheck = this.assessPrice(askComparable, refComparable, asset.confidence, refFloor);
        const marketEvidence = !pack && rootTpl ? this.getMarketEvidence(instance, rootTpl) : { known: false, sampleCount: 0, sellerCount: 0, reason: pack ? 'PACK_NOT_COMPARABLE_TO_UNIT_MARKET' : 'NO_ITEM_TPL' };
        const marketComparePrice = !pack ? totalPrice.value : null;
        const marketRatio = marketEvidence.known && marketEvidence.median > 0 && Number.isFinite(marketComparePrice) ? marketComparePrice / marketEvidence.median : null;
        const taxEstimate = safeCall(() => {
            if (!instance.ragfairTaxService || !selected.roots[0] || typeof instance.ragfairTaxService.calculateTax !== 'function') return null;
            return Number(instance.ragfairTaxService.calculateTax(selected.roots[0], profile, totalPrice.value, quantity, pack));
        }, null);
        return {
            known: structuralProblems.length === 0,
            structuralProblems,
            roots,
            rootTpl,
            quantity,
            pack,
            offerType: pack ? 'PACK' : (selected.roots.length > 1 ? 'MULTI' : 'SINGLE'),
            asset,
            totalPrice,
            askPriceRub: totalPrice.value,
            askUnitPriceRub: pack ? null : totalPrice.value,
            askTotalPriceRub: askTotal,
            referenceTotalRub: adjustedAssetTotal,
            referenceUnitRub: referenceUnit,
            qualityMultiplier,
            itemPriceMultiplier,
            taxEstimateRub: Number.isFinite(taxEstimate) ? taxEstimate : null,
            sellerNetEstimateRub: Number.isFinite(taxEstimate) ? askTotal - taxEstimate : null,
            marketEvidence,
            marketRatio,
            priceCheck,
            blockStructural: structuralProblems.length > 0,
            blockPrice: structuralProblems.length === 0 && priceCheck.blockable && this.config.flea.blockExtremePrice !== false
        };
    }

    checkFence(instance, profile, request) {
        const total = Number(request && request.totalValue);
        const cap = Number(this.config.fence.absoluteMaxPayoutRoubles) || 50000000;
        const validNumber = Number.isFinite(total) && total >= 0;
        return {
            known: true,
            valid: validNumber && (this.config.fence.blockAbsoluteCap === false || total <= cap),
            totalValue: total,
            cap,
            reason: !validNumber ? 'INVALID_FENCE_TOTAL' : total > cap ? 'FENCE_ABSOLUTE_PAYOUT_CAP' : 'WITHIN_CAP'
        };
    }

    recordPlayerFleaPurchase(data) {
        const hasAssetReference = Number.isFinite(Number(data.assetValueRub)) && Number(data.assetValueRub) > 0;
        const confidence = data.priceConfidence || 'UNKNOWN';
        const valuationStatus = !hasAssetReference || confidence === 'LOW' ? 'UNKNOWN_REFERENCE'
            : confidence === 'AMBIGUOUS' ? 'AMBIGUOUS_REFERENCE'
            : confidence === 'MEDIUM' ? 'MEDIUM_CONFIDENCE'
            : confidence === 'ADMIN' ? 'ADMIN_REFERENCE' : 'HIGH_CONFIDENCE';
        const transactionType = data.transactionType || (Number(data.sellerMemberType) === 4 ? 'TRADER_FLEA_PURCHASE' : 'PLAYER_FLEA_PURCHASE');
        const event = {
            timestamp: Date.now(),
            sellerId: String(data.sellerId || 'unknown'),
            buyerId: String(data.buyerId || 'unknown'),
            offerId: data.offerId,
            itemTpl: data.itemTpl,
            itemCount: data.itemCount,
            offerType: data.offerType || (data.sellInOnePiece ? 'PACK' : 'UNIT'),
            sellInOnePiece: data.sellInOnePiece === true,
            valueRub: Number(data.valueRub) || 0,
            assetValueRub: hasAssetReference ? Number(data.assetValueRub) : null,
            priceRatio: hasAssetReference && Number.isFinite(Number(data.priceRatio)) ? Number(data.priceRatio) : null,
            valuationStatus,
            priceConfidence: confidence,
            sellerMemberType: Number.isFinite(Number(data.sellerMemberType)) ? Number(data.sellerMemberType) : null,
            priceReference: data.priceReference || null,
            marketEvidence: data.marketEvidence || null,
            marketRatio: Number.isFinite(Number(data.marketRatio)) ? Number(data.marketRatio) : null,
            transactionType
        };
        this.storage.ledger({ ...event, timestampIso: new Date(event.timestamp).toISOString() });
        this.recentLedger.push(event);
        const max = Number(this.config.flea.maxTrackedEventsInMemory) || 20000;
        if (this.recentLedger.length > max) this.recentLedger.splice(0, this.recentLedger.length - max);
        const isPlayerToPlayer = event.transactionType === 'PLAYER_FLEA_PURCHASE';
        const behavior = isPlayerToPlayer ? core.analyzePairBehavior(this.recentLedger.slice(0, -1).filter(x => x.transactionType === 'PLAYER_FLEA_PURCHASE'), event, this.config.flea || {}) : { suspicious: false, reasons: [], pairKey: null };
        const cycle = isPlayerToPlayer ? core.detectThreePartyCycle(this.recentLedger.slice(-1000).filter(x => x.transactionType === 'PLAYER_FLEA_PURCHASE'), event, (Number(this.config.flea.cycleWindowHours) || 24) * 3600000) : { detected: false, members: [], edges: [] };
        if (isPlayerToPlayer && (behavior.suspicious || cycle.detected)) {
            const key = behavior.pairKey || (cycle.members || []).slice().sort().join('::');
            const now = Date.now();
            const last = this.caseCooldown.get(key) || 0;
            if (now - last > 30 * 60 * 1000) {
                this.caseCooldown.set(key, now);
                this.createCase('SUSPICIOUS_PLAYER_FLEA_PATTERN', 'MEDIUM', { event, behavior, cycle });
            }
        }
        if (event.priceRatio !== null && Number.isFinite(event.priceRatio)) {
            const over = Number(this.config.price.maxOvervalueRatio) || 20;
            const under = Number(this.config.price.minUndervalueRatio) || 0.05;
            if (event.priceRatio > over || event.priceRatio < under) {
                this.createReviewCase('FLEA_COMPLETED_PRICE_ANOMALY_REVIEW', {
                    event,
                    explanation: 'Completed sale exceeded the configured ratio, but the price reference was not strong enough for automatic blocking.'
                }, `completed-price:${event.sellerId}:${event.buyerId}:${event.itemTpl}`);
            }
        } else if (event.valuationStatus === 'UNKNOWN_REFERENCE') {
            this.audit('FLEA_COMPLETED_UNKNOWN_ITEM_REFERENCE', { event });
        }
        this.audit('PLAYER_FLEA_TRADE_COMPLETED', { event, behavior: behavior.suspicious ? behavior : undefined, cycle: cycle.detected ? cycle : undefined });
    }

    currencyBalances(profile, moneyTpls = this.moneyTpls) {
        const inventory = profile && profile.Inventory && Array.isArray(profile.Inventory.items) ? profile.Inventory.items : [];
        const balances = {};
        for (const item of inventory) {
            if (!item || !moneyTpls.has(item._tpl)) continue;
            const stack = core.readStackCount(item);
            if (!stack.valid) continue;
            balances[item._tpl] = (balances[item._tpl] || 0) + stack.count;
        }
        return balances;
    }

    traceTransaction(kind, profile, request, details = {}) {
        const diagnostics = this.config.diagnostics || {};
        if (diagnostics.traceTransactions === false) return;
        const runtime = this.health.runtime;
        runtime.lastTransactionAt = new Date().toISOString();
        runtime.lastTransaction = {
            kind,
            type: request && request.type || null,
            tid: request && request.tid || null,
            itemId: request && request.item_id || null,
            count: request && request.count || null,
            paymentEntries: Array.isArray(request && request.scheme_items)
                ? request.scheme_items.map(x => ({ id: x && x.id, count: x && x.count }))
                : Array.isArray(request && request.items)
                    ? request.items.map(x => ({ id: x && x.id, count: x && x.count }))
                    : Array.isArray(request && request.offers)
                        ? request.offers.flatMap(offer => Array.isArray(offer && offer.items) ? offer.items.map(x => ({ id: x && x.id, count: x && x.count })) : [])
                        : [],
            offerRequests: Array.isArray(request && request.offers)
                ? request.offers.map(offer => ({ id: offer && offer.id || null, count: offer && offer.count || null, paymentItemCount: Array.isArray(offer && offer.items) ? offer.items.length : 0 }))
                : undefined,
            currencyBalances: this.currencyBalances(profile),
            ...details
        };
        this.audit('TRANSACTION_TRACE', runtime.lastTransaction);
        this.writeHealth();
        this.log('info', `TRACE ${kind} type=${runtime.lastTransaction.type || '-'} tid=${runtime.lastTransaction.tid || '-'} item=${runtime.lastTransaction.itemId || '-'} count=${runtime.lastTransaction.count || '-'} funds=${details.fundsValid === undefined ? 'n/a' : details.fundsValid}`);
    }

    installTradeHelper(instance) {
        if (!instance || instance.__economyGuardTradeHelper) return;
        const guard = this;
        const buyTarget = getPatchTarget(instance, 'buyItem');
        if (buyTarget && typeof buyTarget.buyItem === 'function' && !buyTarget.__economyGuardBuyItemHooked) {
            const original = buyTarget.buyItem;
            buyTarget.buyItem = function (profile, request, sessionId, foundInRaid, output) {
                let fleaCheck = null;
                let traderPolicyPurchase = null;
                let traderBuyCheck = null;
                let nativeTraderCheck = null;
                guard.health.runtime.buyItemCalls++;
                try {
                    // Critical SPT 3.11.x transaction-order guard:
                    // TradeHelper.buyItem adds purchased items to stash before PaymentService.payMoney.
                    // If payMoney later reports insufficient funds, SPT does not roll those items back.
                    // Reject unaffordable or synthetic currency references before calling the original.
                    const fundsCheck = guard.checkPaymentAvailability(profile, request || {}, this);
                    if (fundsCheck.known && !fundsCheck.valid) guard.health.runtime.insufficientFundsFindings++;
                    guard.traceTransaction('TRADE_HELPER_BUY_ITEM', profile, request || {}, {
                        fundsValid: fundsCheck.valid,
                        fundsProblems: fundsCheck.problems,
                        purchaseKind: request && request.type || null
                    });
                    if (request && (request.type === 'buy_from_trader' || request.type === 'buy_from_ragfair')) {
                        const accountPolicy = guard.checkPlayerPurchasePolicy(profile, null, 0, 'any', request.tid, sessionId);
                        if (!accountPolicy.valid && accountPolicy.reason === 'PLAYER_BLOCKLISTED') {
                            const evidence = { profileId: getProfileId(profile, sessionId), playerName: profile && profile.Info && profile.Info.Nickname || '', traderId: request.tid, itemId: request.item_id, policy: accountPolicy };
                            if (guard.isProtect()) {
                                guard.health.runtime.policyBlocks++;
                                guard.block(this, output, 'PLAYER_BLOCKLISTED', 'All purchases are disabled for this profile by the administrator blocklist.', evidence);
                                guard.writeHealth();
                                return;
                            }
                            guard.audit('PURCHASE_POLICY_MATCH_AUDIT', { code: 'PLAYER_BLOCKLISTED', ...evidence, enforcement: 'AUDIT_ONLY' });
                        }
                    }
                    if (guard.isProtect() && fundsCheck.known && !fundsCheck.valid && guard.config.trader.blockInsufficientFunds !== false) {
                        guard.block(this, output, 'INSUFFICIENT_OR_INVALID_PAYMENT_ASSET', 'Insufficient or invalid payment assets; purchase stopped before delivery.', { traderId: request && request.tid, itemId: request && request.item_id, fundsCheck });
                        return;
                    }
                    if (!fundsCheck.valid) {
                        guard.warn('PAYMENT_FUNDS_PREFLIGHT_FAILED', "Submitted payment does not match the player's actual profile inventory.", { traderId: request && request.tid, itemId: request && request.item_id, fundsCheck });
                    }
                    if (request && String(request.tid).toLowerCase() === 'ragfair') {
                        fleaCheck = guard.checkFleaPurchase(this, profile, request, sessionId);
                        if (fleaCheck.known && fleaCheck.offerItemTpl) {
                            const policy = guard.checkPlayerPurchasePolicy(profile, fleaCheck.offerItemTpl, fleaCheck.requestedQuantity, guard.getPolicyChannel(fleaCheck.requirements, 'flea'), null, sessionId);
                            if (!policy.valid) {
                                const evidence = { profileId: getProfileId(profile, sessionId), playerName: profile && profile.Info && profile.Info.Nickname || '', offerId: request.item_id, itemTpl: fleaCheck.offerItemTpl, policy };
                                if (guard.isProtect()) {
                                    guard.health.runtime.policyBlocks++;
                                    guard.block(this, output, policy.reason || 'PLAYER_PURCHASE_POLICY_RESTRICTED', 'Flea purchase is restricted by the administrator policy.', evidence);
                                    guard.writeHealth();
                                    return;
                                }
                                guard.audit('PURCHASE_POLICY_MATCH_AUDIT', { code: policy.reason || 'PLAYER_PURCHASE_POLICY_RESTRICTED', ...evidence, enforcement: 'AUDIT_ONLY' });
                            }
                        }
                        if (fleaCheck.known && guard.isProtect()) {
                            if (fleaCheck.blockSelf) {
                                guard.block(this, output, 'FLEA_SELF_PURCHASE', 'Self-purchase of a player offer is not allowed.', { offerId: request.item_id, buyerId: fleaCheck.buyerId, sellerId: fleaCheck.ownerId });
                                return;
                            }
                            if (fleaCheck.blockPayment) {
                                guard.block(this, output, 'FLEA_PAYMENT_MISMATCH', 'Submitted payment items or quantities do not match the server offer requirements.', { offerId: request.item_id, requirementCheck: fleaCheck.requirementCheck });
                                return;
                            }
                            if (fleaCheck.blockPrice) {
                                guard.block(this, output, fleaCheck.priceCheck.reason, 'Offer price is outside the trusted reference range for this item.', { offerId: request.item_id, priceCheck: fleaCheck.priceCheck, asset: fleaCheck.asset });
                                return;
                            }
                        }
                    } else if (request && request.tid && request.tid !== FENCE_ID && request.type !== 'buy_from_ragfair') {
                        if (request.type === 'buy_from_ragfair') {
                            guard.warn('FLEA_TRADER_OFFER_SEEN', 'Trader-origin Flea offer intercepted; payment affordability checked. Offer-level price validation is handled at the Ragfair controller layer.', { traderId: request.tid, itemId: request.item_id, fundsValid: fundsCheck.valid });
                        }
                        const buyCheck = guard.checkTraderBuy(this, profile, request, sessionId);
                        traderBuyCheck = buyCheck;
                        nativeTraderCheck = guard.checkNativeTraderPurchase(this, profile, request, sessionId);
                        if (nativeTraderCheck.applicable) {
                            if (Number.isFinite(nativeTraderCheck.stock)) guard.health.runtime.nativeTraderStockChecks++;
                            if (nativeTraderCheck.hasBuyRestrictions) guard.health.runtime.nativeTraderRestrictionChecks++;
                            guard.audit('TRADER_NATIVE_STOCK_PREFLIGHT', { traderId: request.tid, itemId: request.item_id, check: nativeTraderCheck });
                        }
                        if (nativeTraderCheck.known && !nativeTraderCheck.valid && guard.isProtect()) {
                            if (nativeTraderCheck.code === 'TRADER_STOCK_INSUFFICIENT') guard.health.runtime.traderStockBlocks++;
                            else guard.health.runtime.traderRestrictionBlocks++;
                            guard.block(this, output, nativeTraderCheck.code || 'TRADER_STOCK_INSUFFICIENT', 'Native SPT trader stock or purchase restriction rejected this quantity before item delivery.', { traderId: request.tid, itemId: request.item_id, nativeTraderCheck });
                            guard.writeHealth();
                            return;
                        }
                        if (buyCheck.known && !buyCheck.valid && guard.config.trader.blockInvalidPaymentScheme !== false && guard.isProtect()) {
                            guard.block(this, output, 'TRADER_PAYMENT_SCHEME_MISMATCH', "Payment does not match the trader's live server-side barter scheme.", { traderId: request.tid, itemId: request.item_id, buyCheck });
                            return;
                        }
                        if (buyCheck.itemTpl) {
                            const policy = guard.checkPlayerPurchasePolicy(profile, buyCheck.itemTpl, buyCheck.count, buyCheck.isBarter ? 'trader-barter' : 'trader-money', request.tid, sessionId);
                            if (!policy.valid) {
                                const evidence = { profileId: getProfileId(profile, sessionId), playerName: profile && profile.Info && profile.Info.Nickname || '', traderId: request.tid, itemId: request.item_id, itemTpl: buyCheck.itemTpl, policy, buyCheck };
                                if (guard.isProtect()) {
                                    guard.health.runtime.policyBlocks++;
                                    guard.block(this, output, policy.reason || 'PLAYER_PURCHASE_POLICY_RESTRICTED', 'Purchase is restricted by the administrator policy for this profile and item.', evidence);
                                    guard.writeHealth();
                                    return;
                                }
                                guard.audit('PURCHASE_POLICY_MATCH_AUDIT', { code: policy.reason || 'PLAYER_PURCHASE_POLICY_RESTRICTED', ...evidence, enforcement: 'AUDIT_ONLY' });
                            }
                            if (buyCheck.known && buyCheck.valid) traderPolicyPurchase = { profileId: getProfileId(profile, sessionId), itemTpl: buyCheck.itemTpl, quantity: buyCheck.count, channel: buyCheck.isBarter ? 'trader-barter' : 'trader-money', traderId: request.tid };
                        }
                        if (!buyCheck.known) guard.warn('TRADER_BUY_SCHEME_NOT_CHECKED', 'Live trader barter scheme was unavailable; this check could not be completed.', { traderId: request.tid, itemId: request.item_id, reason: buyCheck.reason });
                    }
                } catch (err) {
                    guard.audit('BUY_PREFLIGHT_ERROR', { error: err.message, traderId: request && request.tid, itemId: request && request.item_id });
                    guard.log('error', `Buy preflight failed open: ${err.stack || err.message}`);
                }

                const result = original.apply(this, arguments);
                if (output && (!Array.isArray(output.warnings) || output.warnings.length === 0)) {
                    if (traderPolicyPurchase) {
                        const p = traderPolicyPurchase;
                        guard.recordPolicyPurchase(p.profileId, p.itemTpl, p.quantity, p.channel, p.traderId, request && request.item_id);
                    }
                    if (traderBuyCheck && traderBuyCheck.known && traderBuyCheck.itemTpl && Number.isFinite(traderBuyCheck.nativeStock)) {
                        const remaining = safeCall(() => this.traderHelper.getTraderAssortsByTraderId(request.tid).items.find(x => x && x._id === request.item_id).upd.StackObjectsCount, null);
                        if (Number.isFinite(Number(remaining)) && Number(remaining) > traderBuyCheck.nativeStock - (Number(request.count) || 0)) {
                            guard.health.runtime.stockAnomalies++;
                            guard.createReviewCase('TRADER_STOCK_NOT_DECREMENTED_REVIEW', { traderId: request.tid, itemId: request.item_id, itemTpl: traderBuyCheck.itemTpl, count: request.count, stockBefore: traderBuyCheck.nativeStock, stockAfter: Number(remaining) }, `stock:${request.tid}:${request.item_id}:${getProfileId(profile, sessionId)}`);
                        }
                    }
                }
                return result;
            };
            buyTarget.__economyGuardBuyItemHooked = true;
            this.health.hooks['TradeHelper.buyItem'] = true;
            this.health.hookScope['TradeHelper.buyItem'] = buyTarget === instance ? 'instance' : 'prototype';
            this.health.coverage.traderBuy = true;
            this.health.coverage.fleaPurchaseViaTradeHelper = true;
            this.health.coverage.paymentAffordability = true;
        }

        const sellTarget = getPatchTarget(instance, 'sellItem');
        if (sellTarget && typeof sellTarget.sellItem === 'function' && !sellTarget.__economyGuardSellItemHooked) {
            const original = sellTarget.sellItem;
            sellTarget.sellItem = function (profileWithItems, profileToReceiveMoney, request, sessionId, output) {
                guard.health.runtime.sellItemCalls++;
                guard.traceTransaction('TRADE_HELPER_SELL_ITEM', profileWithItems, request || {}, { payout: request && request.price });
                try {
                    const check = guard.checkTraderSell(this, profileWithItems, request || {}, sessionId);
                    if (check.known && check.valid && check.reviewRequired) {
                        const selectedIds = Array.from(new Set((request.items || []).map(item => item && item.id).filter(Boolean))).sort();
                        guard.createReviewCase('TRADER_SELL_PAYOUT_REVIEW', {
                            sessionId,
                            traderId: request && request.tid,
                            profileId: String(profileWithItems && (profileWithItems._id || profileWithItems.id) || ''),
                            playerName: String(profileWithItems && profileWithItems.Info && profileWithItems.Info.Nickname || ''),
                            sessionId,
                            playerId: getProfileId(profileWithItems, sessionId),
                            selectedItemIds: selectedIds,
                            check
                        }, `trader-sell:${getProfileId(profileWithItems, sessionId)}:${request && request.tid}:${selectedIds.join(',')}`);
                    }
                    if (check.known && !check.valid && guard.isProtect()) {
                        guard.block(this, output, 'TRADER_SELL_PAYOUT_TOO_HIGH', 'Trader sale payout exceeds the configured conservative item valuation ceiling.', { traderId: request.tid, check });
                        return;
                    }
                    if (!check.known) guard.warn('TRADER_SELL_NOT_FULLY_VALUED', 'Sale value could not be verified because a trusted price reference or currency rate was unavailable; transaction was not blocked.', { traderId: request && request.tid, reason: check.reason });
                } catch (err) {
                    guard.audit('SELL_PREFLIGHT_ERROR', { error: err.message, traderId: request && request.tid });
                    guard.log('error', `Sell preflight failed open: ${err.stack || err.message}`);
                }
                return original.apply(this, arguments);
            };
            sellTarget.__economyGuardSellItemHooked = true;
            this.health.hooks['TradeHelper.sellItem'] = true;
            this.health.hookScope['TradeHelper.sellItem'] = sellTarget === instance ? 'instance' : 'prototype';
            this.health.coverage.traderSell = true;
        }
        instance.__economyGuardTradeHelper = true;
        this.writeHealth();
    }

    installRagfairController(instance) {
        if (!instance || instance.__economyGuardRagfairController || typeof instance.addPlayerOffer !== 'function') return;
        const guard = this;
        const original = instance.addPlayerOffer;
        instance.addPlayerOffer = function (pmcData, offerRequest, sessionId) {
            try {
                const check = guard.checkFleaListing(this, pmcData, offerRequest || {});
                if (check.blockStructural && guard.isProtect()) {
                    const output = this.eventOutputHolder.getOutput(sessionId);
                    guard.block(this, output, 'INVALID_FLEA_LISTING_STRUCTURE', 'Flea listing structure is inconsistent with the selected inventory items.', { sessionId, check });
                    return output;
                }
                if (check.blockPrice && guard.isProtect() && check.totalPrice.complete && check.asset.complete) {
                    const output = this.eventOutputHolder.getOutput(sessionId);
                    guard.block(this, output, check.priceCheck.reason, 'New offer price is outside the trusted per-unit or full-pack reference range.', { sessionId, check });
                    return output;
                }
                if (check.priceCheck && check.priceCheck.known && check.priceCheck.suspicious && !check.priceCheck.blockable) {
                    guard.createReviewCase('FLEA_LISTING_PRICE_REVIEW', { sessionId, itemTpl: check.rootTpl, check, explanation: 'Suspicious price observed; not blocked because the reference is not sufficiently trusted.' }, `listing-price:${sessionId}:${check.rootTpl}`);
                } else if ((!check.asset.complete || check.asset.confidence === 'LOW') && check.askTotalPriceRub >= (Number(guard.config.price.unknownItemReviewThresholdRoubles) || 1000000)) {
                    guard.health.runtime.unknownReferenceReviews++;
                    guard.createReviewCase('UNKNOWN_ITEM_HIGH_VALUE_LISTING_REVIEW', { sessionId, itemTpl: check.rootTpl, check, explanation: 'The custom item has no trusted reference. Listing is allowed; manual review only.' }, `unknown-listing:${sessionId}:${check.rootTpl}`);
                }
                if (check.marketEvidence && check.marketEvidence.known && Number.isFinite(check.marketRatio)) {
                    const mr = Number(check.marketRatio);
                    const reviewHigh = Number(guard.config.price.marketReviewOvervalueRatio) || 10;
                    const reviewLow = Number(guard.config.price.marketReviewUndervalueRatio) || 0.1;
                    if (mr > reviewHigh || mr < reviewLow) {
                        guard.createReviewCase('FLEA_LISTING_VS_ACTIVE_MARKET_REVIEW', { sessionId, itemTpl: check.rootTpl, check, explanation: 'Active market offers disagree with the submitted listing. Active offers are context-only and never trigger an automatic block.' }, `market-listing:${sessionId}:${check.rootTpl}`);
                    }
                }
                guard.audit('FLEA_LISTING_EVALUATED', { sessionId, itemTpl: check.rootTpl, offerType: check.offerType, quantity: check.quantity, sellInOnePiece: check.pack, askUnitPriceRub: check.askUnitPriceRub, askTotalPriceRub: check.askTotalPriceRub, referenceUnitRub: check.referenceUnitRub, referenceTotalRub: check.referenceTotalRub, marketEvidence: check.marketEvidence, marketRatio: check.marketRatio, taxEstimateRub: check.taxEstimateRub, sellerNetEstimateRub: check.sellerNetEstimateRub, confidence: check.asset.confidence, assetComplete: check.asset.complete, suspicious: check.priceCheck.suspicious });
            } catch (err) {
                guard.audit('FLEA_LISTING_PREFLIGHT_ERROR', { error: err.message, sessionId });
                guard.log('error', `Flea listing preflight failed open: ${err.stack || err.message}`);
            }
            const result = original.apply(this, arguments);
            return result;
        };
        instance.__economyGuardRagfairController = true;
        this.health.hooks['RagfairController.addPlayerOffer'] = true;
        this.health.coverage.fleaListing = true;
        this.writeHealth();
    }

    installTradeController(instance) {
        if (!instance || instance.__economyGuardTradeController) return;
        const guard = this;
        const ragfairTarget = getPatchTarget(instance, 'confirmRagfairTrading');
        if (ragfairTarget && typeof ragfairTarget.confirmRagfairTrading === 'function' && !ragfairTarget.__economyGuardRagfairConfirmHooked) {
            const originalConfirmRagfair = ragfairTarget.confirmRagfairTrading;
            ragfairTarget.confirmRagfairTrading = function (pmcData, request, sessionID) {
                guard.health.runtime.ragfairPurchaseCalls++;
                const offers = Array.isArray(request && request.offers) ? request.offers : [];
                const inventory = pmcData && pmcData.Inventory && pmcData.Inventory.items;
                const allPaymentItems = offers.flatMap(x => Array.isArray(x && x.items) ? x.items : []);
                // Validate the whole event as one payment: separate per-offer checks can miss
                // two individually affordable offers whose combined amount exceeds the balance.
                const allRequirements = offers.flatMap(x => { const offer = safeCall(() => this.ragfairServer.getOffer(x && x.id), null); return Array.isArray(offer && offer.requirements) ? offer.requirements : []; });
                const moneyTpls = guard.refreshMoneyTpls(this, pmcData, allPaymentItems, allRequirements);
                const combinedFunds = core.validatePaymentAvailability(allPaymentItems, inventory, moneyTpls);
                const output = safeCall(() => this.eventOutputHolder.getOutput(sessionID), { warnings: [] });
                for (const requestedOffer of offers) {
                    const serverOffer = safeCall(() => this.ragfairServer.getOffer(requestedOffer.id), null);
                    const individualFunds = core.validatePaymentAvailability(requestedOffer && requestedOffer.items, inventory, moneyTpls);
                    guard.traceTransaction('TRADE_CONTROLLER_RAGFAIR_PURCHASE', pmcData, {
                        type: 'RagFairBuyOffer', tid: serverOffer && serverOffer.user && serverOffer.user.id,
                        item_id: requestedOffer && requestedOffer.id, count: requestedOffer && requestedOffer.count,
                        items: requestedOffer && requestedOffer.items
                    }, {
                        fundsValid: individualFunds.valid,
                        fundsProblems: individualFunds.problems,
                        combinedFundsValid: combinedFunds.valid,
                        combinedFundsProblems: combinedFunds.problems,
                        offerFound: Boolean(serverOffer),
                        offerOwner: serverOffer && serverOffer.user && serverOffer.user.id,
                        offerRoot: serverOffer && serverOffer.root,
                        offerCount: serverOffer && serverOffer.count,
                        offerRequirements: serverOffer && serverOffer.requirements
                    });
                }
                if (offers.length > 0 && guard.isProtect() && guard.config.trader.blockInsufficientFunds !== false && !combinedFunds.valid) {
                    guard.block(this, output, 'INSUFFICIENT_FLEA_FUNDS', "Purchase blocked: combined Flea payment exceeds the buyer's available balance.", {
                        offerIds: offers.map(x => x && x.id),
                        fundsCheck: combinedFunds
                    });
                    return output;
                }
                return originalConfirmRagfair.apply(this, arguments);
            };
            ragfairTarget.__economyGuardRagfairConfirmHooked = true;
            this.health.hooks['TradeController.confirmRagfairTrading'] = true;
            this.health.hookScope['TradeController.confirmRagfairTrading'] = ragfairTarget === instance ? 'instance' : 'prototype';
            this.health.coverage.fleaPurchaseController = true;
        } else {
            this.health.hooks['TradeController.confirmRagfairTrading'] = false;
            this.health.coverage.fleaPurchaseController = false;
            // The verified SPT 3.11.1 route enters TradeCallbacks.processRagfairTrade first.
            // A callback-level preflight is sufficient to stop invalid purchases before controller execution.
            this.health.warnings.push('Direct TradeController.confirmRagfairTrading hook unavailable; callback-level Flea preflight is the active protection layer.');
        }
        const tradeTarget = getPatchTarget(instance, 'confirmTrading');
        if (tradeTarget && typeof tradeTarget.confirmTrading === 'function' && !tradeTarget.__economyGuardConfirmTradeHooked) {
            const originalConfirmTrading = tradeTarget.confirmTrading;
            tradeTarget.confirmTrading = function (pmcData, request, sessionID) {
                guard.health.runtime.traderConfirmCalls++;
                guard.traceTransaction('TRADE_CONTROLLER_CONFIRM_TRADING', pmcData, request || {}, { action: request && request.Action });
                return originalConfirmTrading.apply(this, arguments);
            };
            tradeTarget.__economyGuardConfirmTradeHooked = true;
            this.health.hooks['TradeController.confirmTrading'] = true;
            this.health.hookScope['TradeController.confirmTrading'] = tradeTarget === instance ? 'instance' : 'prototype';
        }
        const fenceTarget = getPatchTarget(instance, 'sellScavItemsToFence');
        if (fenceTarget && typeof fenceTarget.sellScavItemsToFence === 'function' && !fenceTarget.__economyGuardFenceSellHooked) {
            const original = fenceTarget.sellScavItemsToFence;
            fenceTarget.sellScavItemsToFence = function (pmcData, request, sessionId) {
                try {
                    const check = guard.checkFence(this, pmcData, request || {});
                    if (check.known && !check.valid && guard.isProtect()) {
                        const output = this.eventOutputHolder.getOutput(sessionId);
                        guard.block(this, output, check.reason, 'Scav sale payout to Fence exceeds the configured absolute safety cap.', { sessionId, check });
                        return output;
                    }
                    if (check.known && check.totalValue > check.cap * 0.8) guard.warn('FENCE_PAYOUT_NEAR_CAP', 'Fence payout is approaching the configured absolute safety cap.', { sessionId, check });
                } catch (err) {
                    guard.audit('FENCE_PREFLIGHT_ERROR', { error: err.message, sessionId });
                    guard.log('error', `Fence preflight failed open: ${err.stack || err.message}`);
                }
                return original.apply(this, arguments);
            };
            fenceTarget.__economyGuardFenceSellHooked = true;
            this.health.hooks['TradeController.sellScavItemsToFence'] = true;
            this.health.hookScope['TradeController.sellScavItemsToFence'] = fenceTarget === instance ? 'instance' : 'prototype';
            this.health.coverage.fenceSellAll = true;
        }
        instance.__economyGuardTradeController = true;
        this.writeHealth();
    }


    installTradeCallbacks(instance) {
        if (!instance) return;
        const guard = this;

        const patchCallback = (methodName, marker, wrapperFactory) => {
            const target = getPatchTarget(instance, methodName);
            if (!target || typeof target[methodName] !== 'function' || target[marker]) return;
            const original = target[methodName];
            target[methodName] = wrapperFactory(original);
            target[marker] = true;
            this.health.hooks[`TradeCallbacks.${methodName}`] = true;
            this.health.hookScope[`TradeCallbacks.${methodName}`] = target === instance ? 'instance' : 'prototype';
        };

        patchCallback('processTrade', '__economyGuardProcessTradeHooked', original => function (pmcData, request, sessionID) {
            guard.health.runtime.tradeCallbackCalls++;
            guard.refreshMoneyTpls(this, pmcData, request && request.scheme_items, []);
            guard.traceTransaction('TRADE_CALLBACK', pmcData, request || {}, { action: request && request.Action });
            const isBuy = request && (request.type === 'buy_from_trader' || request.type === 'buy_from_ragfair');
            if (isBuy) {
                const accountPolicy = guard.checkPlayerPurchasePolicy(pmcData, null, 0, 'any', request && request.tid, sessionID);
                if (!accountPolicy.valid && accountPolicy.reason === 'PLAYER_BLOCKLISTED') {
                    const evidence = { sessionID, profileId: getProfileId(pmcData, sessionID), playerName: pmcData && pmcData.Info && pmcData.Info.Nickname || '', policy: accountPolicy, action: request && request.Action, traderId: request && request.tid };
                    if (guard.isProtect()) {
                        const controller = this.tradeController;
                        const output = safeCall(() => controller.eventOutputHolder.getOutput(sessionID), { warnings: [] });
                        guard.health.runtime.policyBlocks++;
                        guard.block(controller, output, 'PLAYER_BLOCKLISTED', 'All purchases are disabled for this profile by the administrator blocklist.', evidence);
                        guard.writeHealth();
                        return output;
                    }
                    guard.audit('PURCHASE_POLICY_MATCH_AUDIT', { code: 'PLAYER_BLOCKLISTED', ...evidence, enforcement: 'AUDIT_ONLY' });
                }
            }
            if (isBuy && guard.isProtect() && guard.config.trader.blockInsufficientFunds !== false) {
                const entries = Array.isArray(request.scheme_items) ? request.scheme_items : [];
                const moneyTpls = guard.refreshMoneyTpls(this, pmcData, entries, []);
                const fundsCheck = core.validatePaymentAvailability(entries, pmcData && pmcData.Inventory && pmcData.Inventory.items, moneyTpls);
                const missingScheme = !Array.isArray(request.scheme_items) || request.scheme_items.length === 0;
                if (missingScheme || !fundsCheck.valid) {
                    const controller = this.tradeController;
                    const output = safeCall(() => controller.eventOutputHolder.getOutput(sessionID), { warnings: [] });
                    guard.health.runtime.callbackPreflightBlocks++;
                    guard.block(controller, output, 'CALLBACK_INSUFFICIENT_OR_MISSING_PAYMENT', 'Purchase was stopped because its payment could not be verified against the actual profile inventory.', {
                        action: request && request.Action, traderId: request && request.tid, itemId: request && request.item_id,
                        missingScheme, fundsCheck
                    });
                    guard.writeHealth();
                    return output;
                }
            }
            return original.apply(this, arguments);
        });

        patchCallback('processRagfairTrade', '__economyGuardProcessRagfairTradeHooked', original => function (pmcData, request, sessionID) {
            guard.health.runtime.ragfairCallbackCalls++;
            const controller = this.tradeController;
            const offers = Array.isArray(request && request.offers) ? request.offers : [];
            const inventory = pmcData && pmcData.Inventory && pmcData.Inventory.items;
            const evaluations = offers.map(offer => guard.checkRagfairCallbackOffer(this, pmcData, offer, sessionID));
            const profileId = getProfileId(pmcData, sessionID);
            const accountPolicy = guard.checkPlayerPurchasePolicy(pmcData, null, 0, 'any', null, sessionID);
            const policyEvaluations = evaluations.map(check => check && check.offerItemTpl
                ? guard.checkPlayerPurchasePolicy(pmcData, check.offerItemTpl, check.requestedQuantity, guard.getPolicyChannel(check.requirements, 'flea'), null, sessionID)
                : { known: true, valid: true, restricted: false });
            const policyFailure = !accountPolicy.valid ? accountPolicy : policyEvaluations.find(check => !check.valid);
            const allPaymentItems = offers.flatMap(offer => Array.isArray(offer && offer.items) ? offer.items : []);
            const allRequirements = evaluations.flatMap(check => Array.isArray(check && check.requirements) ? check.requirements : []);
            const moneyTpls = guard.refreshMoneyTpls(this, pmcData, allPaymentItems, allRequirements);
            const combinedFunds = core.validatePaymentAvailability(allPaymentItems, inventory, moneyTpls);
            const failed = evaluations.find(check => !check.valid);
            const priceFailure = evaluations.find(check => check && check.valid && check.priceCheck && check.priceCheck.blockable && guard.config.flea.blockExtremePrice !== false);
            const invalidRequest = offers.length === 0;
            guard.traceTransaction('RAGFAIR_CALLBACK', pmcData, {
                type: 'RagFairBuyOffer',
                items: allPaymentItems,
                offers: evaluations
            }, {
                fundsValid: allPaymentItems.length > 0 ? combinedFunds.valid : null,
                fundsCheckApplicable: allPaymentItems.length > 0,
                fundsProblems: combinedFunds.problems,
                schemeValid: evaluations.every(check => check.valid),
                offerCount: offers.length,
                submittedPaymentItemCount: allPaymentItems.length,
                offerEvaluations: evaluations,
                invalidRequest
            });

            if (policyFailure && !guard.isProtect()) {
                guard.audit('PURCHASE_POLICY_MATCH_AUDIT', { code: policyFailure.reason || 'PLAYER_PURCHASE_POLICY_RESTRICTED', sessionID, profileId, playerName: pmcData && pmcData.Info && pmcData.Info.Nickname || '', policy: policyFailure, enforcement: 'AUDIT_ONLY' });
            }
            if (guard.isProtect() && policyFailure) {
                const output = safeCall(() => controller.eventOutputHolder.getOutput(sessionID), { warnings: [] });
                guard.health.runtime.policyBlocks++;
                guard.block(controller, output, policyFailure.reason || 'PLAYER_PURCHASE_POLICY_RESTRICTED', 'This item is restricted for this profile by the administrator purchase policy.', { sessionID, playerName: pmcData && pmcData.Info && pmcData.Info.Nickname || '', policy: policyFailure });
                guard.writeHealth();
                return output;
            }
            if (guard.isProtect() && guard.config.trader.blockInsufficientFunds !== false && (invalidRequest || failed || !combinedFunds.valid)) {
                const output = safeCall(() => controller.eventOutputHolder.getOutput(sessionID), { warnings: [] });
                guard.health.runtime.callbackPreflightBlocks++;
                if (invalidRequest) {
                    guard.block(controller, output, 'INVALID_FLEA_REQUEST', 'Purchase blocked: the Flea request did not contain a valid offer.', { sessionID, offerCount: offers.length });
                } else {
                    const failure = failed || {
                        code: combinedFunds.problems.some(x => x.reason === 'INSUFFICIENT_CURRENCY') ? 'INSUFFICIENT_FLEA_FUNDS' : 'FLEA_INVALID_PAYMENT_ASSET',
                        reason: 'PAYMENT_AVAILABILITY_FAILED',
                        availability: combinedFunds
                    };
                    if (failure.code === 'INSUFFICIENT_FLEA_FUNDS') guard.health.runtime.insufficientFleaFunds++;
                    if (failure.code === 'FLEA_MISSING_PAYMENT_ITEMS') { guard.health.runtime.malformedOfferFindings++; guard.health.runtime.missingPaymentItemsFindings++; }
                    if (failure.code === 'FLEA_PAYMENT_SCHEME_MISMATCH') guard.health.runtime.paymentSchemeMismatches++;
                    guard.block(controller, output, failure.code, failure.reason, {
                        sessionID,
                        playerName: pmcData && pmcData.Info && pmcData.Info.Nickname || '',
                        offerId: failure.offerId,
                        offerOwner: failure.offerOwner,
                        offerRoot: failure.offerRoot,
                        requestedQuantity: failure.requestedQuantity,
                        requirements: failure.scaledRequirements || failure.requirements,
                        submittedItems: failure.submittedItems,
                        availability: failure.availability && failure.availability.known ? failure.availability : null,
                        scheme: failure.scheme,
                        balances: failure.balances || guard.currencyBalances(pmcData),
                        expectedCurrencyPayments: failure.expectedCurrencyPayments,
                        currencyShortfalls: failure.currencyShortfalls,
                        requiredPaymentText: failure.requiredPaymentText,
                        availablePaymentText: failure.availablePaymentText,
                        paymentStatus: failure.paymentStatus,
                        reason: failure.reason
                    });
                }
                guard.writeHealth();
                return output;
            }
            if (guard.isProtect() && priceFailure) {
                guard.health.runtime.fleaPriceBlocks++;
                guard.health.runtime.callbackPreflightBlocks++;
                const output = safeCall(() => controller.eventOutputHolder.getOutput(sessionID), { warnings: [] });
                guard.block(controller, output, priceFailure.priceCheck.reason, 'Flea offer price is outside the trusted server reference range.', {
                    sessionID, playerName: pmcData && pmcData.Info && pmcData.Info.Nickname || '',
                    offerId: priceFailure.offerId, offerOwner: priceFailure.offerOwner, itemTpl: priceFailure.offerItemTpl,
                    requestedQuantity: priceFailure.requestedQuantity, requiredPaymentText: priceFailure.requiredPaymentText,
                    asset: priceFailure.asset, requestedAssetValue: priceFailure.requestedAssetValue,
                    priceCheck: priceFailure.priceCheck, marketEvidence: priceFailure.marketEvidence
                });
                guard.writeHealth();
                return output;
            }
            // In AUDIT mode, record all problems but allow the native SPT path to continue.
            for (const failure of evaluations.filter(check => !check.valid)) {
                guard.audit('FLEA_PAYMENT_PREFLIGHT_FINDING', failure);
            }
            for (const check of evaluations) {
                if (check && check.priceCheck && check.priceCheck.known && check.priceCheck.suspicious && !check.priceCheck.blockable) {
                    guard.createReviewCase('FLEA_PRICE_ANOMALY_REVIEW', {
                        sessionId: sessionID, playerName: pmcData && pmcData.Info && pmcData.Info.Nickname || '',
                        offerId: check.offerId, offerOwner: check.offerOwner, itemTpl: check.offerItemTpl,
                        requestedQuantity: check.requestedQuantity, requiredPaymentText: check.requiredPaymentText,
                        assetValueRub: check.requestedAssetValue, priceConfidence: check.asset && check.asset.confidence,
                        priceCheck: check.priceCheck, marketEvidence: check.marketEvidence, marketRatio: check.marketRatio
                    }, `price:${check.offerOwner}:${check.offerItemTpl}:${sessionID}`);
                } else if (check && check.expectedPayment && !check.expectedPayment.complete) {
                    guard.createReviewCase('FLEA_REQUIREMENT_VALUATION_REVIEW', {
                        sessionId: sessionID, offerId: check.offerId, offerOwner: check.offerOwner, itemTpl: check.offerItemTpl,
                        requestedQuantity: check.requestedQuantity, requiredPaymentText: check.requiredPaymentText,
                        requirementBreakdown: check.expectedPayment.breakdown,
                        requirementStructureValid: check.expectedPayment.validStructure,
                        explanation: 'Payment structure and ownership were checked, but the barter requirement contains an unknown or onlyFunctional component; no automatic price verdict was made.'
                    }, `requirement-valuation:${check.offerItemTpl}:${check.offerOwner}`);
                } else if (check && check.offerItemTpl && check.asset && !check.asset.complete && Number(check.expectedPayment && check.expectedPayment.value) >= Number(guard.config.price && guard.config.price.unknownItemReviewThresholdRoubles || 1000000)) {
                    guard.createReviewCase('UNKNOWN_ITEM_PRICE_REFERENCE_REVIEW', {
                        sessionId: sessionID, offerId: check.offerId, offerOwner: check.offerOwner, itemTpl: check.offerItemTpl,
                        requestedQuantity: check.requestedQuantity, requiredPaymentText: check.requiredPaymentText,
                        unknownTemplates: check.asset.unknown, assetBreakdown: check.asset.breakdown
                    }, `unknown-price:${check.offerItemTpl}:${check.offerOwner}`);
                }
            }
            if (!combinedFunds.valid) guard.audit('FLEA_COMBINED_FUNDS_FINDING', { combinedFunds, offers: offers.map(x => x && x.id) });
            if (evaluations.length && evaluations.every(check => check.valid)) guard.health.runtime.fleaPreflightPasses++;
            guard.writeHealth();
            const result = original.apply(this, arguments);
            if (result && (!Array.isArray(result.warnings) || result.warnings.length === 0)) {
                for (const check of evaluations) {
                    if (check && check.valid && check.offerOwner && check.offerItemTpl && check.expectedPayment && check.expectedPayment.complete) {
                        try {
                            guard.recordPlayerFleaPurchase({
                                sellerId: check.offerOwner,
                                buyerId: profileId,
                                offerId: check.offerId,
                                itemTpl: check.offerItemTpl,
                                itemCount: check.requestedQuantity,
                                offerType: check.sellInOnePiece ? 'PACK' : 'UNIT',
                                sellInOnePiece: check.sellInOnePiece,
                                valueRub: check.expectedPayment.value,
                                assetValueRub: check.asset && check.asset.complete ? check.requestedAssetValue : null,
                                priceRatio: check.priceCheck && check.priceCheck.ratio,
                                priceConfidence: check.asset && check.asset.complete ? check.asset.confidence : 'LOW',
                                sellerMemberType: check.sellerMemberType,
                                priceReference: check.priceCheck,
                                marketEvidence: check.marketEvidence,
                                marketRatio: check.marketRatio
                            });
                        } catch (err) { guard.log('error', `Flea ledger record failed: ${err.message}`); }
                    }
                }
                for (let i = 0; i < evaluations.length; i++) {
                    const check = evaluations[i];
                    if (check && check.offerItemTpl && check.valid) {
                        guard.recordPolicyPurchase(profileId, check.offerItemTpl, check.requestedQuantity, guard.getPolicyChannel(check.requirements, 'flea'), null, check.offerId);
                    }
                }
            }
            return result;
        });

        patchCallback('sellAllFromSavage', '__economyGuardSellAllFromSavageHooked', original => function (pmcData, request, sessionID) {
            guard.health.runtime.fenceCallbackCalls++;
            guard.traceTransaction('FENCE_CALLBACK', pmcData, request || {}, { totalValue: request && request.totalValue });
            const check = guard.checkFence(this.tradeController, pmcData, request || {});
            if (check.known && !check.valid && guard.isProtect()) {
                const controller = this.tradeController;
                const output = safeCall(() => controller.eventOutputHolder.getOutput(sessionID), { warnings: [] });
                guard.health.runtime.callbackPreflightBlocks++;
                guard.block(controller, output, check.reason, 'Scav sale payout to Fence exceeds the configured absolute safety cap; operation stopped before reward mail was issued.', { sessionID, check });
                guard.writeHealth();
                return output;
            }
            return original.apply(this, arguments);
        });

        instance.__economyGuardTradeCallbacks = true;
        this.health.coverage.fleaPurchaseViaCallback = this.health.hooks['TradeCallbacks.processRagfairTrade'] === true;
        this.health.coverage.fleaPurchase = this.health.coverage.fleaPurchaseViaCallback === true
            || this.health.coverage.fleaPurchaseController === true;
        this.writeHealth();
    }


    installLauncherCallbacks(instance) {
        if (!instance) return;
        const guard = this;
        const target = getPatchTarget(instance, 'register');
        if (target && typeof target.register === 'function' && !target.__economyGuardRegisterHooked) {
            const original = target.register;
            target.register = async function (url, info, sessionID) {
                if (!guard.accessControl.state.settings.allowLauncherRegistration) {
                    guard.accessControl.audit('LAUNCHER_REGISTRATION_DENIED', { username: String(info && info.username || '').slice(0, 64), mode: 'ADMIN_CREATED_ONLY' });
                    guard.audit('LAUNCHER_REGISTRATION_DENIED', { username: String(info && info.username || '').slice(0, 64), mode: 'ADMIN_CREATED_ONLY' });
                    return 'FAILED';
                }
                const result = await original.apply(this, arguments);
                if (result === 'OK') {
                    const profiles = safeCall(() => guard.serverContext.saveServer.getProfiles(), {});
                    const found = Object.entries(profiles).find(([, profile]) => profile && profile.info && profile.info.username === info.username);
                    if (found) {
                        const [profileId, profile] = found;
                        guard.accessControl.approveProfile(profileId, { username: profile.info.username, edition: profile.info.edition, source: 'LAUNCHER_REGISTRATION_ALLOWED' });
                        guard.audit('LAUNCHER_ACCOUNT_CREATED', { profileId, username: profile.info.username, source: 'LAUNCHER_REGISTRATION_ALLOWED' });
                    }
                }
                return result;
            };
            target.__economyGuardRegisterHooked = true;
            this.health.hooks['LauncherCallbacks.register'] = true;
            this.health.hookScope['LauncherCallbacks.register'] = target === instance ? 'instance' : 'prototype';
        }
    }

    installLauncherController(instance) {
        if (!instance) return;
        const guard = this;
        const target = getPatchTarget(instance, 'login');
        if (target && typeof target.login === 'function' && !target.__economyGuardLoginHooked) {
            const original = target.login;
            target.login = function (info) {
                const profileId = original.apply(this, arguments);
                if (!profileId) return profileId;
                const decision = guard.accessControl.getLoginDecision(profileId);
                const account = safeCall(() => this.saveServer.getProfile(profileId).info, null);
                if (!decision.allowed) {
                    const details = { profileId, username: String(info && info.username || account && account.username || '').slice(0, 64), code: decision.code, reason: decision.reason };
                    guard.accessControl.audit('LOGIN_DENIED', details);
                    guard.audit('ACCOUNT_LOGIN_DENIED', details);
                    guard.health.runtime.loginBlocks = (Number(guard.health.runtime.loginBlocks) || 0) + 1;
                    guard.health.accessControl.activeBans = guard.accessControl.getStateForPanel().activeBanCount;
                    guard.writeHealth();
                    guard.log('warn', `Login denied for profile ${profileId}: ${decision.code}`);
                    return '';
                }
                guard.health.runtime.loginPasses = (Number(guard.health.runtime.loginPasses) || 0) + 1;
                return profileId;
            };
            target.__economyGuardLoginHooked = true;
            this.health.hooks['LauncherController.login'] = true;
            this.health.hookScope['LauncherController.login'] = target === instance ? 'instance' : 'prototype';
        }
    }

    installFikaPresenceService(instance) {
        if (!instance) return;
        const guard = this;
        const readPresence = (service, profileId) => safeCall(() => service.onlinePlayers && service.onlinePlayers[profileId], null);
        const updateTracked = (service, profileId, isConnect = false) => {
            const presence = readPresence(service, profileId);
            if (!presence) {
                guard.onlinePresence.delete(profileId);
                return;
            }
            const previous = guard.onlinePresence.get(profileId) || {};
            const now = new Date().toISOString();
            guard.onlinePresence.set(profileId, {
                profileId,
                connectedAt: isConnect || !previous.connectedAt ? now : previous.connectedAt,
                lastPresenceUpdateAt: now,
                nickname: presence.nickname || previous.nickname || '',
                level: Number.isFinite(Number(presence.level)) ? Number(presence.level) : null,
                activity: presence.activity,
                activityStartedTimestamp: presence.activityStartedTimestamp,
                raidInformation: presence.raidInformation || null
            });
            if (guard.health.onlinePlayers) guard.health.onlinePlayers.count = guard.onlinePresence.size;
        };
        const patch = (method, kind) => {
            const target = getPatchTarget(instance, method);
            if (!target || typeof target[method] !== 'function' || target[`__economyGuardPresence_${method}`]) return false;
            const original = target[method];
            target[method] = function (profileId) {
                const result = original.apply(this, arguments);
                if (kind === 'remove') {
                    guard.onlinePresence.delete(String(profileId));
                    if (guard.health.onlinePlayers) guard.health.onlinePlayers.count = guard.onlinePresence.size;
                } else updateTracked(this, String(profileId), kind === 'connect');
                return result;
            };
            target[`__economyGuardPresence_${method}`] = true;
            guard.health.hooks[`FikaPresenceService.${method}`] = true;
            guard.health.hookScope[`FikaPresenceService.${method}`] = target === instance ? 'instance' : 'prototype';
            return true;
        };

        patch('addPlayerPresence', 'connect');
        patch('updatePlayerPresence', 'update');
        patch('removePlayerPresence', 'remove');

        // Pick up clients already connected before the service was resolved by our hook.
        const existing = safeCall(() => instance.onlinePlayers || {}, {});
        for (const profileId of Object.keys(existing)) updateTracked(instance, profileId, false);

        this.health.onlinePlayers = {
            available: this.health.hooks['FikaPresenceService.addPlayerPresence'] === true && this.health.hooks['FikaPresenceService.removePlayerPresence'] === true,
            source: 'FIKA_PRESENCE_WEBSOCKET',
            count: this.onlinePresence.size,
            hooks: {
                connect: this.health.hooks['FikaPresenceService.addPlayerPresence'] === true,
                activity: this.health.hooks['FikaPresenceService.updatePlayerPresence'] === true,
                disconnect: this.health.hooks['FikaPresenceService.removePlayerPresence'] === true
            }
        };
        this.log('info', `Fika online-player presence ${this.health.onlinePlayers.available ? 'enabled' : 'partially available'}; current players: ${this.onlinePresence.size}.`);
    }

    installHttpServer(instance) {
        if (!instance) return;
        const guard = this;
        const target = getPatchTarget(instance, 'handleRequest');
        if (target && typeof target.handleRequest === 'function' && !target.__economyGuardHttpAccessHooked) {
            const original = target.handleRequest;
            target.handleRequest = async function (req, resp) {
                const ip = guard.accessControl.getClientIp(req);
                const route = String(req && req.url || '').split('?')[0];
                const sessionId = guard.accessControl.getSessionIdFromRequest
                    ? guard.accessControl.getSessionIdFromRequest(req)
                    : safeCall(() => String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('PHPSESSID='))?.slice('PHPSESSID='.length) || '', '');
                if (!guard.accessControl.isIpAllowed(ip)) {
                    guard.accessControl.recordDeniedRequest(ip, sessionId, route, 'IP_NOT_ALLOWLISTED');
                    guard.health.runtime.ipBlocks = (Number(guard.health.runtime.ipBlocks) || 0) + 1;
                    guard.writeHealth();
                    const body = JSON.stringify({ err: 255, errmsg: 'This server is private. Your IP address is not allowlisted.', data: null });
                    resp.statusCode = 403;
                    resp.setHeader('Content-Type', 'application/json; charset=utf-8');
                    resp.setHeader('Cache-Control', 'no-store');
                    resp.setHeader('Content-Length', Buffer.byteLength(body));
                    resp.end(body);
                    return;
                }
                const authRoute = /^\/launcher\/(profile\/(login|get|register)|server\/(connect|ping|version))\/?$/i.test(route);
                if (sessionId && !authRoute) {
                    const decision = guard.accessControl.getLoginDecision(sessionId);
                    if (!decision.allowed) {
                        guard.accessControl.recordDeniedRequest(ip, sessionId, route, decision.code);
                        guard.health.runtime.sessionBlocks = (Number(guard.health.runtime.sessionBlocks) || 0) + 1;
                        guard.writeHealth();
                        const body = JSON.stringify({ err: 255, errmsg: decision.code === 'ACCOUNT_BANNED' ? 'Your account is banned from this server.' : decision.code === 'ACCOUNT_NOT_ALLOWLISTED' ? 'This account is not approved by the server administrator.' : 'Server access control is unavailable. Contact the server administrator.', data: null });
                        resp.statusCode = 403;
                        resp.setHeader('Content-Type', 'application/json; charset=utf-8');
                        resp.setHeader('Cache-Control', 'no-store');
                        resp.setHeader('Content-Length', Buffer.byteLength(body));
                        resp.end(body);
                        return;
                    }
                }
                guard.accessControl.recordRequest(ip, sessionId, route, 'ALLOWED');
                return original.apply(this, arguments);
            };
            target.__economyGuardHttpAccessHooked = true;
            this.health.hooks['HttpServer.handleRequest'] = true;
            this.health.hookScope['HttpServer.handleRequest'] = target === instance ? 'instance' : 'prototype';
        }
    }

    registerHooks(container) {
        if (!container || typeof container.afterResolution !== 'function') {
            this.health.warnings.push('Container.afterResolution unavailable; server hooks were not installed.');
            this.writeHealth();
            return;
        }
        const register = (token, callback) => {
            try {
                container.afterResolution(token, (_token, instance) => callback.call(this, instance), { frequency: 'Always' });
                this.health.hooks[`${token}.afterResolution`] = true;
                // Resolve now so the initial instances are patched before the first client transaction.
                try {
                    const resolved = container.resolve(token);
                    if (token === 'TradeHelper') callback.call(this, resolved);
                    else if (token === 'RagfairController') callback.call(this, resolved);
                    else if (token === 'TradeController') callback.call(this, resolved);
                    else if (token === 'LauncherCallbacks') callback.call(this, resolved);
                    else if (token === 'LauncherController') callback.call(this, resolved);
                    else if (token === 'HttpServer') callback.call(this, resolved);
                    else if (token === 'FikaPresenceService') callback.call(this, resolved);
                } catch (resolveErr) {
                    this.health.warnings.push(`${token} immediate resolve failed: ${resolveErr.message}`);
                    this.log('warn', `${token} registered but could not be eagerly resolved: ${resolveErr.message}`);
                }
            } catch (err) {
                this.health.hooks[`${token}.afterResolution`] = false;
                this.health.warnings.push(`${token}: ${err.message}`);
                this.log('error', `Could not register ${token}: ${err.message}`);
            }
        };
        register('TradeHelper', this.installTradeHelper);
        register('RagfairController', this.installRagfairController);
        register('TradeController', this.installTradeController);
        register('TradeCallbacks', this.installTradeCallbacks);
        register('LauncherCallbacks', this.installLauncherCallbacks);
        register('LauncherController', this.installLauncherController);
        register('HttpServer', this.installHttpServer);
        register('FikaPresenceService', this.installFikaPresenceService);
        this.health.accessControl.hooks = { launcherRegistration: this.health.hooks['LauncherCallbacks.register'] === true, login: this.health.hooks['LauncherController.login'] === true, httpSessionAndIpGate: this.health.hooks['HttpServer.handleRequest'] === true };
        this.writeHealth();
    }
}

module.exports = { EconomyGuard };
