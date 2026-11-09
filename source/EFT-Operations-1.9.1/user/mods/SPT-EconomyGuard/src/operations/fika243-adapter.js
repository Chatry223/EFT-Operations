'use strict';

// Read-only integration observer for the user's verified Fika Server 2.4.3 build.
// It never changes raid state, player profiles, rewards, or Fika's match lifecycle.
const fs = require('fs');
const path = require('path');

const EXPECTED_FIKA_VERSION = '2.4.3';
const MAX_EVENTS = 250;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function safe(fn, fallback = null) { try { return fn(); } catch (_) { return fallback; } }
function object(value) { return value && typeof value === 'object' ? value : {}; }

class Fika243OperationsAdapter {
    constructor({ modDir, operations, logger = console, services = {} } = {}) {
        this.modDir = modDir;
        this.operations = operations || null;
        this.logger = logger || console;
        this.services = services || {};
        this.dataDir = this.operations && this.operations.dataDir ? this.operations.dataDir : path.join(modDir || '.', 'SPT-EconomyGuard-Data', 'operations');
        this.eventsFile = path.join(this.dataDir, 'fika-events.jsonl');
        this.events = [];
        this.patched = new Set();
        this.status = this.detectVersion();
    }

    log(level, message) {
        const fn = this.logger && (this.logger[level] || this.logger.info);
        if (typeof fn === 'function') fn.call(this.logger, `[EFT Operations/Fika 2.4.3] ${message}`);
    }

    detectVersion() {
        const packagePath = path.resolve(this.modDir || '.', '..', 'fika-server', 'package.json');
        try {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            const version = String(pkg.version || 'unknown');
            const sptVersion = String(pkg.sptVersion || 'unknown');
            return {
                detected: true,
                enabled: version === EXPECTED_FIKA_VERSION && /^~?3\.11(?:\.|$)/.test(sptVersion),
                serverVersion: version,
                sptVersion,
                expectedServerVersion: EXPECTED_FIKA_VERSION,
                packagePath,
                reason: version !== EXPECTED_FIKA_VERSION ? 'FIKA_VERSION_MISMATCH' : (!/^~?3\.11(?:\.|$)/.test(sptVersion) ? 'SPT_VERSION_MISMATCH' : null)
            };
        } catch (err) {
            return {
                detected: false,
                enabled: false,
                serverVersion: null,
                sptVersion: null,
                expectedServerVersion: EXPECTED_FIKA_VERSION,
                packagePath,
                reason: 'FIKA_SERVER_PACKAGE_NOT_FOUND',
                detail: err && err.code ? err.code : 'READ_FAILED'
            };
        }
    }

    install(container) {
        if (!this.status.enabled) {
            this.log('warn', `Fika observer disabled: ${this.status.reason || 'unsupported version'} (detected ${this.status.serverVersion || 'unknown'}).`);
            return false;
        }
        if (!container || typeof container.resolve !== 'function') {
            this.status.reason = 'DI_CONTAINER_UNAVAILABLE';
            return false;
        }
        this.hook(container, 'SaveServer', instance => { this.services.saveServer = instance; });
        this.hook(container, 'FikaMatchService', instance => {
            this.services.fikaMatchService = instance;
            this.patchMatchService(instance);
        });
        this.hook(container, 'LocationLifecycleService', instance => this.patchLifecycle(instance));
        this.status.observerInstalled = true;
        this.log('info', `Read-only hooks installed for Fika Server ${EXPECTED_FIKA_VERSION}; raid outcomes remain untrusted until reviewed.`);
        return true;
    }

    hook(container, token, callback) {
        let registered = false;
        try {
            if (typeof container.afterResolution === 'function') {
                container.afterResolution(token, (_token, instance) => safe(() => callback(instance)), { frequency: 'Always' });
                registered = true;
            }
        } catch (err) { this.log('warn', `${token} hook registration failed: ${err.message}`); }
        try { callback(container.resolve(token)); registered = true; }
        catch (_) { if (!registered) this.log('debug', `${token} is not available yet.`); }
    }

    patchLifecycle(instance) {
        if (!instance) return false;
        const proto = Object.getPrototypeOf(instance);
        const target = proto && Object.prototype.hasOwnProperty.call(proto, 'endLocalRaid') ? proto : instance;
        if (!target || typeof target.endLocalRaid !== 'function' || target.__egFika243LifecycleHook) return false;
        const adapter = this;
        const original = target.endLocalRaid;
        target.endLocalRaid = function (sessionId, request, ...rest) {
            const result = original.call(this, sessionId, request, ...rest);
            safe(() => adapter.captureRaidEnd(sessionId, request));
            return result;
        };
        Object.defineProperty(target, '__egFika243LifecycleHook', { value: true, enumerable: false });
        this.status.lifecycleHook = true;
        return true;
    }

