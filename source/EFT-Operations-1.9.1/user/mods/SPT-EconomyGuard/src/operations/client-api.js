'use strict';

const PROFILE_ID_RE = /^[a-f0-9]{24}$/i;

function safeCall(fn, fallback = null) {
    try { return fn(); } catch (_) { return fallback; }
}

class OperationsClientApi {
    constructor({ operations, saveServer, httpResponseUtil, logger = console } = {}) {
        this.operations = operations;
        this.saveServer = saveServer;
        this.httpResponseUtil = httpResponseUtil;
        this.logger = logger || console;
        this.registered = false;
        this.hostEventWindows = new Map();
    }

    log(level, message) {
        const fn = this.logger && (this.logger[level] || this.logger.info);
        if (typeof fn === 'function') fn.call(this.logger, `[EFT Operations/API] ${message}`);
    }

    response(value) {
        if (this.httpResponseUtil && typeof this.httpResponseUtil.noBody === 'function') {
            return this.httpResponseUtil.noBody(value);
        }
        return value;
    }

    resolvePlayer(sessionId) {
        const sid = String(sessionId || '').trim();
        if (!sid || !this.saveServer || typeof this.saveServer.getProfile !== 'function') throw new Error('SESSION_UNAVAILABLE');
        const profile = this.saveServer.getProfile(sid);
        const pmc = profile && profile.characters && profile.characters.pmc;
        const profileId = String(pmc && pmc._id || '');
        if (!PROFILE_ID_RE.test(profileId)) throw new Error('PMC_PROFILE_UNAVAILABLE');
        const scav = profile && profile.characters && profile.characters.scav;
        const scavId = String(scav && scav._id || '');
        const info = profile && profile.info || {};
        const displayName = pmc && pmc.Info && pmc.Info.Nickname || scav && scav.Info && scav.Info.Nickname || info.Nickname || info.username || 'Operator';
        return { profileId, scavProfileId: PROFILE_ID_RE.test(scavId) && scavId !== profileId ? scavId : null, displayName: String(displayName).slice(0, 40) };
    }

    publicMission(mission) {
        return {
            id: mission.id,
            revision: mission.revision,
            title: mission.title,
            description: mission.description,
            briefing: mission.briefing,
            map: mission.map,
            mode: mission.mode,
            minPlayers: mission.minPlayers,
            maxPlayers: mission.maxPlayers,
            objectives: mission.objectives.map(o => ({ id: o.id, type: o.type, target: o.target, count: o.count, required: o.required, params: o.params })),
            rewards: mission.rewards,
            startAt: mission.startAt,
            endAt: mission.endAt,
            status: mission.status
        };
    }

