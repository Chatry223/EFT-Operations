'use strict';

const EFT_MAX_STACK_COUNT = 2147483647;

const MONEY_TPLS = new Set([
    '5449016a4bdc2d6f028b456f', // RUB
    '5696686a4bdc2da3298b456a', // USD
    '569668774bdc2da2298b456b', // EUR
    '5d235b4d86f7742e017bc88a'  // GP Coin (SPT native money)
]);

function readStackCount(item) {
    const raw = item && item.upd ? item.upd.StackObjectsCount : undefined;
    if (raw === undefined || raw === null) return { valid: true, count: 1, defaulted: true };
    const count = Number(raw);
    if (!Number.isSafeInteger(count) || count <= 0 || count > EFT_MAX_STACK_COUNT) {
        return { valid: false, count, defaulted: false, reason: count > EFT_MAX_STACK_COUNT ? 'STACK_COUNT_EXCEEDS_INT32' : 'INVALID_STACK_COUNT' };
    }
    return { valid: true, count, defaulted: false };
}

function finitePositive(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeTpl(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function comparePriceToReference(priceRub, referenceRub, priceCfg = {}) {
    const price = finitePositive(priceRub);
    const reference = finitePositive(referenceRub);
    if (!price || !reference) return { known: false, suspicious: false, reason: 'NO_REFERENCE' };

    const ratio = price / reference;
    const maxRatio = finitePositive(priceCfg.maxOvervalueRatio) || 20;
    const minRatio = finitePositive(priceCfg.minUndervalueRatio) || 0.05;
    return {
        known: true,
        suspicious: ratio > maxRatio || ratio < minRatio,
        reason: ratio > maxRatio ? 'FLEA_PRICE_TOO_HIGH' : ratio < minRatio ? 'FLEA_PRICE_TOO_LOW' : 'WITHIN_RANGE',
        ratio,
        priceRub: price,
        referenceRub: reference
    };
}

function aggregatePaymentItems(requestItems, inventoryItems, moneyTpls = MONEY_TPLS) {
    const byId = new Map((inventoryItems || []).map(item => [item._id, item]));
    const totals = new Map();
    const problems = [];

    for (const entry of requestItems || []) {
        const id = normalizeTpl(entry && entry.id);
        const count = finitePositive(entry && entry.count);
        if (!id || !count || !Number.isSafeInteger(count) || count > EFT_MAX_STACK_COUNT) {
            problems.push({ reason: count > EFT_MAX_STACK_COUNT ? 'PAYMENT_ENTRY_EXCEEDS_INT32' : 'INVALID_PAYMENT_ENTRY', id, count: entry && entry.count });
            continue;
        }
        const invItem = byId.get(id);
        const tpl = invItem ? normalizeTpl(invItem._tpl) : id;
        if (!invItem && !moneyTpls.has(tpl)) {
            problems.push({ reason: 'PAYMENT_ITEM_NOT_OWNED', id, tpl, count });
            continue;
        }
        if (moneyTpls.has(tpl)) {
            // SPT PaymentService aggregates currency by TPL and consumes it across
            // all available stacks. Do not incorrectly cap a currency request to
            // the one stack ID selected by the client; validate total balance in
            // validatePaymentAvailability() below the caller.
            totals.set(tpl, (totals.get(tpl) || 0) + count);
            continue;
        }
        if (invItem) {
            const stack = readStackCount(invItem);
            const available = stack.count;
            if (!stack.valid) {
                problems.push({ reason: stack.reason, id, tpl, available });
                continue;
            }
            if (count > available) {
                problems.push({ reason: 'PAYMENT_EXCEEDS_STACK', id, tpl, count, available });
                continue;
            }
        }
        totals.set(tpl, (totals.get(tpl) || 0) + count);
    }
    return { totals, problems };
}

function comparePaymentToRequirements(requestItems, inventoryItems, requirements, scale = 1, moneyTpls = MONEY_TPLS) {
    const actual = aggregatePaymentItems(requestItems, inventoryItems, moneyTpls);
    const expected = new Map();
    const requirementProblems = [];
    const safeScale = Number(scale);
    for (const req of requirements || []) {
        const tpl = normalizeTpl(req && (req._tpl || req.tpl));
        const baseCount = finitePositive(req && req.count);
        const count = baseCount * safeScale;
        if (!tpl || !baseCount || !Number.isFinite(count) || count <= 0 || !Number.isSafeInteger(Math.ceil(count))) {
            requirementProblems.push({ reason: 'INVALID_SERVER_REQUIREMENT', tpl, count: req && req.count, scale: safeScale });
            continue;
        }
        const normalizedCount = moneyTpls.has(tpl) ? Math.round(count) : count;
        expected.set(tpl, (expected.get(tpl) || 0) + normalizedCount);
    }
    if (!expected.size) return { known: false, valid: false, reason: 'NO_REQUIREMENT_REFERENCE', problems: [...actual.problems, ...requirementProblems] };

    const diffs = [];
    for (const [tpl, required] of expected.entries()) {
        const paid = actual.totals.get(tpl) || 0;
        if (Math.abs(paid - required) > 0.0001) diffs.push({ tpl, required, paid });
    }
    for (const [tpl, paid] of actual.totals.entries()) {
        if (!expected.has(tpl) && paid > 0) diffs.push({ tpl, required: 0, paid });
    }
    return {
        known: true,
        valid: diffs.length === 0 && actual.problems.length === 0 && requirementProblems.length === 0,
        reason: actual.problems.length ? actual.problems[0].reason : requirementProblems.length ? requirementProblems[0].reason : diffs.length ? 'PAYMENT_SCHEME_MISMATCH' : 'MATCH',
        expected: Object.fromEntries(expected),
        actual: Object.fromEntries(actual.totals),
        diffs,
        problems: [...actual.problems, ...requirementProblems]
    };
}


function validatePaymentAvailability(requestItems, inventoryItems, moneyTpls = MONEY_TPLS) {
    const inventory = Array.isArray(inventoryItems) ? inventoryItems : [];
    const byId = new Map(inventory.map(item => [item && item._id, item]).filter(([id]) => typeof id === 'string'));
    const requestedById = new Map();
    const requestedByTpl = new Map();
    const requestedNonMoneyById = new Map();
    const problems = [];

    for (const entry of Array.isArray(requestItems) ? requestItems : []) {
        const id = normalizeTpl(entry && entry.id);
        const count = Number(entry && entry.count);
        if (!id || !Number.isSafeInteger(count) || count <= 0 || count > EFT_MAX_STACK_COUNT) {
            problems.push({ reason: count > EFT_MAX_STACK_COUNT ? 'PAYMENT_ENTRY_EXCEEDS_INT32' : 'INVALID_PAYMENT_ENTRY', id, count: entry && entry.count });
            continue;
        }
        const item = byId.get(id);
        // PaymentService intentionally accepts a currency TPL as an ID for some
        // trusted internal callers. We still permit this representation only
        // after checking the player's real aggregate balance for that currency.
        if (!item && moneyTpls.has(id)) {
            requestedByTpl.set(id, (requestedByTpl.get(id) || 0) + count);
            continue;
        }
        if (!item) {
            problems.push({ reason: 'PAYMENT_ITEM_NOT_OWNED', id, count });
            continue;
        }
        const tpl = normalizeTpl(item._tpl);
        if (moneyTpls.has(tpl)) {
            // SPT consumes requested money by currency TPL across all available stacks,
            // not just the stack whose ID happened to be placed in scheme_items.
            requestedByTpl.set(tpl, (requestedByTpl.get(tpl) || 0) + count);
            continue;
        }
        const stackInfo = readStackCount(item);
        const stack = stackInfo.count;
        if (!stackInfo.valid) {
            problems.push({ reason: stackInfo.reason, id, tpl, stack });
            continue;
        }
        const nextIdTotal = (requestedNonMoneyById.get(id) || 0) + count;
        requestedNonMoneyById.set(id, nextIdTotal);
        requestedById.set(id, nextIdTotal);
        if (nextIdTotal > stack) {
            problems.push({ reason: 'PAYMENT_EXCEEDS_STACK_TOTAL', id, tpl, requested: nextIdTotal, available: stack });
        }
    }

    for (const [tpl, requested] of requestedByTpl.entries()) {
        const available = inventory.reduce((sum, item) => {
            if (!item || item._tpl !== tpl) return sum;
            const stackInfo = readStackCount(item);
            if (!stackInfo.valid) {
                problems.push({ reason: stackInfo.reason, id: item._id, tpl, stack: stackInfo.count });
                return sum;
            }
            return sum + stackInfo.count;
        }, 0);
        if (requested > available) {
            problems.push({ reason: 'INSUFFICIENT_CURRENCY', tpl, requested, available, shortfall: requested - available });
        }
    }

    return {
        known: true,
        valid: problems.length === 0,
        problems,
        requestedById: Object.fromEntries(requestedById),
        requestedByCurrencyTpl: Object.fromEntries(requestedByTpl)
    };
}


function rootStackQuantity(selectedIds, inventoryItems) {
    const byId = new Map((inventoryItems || []).map(item => [item && item._id, item]).filter(([id]) => typeof id === 'string'));
    const ids = Array.isArray(selectedIds) ? selectedIds : [];
    const seen = new Set();
    let total = 0;
    const missing = [];
    for (const id of ids) {
        if (typeof id !== 'string' || !id || seen.has(id)) continue;
        seen.add(id);
        const item = byId.get(id);
        if (!item) { missing.push(id); continue; }
        const stack = readStackCount(item);
        if (!stack.valid) return { known: false, valid: false, total, missing, reason: 'UNSAFE_ROOT_STACK_COUNT', stackReason: stack.reason };
        const count = stack.count;
        total += count;
        if (!Number.isSafeInteger(total)) return { known: false, valid: false, total: null, missing, reason: 'UNSAFE_TOTAL_STACK_COUNT' };
    }
    return { known: true, valid: ids.length > 0 && missing.length === 0, total, missing, rootCount: seen.size };
}

function median(values) {
    const sorted = (values || []).map(Number).filter(Number.isFinite).filter(x => x > 0).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function robustMarketStats(entries) {
    const valid = (entries || []).filter(e => e && Number.isFinite(Number(e.unitPriceRub)) && Number(e.unitPriceRub) > 0);
    const prices = valid.map(e => Number(e.unitPriceRub));
    const center = median(prices);
    if (!center) return { known: false, sampleCount: 0, sellerCount: 0 };
    const deviations = prices.map(x => Math.abs(x - center));
    const mad = median(deviations) || 0;
    // A robust context-only market sample. It is never an independent hard-block source.
    const band = mad > 0 ? Math.max(center * 0.20, mad * 4.5) : center * 0.5;
    const filtered = valid.filter(e => Math.abs(Number(e.unitPriceRub) - center) <= band);
    const filteredPrices = filtered.map(e => Number(e.unitPriceRub));
    const sellers = new Set(filtered.map(e => String(e.sellerId || '')).filter(Boolean));
    return {
        known: filtered.length >= 5 && sellers.size >= 3,
        sampleCount: filtered.length,
        rawSampleCount: valid.length,
        sellerCount: sellers.size,
        median: median(filteredPrices),
        min: filteredPrices.length ? Math.min(...filteredPrices) : null,
        max: filteredPrices.length ? Math.max(...filteredPrices) : null,
        mad
    };
}

function pairKey(a, b) {
    const x = String(a || 'unknown');
    const y = String(b || 'unknown');
    return x < y ? `${x}::${y}` : `${y}::${x}`;
}

function analyzePairBehavior(events, incoming, options = {}) {
    const now = Number(incoming.timestamp) || Date.now();
    const windowMs = (Number(options.pairWindowMinutes) || 10) * 60 * 1000;
    const threshold = Number(options.pairCaseThreshold) || 5;
    const key = pairKey(incoming.sellerId, incoming.buyerId);
    const relevant = (events || []).filter(e =>
        pairKey(e.sellerId, e.buyerId) === key && now - Number(e.timestamp) <= windowMs && now >= Number(e.timestamp)
    );
    const direct = relevant.filter(e => e.sellerId === incoming.sellerId && e.buyerId === incoming.buyerId).length + 1;
    const reverse = relevant.filter(e => e.sellerId === incoming.buyerId && e.buyerId === incoming.sellerId).length;
    const totalValue = relevant.reduce((sum, e) => sum + (Number(e.valueRub) || 0), Number(incoming.valueRub) || 0);
    return {
        pairKey: key,
        directTrades: direct,
        reverseTrades: reverse,
        totalTrades: direct + reverse,
        totalValueRub: totalValue,
        suspicious: direct + reverse >= threshold || (direct >= 2 && reverse >= 2),
        reasons: [
            ...(direct + reverse >= threshold ? ['REPEATED_PAIR_TRADES'] : []),
            ...(direct >= 2 && reverse >= 2 ? ['BIDIRECTIONAL_TRADING'] : [])
        ]
    };
}

function detectThreePartyCycle(events, incoming, maxAgeMs) {
    const now = Number(incoming && incoming.timestamp) || Date.now();
    const cutoff = now - (maxAgeMs || 86400000);
    const adjacency = new Map();
    const addEdge = (from, to) => {
        if (!adjacency.has(from)) adjacency.set(from, new Set());
        adjacency.get(from).add(to);
    };
    for (const e of [...(events || []), incoming]) {
        if (!e || !e.sellerId || !e.buyerId || e.sellerId === e.buyerId) continue;
        const stamp = Number(e.timestamp) || 0;
        if (stamp < cutoff || stamp > now) continue;
        addEdge(String(e.sellerId), String(e.buyerId));
    }
    // O(E * average-degree), rather than a cubic scan of every player ID.
    for (const [a, buyers] of adjacency.entries()) {
        for (const b of buyers) {
            if (a === b) continue;
            const cSet = adjacency.get(b);
            if (!cSet) continue;
            for (const c of cSet) {
                if (c === a || c === b) continue;
                if (adjacency.get(c) && adjacency.get(c).has(a)) {
                    return { detected: true, members: [a, b, c], edges: [`${a}->${b}`, `${b}->${c}`, `${c}->${a}`] };
                }
            }
        }
    }
    return { detected: false, members: [], edges: [] };
}

function itemTree(selectedIds, inventoryItems) {
    const byId = new Map((inventoryItems || []).map(item => [item._id, item]));
    const children = new Map();
    for (const item of inventoryItems || []) {
        const parent = item.parentId;
        if (!parent) continue;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(item);
    }
    const result = [];
    const seen = new Set();
    const visit = id => {
        if (seen.has(id)) return;
        seen.add(id);
        const item = byId.get(id);
        if (!item) return;
        result.push(item);
        for (const child of children.get(id) || []) visit(child._id);
    };
    for (const id of selectedIds || []) visit(id);
    return result;
}

module.exports = {
    MONEY_TPLS,
    EFT_MAX_STACK_COUNT,
    finitePositive,
    readStackCount,
    normalizeTpl,
    comparePriceToReference,
    aggregatePaymentItems,
    comparePaymentToRequirements,
    validatePaymentAvailability,
    analyzePairBehavior,
    detectThreePartyCycle,
    itemTree,
    rootStackQuantity,
    median,
    robustMarketStats
};
