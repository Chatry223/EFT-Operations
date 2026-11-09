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
        return { profileId, scavProfileId: PROFILE_ID_RE.test(scavId) && scavId !== profileId ? scavId : null, displayName: String(info.Nickname || info.username || 'Operator').slice(0, 40) };
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
            return this.response({ ok: true, player: this.operations.getPlayer(player.profileId), group: group ? this.publicGroup(group) : null, mission: mission ? this.publicMission(mission) : null });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    acceptMission(_url, info, sessionId) {
        try {
            const player = this.resolvePlayer(sessionId);
            const missionId = String(info && info.missionId || '').trim();
            if (!missionId || missionId.length > 100) throw new Error('INVALID_MISSION_ID');
            const group = this.operations.accept(missionId, player.profileId, player.displayName, player.scavProfileId);
            return this.response({ ok: true, group: this.publicGroup(group) });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    setReady(_url, info, sessionId) {
        try {
            const player = this.resolvePlayer(sessionId);
            const groupId = String(info && info.groupId || '').trim();
            if (!groupId || groupId.length > 100) throw new Error('INVALID_GROUP_ID');
            const ready = info && info.ready === true;
            const result = this.operations.setReady(groupId, player.profileId, ready);
            return this.response({ ok: true, group: this.publicGroup(result.group), canStart: result.canStart });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    leaveGroup(_url, info, sessionId) {
        try {
            const player = this.resolvePlayer(sessionId);
            const groupId = String(info && info.groupId || '').trim();
            if (!groupId || groupId.length > 100) throw new Error('INVALID_GROUP_ID');
            const group = this.operations.leaveGroup(groupId, player.profileId);
            return this.response({ ok: true, group: this.publicGroup(group) });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    publicGroup(group) {
        return {
            id: group.id,
            missionId: group.missionId,
            state: group.state,
            members: group.members.map(m => ({ displayName: m.displayName, ready: m.ready === true, acceptedAt: m.acceptedAt, result: m.result })),
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
            { url: '/client/eft/operations/leave', action: (url, info, sessionId) => api.leaveGroup(url, info, sessionId) }
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
