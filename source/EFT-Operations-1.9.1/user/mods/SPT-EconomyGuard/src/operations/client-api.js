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
        return {
            sessionId: sid,
            profileId,
            scavProfileId: PROFILE_ID_RE.test(scavId) && scavId !== profileId ? scavId : null,
            displayName: String(displayName).slice(0, 40),
            // Fika 2.4.3 marks its dedicated host account in SaveServer profile info.
            // This flag is used only inside the authenticated server API.
            isFikaHeadless: String(info.password || '') === 'fika-headless'
        };
    }

    publicMission(mission, profileId = null) {
        const eligibility = profileId ? this.operations.getMissionEligibility(mission.id, profileId)
            : { available: true, reason: null, currentPoints: 0, requiredPoints: Number(mission.requiredPoints || 0), missingPrerequisites: [] };
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
            campaignId: mission.campaignId || '',
            campaignOrder: Number(mission.campaignOrder || 0),
            requiredPoints: Number(mission.requiredPoints || 0),
            locked: !eligibility.available,
            lockReason: eligibility.reason || '',
            currentPoints: Number(eligibility.currentPoints || 0),
            missingPrerequisites: eligibility.missingPrerequisites || [],
            objectives: mission.objectives.map(o => ({ id: o.id, type: o.type, target: o.target, count: o.count, required: o.required, params: o.params })),
            rewards: mission.rewards,
            startAt: mission.startAt,
            endAt: mission.endAt,
            status: mission.status
        };
    }

    listMissions(_url, _info, sessionId) {
        try {
            const player = this.resolvePlayer(sessionId);
            const now = Date.now();
            const missions = this.operations.list({ status: 'published' })
                .filter(m => (!m.startAt || Date.parse(m.startAt) <= now) && (!m.endAt || Date.parse(m.endAt) > now))
                .map(m => this.publicMission(m, player.profileId));
            return this.response({ ok: true, missions });
        } catch (err) { return this.response({ ok: false, error: this.errorCode(err) }); }
    }

    playerState(_url, _info, sessionId) {
        try {
            const player = this.resolvePlayer(sessionId);
            const group = this.operations.state.groups.find(g => ['forming', 'in_raid', 'review'].includes(g.state) && g.members.some(m => m.profileId === player.profileId));
            const mission = group ? this.operations.get(group.missionId) : null;
            const canStart = this.canStartGroup(group, mission);
            return this.response({ ok: true, player: this.operations.getPlayer(player.profileId), group: group ? this.publicGroup(group, player.profileId) : null, mission: mission ? this.publicMission(mission, player.profileId) : null, canStart });
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
            const type = String(info && info.type || 'kill').trim().toLowerCase();
            const eventId = String(info && info.eventId || '').trim();
            const matchId = String(info && info.matchId || '').trim();
            const actorProfileId = String(info && (type === 'visit' ? info.actorProfileId : info.killerProfileId) || '').trim();
            if (!['kill', 'visit'].includes(type)) throw new Error('INVALID_HOST_EVENT_TYPE');
            if (!eventId || eventId.length > 120) throw new Error('INVALID_EVENT_ID');
            if (!matchId || matchId.length > 100) throw new Error('INVALID_MATCH_ID');
            if (!PROFILE_ID_RE.test(actorProfileId)) throw new Error('INVALID_ACTOR_PROFILE');

            let victimProfileId = '';
            let victimRole = '';
            let victimSide = '';
            let triggerId = '';
            if (type === 'kill') {
                victimProfileId = String(info && info.victimProfileId || '').trim();
                victimRole = String(info && info.victimRole || '').trim().slice(0, 60);
                victimSide = String(info && info.victimSide || '').trim().slice(0, 20);
                if (!PROFILE_ID_RE.test(victimProfileId)) throw new Error('INVALID_VICTIM_PROFILE');
                if (!victimRole || info.victimIsAi !== true) throw new Error('INVALID_HOST_KILL_EVIDENCE');
            } else {
                triggerId = String(info && info.triggerId || '').trim().slice(0, 100);
                if (!triggerId) throw new Error('INVALID_VISIT_TRIGGER');
            }

            const groups = this.operations && this.operations.state && Array.isArray(this.operations.state.groups) ? this.operations.state.groups : [];
            if (reporter.isFikaHeadless && matchId !== reporter.sessionId) throw new Error('HEADLESS_HOST_PROFILE_MISMATCH');
            const group = groups.find(item => item.state === 'in_raid' && String(item.raidId || '') === matchId
                && (reporter.isFikaHeadless || (item.members && item.members.some(member => String(member.profileId) === reporter.profileId))));
            if (!group) throw new Error('HOST_NOT_ACTIVE_MISSION_MEMBER');
            if (!reporter.isFikaHeadless && matchId !== reporter.profileId && matchId !== String(reporter.scavProfileId || '')) {
                throw new Error('HOST_PROFILE_MISMATCH');
            }
            if (info.groupId && String(info.groupId) !== String(group.id)) throw new Error('RAID_GROUP_MISMATCH');

            const member = group.members.find(item => String(item.profileId) === actorProfileId || String(item.scavProfileId || '') === actorProfileId);
            if (!member) throw new Error(type === 'kill' ? 'KILLER_NOT_GROUP_MEMBER' : 'ACTOR_NOT_GROUP_MEMBER');
            if (!this.fikaOperationsAdapter || typeof this.fikaOperationsAdapter.isProfileInFikaMatch !== 'function') {
                throw new Error('FIKA_MATCH_MEMBERSHIP_UNAVAILABLE');
            }
            if (!this.fikaOperationsAdapter.isProfileInFikaMatch(matchId, matchId)) {
                throw new Error('FIKA_HOST_NOT_IN_MATCH');
            }
            if (!this.fikaOperationsAdapter.isProfileInFikaMatch(matchId, actorProfileId)) {
                throw new Error('FIKA_ACTOR_NOT_IN_MATCH');
            }
            if (type === 'kill' && group.members.some(item => String(item.profileId) === victimProfileId || String(item.scavProfileId || '') === victimProfileId)) {
                throw new Error('VICTIM_IS_SQUAD_MEMBER');
            }

            const now = Date.now();
            const reporterKey = reporter.isFikaHeadless ? reporter.sessionId : reporter.profileId;
            const window = this.hostEventWindows.get(reporterKey) || { startedAt: now, count: 0 };
            if (now - window.startedAt >= 60000) { window.startedAt = now; window.count = 0; }
            window.count++;
            this.hostEventWindows.set(reporterKey, window);
            if (window.count > 180) throw new Error('HOST_EVENT_RATE_LIMIT');
            if (this.hostEventWindows.size > 1000) {
                for (const [key, value] of this.hostEventWindows) if (now - value.startedAt > 120000) this.hostEventWindows.delete(key);
            }

            const mission = this.operations.get(group.missionId);
            if (!mission) throw new Error('MISSION_NOT_FOUND');
            const event = {
                eventId,
                type,
                profileId: member.profileId,
                amount: 1,
                map: mission.map,
                matchId,
                reporterProfileId: reporter.isFikaHeadless ? reporter.sessionId : matchId,
                source: reporter.isFikaHeadless ? 'fika-headless-host-client' : 'fika-host-client',
                evidenceTrust: 'host_attested',
                ...(reporter.isFikaHeadless ? { headlessHost: true } : {})
            };
            if (type === 'visit') {
                event.target = triggerId;
            } else {
                const role = victimRole.toLowerCase();
                const side = victimSide.toLowerCase();
                let targetCategory = 'other';
                if (role.indexOf('follower') >= 0) targetCategory = 'boss_guard';
                else if (role.indexOf('boss') >= 0) targetCategory = 'boss';
                else if (role.indexOf('raider') >= 0) targetCategory = 'raider';
                else if (role.indexOf('rogue') >= 0) targetCategory = 'rogue';
                else if (role.indexOf('cultist') >= 0) targetCategory = 'cultist';
                else if (role.indexOf('pmc') >= 0 || side.indexOf('usec') >= 0 || side.indexOf('bear') >= 0) targetCategory = 'pmc';
                else if (side.indexOf('savage') >= 0 || role.indexOf('assault') >= 0 || role.indexOf('marksman') >= 0 || role.indexOf('cursed') >= 0) targetCategory = 'scav';
                event.target = victimRole;
                event.targetCategory = targetCategory;
                event.victimProfileId = victimProfileId;
                event.victimRole = victimRole;
                event.victimSide = victimSide;
                event.victimIsAi = true;
            }
            const progress = this.operations.recordRaidEvent(group.id, event);
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
            objectiveProgress: mission ? mission.objectives.map(objective => {
                const progress = Math.min(objective.count, Math.max(0, Number(group.progress && group.progress[objective.id]) || 0));
                const rawCounts = group.progressByTrust && group.progressByTrust[objective.id]
                    && typeof group.progressByTrust[objective.id] === 'object' && !Array.isArray(group.progressByTrust[objective.id])
                    ? group.progressByTrust[objective.id] : {};
                const trustKeys = ['server_verified', 'host_attested', 'spt_accepted_client_delta', 'client_report_only', 'legacy_unattributed'];
                const parsedCounts = Object.fromEntries(trustKeys.map(key => [key, Math.max(0, Math.floor(Number(rawCounts[key]) || 0))]));
                const total = Object.values(parsedCounts).reduce((sum, count) => sum + count, 0);
                const evidenceCounts = total > progress
                    ? [{ trust: 'legacy_unattributed', count: progress }]
                    : trustKeys.map(trust => ({ trust, count: parsedCounts[trust] + (trust === 'legacy_unattributed' ? progress - total : 0) }))
                        .filter(item => item.count > 0);
                const activeTrusts = evidenceCounts.map(item => item.trust);
                const trust = activeTrusts.length > 1 ? 'mixed' : (activeTrusts[0] || 'none');
                return {
                    id: objective.id,
                    progress,
                    count: objective.count,
                    required: objective.required === true,
                    trust,
                    evidenceCounts
                };
            }) : [],
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
