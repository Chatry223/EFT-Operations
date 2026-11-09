'use strict';

// Pure logic for the public status board. Nothing here touches SPT, the file system or the network,
// so every rule (anonymisation, scoring, ranking, market summary) is unit-testable.

const crypto = require('crypto');

const MAP_NAMES = {
    bigmap: 'Customs', customs: 'Customs',
    factory4_day: 'Factory', factory4_night: 'Factory', factory: 'Factory',
    woods: 'Woods', shoreline: 'Shoreline', interchange: 'Interchange',
    rezervbase: 'Reserve', reserve: 'Reserve',
    laboratory: 'The Lab', lab: 'The Lab',
    lighthouse: 'Lighthouse', tarkovstreets: 'Streets of Tarkov', streets: 'Streets of Tarkov',
    sandbox: 'Ground Zero', sandbox_high: 'Ground Zero', groundzero: 'Ground Zero'
};
const ACTIVITY_KEYS = { 0: 'menu', 1: 'raid', 2: 'stash', 3: 'hideout', 4: 'flea' };
const PMC_ROLES = new Set(['pmcbear', 'pmcusec']);
const BOSS_RE = /^(boss|bossbully|bosskilla|bossgluhar|bosssanitar|bosstagilla|bossknight|followerbully|exusec)/i;
const DEFAULT_SCORE_WEIGHTS = { level: 100, kill: 10, survived: 20, headshot: 2, boss: 25, death: 2 };