    listMissions(_url, _info, sessionId) {
        try {
            this.resolvePlayer(sessionId);
            const now = Date.now();
            const missions = this.operations.list({ status: 'published' })
                .filter(m => (!m.startAt || Date.parse(m.startAt) <= now) && (!m.endAt || Date.parse(m.endAt) > now))
                .map(m => this.publicMission(m));
            return this.response({ ok: true, missions });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    playerState(_url, _info, sessionId) {
        try {
            const player = this.resolvePlayer(sessionId);
            const group = this.operations.state.groups.find(g => ['forming', 'in_raid', 'review'].includes(g.state) && g.members.some(m => m.profileId === player.profileId));
            const mission = group ? this.operations.get(group.missionId) : null;
            const canStart = this.canStartGroup(group, mission);
            return this.response({ ok: true, player: this.operations.getPlayer(player.profileId), group: group ? this.publicGroup(group, player.profileId) : null, mission: mission ? this.publicMission(mission) : null, canStart });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    acceptMission(_url, info, sessionId) {
        try {
            const player = this.resolvePlayer(sessionId);
            const missionId = String(info && info.missionId || '').trim();
            if (!missionId || missionId.length > 100) throw new Error('INVALID_MISSION_ID');
            const group = this.operations.accept(missionId, player.profileId, player.displayName, player.scavProfileId);
            return this.response({ ok: true, group: this.publicGroup(group, player.profileId) });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    setReady(_url, info, sessionId) {
        try {
            const player = this.resolvePlayer(sessionId);
            const groupId = String(info && info.groupId || '').trim();
            if (!groupId || groupId.length > 100) throw new Error('INVALID_GROUP_ID');
            const ready = info && info.ready === true;
            const result = this.operations.setReady(groupId, player.profileId, ready);
            return this.response({ ok: true, group: this.publicGroup(result.group, player.profileId), canStart: result.canStart });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    leaveGroup(_url, info, sessionId) {
        try {
            const player = this.resolvePlayer(sessionId);
            const groupId = String(info && info.groupId || '').trim();
            if (!groupId || groupId.length > 100) throw new Error('INVALID_GROUP_ID');
            const group = this.operations.leaveGroup(groupId, player.profileId);
            return this.response({ ok: true, group: this.publicGroup(group, player.profileId) });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    hostRaidEvent(_url, info, sessionId) {
        try {
            const reporter = this.resolvePlayer(sessionId);
            const eventId = String(info && info.eventId || '').trim();
            const matchId = String(info && info.matchId || '').trim();
            const killerProfileId = String(info && info.killerProfileId || '').trim();
            const victimProfileId = String(info && info.victimProfileId || '').trim();
            const victimRole = String(info && info.victimRole || '').trim().slice(0, 60);
            const victimSide = String(info && info.victimSide || '').trim().slice(0, 20);
            if (!eventId || eventId.length > 120) throw new Error('INVALID_EVENT_ID');
            if (!matchId || matchId.length > 100) throw new Error('INVALID_MATCH_ID');
            if (!PROFILE_ID_RE.test(killerProfileId)) throw new Error('INVALID_KILLER_PROFILE');
            if (!PROFILE_ID_RE.test(victimProfileId)) throw new Error('INVALID_VICTIM_PROFILE');
            if (!victimRole || info.victimIsAi !== true) throw new Error('INVALID_HOST_KILL_EVIDENCE');

            const groups = this.operations && this.operations.state && Array.isArray(this.operations.state.groups) ? this.operations.state.groups : [];
            const group = groups.find(item => item.state === 'in_raid' && String(item.raidId || '') === matchId
                && item.members && item.members.length && String(item.members[0].profileId) === reporter.profileId);
            if (!group) throw new Error('HOST_NOT_ACTIVE_SQUAD_LEADER');
            if (info.groupId && String(info.groupId) !== String(group.id)) throw new Error('RAID_GROUP_MISMATCH');

            const member = group.members.find(item => String(item.profileId) === killerProfileId || String(item.scavProfileId || '') === killerProfileId);
            if (!member) throw new Error('KILLER_NOT_GROUP_MEMBER');
            if (group.members.some(item => String(item.profileId) === victimProfileId || String(item.scavProfileId || '') === victimProfileId)) {
                throw new Error('VICTIM_IS_SQUAD_MEMBER');
            }

            const now = Date.now();
            const window = this.hostEventWindows.get(reporter.profileId) || { startedAt: now, count: 0 };
            if (now - window.startedAt >= 60000) { window.startedAt = now; window.count = 0; }
            window.count++;
            this.hostEventWindows.set(reporter.profileId, window);
            if (window.count > 180) throw new Error('HOST_EVENT_RATE_LIMIT');
            if (this.hostEventWindows.size > 1000) {
                for (const [key, value] of this.hostEventWindows) if (now - value.startedAt > 120000) this.hostEventWindows.delete(key);
            }

            const role = victimRole.toLowerCase();
            const side = victimSide.toLowerCase();
            let targetCategory = 'other';
            if (role.indexOf('follower') >= 0) targetCategory = 'follower';
            else if (role.indexOf('boss') >= 0) targetCategory = 'boss';
            else if (role.indexOf('raider') >= 0) targetCategory = 'raider';
            else if (role.indexOf('rogue') >= 0) targetCategory = 'rogue';
            else if (role.indexOf('cultist') >= 0) targetCategory = 'cultist';
            else if (role.indexOf('pmc') >= 0 || side.indexOf('usec') >= 0 || side.indexOf('bear') >= 0) targetCategory = 'pmc';
            else if (side.indexOf('savage') >= 0 || role.indexOf('assault') >= 0 || role.indexOf('marksman') >= 0 || role.indexOf('cursed') >= 0) targetCategory = 'scav';

            const mission = this.operations.get(group.missionId);
            if (!mission) throw new Error('MISSION_NOT_FOUND');
            const progress = this.operations.recordRaidEvent(group.id, {
                eventId,
                type: 'kill',
                profileId: member.profileId,
                amount: 1,
                map: mission.map,
                target: victimRole,
                targetCategory,
                victimProfileId,
                victimRole,
                victimSide,
                victimIsAi: true,
                matchId,
                reporterProfileId: reporter.profileId,
                source: 'fika-host-client',
                evidenceTrust: 'host_attested'
            });
            return this.response({ ok: true, progress, group: this.publicGroup(group, reporter.profileId), evidenceTrust: 'host_attested' });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    canStartGroup(group, mission) {
        const now = Date.now();
        return !!group && group.state === 'forming' && !!mission && mission.status === 'published'
            && (!mission.startAt || Date.parse(mission.startAt) <= now)
            && (!mission.endAt || Date.parse(mission.endAt) > now)
            && group.members.length >= mission.minPlayers
            && group.members.every(member => member.ready === true);
    }

    publicGroup(group, viewerProfileId = '') {
        const mission = this.operations.get(group.missionId);
        const readyCount = group.members.filter(member => member.ready === true).length;
        return {
            id: group.id,
            missionId: group.missionId,
            state: group.state,
            minPlayers: mission ? mission.minPlayers : 1,
            maxPlayers: mission ? mission.maxPlayers : group.members.length,
            readyCount,
            isLeader: !!group.members.length && String(group.members[0].profileId) === String(viewerProfileId),
            leaderName: group.members.length ? group.members[0].displayName : '',
            members: group.members.map(member => ({
                displayName: member.displayName,
                ready: member.ready === true,
                acceptedAt: member.acceptedAt,
                result: member.result
            })),
            objectiveProgress: mission ? mission.objectives.map(objective => ({
                id: objective.id,
                progress: Math.min(objective.count, Math.max(0, Number(group.progress && group.progress[objective.id]) || 0)),
                count: objective.count,
                required: objective.required === true,
                trust: String(group.progressTrust && group.progressTrust[objective.id] || 'none')
            })) : [],
            createdAt: group.createdAt,
            startedAt: group.startedAt || null,
            finishedAt: group.finishedAt || null
        };
    }

    errorCode(err) {
        const code = String(err && err.message || 'OPERATIONS_API_ERROR');
        this.log('warn', `Player API request rejected: ${code}`);
        return /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'OPERATIONS_API_ERROR';
    }

    register(container) {
        if (!container || typeof container.resolve !== 'function') return false;
        let routerService;
        try { routerService = container.resolve('StaticRouterModService'); }
        catch (err) { this.log('warn', `StaticRouterModService unavailable: ${err.message}`); return false; }
        if (!routerService || typeof routerService.registerStaticRouter !== 'function') {
            this.log('warn', 'StaticRouterModService does not expose registerStaticRouter.');
            return false;
        }
        const api = this;
        const routes = [
            { url: '/client/eft/operations/missions', action: (url, info, sessionId) => api.listMissions(url, info, sessionId) },
            { url: '/client/eft/operations/state', action: (url, info, sessionId) => api.playerState(url, info, sessionId) },
            { url: '/client/eft/operations/accept', action: (url, info, sessionId) => api.acceptMission(url, info, sessionId) },
            { url: '/client/eft/operations/ready', action: (url, info, sessionId) => api.setReady(url, info, sessionId) },
            { url: '/client/eft/operations/leave', action: (url, info, sessionId) => api.leaveGroup(url, info, sessionId) },
            { url: '/client/eft/operations/host-event', action: (url, info, sessionId) => api.hostRaidEvent(url, info, sessionId) }
        ];
        try {
            routerService.registerStaticRouter('EFTOperationsClientApi', routes, 'EFTOperations');
            this.registered = true;
            this.log('info', 'Authenticated SPT player routes registered (missions/state/accept/ready).');
            return true;
        } catch (err) {
            this.log('error', `Could not register player routes: ${err.message}`);
            return false;
        }
    }
}

module.exports = { OperationsClientApi };
