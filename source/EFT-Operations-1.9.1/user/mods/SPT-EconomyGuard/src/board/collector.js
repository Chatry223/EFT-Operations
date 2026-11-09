'use strict';

// Observes the running SPT/Fika server and feeds the status board. Every wrapper:
//   * calls the original method first-class (same arguments, same `this`, same return value),
//   * never throws into SPT (all board work is inside try/catch),
//   * trips a circuit breaker if it keeps failing, after which the board stops observing but SPT is untouched.

const { cleanName, nameKey, mapName, classifyVictim, publicId } = require('./core');

const PMC_ROLES = new Set(['pmcbear', 'pmcusec']);
const MATCH_STATUS = { 0: 'loading', 1: 'in_game', 2: 'complete' };

function safeCall(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function getPatchTarget(instance, methodName) {
    if (!instance) return null;
    const proto = Object.getPrototypeOf(instance);
    if (proto && Object.prototype.hasOwnProperty.call(proto, methodName) && typeof proto[methodName] === 'function') return proto;
    return instance;
}

class BoardCollector {
    constructor({ store, guard, logger, services = {} }) {
        this.store = store;
        this.guard = guard;
        this.logger = logger || console;
        this.services = services;
        this.raids = new Map();            // raid key -> { key, map, startedAt, bots:Set }
        this.recentEnds = new Map();       // de-duplication of end-of-raid reports
        this.errors = [];
        this.disabled = false;
        this.health = { hooks: {}, errors: 0, disabled: false, lastError: null, botsSeen: 0, raidsRecorded: 0 };
    }

    log(level, message) {
        const fn = this.logger && (this.logger[level] || this.logger.info);
        if (typeof fn === 'function') fn.call(this.logger, `[StatusBoard] ${message}`);
    }

    // ---- fail-safe plumbing -------------------------------------------------------------------------------
    guarded(label, fn) {
        if (this.disabled) return undefined;
        try { return fn(); }
        catch (err) {
            const now = Date.now();
            this.errors = this.errors.filter(t => now - t < 60000);
            this.errors.push(now);
            this.health.errors++;
            this.health.lastError = `${label}: ${err && err.message}`;
            if (this.errors.length > 20) {
                this.disabled = true;
                this.health.disabled = true;
                this.log('error', `Collector disabled after repeated failures (last: ${this.health.lastError}). SPT itself is unaffected.`);
            }
            return undefined;
        }
    }

    // ---- hook installation --------------------------------------------------------------------------------
    install(container) {
        if (!container || typeof container.resolve !== 'function') { this.log('warn', 'No DI container; live collection unavailable.'); return; }
        const hookToken = (token, fn) => {
            let registered = false;
            try {
                if (typeof container.afterResolution === 'function') {
                    container.afterResolution(token, (_t, instance) => { this.guarded(`${token}.install`, () => fn(instance)); }, { frequency: 'Always' });
                    registered = true;
                }
            } catch (err) { this.log('warn', `Could not register ${token}: ${err.message}`); }
            try { fn(container.resolve(token)); registered = true; }
            catch (err) { if (!registered) this.log('warn', `${token} unavailable: ${err.message}`); }
        };
        hookToken('FikaMatchService', inst => { if (inst) this.services.fikaMatchService = inst; this.health.hooks.fikaMatches = !!inst; });
        hookToken('RagfairServer', inst => { if (inst && typeof inst.getOffers === 'function') { this.services.offerSource = () => inst.getOffers(); this.health.hooks.offers = true; } });
        if (!this.services.offerSource) hookToken('RagfairOfferService', inst => { if (inst && typeof inst.getOffers === 'function') { this.services.offerSource = () => inst.getOffers(); this.health.hooks.offers = true; } });
        hookToken('LocaleService', inst => { if (inst) this.services.localeService = inst; });
        hookToken('BotController', inst => this.patchBotGenerate(inst));
        hookToken('MatchCallbacks', inst => this.patchMatchEnd(inst));
        hookToken('LocationLifecycleService', inst => this.patchLifecycleEnd(inst));
    }

    patchBotGenerate(instance) {
        const collector = this;
        const target = getPatchTarget(instance, 'generate');
        if (!target || typeof target.generate !== 'function' || Object.prototype.hasOwnProperty.call(target, '__statusBoardGenerate')) return;
        const original = target.generate;
        target.generate = function (...args) {
            const result = original.apply(this, args);
            collector.guarded('BotController.generate', () => {
                const sessionId = String(args[0] || '');
                const done = bots => collector.guarded('onBotsGenerated', () => collector.onBotsGenerated(sessionId, bots));
                if (result && typeof result.then === 'function') result.then(done, () => { /* original rejection is still delivered to SPT */ });
                else done(result);
            });
            return result;
        };
        Object.defineProperty(target, '__statusBoardGenerate', { value: true, enumerable: false });
        this.health.hooks.botGeneration = true;
    }

    patchMatchEnd(instance) {
        const collector = this;
        const target = getPatchTarget(instance, 'endLocalRaid');
        if (!target || typeof target.endLocalRaid !== 'function' || Object.prototype.hasOwnProperty.call(target, '__statusBoardEnd')) return;
        const original = target.endLocalRaid;
        target.endLocalRaid = function (...args) {
            collector.guarded('MatchCallbacks.endLocalRaid', () => collector.onRaidEnded(String(args[2] || ''), args[1]));
            return original.apply(this, args);
        };
        Object.defineProperty(target, '__statusBoardEnd', { value: true, enumerable: false });
        this.health.hooks.raidEnd = true;
    }

    // Fika assigns its own endLocalRaid on the resolved instance, possibly after this runs. An accessor wraps
    // whatever is assigned later, so the order in which mods load does not matter. onRaidEnded de-duplicates.
    patchLifecycleEnd(instance) {
        if (!instance || instance.__statusBoardAccessor) return;
        const collector = this;
        const wrap = fn => {
            if (typeof fn !== 'function') return fn;
            return function (...args) {
                collector.guarded('LocationLifecycleService.endLocalRaid', () => collector.onRaidEnded(String(args[0] || ''), args[1]));
                return fn.apply(this, args);
            };
        };
        let wrapped = wrap(instance.endLocalRaid);
        try {
            Object.defineProperty(instance, 'endLocalRaid', { configurable: true, enumerable: true, get() { return wrapped; }, set(value) { wrapped = wrap(value); } });
            instance.__statusBoardAccessor = true;
            this.health.hooks.raidEndLifecycle = true;
        } catch (err) { this.log('warn', `Lifecycle raid-end hook unavailable: ${err.message}`); }
    }

    // ---- observations -------------------------------------------------------------------------------------
    resolveRaid(sessionId) {
        const fika = this.services.fikaMatchService;
        const matchId = fika && typeof fika.getMatchIdByProfile === 'function' ? safeCall(() => fika.getMatchIdByProfile(sessionId), undefined) : undefined;
        const key = matchId || sessionId;
        const match = fika && matchId && typeof fika.getMatch === 'function' ? safeCall(() => fika.getMatch(matchId), null) : null;
        const presence = this.guard && this.guard.onlinePresence instanceof Map ? this.guard.onlinePresence.get(sessionId) : null;
        const map = (match && match.locationData && match.locationData.Id) || (presence && presence.raidInformation && presence.raidInformation.location) || '';
        return { key, map };
    }

    realNicknames() {
        const saveServer = this.services.saveServer;
        const set = new Set();
        const profiles = saveServer && typeof saveServer.getProfiles === 'function' ? safeCall(() => saveServer.getProfiles(), {}) : {};
        for (const p of Object.values(profiles)) {
            const n = nameKey(p && p.characters && p.characters.pmc && p.characters.pmc.Info && p.characters.pmc.Info.Nickname);
            if (n) set.add(n);
        }
        return set;
    }

    upsertPmc(key, name, level, side, map) {
        const now = Date.now();
        const registry = this.store.registry.pmcs;
        const entry = registry[key] || { name, level: 1, side: '', kills: 0, deaths: 0, raids: 0, firstSeen: now, lastSeen: now, lastMap: '', statsSince: new Date(now).toISOString() };
        entry.name = name;
        if (Number.isFinite(level) && level > 0) entry.level = Math.floor(level);
        if (side) entry.side = side;
        entry.lastSeen = now;
        if (map) entry.lastMap = map;
        registry[key] = entry;
        return entry;
    }

    onBotsGenerated(sessionId, bots) {
        if (!Array.isArray(bots) || !bots.length) return;
        const real = this.realNicknames();
        const { key, map } = this.resolveRaid(sessionId);
        let raid = this.raids.get(key);
        if (!raid) { raid = { key, map, startedAt: Date.now(), bots: new Set(), ended: false }; this.raids.set(key, raid); }
        if (map && !raid.map) raid.map = map;
        for (const bot of bots) {
            const info = bot && bot.Info;
            if (!info) continue;
            const role = String(info.Settings && info.Settings.Role || '').toLowerCase();
            const side = String(info.Side || '');
            const isPmc = role ? PMC_ROLES.has(role) : /^(usec|bear)$/i.test(side);
            if (!isPmc) continue;
            const name = cleanName(info.Nickname);
            const nk = name.toLowerCase();
            if (!name || real.has(nk)) continue;
            const entry = this.upsertPmc(nk, name, num(info.Level, 1), side, raid.map);
            if (!raid.bots.has(nk)) { raid.bots.add(nk); entry.raids++; this.health.botsSeen++; }
        }
        this.store.markRegistryDirty();
    }

    onRaidEnded(sessionId, info) {
        const results = info && info.results;
        if (!sessionId || !results) return;
        const dedupeKey = `${sessionId}:${info.serverId || ''}:${num(results.playTime)}`;
        const now = Date.now();
        for (const [k, t] of this.recentEnds) if (now - t > 120000) this.recentEnds.delete(k);
        if (this.recentEnds.has(dedupeKey)) return;
        this.recentEnds.set(dedupeKey, now);

        const saveServer = this.services.saveServer;
        const profile = saveServer && typeof saveServer.getProfile === 'function' ? safeCall(() => saveServer.getProfile(sessionId), null) : null;
        const pmcInfo = profile && profile.characters && profile.characters.pmc && profile.characters.pmc.Info;
        const player = cleanName(pmcInfo && pmcInfo.Nickname || results.profile && results.profile.Info && results.profile.Info.Nickname);
        if (!player) return;
        const actor = publicId(this.store.secret, sessionId, 'p');
        const raidInfo = this.resolveRaid(sessionId);
        const serverMap = String(info.serverId || '').split('.')[0];
        const map = mapName(serverMap || raidInfo.map);
        const side = results.profile && results.profile.Info && /savage/i.test(String(results.profile.Info.Side)) ? 'scav' : 'pmc';
        const eft = results.profile && results.profile.Stats && results.profile.Stats.Eft || {};
        const victims = Array.isArray(eft.Victims) ? eft.Victims : [];
        const real = this.realNicknames();
        const at = new Date(now).toISOString();
        const registry = this.store.registry.pmcs;
        let scavKills = 0;

        for (const victim of victims) {
            const vName = cleanName(victim && victim.Name);
            const vKey = vName.toLowerCase();
            let kind = classifyVictim(victim);
            if (kind === 'pmc' && real.has(vKey)) kind = 'player';
            if (kind === 'scav' || kind === 'unknown') { scavKills++; continue; }
            if (kind === 'pmc' && vName) {
                const entry = this.upsertPmc(vKey, vName, num(victim.Level, 1), String(victim.Side || ''), map);
                entry.deaths++;
                entry.raids = Math.max(entry.raids, 1);
            }
            this.store.addEvent({ type: 'kill', at, map, killer: player, victim: kind === 'boss' ? null : vName, victimKind: kind, actors: [actor] });
        }

        const result = String(results.result || '').toLowerCase();
        if (result === 'killed') {
            const aggressor = eft.Aggressor || {};
            const aName = cleanName(aggressor.Name);
            let kind = classifyVictim(aggressor);
            if (kind === 'pmc' && real.has(aName.toLowerCase())) kind = 'player';
            if (kind === 'pmc' && aName) {
                const entry = this.upsertPmc(aName.toLowerCase(), aName, num(aggressor.Level, NaN), String(aggressor.Side || ''), map);
                entry.kills++;
                entry.raids = Math.max(entry.raids, 1);
            }
            this.store.addEvent({ type: 'death', at, map, victim: player, killer: kind === 'pmc' || kind === 'player' ? aName : null, killerKind: kind, actors: [actor] });
        }
        this.store.addEvent({ type: 'raid', at, map, player, side, result: result || 'unknown', kills: victims.length, scavKills, durationSec: Math.max(0, Math.floor(num(results.playTime))), actors: [actor] });
        this.health.raidsRecorded++;

        // The Fika host's end-of-raid report closes the shared raid: its AI PMCs are no longer online.
        const raid = this.raids.get(raidInfo.key);
        if (raid && raidInfo.key === sessionId) this.raids.delete(raidInfo.key);
        this.store.markRegistryDirty();
    }

    // ---- live views ---------------------------------------------------------------------------------------
    getOffers() {
        const source = this.services.offerSource;
        if (!source) return null;
        const offers = safeCall(() => source(), null);
        return Array.isArray(offers) ? offers : null;
    }

    getActiveRaids(now = Date.now(), ttlMinutes = 60) {
        const ttl = ttlMinutes * 60000;
        const fika = this.services.fikaMatchService;
        const out = [];
        const seen = new Set();
        const matches = fika && typeof fika.getAllMatches === 'function' ? safeCall(() => fika.getAllMatches(), null) : null;
        if (matches instanceof Map) {
            for (const [id, match] of matches.entries()) {
                const status = MATCH_STATUS[Number(match && match.status)] || 'in_game';
                if (status === 'complete') continue;
                const tracked = this.raids.get(id);
                const playerIds = match.players instanceof Map ? [...match.players.keys()] : [];
                const deadIds = new Set();
                if (match.players instanceof Map) for (const [pid, p] of match.players.entries()) if (p && p.isDead) deadIds.add(pid);
                out.push({ key: id, map: match.locationData && match.locationData.Id || tracked && tracked.map || '', status, startedAt: tracked ? tracked.startedAt : num(Date.parse(match.timestamp), 0) || now, playerIds, deadIds, bots: tracked ? [...tracked.bots] : [] });
                seen.add(id);
            }
        }
        for (const [key, raid] of this.raids.entries()) {
            if (now - raid.startedAt > ttl) { this.raids.delete(key); continue; }
            if (seen.has(key)) continue;
            if (matches instanceof Map) { this.raids.delete(key); continue; } // Fika knows this raid is gone.
            out.push({ key, map: raid.map, status: 'in_game', startedAt: raid.startedAt, playerIds: [key], deadIds: new Set(), bots: [...raid.bots] });
        }
        return out;
    }
}

module.exports = { BoardCollector, getPatchTarget };