    patchMatchService(instance) {
        if (!instance) return false;
        const proto = Object.getPrototypeOf(instance);
        const target = proto && Object.prototype.hasOwnProperty.call(proto, 'endMatch') ? proto : instance;
        if (!target || typeof target.endMatch !== 'function' || target.__egFika243MatchHook) return false;
        const adapter = this;
        const original = target.endMatch;
        target.endMatch = function (matchId, reason, ...rest) {
            safe(() => adapter.captureMatchEnd(this, matchId, reason));
            return original.call(this, matchId, reason, ...rest);
        };
        Object.defineProperty(target, '__egFika243MatchHook', { value: true, enumerable: false });
        this.status.matchEndHook = true;
        return true;
    }

    resolveIdentity(sessionId) {
        const profile = safe(() => this.services.saveServer && this.services.saveServer.getProfile(sessionId), null);
        const characters = object(profile && profile.characters);
        const pmcId = String(object(characters.pmc)._id || '');
        const scavId = String(object(characters.scav)._id || '');
        return { profileId: pmcId || String(sessionId || ''), pmcId, scavId };
    }

    resolveMatchId(sessionId, identity) {
        const service = this.services.fikaMatchService;
        if (!service) return null;
        return safe(() => service.getMatchIdByProfile && service.getMatchIdByProfile(sessionId), null)
            || safe(() => identity.pmcId && service.getMatchIdByPlayer && service.getMatchIdByPlayer(identity.pmcId), null)
            || safe(() => identity.scavId && service.getMatchIdByPlayer && service.getMatchIdByPlayer(identity.scavId), null)
            || safe(() => service.getMatchIdByPlayer && service.getMatchIdByPlayer(sessionId), null);
    }

    captureRaidEnd(sessionId, request) {
        const results = object(object(request).results);
        const identity = this.resolveIdentity(sessionId);
        const matchId = this.resolveMatchId(sessionId, identity);
        const serverId = String(object(request).serverId || '');
        const map = serverId.split('.')[0] || '';
        const event = {
            eventId: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
            type: 'player_raid_end',
            timestamp: new Date().toISOString(),
            fikaServerVersion: EXPECTED_FIKA_VERSION,
            matchId: matchId ? String(matchId) : null,
            profileId: identity.profileId,
            map,
            sptServerId: serverId,
            exitStatus: String(results.result || 'Unknown'),
            exitName: String(results.exitName || ''),
            playTimeSeconds: Number.isFinite(Number(results.playTime)) ? Number(results.playTime) : null,
            evidenceTrust: 'untrusted_client_report',
            rewardEligible: false
        };
        this.appendEvent(event);
        return event;
    }

    captureMatchEnd(service, matchId, reason) {
        const match = safe(() => service.getMatch && service.getMatch(matchId), null);
        const players = match && match.players instanceof Map ? [...match.players.keys()].map(String) : [];
        const event = {
            eventId: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
            type: 'fika_match_end',
            timestamp: new Date().toISOString(),
            fikaServerVersion: EXPECTED_FIKA_VERSION,
            matchId: String(matchId || ''),
            reason: String(reason || ''),
            players,
            evidenceTrust: 'lifecycle_observation',
            rewardEligible: false
        };
        this.appendEvent(event);
        return event;
    }

    appendEvent(event) {
        try {
            fs.mkdirSync(this.dataDir, { recursive: true });
            if (fs.existsSync(this.eventsFile) && fs.statSync(this.eventsFile).size > MAX_LOG_BYTES) {
                const rotated = `${this.eventsFile}.1`;
                try { fs.rmSync(rotated, { force: true }); } catch (_) { /* best effort */ }
                fs.renameSync(this.eventsFile, rotated);
            }
            fs.appendFileSync(this.eventsFile, `${JSON.stringify(event)}\n`, 'utf8');
            this.events.push(event);
            if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
        } catch (err) { this.log('warn', `Could not persist Fika event: ${err.message}`); }
    }

    getRecentEvents(limit = 100) {
        const max = Math.max(1, Math.min(500, Number(limit) || 100));
        let rows = [];
        try {
            if (fs.existsSync(this.eventsFile)) {
                rows = fs.readFileSync(this.eventsFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-max).map(line => JSON.parse(line));
            }
        } catch (err) { this.log('warn', `Could not read Fika event log: ${err.message}`); }
        return rows.reverse();
    }

    getStatus() { return { ...this.status, clientPluginVersion: '1.2.3', clientPluginEvidence: 'BepInEx/config/com.fika.core.cfg (Last Version)' }; }
}

module.exports = { Fika243OperationsAdapter, EXPECTED_FIKA_VERSION };