function cleanName(value, max = 32) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function nameKey(value) { return cleanName(value).toLowerCase(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function round(value, digits = 2) { const f = 10 ** digits; return Math.round(num(value) * f) / f; }

function mapName(id) {
    const raw = String(id || '').trim();
    if (!raw) return '';
    return MAP_NAMES[raw.toLowerCase()] || raw;
}

// Public IDs are keyed hashes. They are stable (so a row keeps its identity between refreshes) but cannot be
// reversed into the SPT profile ID, which doubles as the session cookie for the game backend.
function publicId(secret, rawId, prefix = 'p') {
    const digest = crypto.createHmac('sha256', String(secret)).update(String(rawId)).digest('hex');
    return `${prefix}${digest.slice(0, 12)}`;
}

function readCounter(profile, keyPath) {
    const items = profile && profile.characters && profile.characters.pmc && profile.characters.pmc.Stats
        && profile.characters.pmc.Stats.Eft && profile.characters.pmc.Stats.Eft.OverallCounters
        && profile.characters.pmc.Stats.Eft.OverallCounters.Items;
    if (!Array.isArray(items)) return 0;
    const wanted = keyPath.join('\u0001');
    for (const item of items) {
        if (item && Array.isArray(item.Key) && item.Key.join('\u0001') === wanted) return num(item.Value);
    }
    return 0;
}

function isInfrastructureProfile(profile) {
    const username = String(profile && profile.info && profile.info.username || '');
    return /^headless_/i.test(username);
}

// Returns null when the profile has no in-game character yet (account created but character not made).
function extractPlayerStats(profile) {
    const pmc = profile && profile.characters && profile.characters.pmc;
    const info = pmc && pmc.Info;
    const nickname = cleanName(info && info.Nickname);
    if (!nickname || isInfrastructureProfile(profile)) return null;
    const sessions = readCounter(profile, ['Sessions', 'Pmc']);
    const survived = readCounter(profile, ['ExitStatus', 'Survived', 'Pmc']);
    const kills = readCounter(profile, ['Kills']);
    const deaths = readCounter(profile, ['Deaths']);
    const eft = pmc.Stats && pmc.Stats.Eft || {};
    return {
        nickname,
        level: Math.max(1, Math.floor(num(info.Level, 1))),
        side: String(info.Side || ''),
        experience: num(info.Experience),
        kills, deaths,
        kd: deaths > 0 ? round(kills / deaths) : round(kills),
        killedPmc: readCounter(profile, ['KilledPmc']),
        killedScav: readCounter(profile, ['KilledSavage']),
        killedBoss: readCounter(profile, ['KilledBoss']),
        headshots: readCounter(profile, ['HeadShots']),
        sessions, survived,
        scavSessions: readCounter(profile, ['Sessions', 'Savage']),
        survivalRate: sessions > 0 ? round(survived / sessions * 100, 1) : 0,
        playtimeHours: round(num(eft.TotalInGameTime) / 3600, 1),
        lastSessionAt: num(eft.LastSessionDate) > 0 ? new Date(num(eft.LastSessionDate) * 1000).toISOString() : null
    };
}

// A friendly, honest "about this many" figure: always rounded DOWN, flagged `approx` when it was rounded.
function roundRaids(total) {
    const n = Math.max(0, Math.floor(num(total)));
    const step = n < 50 ? 1 : n < 1000 ? 10 : n < 10000 ? 100 : 1000;
    const value = Math.floor(n / step) * step;
    return { exact: n, value, approx: value < n };
}

function computeScore(stats, weights) {
    const w = { ...DEFAULT_SCORE_WEIGHTS, ...(weights || {}) };
    const raw = num(stats.level) * w.level + num(stats.kills) * w.kill + num(stats.survived) * w.survived
        + num(stats.headshots) * w.headshot + num(stats.killedBoss) * w.boss - num(stats.deaths) * w.death;
    return Math.max(0, Math.round(raw));
}

function rankRows(rows) {
    rows.sort((a, b) => b.score - a.score || b.level - a.level || b.kills - a.kills || a.name.localeCompare(b.name));
    rows.forEach((row, index) => { row.rank = index + 1; });
    return rows;
}

// Works for Victims and Aggressor records. Some game builds omit Role, so Side is the fallback signal:
// Usec/Bear sides are PMCs (AI or human; the caller tells them apart by name), Savage is a scav or boss.
function classifyVictim(victim) {
    const role = String(victim && victim.Role || '').toLowerCase();
    const side = String(victim && victim.Side || '').toLowerCase();
    if (PMC_ROLES.has(role)) return 'pmc';
    if (BOSS_RE.test(role)) return 'boss';
    if ((!role || role === 'usec' || role === 'bear') && (side === 'usec' || side === 'bear')) return 'pmc';
    return role || side ? 'scav' : 'unknown';
}

function priceOfOffer(offer, moneyTpls) {
    const cost = num(offer && (offer.requirementsCost != null ? offer.requirementsCost : offer.summaryCost), NaN);
    const reqs = Array.isArray(offer && offer.requirements) ? offer.requirements : [];
    const barter = reqs.length > 0 && reqs.some(r => !moneyTpls.has(String(r && (r._tpl || r.tpl))));
    if (barter) return { barter: true, total: null };
    if (Number.isFinite(cost) && cost > 0) return { barter: false, total: Math.round(cost) };
    const roubles = reqs.filter(r => String(r && r._tpl) === '5449016a4bdc2d6f028b456f').reduce((s, r) => s + num(r.count), 0);
    return roubles > 0 ? { barter: false, total: Math.round(roubles) } : { barter: false, total: null };
}

function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function summariseMarket(ctx, identity) {
    const offers = Array.isArray(ctx.offers) ? ctx.offers : null;
    if (!offers) return { available: false };
    const settings = ctx.settings;
    const moneyTpls = ctx.moneyTpls || new Set();
    const traders = new Map();
    const items = new Map();
    const playerListings = [];
    let playerOffers = 0, pmcOffers = 0, traderOffers = 0;
    for (const offer of offers) {
        if (!offer || !offer.user) continue;
        const user = offer.user;
        const userId = String(user.id || '');
        const root = Array.isArray(offer.items) && offer.items[0] || null;
        const tpl = root && String(root._tpl || '');
        const qty = Math.max(1, Math.floor(num(root && root.upd && root.upd.StackObjectsCount, 1)));
        const price = priceOfOffer(offer, moneyTpls);
        const realOwner = identity.byAnyId.get(userId);
        if (Number(user.memberType) === 4 || ctx.traderIds && ctx.traderIds.has(userId)) { traderOffers++; continue; }
        if (realOwner) {
            playerOffers++;
            if (!realOwner.hidden && tpl) {
                playerListings.push({ seller: realOwner.nickname, item: ctx.itemName(tpl), tpl, qty, price: price.total, barter: price.barter, startedAt: num(offer.startTime) > 0 ? new Date(num(offer.startTime) * 1000).toISOString() : null, _t: num(offer.startTime) });
            }
        } else {
            pmcOffers++;
            const name = cleanName(user.nickname);
            if (name) {
                const key = name.toLowerCase();
                const row = traders.get(key) || { name, rating: num(user.rating, 0), offers: 0 };
                row.offers++;
                traders.set(key, row);
            }
        }
        if (tpl && price.total && !price.barter) {
            const row = items.get(tpl) || { tpl, listings: 0, units: [] };
            row.listings++;
            row.units.push(price.total / qty);
            items.set(tpl, row);
        }
    }
    const topItems = [...items.values()].sort((a, b) => b.listings - a.listings).slice(0, 15).map(row => ({
        item: ctx.itemName(row.tpl), tpl: row.tpl, listings: row.listings,
        minPrice: Math.round(Math.min(...row.units)), medianPrice: median(row.units.map(Math.round)), maxPrice: Math.round(Math.max(...row.units))
    }));
    playerListings.sort((a, b) => b._t - a._t);
    playerListings.forEach(row => { delete row._t; });
    const marketTraders = [...traders.values()].sort((a, b) => b.offers - a.offers || a.name.localeCompare(b.name));
    return {
        available: true,
        totals: { offers: playerOffers + pmcOffers + traderOffers, playerOffers, pmcOffers, traderOffers, pmcTraders: marketTraders.length },
        topItems,
        playerListings: playerListings.slice(0, 15),
        pmcTraders: settings.showMarketTraders ? marketTraders.slice(0, Math.max(0, Math.min(200, num(settings.marketTradersLimit, 40)))) : [],
        _traders: marketTraders
    };
}

// identity: lookup tables built from live profiles. Raw profile IDs live only inside this function's maps.
function buildIdentity(ctx) {
    const byAnyId = new Map();
    const players = [];
    const hiddenProfiles = ctx.settings.hiddenProfiles || {};
    for (const [profileId, profile] of Object.entries(ctx.profiles || {})) {
        const stats = extractPlayerStats(profile);
        if (!stats) continue;
        const banned = ctx.isBanned ? !!ctx.isBanned(profileId) : false;
        const hidden = !!hiddenProfiles[profileId] || (ctx.settings.hideBanned !== false && banned);
        const entry = { profileId, nickname: stats.nickname, stats, hidden };
        players.push(entry);
        byAnyId.set(profileId, entry);
        const pmcId = profile.characters && profile.characters.pmc && profile.characters.pmc._id;
        const scavId = profile.characters && profile.characters.scav && profile.characters.scav._id;
        if (pmcId) byAnyId.set(String(pmcId), entry);
        if (scavId) byAnyId.set(String(scavId), entry);
    }
    return { players, byAnyId };
}

function buildSnapshot(ctx) {
    const now = ctx.now ? ctx.now() : Date.now();
    const settings = ctx.settings;
    const identity = buildIdentity(ctx);
    const presence = ctx.presence instanceof Map ? ctx.presence : new Map();
    const presenceAvailable = ctx.presenceAvailable === true;
    const knownNames = new Set(identity.players.map(p => p.nickname.toLowerCase()));

    // Active raids first: the PMC online list and the player "in raid" label depend on them.
    const registry = ctx.registry && ctx.registry.pmcs || {};
    const activeRaidsRaw = ctx.activeRaids || [];
    const raids = [];
    const pmcOnline = new Map();
    for (const raid of activeRaidsRaw) {
        const members = [];
        for (const sid of raid.playerIds || []) {
            const entry = identity.byAnyId.get(String(sid));
            if (!entry || entry.hidden) continue;
            members.push({ name: entry.nickname, dead: !!(raid.deadIds && raid.deadIds.has(sid)) });
        }
        const bots = [];
        for (const key of raid.bots || []) {
            const bot = registry[key];
            if (!bot || knownNames.has(key)) continue;
            bots.push(bot.name);
            if (settings.showPmc !== false) pmcOnline.set(key, { name: bot.name, level: bot.level, side: bot.side, map: mapName(raid.map) });
        }
        raids.push({
            id: publicId(ctx.secret, `raid:${raid.key}`, 'r'),
            map: mapName(raid.map), status: raid.status || 'in_game',
            startedAt: raid.startedAt ? new Date(raid.startedAt).toISOString() : null,
            players: members, playerCount: members.length, pmcCount: bots.length
        });
    }

    // Leaderboard rows (real players + AI-controlled PMCs tracked from raids).
    const rows = [];
    const onlinePlayers = [];
    for (const entry of identity.players) {
        if (entry.hidden) continue;
        const p = entry.stats;
        const live = presence.get(entry.profileId);
        const activity = live ? (ACTIVITY_KEYS[Number(live.activity)] || 'online') : null;
        const raidInfo = live && Number(live.activity) === 1 && live.raidInformation || null;
        const row = {
            id: publicId(ctx.secret, entry.profileId, 'p'), kind: 'player', name: p.nickname, level: p.level, side: p.side,
            score: computeScore(p, settings.score), kills: p.kills, deaths: p.deaths, kd: p.kd,
            headshots: p.headshots, killedPmc: p.killedPmc, killedBoss: p.killedBoss, sessions: p.sessions,
            survived: p.survived, survivalRate: p.survivalRate, playtimeHours: p.playtimeHours,
            online: !!live, status: live ? 'online' : 'offline', activity, map: raidInfo ? mapName(raidInfo.location) : '', lastSeen: p.lastSessionAt
        };
        rows.push(row);
        if (live) onlinePlayers.push({ id: row.id, name: row.name, level: row.level, activity, map: row.map, since: num(live.activityStartedTimestamp) > 0 ? new Date(num(live.activityStartedTimestamp) * 1000).toISOString() : null });
    }
    const pmcRows = [];
    if (settings.showPmc !== false) {
        for (const [key, bot] of Object.entries(registry)) {
            if (knownNames.has(key) || !(num(bot.raids) > 0)) continue;
            const stats = { level: bot.level, kills: bot.kills, deaths: bot.deaths, survived: 0, headshots: 0, killedBoss: 0 };
            const live = pmcOnline.get(key);
            const row = {
                id: publicId(ctx.secret, `pmc:${key}`, 'b'), kind: 'pmc', name: bot.name, level: num(bot.level, 1), side: bot.side || '',
                score: computeScore(stats, settings.score), kills: num(bot.kills), deaths: num(bot.deaths),
                kd: num(bot.deaths) > 0 ? round(num(bot.kills) / num(bot.deaths)) : round(num(bot.kills)),
                raids: num(bot.raids), online: !!live, status: live ? 'online' : 'offline', activity: live ? 'raid' : null, map: live ? live.map : mapName(bot.lastMap),
                lastSeen: bot.lastSeen ? new Date(bot.lastSeen).toISOString() : null
            };
            pmcRows.push(row);
        }
    }
    const allRows = rankRows(rows.concat(pmcRows));
    const leaderboard = allRows.slice(0, Math.max(10, Math.min(500, num(settings.leaderboardLimit, 200))));

    // Market + trades
    const market = summariseMarket(ctx, identity);
    const marketTraders = market._traders || [];
    delete market._traders;
    const trades = [];
    if (settings.sections.trades !== false) {
        for (const e of (ctx.ledger || []).slice(-60).reverse()) {
            const buyer = identity.byAnyId.get(String(e.buyerId));
            if (!buyer || buyer.hidden) continue;
            const seller = identity.byAnyId.get(String(e.sellerId));
            if (seller && seller.hidden) continue;
            trades.push({
                at: new Date(num(e.timestamp, now)).toISOString(), buyer: buyer.nickname,
                seller: seller ? seller.nickname : null, sellerKind: seller ? 'player' : 'pmc',
                item: ctx.itemName(e.itemTpl), qty: num(e.itemCount, 1), valueRub: Math.round(num(e.valueRub))
            });
            if (trades.length >= 25) break;
        }
    }

    const online = {
        available: presenceAvailable,
        players: onlinePlayers.sort((a, b) => a.name.localeCompare(b.name)),
        pmc: [...pmcOnline.values()].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)).slice(0, 150),
        market: settings.showMarketTraders && market.available ? marketTraders.slice(0, Math.max(0, Math.min(200, num(settings.marketTradersLimit, 40)))).map(t => ({ name: t.name, rating: round(t.rating, 1), offers: t.offers })) : []
    };
    const inRaidPlayers = onlinePlayers.filter(p => p.activity === 'raid').length;
    // "Online" = everyone present right now: real players on the server, AI PMCs inside an active raid and
    // (optionally) flea-market sellers with live offers. Each name counts once; anyone who leaves those lists is offline.
    const onlineKeys = new Set(onlinePlayers.map(p => p.name.toLowerCase()));
    for (const key of pmcOnline.keys()) onlineKeys.add(key);
    if (settings.onlineIncludesMarket !== false && market.available) {
        for (const trader of marketTraders) {
            const key = trader.name.toLowerCase();
            if (!knownNames.has(key)) onlineKeys.add(key);
        }
    }
    const sessionsTotal = identity.players.reduce((sum, p) => sum + p.stats.sessions + p.stats.scavSessions, 0);
    const counters = {
        online: onlineKeys.size,
        raidsCompleted: roundRaids(sessionsTotal),
        playersOnline: onlinePlayers.length,
        playersInRaid: inRaidPlayers,
        pmcInRaid: pmcOnline.size,
        activeRaids: raids.length,
        registeredPlayers: identity.players.filter(p => !p.hidden).length,
        trackedPmc: pmcRows.length,
        marketOffers: market.available ? market.totals.offers : null,
        marketTraders: market.available ? market.totals.pmcTraders : null,
        totalKills: rows.reduce((s, r) => s + r.kills, 0)
    };

    // Events never reveal hidden (or banned, when hideBanned is on) players, neither as reporter nor as killer/victim.
    const hiddenPids = new Set(identity.players.filter(p => p.hidden).map(p => publicId(ctx.secret, p.profileId, 'p')));
    const hiddenNames = new Set(identity.players.filter(p => p.hidden).map(p => p.nickname.toLowerCase()));
    const mentionsHidden = e => [e.player, e.killer, e.victim].some(n => n && hiddenNames.has(String(n).toLowerCase()));
    const events = (ctx.events || [])
        .filter(e => !(e.actors || []).some(a => hiddenPids.has(a)) && !mentionsHidden(e))
        .slice(-80).reverse()
        .map(e => { const { actors, ...rest } = e; return rest; });
    return {
        meta: {
            name: settings.serverName, tagline: settings.tagline, language: settings.language, accent: settings.accent,
            refreshSeconds: settings.refreshSeconds, allowLanguageSwitch: settings.allowLanguageSwitch !== false,
            background: ctx.background || null, sections: settings.sections, showPmc: settings.showPmc !== false,
            showPmcBadge: settings.showPmcBadge === true, layout: settings.layout, onlineIncludesMarket: settings.onlineIncludesMarket !== false,
            generatedAt: new Date(now).toISOString()
        },
        counters,
        online,
        leaderboard,
        raids,
        market,
        trades,
        events,
        announcements: Array.isArray(ctx.announcements) ? ctx.announcements : []
    };
}

module.exports = {
    MAP_NAMES, DEFAULT_SCORE_WEIGHTS, cleanName, nameKey, mapName, publicId, readCounter, extractPlayerStats,
    computeScore, roundRaids, rankRows, classifyVictim, summariseMarket, buildIdentity, buildSnapshot, isInfrastructureProfile
};
