'use strict';

// Version-gated Fika Server 2.4.3 observer and mission-group lifecycle bridge.
// It never changes Fika's own raid state or trusts client reports for automatic rewards.
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
        this.hook(container, 'FikaUpdateCallbacks', instance => this.patchUpdateCallbacks(instance));
        this.hook(container, 'FikaRaidCallbacks', instance => this.patchRaidCallbacks(instance));
        this.hook(container, 'FikaMatchService', instance => {
            this.services.fikaMatchService = instance;
            this.patchMatchService(instance);
        });
        this.hook(container, 'LocationLifecycleService', instance => this.patchLifecycle(instance));
        this.status.observerInstalled = true;
        this.log('info', `Fika ${EXPECTED_FIKA_VERSION} match/player lifecycle hooks installed; mission groups link after all ready members join. Client outcomes remain untrusted.`);
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

    patchUpdateCallbacks(instance) {
        if (!instance) return false;
        const proto = Object.getPrototypeOf(instance);
        const hasHooks = proto && (Object.prototype.hasOwnProperty.call(proto, 'handleRaidAddPlayer') || Object.prototype.hasOwnProperty.call(proto, 'handlePlayerDied'));
        const target = hasHooks ? proto : instance;
        const adapter = this;
        let patched = false;
        for (const methodName of ['handleRaidAddPlayer', 'handlePlayerDied']) {
            if (typeof target[methodName] !== 'function') continue;
            const flag = '__egFika243Identity_' + methodName;
            if (target[flag]) continue;
            const original = target[methodName];
            target[methodName] = function (url, info, sessionId, ...rest) {
                adapter.assertProfileBelongsToSession(sessionId, object(info).profileId, methodName);
                return original.call(this, url, info, sessionId, ...rest);
            };
            Object.defineProperty(target, flag, { value: true, enumerable: false });
            patched = true;
        }
        this.status.updateIdentityHook = patched;
        return patched;
    }

    patchRaidCallbacks(instance) {
        if (!instance) return false;
        const proto = Object.getPrototypeOf(instance);
        const hasHooks = proto && (Object.prototype.hasOwnProperty.call(proto, 'handleRaidCreate') || Object.prototype.hasOwnProperty.call(proto, 'handleRaidLeave'));
        const target = hasHooks ? proto : instance;
        const adapter = this;
        let patched = false;
        for (const methodName of ['handleRaidCreate', 'handleRaidLeave']) {
            if (typeof target[methodName] !== 'function') continue;
            const flag = '__egFika243Identity_' + methodName;
            if (target[flag]) continue;
            const original = target[methodName];
            target[methodName] = function (url, info, sessionId, ...rest) {
                const field = methodName === 'handleRaidCreate' ? 'serverId' : 'profileId';
                adapter.assertProfileBelongsToSession(sessionId, object(info)[field], methodName);
                return original.call(this, url, info, sessionId, ...rest);
            };
            Object.defineProperty(target, flag, { value: true, enumerable: false });
            patched = true;
        }
        this.status.raidIdentityHook = patched;
        return patched;
    }

    assertProfileBelongsToSession(sessionId, requestedProfileId, methodName) {
        const sid = String(sessionId || '').trim();
        const requested = String(requestedProfileId || '').trim();
        if (!sid || !requested || !this.services.saveServer || typeof this.services.saveServer.getProfile !== 'function') {
            throw new Error('FIKA_SESSION_PROFILE_UNAVAILABLE');
        }
        const profile = safe(() => this.services.saveServer.getProfile(sid), null);
        const characters = object(profile && profile.characters);
        const allowed = [String(object(characters.pmc)._id || ''), String(object(characters.scav)._id || '')].filter(Boolean);
        if (!allowed.includes(requested)) {
            this.log('warn', `Rejected Fika ${methodName} for session ${sid}: requested profile does not belong to the authenticated SPT account.`);
            throw new Error('FIKA_SESSION_PROFILE_MISMATCH');
        }
        return true;
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
        const hasHooks = proto && (Object.prototype.hasOwnProperty.call(proto, 'endMatch') || Object.prototype.hasOwnProperty.call(proto, 'addPlayerToMatch'));
        const target = hasHooks ? proto : instance;
        const adapter = this;
        let patched = false;

        if (typeof target.endMatch === 'function' && !target.__egFika243MatchHook) {
            const original = target.endMatch;
            target.endMatch = function (matchId, reason, ...rest) {
                safe(() => adapter.captureMatchEnd(this, matchId, reason));
                return original.call(this, matchId, reason, ...rest);
            };
            Object.defineProperty(target, '__egFika243MatchHook', { value: true, enumerable: false });
            this.status.matchEndHook = true;
            patched = true;
        }

        // Fika 2.4.3 updates IFikaMatch.players after the in-raid registration path.
        // Bind a mission only after every accepted, ready member appears in this match.
        if (typeof target.addPlayerToMatch === 'function' && !target.__egFika243PlayerJoinHook) {
            const original = target.addPlayerToMatch;
            target.addPlayerToMatch = function (matchId, playerId, data, ...rest) {
                const result = original.call(this, matchId, playerId, data, ...rest);
                safe(() => adapter.tryStartMissionGroup(this, matchId));
                return result;
            };
            Object.defineProperty(target, '__egFika243PlayerJoinHook', { value: true, enumerable: false });
            this.status.playerJoinHook = true;
            patched = true;
        }
        return patched;
    }

    tryStartMissionGroup(service, matchId) {
        if (!this.operations || !this.operations.state || !Array.isArray(this.operations.state.groups)) return false;
        const match = safe(() => service.getMatch && service.getMatch(matchId), null);
        if (!match || !(match.players instanceof Map)) return false;
        const players = new Set([...match.players.keys()].map(String));
        const location = String(object(match.locationData).Id || object(match.raidConfig).location || '').toLowerCase();
        if (!location) return false;

        for (const group of this.operations.state.groups) {
            if (group.state !== 'forming' || !group.members || !group.members.length) continue;
            const mission = safe(() => this.operations.get(group.missionId), null);
            if (!mission || String(mission.map || '').toLowerCase() !== location) continue;
            if (!group.members.every(member => member.ready === true && (players.has(String(member.profileId)) || (member.scavProfileId && players.has(String(member.scavProfileId)))))) continue;
            try {
                this.operations.startGroup(group.id, String(matchId));
                this.appendEvent({
                    eventId: `mission-link-${Date.now()}-${String(matchId)}`,
                    type: 'mission_group_linked',
                    timestamp: new Date().toISOString(),
                    fikaServerVersion: EXPECTED_FIKA_VERSION,
                    matchId: String(matchId),
                    groupId: group.id,
                    missionId: group.missionId,
                    players: group.members.map(member => member.profileId),
                    map: location,
                    evidenceTrust: 'authenticated_fika_match_membership',
                    rewardEligible: false
                });
                this.log('info', `Mission group ${group.id} linked to Fika match ${matchId} after all ready members joined.`);
                return true;
            } catch (err) {
                this.log('warn', `Could not link mission group ${group.id} to Fika match ${matchId}: ${err.message}`);
            }
        }
        return false;
    }

    finishMissionGroup(service, matchId, match) {
        if (!this.operations || !this.operations.state || !Array.isArray(this.operations.state.groups)) return null;
        const group = this.operations.state.groups.find(item => item.state === 'in_raid' && String(item.raidId) === String(matchId));
        if (!group) return null;
        const raidProfileToAccount = new Map();
        for (const member of group.members) {
            raidProfileToAccount.set(String(member.profileId), String(member.profileId));
            if (member.scavProfileId) raidProfileToAccount.set(String(member.scavProfileId), String(member.profileId));
        }
        const memberIds = new Set(raidProfileToAccount.keys());
        const aliveProfileIds = match && match.players instanceof Map
            ? [...match.players.entries()].filter(([playerId, player]) => memberIds.has(String(playerId)) && object(player).isDead !== true).map(([playerId]) => raidProfileToAccount.get(String(playerId)))
            : [];
        const extractedProfileIds = this.getRecentEvents(500)
            .filter(event => event.type === 'player_raid_end' && String(event.matchId || '') === String(matchId)
                && group.members.some(member => String(member.profileId) === String(event.profileId || ''))
                && String(event.exitStatus || '').toLowerCase() === 'survived')
            .map(event => String(event.profileId));
        try {
            const result = this.operations.finishGroup(group.id, {
                verified: false,
                aliveProfileIds,
                extractedProfileIds,
                evidenceTrust: 'fika_registry_and_client_reports_unverified',
                source: 'fika-server-adapter'
            });
            this.appendEvent({
                eventId: `mission-finish-${Date.now()}-${String(matchId)}`,
                type: 'mission_group_review_created',
                timestamp: new Date().toISOString(),
                fikaServerVersion: EXPECTED_FIKA_VERSION,
                matchId: String(matchId),
                groupId: group.id,
                players: group.members.map(member => member.profileId),
                evidenceTrust: 'mixed_unverified',
                rewardEligible: false
            });
            return result;
        } catch (err) {
            this.log('warn', `Could not finish mission group ${group.id} for Fika match ${matchId}: ${err.message}`);
            return null;
        }
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
            evidenceTrust: 'fika_match_end_lifecycle_with_authenticated_roster',
            rewardEligible: false
        };
        this.appendEvent(event);
        this.finishMissionGroup(service, matchId, match);
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
