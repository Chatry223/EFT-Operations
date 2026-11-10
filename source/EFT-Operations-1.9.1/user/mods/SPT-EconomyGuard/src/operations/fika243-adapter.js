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
        this.finishedMatchIds = new Set();
        this.raidSnapshots = new Map();
        this.patched = new Set();
        this.status = this.detectVersion();
        this.status.itemSending = this.readItemSendingSetting();
        this.status.saveServerHook = false;
        this.status.updateIdentityHook = false;
        this.status.raidIdentityHook = false;
        this.status.playerJoinHook = false;
        this.status.matchEndHook = false;
        this.status.matchDeleteHook = false;
        this.status.matchCreateHook = false;
        this.status.lifecycleHook = false;
        this.status.observerInstalled = false;
        this.status.hookState = 'not_installed';
        this.status.missingHooks = ['saveServer', 'updateIdentity', 'raidIdentity', 'playerJoin', 'matchEnd', 'matchDelete', 'matchCreate', 'lifecycle'];
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

    readItemSendingSetting() {
        const configPath = path.resolve(this.modDir || '.', '..', 'fika-server', 'assets', 'configs', 'fika.jsonc');
        try {
            const raw = fs.readFileSync(configPath, 'utf8');
            // Fika's JSONC may contain comments; the setting is a single boolean
            // and this narrow extraction avoids a new JSONC parser dependency.
            const match = raw.match(/"allowItemSending"\s*:\s*(true|false)/i);
            if (!match) return { configured: false, enabled: null, reason: 'SETTING_NOT_FOUND' };
            return { configured: true, enabled: match[1].toLowerCase() === 'true', reason: null };
        } catch (err) {
            return { configured: false, enabled: null, reason: err && err.code ? err.code : 'READ_FAILED' };
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
        this.hook(container, 'SaveServer', instance => {
            this.services.saveServer = instance;
            this.status.saveServerHook = !!(instance && typeof instance.getProfile === 'function');
        });
        this.hook(container, 'FikaUpdateCallbacks', instance => this.patchUpdateCallbacks(instance));
        this.hook(container, 'FikaRaidCallbacks', instance => this.patchRaidCallbacks(instance));
        this.hook(container, 'FikaMatchService', instance => {
            this.services.fikaMatchService = instance;
            this.patchMatchService(instance);
        });
        this.hook(container, 'LocationLifecycleService', instance => this.patchLifecycle(instance));
        this.refreshHookStatus();
        if (this.status.observerInstalled) {
            this.log('info', `Fika ${EXPECTED_FIKA_VERSION} lifecycle hooks are active; client outcomes remain untrusted.`);
        } else {
            this.log('warn', `Fika ${EXPECTED_FIKA_VERSION} hook registration is pending or partial: ${this.status.missingHooks.join(', ')}.`);
        }
        return true;
    }

    hook(container, token, callback) {
        let registered = false;
        const apply = instance => {
            try { callback(instance); }
            catch (err) { this.log('warn', `${token} hook application failed: ${err.message}`); }
            this.refreshHookStatus();
        };
        try {
            if (typeof container.afterResolution === 'function') {
                container.afterResolution(token, (_token, instance) => apply(instance), { frequency: 'Always' });
                registered = true;
            }
        } catch (err) { this.log('warn', `${token} hook registration failed: ${err.message}`); }
        try { apply(container.resolve(token)); registered = true; }
        catch (_) { if (!registered) this.log('debug', `${token} is not available yet.`); }
    }

    refreshHookStatus() {
        const hooks = {
            saveServer: this.status.saveServerHook === true,
            updateIdentity: this.status.updateIdentityHook === true,
            raidIdentity: this.status.raidIdentityHook === true,
            playerJoin: this.status.playerJoinHook === true,
            matchEnd: this.status.matchEndHook === true,
            matchDelete: this.status.matchDeleteHook === true,
            matchCreate: this.status.matchCreateHook === true,
            lifecycle: this.status.lifecycleHook === true
        };
        this.status.hooks = hooks;
        this.status.missingHooks = Object.keys(hooks).filter(key => !hooks[key]);
        this.status.observerInstalled = this.status.enabled === true && this.status.missingHooks.length === 0;
        this.status.hookState = this.status.observerInstalled ? 'ready' : (this.status.enabled ? 'pending_or_partial' : 'disabled');
        return this.status.observerInstalled;
    }

    patchUpdateCallbacks(instance) {
        if (!instance) return false;
        const proto = Object.getPrototypeOf(instance);
        const hasHooks = proto && (Object.prototype.hasOwnProperty.call(proto, 'handleRaidAddPlayer') || Object.prototype.hasOwnProperty.call(proto, 'handlePlayerDied'));
        const target = hasHooks ? proto : instance;
        const adapter = this;
        let complete = true;
        for (const methodName of ['handleRaidAddPlayer', 'handlePlayerDied']) {
            if (typeof target[methodName] !== 'function') { complete = false; continue; }
            const flag = '__egFika243Identity_' + methodName;
            if (target[flag]) continue;
            const original = target[methodName];
            target[methodName] = function (url, info, sessionId, ...rest) {
                adapter.assertProfileBelongsToSession(sessionId, object(info).profileId, methodName);
                const result = original.call(this, url, info, sessionId, ...rest);
                if (methodName === 'handlePlayerDied') safe(() => adapter.capturePlayerDeath(sessionId, info));
                return result;
            };
            Object.defineProperty(target, flag, { value: true, enumerable: false });
        }
        this.status.updateIdentityHook = complete;
        return complete;
    }

    patchRaidCallbacks(instance) {
        if (!instance) return false;
        const proto = Object.getPrototypeOf(instance);
        const hasHooks = proto && (Object.prototype.hasOwnProperty.call(proto, 'handleRaidCreate') || Object.prototype.hasOwnProperty.call(proto, 'handleRaidLeave'));
        const target = hasHooks ? proto : instance;
        const adapter = this;
        let complete = true;
        for (const methodName of ['handleRaidCreate', 'handleRaidLeave']) {
            if (typeof target[methodName] !== 'function') { complete = false; continue; }
            const flag = '__egFika243Identity_' + methodName;
            if (target[flag]) continue;
            const original = target[methodName];
            target[methodName] = function (url, info, sessionId, ...rest) {
                if (methodName === 'handleRaidCreate') {
                    adapter.assertRaidHostBelongsToSession(sessionId, object(info).hostUsername);
                } else if (String(object(info).serverId || '') === String(object(info).profileId || '')) {
                    const match = adapter.services.fikaMatchService && adapter.services.fikaMatchService.getMatch(object(info).serverId);
                    if (!match) throw new Error('FIKA_HOST_MATCH_NOT_FOUND');
                    adapter.assertRaidHostBelongsToSession(sessionId, match.hostUsername);
                } else {
                    adapter.assertProfileBelongsToSession(sessionId, object(info).profileId, methodName);
                }
                return original.call(this, url, info, sessionId, ...rest);
            };
            Object.defineProperty(target, flag, { value: true, enumerable: false });
        }
        this.status.raidIdentityHook = complete;
        return complete;
    }

    assertRaidHostBelongsToSession(sessionId, hostUsername) {
        const sid = String(sessionId || '').trim();
        const requestedName = String(hostUsername || '').trim().toLowerCase();
        if (!sid || !requestedName || !this.services.saveServer || typeof this.services.saveServer.getProfile !== 'function') {
            throw new Error('FIKA_HOST_SESSION_IDENTITY_UNAVAILABLE');
        }
        const profile = safe(() => this.services.saveServer.getProfile(sid), null);
        const characters = object(profile && profile.characters);
        const names = [object(characters.pmc).Info, object(characters.scav).Info]
            .map(info => String(object(info).Nickname || '').trim().toLowerCase())
            .filter(Boolean);
        if (!names.includes(requestedName)) {
            this.log('warn', `Rejected Fika raid create for session ${sid}: host username does not match its authenticated PMC/Scav profile.`);
            throw new Error('FIKA_HOST_SESSION_IDENTITY_MISMATCH');
        }
        return true;
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
        // Fika 2.4.3 assigns its startLocalRaid/endLocalRaid overrides directly on
        // the resolved service instance. Patch the effective instance methods, not
        // the base prototype (the Fika override calls the base endLocalRaid itself).
        const target = instance;
        if (!target || typeof target.startLocalRaid !== 'function' || typeof target.endLocalRaid !== 'function'
            || !Object.prototype.hasOwnProperty.call(target, 'startLocalRaid')
            || !Object.prototype.hasOwnProperty.call(target, 'endLocalRaid')) {
            this.status.lifecycleHook = false;
            return false;
        }
        const adapter = this;

        // Fika registers its own afterResolution callback with frequency=Always and
        // reassigns these instance methods. Re-wrap whenever its current method differs
        // from our wrapper; a one-time boolean flag would silently lose the hook.
        if (target.startLocalRaid !== target.__egFika243StartLifecycleWrapper) {
            const originalStart = target.startLocalRaid;
            const wrappedStart = function (sessionId, request, ...rest) {
                const result = originalStart.call(this, sessionId, request, ...rest);
                if (result && typeof result.then === 'function') {
                    return result.then(value => {
                        safe(() => adapter.captureRaidStart(sessionId, request, value));
                        return value;
                    });
                }
                safe(() => adapter.captureRaidStart(sessionId, request, result));
                return result;
            };
            target.__egFika243StartLifecycleWrapper = wrappedStart;
            target.startLocalRaid = wrappedStart;
        }

        if (target.endLocalRaid !== target.__egFika243EndLifecycleWrapper) {
            const originalEnd = target.endLocalRaid;
            const wrappedEnd = function (sessionId, request, ...rest) {
                let result;
                try {
                    result = originalEnd.call(this, sessionId, request, ...rest);
                } catch (error) {
                    safe(() => adapter.captureRaidEnd(sessionId, request));
                    throw error;
                }
                if (result && typeof result.then === 'function') {
                    return result.then(value => {
                        safe(() => adapter.captureRaidEnd(sessionId, request));
                        return value;
                    }, error => {
                        safe(() => adapter.captureRaidEnd(sessionId, request));
                        throw error;
                    });
                }
                safe(() => adapter.captureRaidEnd(sessionId, request));
                return result;
            };
            target.__egFika243EndLifecycleWrapper = wrappedEnd;
            target.endLocalRaid = wrappedEnd;
        }

        this.status.lifecycleHook = target.startLocalRaid === target.__egFika243StartLifecycleWrapper
            && target.endLocalRaid === target.__egFika243EndLifecycleWrapper;
        return this.status.lifecycleHook;
    }

    patchMatchService(instance) {
        if (!instance) return false;
        const proto = Object.getPrototypeOf(instance);
        const hasHooks = proto && (Object.prototype.hasOwnProperty.call(proto, 'endMatch') || Object.prototype.hasOwnProperty.call(proto, 'addPlayerToMatch'));
        const target = hasHooks ? proto : instance;
        const adapter = this;
        let patched = false;

        if (typeof target.endMatch === 'function') {
            if (!target.__egFika243MatchHook) {
                const original = target.endMatch;
                target.endMatch = function (matchId, reason, ...rest) {
                    safe(() => adapter.captureMatchEnd(this, matchId, reason));
                    return original.call(this, matchId, reason, ...rest);
                };
                Object.defineProperty(target, '__egFika243MatchHook', { value: true, enumerable: false });
                patched = true;
            }
            this.status.matchEndHook = true;
        } else {
            this.status.matchEndHook = false;
        }

        // Fika can delete a match directly (e.g. duplicate serverId during createMatch)
        // without calling endMatch. Observe deletion too, with a per-match dedupe guard.
        if (typeof target.deleteMatch === 'function') {
            if (!target.__egFika243DeleteMatchHook) {
                const original = target.deleteMatch;
                target.deleteMatch = function (matchId, ...rest) {
                    safe(() => adapter.captureMatchEnd(this, matchId, 'deleteMatch'));
                    return original.call(this, matchId, ...rest);
                };
                Object.defineProperty(target, '__egFika243DeleteMatchHook', { value: true, enumerable: false });
                patched = true;
            }
            this.status.matchDeleteHook = true;
        } else {
            this.status.matchDeleteHook = false;
        }

        // A reused serverId denotes a new match; clear the old match's dedupe marker after
        // Fika's createMatch has replaced the previous match in its internal Map.
        if (typeof target.createMatch === 'function') {
            if (!target.__egFika243CreateMatchHook) {
                const original = target.createMatch;
                target.createMatch = function (data, ...rest) {
                    const result = original.call(this, data, ...rest);
                    const matchId = String(object(data).serverId || '');
                    if (matchId) adapter.finishedMatchIds.delete(matchId);
                    return result;
                };
                Object.defineProperty(target, '__egFika243CreateMatchHook', { value: true, enumerable: false });
                patched = true;
            }
            this.status.matchCreateHook = true;
        } else {
            this.status.matchCreateHook = false;
        }

        // Fika client 1.2.3 uses the host profile ID as serverId. Fika Server 2.4.3
        // seeds that host into IFikaMatch.players inside createMatch(), then adds remote
        // members through addPlayerToMatch(). Observe after each mutation and bind only
        // when every accepted, ready mission member is present in the same map/match.
        if (typeof target.addPlayerToMatch === 'function') {
            if (!target.__egFika243PlayerJoinHook) {
                const original = target.addPlayerToMatch;
                target.addPlayerToMatch = function (matchId, playerId, data, ...rest) {
                    const result = original.call(this, matchId, playerId, data, ...rest);
                    safe(() => adapter.tryStartMissionGroup(this, matchId));
                    return result;
                };
                Object.defineProperty(target, '__egFika243PlayerJoinHook', { value: true, enumerable: false });
                patched = true;
            }
            this.status.playerJoinHook = true;
        } else {
            this.status.playerJoinHook = false;
        }
        return patched || this.status.matchEndHook || this.status.matchDeleteHook || this.status.matchCreateHook || this.status.playerJoinHook;
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
                this.bindPendingRaidSnapshots(group, matchId, location);
                this.appendEvent({
                    eventId: `mission-link-${Date.now()}-${String(matchId)}`,
                    type: 'mission_group_linked',
                    timestamp: new Date().toISOString(),
                    fikaServerVersion: EXPECTED_FIKA_VERSION,
                    matchId: String(matchId),
                    groupId: group.id,
                    missionId: group.missionId,
                    displayName: group.members[0] ? String(group.members[0].displayName || 'Fika squad') : 'Fika squad',
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

    bindPendingRaidSnapshots(group, matchId, location) {
        for (const member of group.members || []) {
            const pendingKey = `pending:${String(member.profileId)}`;
            const snapshot = this.raidSnapshots.get(pendingKey);
            if (!snapshot) continue;
            this.raidSnapshots.delete(pendingKey);
            snapshot.matchId = String(matchId);
            snapshot.map = snapshot.map || String(location || '').toLowerCase();
            this.raidSnapshots.set(`${matchId}:${String(member.profileId)}`, snapshot);
        }
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
                && ['survived', 'runner'].includes(String(event.exitStatus || '').toLowerCase()))
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
                missionId: group.missionId,
                displayName: group.members[0] ? String(group.members[0].displayName || 'Fika squad') : 'Fika squad',
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
        const pmc = object(characters.pmc);
        const scav = object(characters.scav);
        const pmcId = String(pmc._id || '');
        const scavId = String(scav._id || '');
        const displayName = String(object(pmc.Info).Nickname || object(scav.Info).Nickname || object(profile && profile.info).Nickname || object(profile && profile.info).username || '').slice(0, 40);
        return { profileId: pmcId || String(sessionId || ''), pmcId, scavId, displayName };
    }

    resolveMatchId(sessionId, identity) {
        const service = this.services.fikaMatchService;
        if (!service) return null;
        return safe(() => service.getMatchIdByProfile && service.getMatchIdByProfile(sessionId), null)
            || safe(() => identity.pmcId && service.getMatchIdByPlayer && service.getMatchIdByPlayer(identity.pmcId), null)
            || safe(() => identity.scavId && service.getMatchIdByPlayer && service.getMatchIdByPlayer(identity.scavId), null)
            || safe(() => service.getMatchIdByPlayer && service.getMatchIdByPlayer(sessionId), null);
    }

    capturePlayerDeath(sessionId, info) {
        const identity = this.resolveIdentity(sessionId);
        const requestedProfileId = String(object(info).profileId || '');
        const matchId = String(object(info).serverId || this.resolveMatchId(sessionId, identity) || '');
        const group = this.operations && this.operations.state && Array.isArray(this.operations.state.groups)
            ? this.operations.state.groups.find(item => item.state === 'in_raid' && String(item.raidId || '') === matchId
                && (item.members || []).some(member => String(member.profileId || '') === requestedProfileId || String(member.scavProfileId || '') === requestedProfileId))
            : null;
        const member = group ? (group.members || []).find(item => String(item.profileId || '') === requestedProfileId || String(item.scavProfileId || '') === requestedProfileId) : null;
        const event = {
            eventId: `death-${Date.now()}-${requestedProfileId}`,
            type: 'fika_player_died',
            timestamp: new Date().toISOString(),
            fikaServerVersion: EXPECTED_FIKA_VERSION,
            matchId,
            groupId: group ? group.id : null,
            missionId: group ? group.missionId : null,
            profileId: member ? String(member.profileId) : identity.profileId,
            displayName: member ? String(member.displayName || '') : identity.displayName,
            reportedCharacterProfileId: requestedProfileId,
            evidenceTrust: 'authenticated_client_report',
            source: 'FikaUpdateCallbacks.handlePlayerDied',
            rewardEligible: false
        };
        this.appendEvent(event);
        return event;
    }

    captureRaidStart(sessionId, request, response) {
        const identity = this.resolveIdentity(sessionId);
        const matchId = this.resolveMatchId(sessionId, identity);
        if (!this.services.saveServer || typeof this.services.saveServer.getProfile !== 'function') return null;
        const groups = this.operations && this.operations.state && Array.isArray(this.operations.state.groups) ? this.operations.state.groups : [];
        const missionGroup = groups.find(group => ['forming', 'in_raid'].includes(group.state)
            && (group.members || []).some(member => String(member.profileId || '') === identity.profileId));
        if (!missionGroup) return null;
        if (missionGroup.state === 'in_raid' && missionGroup.raidId && matchId && String(missionGroup.raidId) !== String(matchId)) return null;
        const profile = this.services.saveServer.getProfile(sessionId);
        const characters = object(profile && profile.characters);
        const side = String(object(request).playerSide || object(request).side || 'pmc').toLowerCase();
        const isScav = side === 'savage' || side === 'scav' || side === 'scavenger';
        const activeProfile = isScav ? object(characters.scav) : object(characters.pmc);
        const inventory = object(activeProfile.Inventory);
        const items = Array.isArray(inventory.items) ? inventory.items.slice(0, 2500) : [];
        const itemSnapshot = {};
        for (const item of items) {
            const id = String(object(item)._id || '');
            if (!id) continue;
            itemSnapshot[id] = {
                tpl: String(object(item)._tpl || ''),
                count: Math.max(1, Number(object(object(item).upd).StackObjectsCount) || 1)
            };
        }
        const key = matchId ? `${matchId}:${identity.profileId}` : `pending:${identity.profileId}`;
        const snapshot = {
            matchId: matchId ? String(matchId) : null,
            groupId: missionGroup.id,
            profileId: identity.profileId,
            displayName: identity.displayName,
            map: String(object(request).location || object(response).location || '').toLowerCase(),
            side: isScav ? 'scav' : 'pmc',
            startedAt: Date.now(),
            items: itemSnapshot
        };
        this.raidSnapshots.set(key, snapshot);
        while (this.raidSnapshots.size > 200) this.raidSnapshots.delete(this.raidSnapshots.keys().next().value);
        this.appendEvent({
            eventId: `raid-start-${Date.now()}-${identity.profileId}`,
            type: 'fika_raid_start',
            timestamp: new Date().toISOString(),
            matchId: matchId ? String(matchId) : null,
            groupId: missionGroup.id,
            profileId: identity.profileId,
            displayName: identity.displayName,
            map: snapshot.map,
            playerSide: snapshot.side,
            startingInventoryItemCount: items.length,
            evidenceTrust: 'fika_server_lifecycle',
            rewardEligible: false
        });
        return { matchId: matchId ? String(matchId) : null, groupId: missionGroup.id, itemCount: items.length, side: snapshot.side };
    }

    captureRaidEnd(sessionId, request) {
        const results = object(object(request).results);
        const identity = this.resolveIdentity(sessionId);
        const groups = this.operations && this.operations.state && Array.isArray(this.operations.state.groups) ? this.operations.state.groups : [];
        const activeGroup = groups.find(group => group.state === 'in_raid'
            && (group.members || []).some(member => String(member.profileId || '') === identity.profileId));
        const matchId = this.resolveMatchId(sessionId, identity) || (activeGroup && activeGroup.raidId ? String(activeGroup.raidId) : null);
        const serverId = String(object(request).serverId || '');
        const map = serverId.split('.')[0] || '';
        const profile = object(results.profile);
        const eftStats = object(object(profile.Stats).Eft);
        const reportedVictims = Array.isArray(eftStats.Victims) ? eftStats.Victims.slice(0, 100) : [];
        const deathReports = matchId
            ? this.getRecentEvents(500).filter(item => item.type === 'fika_player_died' && String(item.matchId || '') === String(matchId))
            : [];
        const victims = reportedVictims.map(victim => {
            const victimProfileId = String(object(victim).ProfileId || '');
            const role = String(object(victim).Role || '').slice(0, 40);
            return {
                profileId: victimProfileId,
                name: String(object(victim).Name || '').slice(0, 48),
                role,
                side: String(object(victim).Side || '').slice(0, 20),
                level: Number.isFinite(Number(object(victim).Level)) ? Number(victim.Level) : null,
                distance: Number.isFinite(Number(object(victim).Distance)) ? Number(victim.Distance) : null,
                weapon: String(object(victim).Weapon || '').slice(0, 80),
                location: String(object(victim).Location || '').slice(0, 40),
                corroboratedByFikaDeathReport: !!victimProfileId && deathReports.some(report =>
                    String(report.profileId || '') === victimProfileId ||
                    String(report.reportedCharacterProfileId || '') === victimProfileId)
            };
        });
        const killCountsByRole = {};
        for (const victim of victims) {
            const role = victim.role || 'unknown';
            killCountsByRole[role] = (killCountsByRole[role] || 0) + 1;
        }
        const counters = object(eftStats.SessionCounters);
        const counterItems = Array.isArray(counters.Items) ? counters.Items.slice(0, 80).map(item => ({
            key: Array.isArray(object(item).Key) ? item.Key.map(value => String(value).slice(0, 40)).slice(0, 6) : [],
            value: Number.isFinite(Number(object(item).Value)) ? Number(item.Value) : 0
        })) : [];
        const directSnapshotKey = matchId ? `${matchId}:${identity.profileId}` : '';
        const pendingSnapshotKey = `pending:${identity.profileId}`;
        const directSnapshot = directSnapshotKey ? this.raidSnapshots.get(directSnapshotKey) : null;
        const pendingSnapshot = this.raidSnapshots.get(pendingSnapshotKey) || null;
        const pendingMatchesRaid = !!pendingSnapshot
            && (!pendingSnapshot.matchId || String(pendingSnapshot.matchId) === String(matchId || ''))
            && (!activeGroup || String(pendingSnapshot.groupId) === String(activeGroup.id))
            && Date.now() - Number(pendingSnapshot.startedAt || 0) <= 4 * 60 * 60 * 1000;
        const raidSnapshot = directSnapshot || (pendingMatchesRaid ? pendingSnapshot : null);
        const snapshotKey = directSnapshot ? directSnapshotKey : (raidSnapshot ? pendingSnapshotKey : '');
        const acceptedAccount = safe(() => this.services.saveServer && this.services.saveServer.getProfile(sessionId), null);
        const acceptedCharacters = object(acceptedAccount && acceptedAccount.characters);
        const acceptedCharacter = raidSnapshot && raidSnapshot.side === 'scav' ? object(acceptedCharacters.scav) : object(acceptedCharacters.pmc);
        const acceptedInventory = object(acceptedCharacter.Inventory);
        const acceptedItems = Array.isArray(acceptedInventory.items) ? acceptedInventory.items : [];
        const acceptedById = new Map(acceptedItems.map(item => [String(object(item)._id || ''), item]));
        const preRaidItems = raidSnapshot ? object(raidSnapshot.items) : {};
        const reportedInventory = object(profile.Inventory);
        const reportedItems = Array.isArray(reportedInventory.items) ? reportedInventory.items : [];
        const lootItems = [];
        const lootByTpl = {};
        for (const item of reportedItems.slice(0, 2500)) {
            const id = String(object(item)._id || '');
            const tpl = String(object(item)._tpl || '');
            const upd = object(object(item).upd);
            if (!id || !tpl || upd.SpawnedInSession !== true) continue;
            const before = object(preRaidItems[id]);
            const beforeCount = Math.max(0, Number(before.count) || 0);
            const reportedCount = Math.max(1, Number(upd.StackObjectsCount) || 1);
            const acceptedItem = acceptedById.get(id);
            if (!acceptedItem) continue;
            const acceptedUpd = object(object(acceptedItem).upd);
            const acceptedCount = Math.max(1, Number(acceptedUpd.StackObjectsCount) || 1);
            const reportedDelta = Math.max(0, reportedCount - beforeCount);
            const acceptedDelta = Math.max(0, acceptedCount - beforeCount);
            const acceptedDeltaCount = Math.min(reportedDelta, acceptedDelta);
            if (acceptedDeltaCount <= 0) continue;
            lootItems.push({ tpl, count: acceptedDeltaCount, itemId: id, acceptedBySpt: true });
            lootByTpl[tpl] = (lootByTpl[tpl] || 0) + acceptedDeltaCount;
        }
        const missionGroup = activeGroup || (raidSnapshot && this.operations && this.operations.state
            ? this.operations.state.groups.find(group => group.id === raidSnapshot.groupId && group.state === 'in_raid') : null);
        const mission = missionGroup && this.operations && typeof this.operations.get === 'function'
            ? this.operations.get(missionGroup.missionId) : null;
        if (raidSnapshot && acceptedAccount && missionGroup && mission && this.operations && typeof this.operations.recordRaidEvent === 'function') {
            for (const [tpl, count] of Object.entries(lootByTpl)) {
                try {
                    this.operations.recordRaidEvent(missionGroup.id, {
                        eventId: `spt-loot-${String(matchId || 'raid')}-${identity.profileId}-${tpl}`,
                        profileId: identity.profileId,
                        type: 'collect',
                        target: tpl,
                        amount: count,
                        map: mission.map,
                        matchId: String(matchId || ''),
                        source: 'spt-server-adapter',
                        acceptedBySpt: true,
                        evidenceTrust: 'spt_accepted_client_delta'
                    });
                } catch (err) {
                    this.log('warn', `Could not record SPT-accepted loot objective for ${tpl}: ${err.message}`);
                }
            }
        }
        if (missionGroup && mission && this.operations && typeof this.operations.recordRaidEvent === 'function') {
            const exitStatus = String(results.result || '').trim().toLowerCase();
            const exitName = String(results.exitName || '').trim().slice(0, 80);
            const recordClientOutcome = (type, target) => {
                try {
                    this.operations.recordRaidEvent(missionGroup.id, {
                        eventId: `fika-client-${String(matchId || 'raid')}-${identity.profileId}-${type}`,
                        profileId: identity.profileId,
                        type,
                        target: String(target || ''),
                        amount: 1,
                        map: mission.map,
                        matchId: String(matchId || ''),
                        source: 'fika-client-report',
                        evidenceTrust: 'client_report_only'
                    });
                } catch (err) {
                    this.log('warn', `Could not record review-only ${type} outcome: ${err.message}`);
                }
            };
            if (exitStatus) recordClientOutcome('raid_complete', exitStatus);
            if (['survived', 'runner'].includes(exitStatus)) {
                recordClientOutcome('survive', exitStatus);
                if (exitName) recordClientOutcome('extract', exitName);
            }
        }
        if (snapshotKey) this.raidSnapshots.delete(snapshotKey);
        const foundInRaidItems = Array.isArray(eftStats.FoundInRaidItems) ? eftStats.FoundInRaidItems.slice(0, 100).map(item => ({
            questId: String(object(item).QuestId || '').slice(0, 40),
            itemId: String(object(item).ItemId || '').slice(0, 40)
        })) : [];
        const droppedQuestItems = Array.isArray(eftStats.DroppedItems) ? eftStats.DroppedItems.slice(0, 100).map(item => ({
            questId: String(object(item).QuestId || '').slice(0, 40),
            itemId: String(object(item).ItemId || '').slice(0, 40),
            zoneId: String(object(item).ZoneId || '').slice(0, 60)
        })) : [];
        const event = {
            eventId: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
            type: 'player_raid_end',
            timestamp: new Date().toISOString(),
            fikaServerVersion: EXPECTED_FIKA_VERSION,
            matchId: matchId ? String(matchId) : null,
            groupId: raidSnapshot ? raidSnapshot.groupId : (activeGroup ? activeGroup.id : null),
            profileId: identity.profileId,
            displayName: identity.displayName,
            map,
            sptServerId: serverId,
            exitStatus: String(results.result || 'Unknown'),
            exitName: String(results.exitName || ''),
            playTimeSeconds: Number.isFinite(Number(results.playTime)) ? Number(results.playTime) : null,
            reportedVictimCount: victims.length,
            reportedVictims: victims,
            reportedKillCountsByRole: killCountsByRole,
            corroboratedVictimCount: victims.filter(victim => victim.corroboratedByFikaDeathReport).length,
            reportedSessionCounters: counterItems,
            lootSnapshotAvailable: !!raidSnapshot,
            serverProfileAvailable: !!acceptedAccount,
            reportedLootItemCount: lootItems.reduce((sum, item) => sum + item.count, 0),
            reportedLootByTpl: lootByTpl,
            acceptedLootByTpl: lootByTpl,
            reportedLootItems: lootItems.slice(0, 200),
            reportedFoundInRaidQuestItems: foundInRaidItems,
            reportedDroppedQuestItems: droppedQuestItems,
            evidenceTrust: 'untrusted_client_report',
            rewardEligible: false
        };
        this.appendEvent(event);
        return event;
    }

    captureMatchEnd(service, matchId, reason) {
        const id = String(matchId || '');
        if (!id || this.finishedMatchIds.has(id)) return null;
        const match = safe(() => service.getMatch && service.getMatch(id), null);
        if (!match) return null;
        this.finishedMatchIds.add(id);
        if (this.finishedMatchIds.size > 1000) this.finishedMatchIds.delete(this.finishedMatchIds.values().next().value);
        const players = match.players instanceof Map ? [...match.players.keys()].map(String) : [];
        const missionGroup = this.operations && this.operations.state && Array.isArray(this.operations.state.groups)
            ? this.operations.state.groups.find(group => String(group.raidId || '') === id)
            : null;
        const event = {
            eventId: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
            type: 'fika_match_end',
            timestamp: new Date().toISOString(),
            fikaServerVersion: EXPECTED_FIKA_VERSION,
            matchId: String(matchId || ''),
            groupId: missionGroup ? missionGroup.id : null,
            missionId: missionGroup ? missionGroup.missionId : null,
            displayName: missionGroup && missionGroup.members[0] ? String(missionGroup.members[0].displayName || 'Fika squad') : 'Fika match',
            reason: String(reason || ''),
            players,
            evidenceTrust: 'fika_match_end_lifecycle_with_authenticated_roster',
            rewardEligible: false
        };
        this.appendEvent(event);
        this.finishMissionGroup(service, matchId, match);
        for (const [key, snapshot] of this.raidSnapshots.entries()) {
            if (String(snapshot.matchId || '') === id || (missionGroup && String(snapshot.groupId || '') === String(missionGroup.id))) {
                this.raidSnapshots.delete(key);
            }
        }
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

    getStatus() {
        const itemSending = this.readItemSendingSetting();
        return { ...this.status, itemSending, fikaServerVersion: EXPECTED_FIKA_VERSION, fikaClientTargetVersion: '1.2.3', fikaClientConfigLastVersion: '1.2.3', fikaClientConfigEvidence: 'BepInEx/config/com.fika.core.cfg [Hidden] Last Version (advisory only; loaded BepInEx plugin metadata is authoritative)', operationsClientPluginVersion: '0.1.0' };
    }
}

module.exports = { Fika243OperationsAdapter, EXPECTED_FIKA_VERSION };
