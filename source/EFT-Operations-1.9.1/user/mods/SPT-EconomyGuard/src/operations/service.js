'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATES = new Set(['draft', 'published', 'closed', 'archived']);
const OBJECTIVES = new Set(['kill', 'kill_type', 'collect', 'extract', 'survive', 'visit', 'raid_complete']);
const MAX_OBJECTIVES = 20;
const PROFILE_ID_RE = /^[a-f0-9]{24}$/i;
function requireProfileId(value) { const id = text(value, 24, 'PROFILE_ID', true); if (!PROFILE_ID_RE.test(id)) throw new Error('INVALID_PROFILE_ID'); return id; }

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function id(prefix = 'op') { return `${prefix}_${crypto.randomBytes(12).toString('hex')}`; }
function text(value, max, field, required = false) {
    const out = String(value == null ? '' : value).trim();
    if (required && !out) throw new Error(`INVALID_${field}`);
    if (out.length > max) throw new Error(`INVALID_${field}`);
    return out;
}
function integer(value, min, max, field, fallback = min) {
    const n = value == null ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`INVALID_${field}`);
    return n;
}

class OperationsService {
    constructor(dataDir, logger = console, options = {}) {
        this.dataDir = path.join(dataDir, 'operations');
        this.file = path.join(this.dataDir, 'operations.json');
        this.logger = logger;
        this.options = options;
        fs.mkdirSync(this.dataDir, { recursive: true });
        this.state = this.load();
    }

    load() {
        try {
            const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value)
                || !Array.isArray(value.missions) || !Array.isArray(value.awards)
                || (Object.prototype.hasOwnProperty.call(value, 'groups') && !Array.isArray(value.groups))
                || (Object.prototype.hasOwnProperty.call(value, 'playerStats') &&
                    (!value.playerStats || typeof value.playerStats !== 'object' || Array.isArray(value.playerStats)))) {
                throw new Error('INVALID_STORE');
            }
            const playerStats = value.playerStats || {};
            for (const [profileId, stats] of Object.entries(playerStats)) {
                if (!PROFILE_ID_RE.test(profileId) || !stats || typeof stats !== 'object'
                    || !Number.isSafeInteger(stats.points) || stats.points < 0
                    || !Number.isSafeInteger(stats.completedMissions) || stats.completedMissions < 0) {
                    throw new Error('INVALID_PLAYER_STATS');
                }
            }
            // Backward-compatible schema-1 migration: early stores may not have groups/playerStats yet.
            return { ...value, schemaVersion: 1, groups: value.groups || [], playerStats };
        } catch (err) {
            if (err.code !== 'ENOENT') {
                try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}.bak`); } catch (_) { /* retain original if backup cannot be made */ }
                this.log('warn', `Operations store could not be loaded; a backup was retained where possible: ${err.message}`);
            }
            return { schemaVersion: 1, missions: [], awards: [], playerStats: {}, groups: [] };
        }
    }

    persist() {
        const tmp = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tmp, this.file);
    }

    log(level, message) {
        const fn = this.logger && (this.logger[level] || this.logger.info);
        if (typeof fn === 'function') fn.call(this.logger, `[EFT Operations] ${message}`);
    }

    normalizeMission(input, existing = null) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_MISSION');
        const title = text(input.title, 100, 'TITLE', true);
        const description = text(input.description, 4000, 'DESCRIPTION');
        const map = text(input.map, 40, 'MAP', true);
        const mode = input.mode || 'solo';
        if (!['solo', 'squad', 'either'].includes(mode)) throw new Error('INVALID_MODE');
        const minPlayers = integer(input.minPlayers, 1, 8, 'MIN_PLAYERS', mode === 'squad' ? 2 : 1);
        const maxPlayers = integer(input.maxPlayers, minPlayers, 8, 'MAX_PLAYERS', mode === 'solo' ? 1 : 4);
        if (mode === 'solo' && (minPlayers !== 1 || maxPlayers !== 1)) throw new Error('INVALID_SOLO_PLAYER_RANGE');
        if (mode === 'squad' && minPlayers < 2) throw new Error('INVALID_SQUAD_PLAYER_RANGE');
        const objectives = Array.isArray(input.objectives) ? input.objectives : [];
        if (!objectives.length || objectives.length > MAX_OBJECTIVES) throw new Error('INVALID_OBJECTIVES');
        const cleanObjectives = objectives.map((o, i) => {
            if (!o || !OBJECTIVES.has(o.type)) throw new Error(`INVALID_OBJECTIVE_${i}`);
            return { id: text(o.id || `obj_${i + 1}`, 40, 'OBJECTIVE_ID', true), type: o.type,
                target: text(o.target, 100, 'OBJECTIVE_TARGET'), count: integer(o.count, 1, 10000, 'OBJECTIVE_COUNT', 1),
                required: o.required !== false, params: o.params && typeof o.params === 'object' && !Array.isArray(o.params) ? clone(o.params) : {} };
        });
        const objectiveIds = new Set();
        for (const objective of cleanObjectives) { if (objectiveIds.has(objective.id)) throw new Error('INVALID_OBJECTIVE_ID_DUPLICATE'); objectiveIds.add(objective.id); }
        const rewards = input.rewards && typeof input.rewards === 'object' ? input.rewards : {};
        if (input.startAt && !Number.isFinite(Date.parse(input.startAt))) throw new Error('INVALID_START_AT');
        if (input.endAt && !Number.isFinite(Date.parse(input.endAt))) throw new Error('INVALID_END_AT');
        const startAt = input.startAt == null || input.startAt === '' ? null : new Date(input.startAt).toISOString();
        const endAt = input.endAt == null || input.endAt === '' ? null : new Date(input.endAt).toISOString();
        if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) throw new Error('INVALID_END_AT');
        const items = Array.isArray(rewards.items) ? rewards.items.slice(0, 10).map(x => { const tpl = text(x.tpl, 24, 'REWARD_TPL', true); if (!/^[a-f0-9]{24}$/i.test(tpl)) throw new Error('INVALID_REWARD_TPL'); return { tpl, count: integer(x.count, 1, 100, 'REWARD_ITEM_COUNT', 1) }; }) : [];
        return {
            id: existing ? existing.id : id(), revision: existing ? existing.revision + 1 : 1,
            title, description, briefing: { kind: ['letter', 'video', 'audio', 'scene'].includes(input.briefing && input.briefing.kind) ? input.briefing.kind : 'letter',
                media: text(input.briefing && input.briefing.media, 300, 'BRIEFING_MEDIA'), body: text(input.briefing && input.briefing.body, 8000, 'BRIEFING_BODY') },
            map, mode, minPlayers, maxPlayers, objectives: cleanObjectives,
            rewards: { points: integer(rewards.points, 0, 1000000, 'REWARD_POINTS', 0), roubles: integer(rewards.roubles, 0, 50000000, 'REWARD_ROUBLES', 0), items },
            status: existing ? existing.status : 'draft', startAt, endAt,
            createdAt: existing ? existing.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(),
            createdBy: existing ? existing.createdBy : text(input.createdBy || 'ADMIN', 80, 'CREATED_BY'),
            announcementId: existing ? (existing.announcementId || null) : null
        };
    }

    list(filter = {}) {
        return this.state.missions.filter(m => !filter.status || m.status === filter.status).map(clone);
    }
    get(missionId) { const m = this.state.missions.find(x => x.id === missionId); return m ? clone(m) : null; }

    save(input) {
        const current = input.id ? this.state.missions.find(x => x.id === input.id) : null;
        if (input.id && !current) throw new Error('MISSION_NOT_FOUND');
        if (current && current.status !== 'draft') throw new Error('MISSION_NOT_EDITABLE');
        const next = this.normalizeMission(input, current);
        if (current) this.state.missions[this.state.missions.indexOf(current)] = next;
        else this.state.missions.push(next);
        this.persist(); return clone(next);
    }

    setStatus(missionId, status) {
        if (!STATES.has(status)) throw new Error('INVALID_STATUS');
        const m = this.state.missions.find(x => x.id === missionId);
        if (!m) throw new Error('MISSION_NOT_FOUND');
        const allowed = { draft: ['published', 'archived'], published: ['closed', 'archived'], closed: ['archived'], archived: [] };
        if (!allowed[m.status].includes(status)) throw new Error('INVALID_STATUS_TRANSITION');
        m.status = status; m.updatedAt = new Date().toISOString(); this.persist(); return clone(m);
    }

    accept(missionId, profileId, displayName = '', scavProfileId = null) {
        profileId = requireProfileId(profileId);
        scavProfileId = scavProfileId ? requireProfileId(scavProfileId) : null;
        if (scavProfileId === profileId) scavProfileId = null;
        const m = this.state.missions.find(x => x.id === missionId && x.status === 'published');
        if (!m) throw new Error('MISSION_UNAVAILABLE');
        const now = Date.now();
        if (m.startAt && Date.parse(m.startAt) > now) throw new Error('MISSION_NOT_STARTED');
        if (m.endAt && Date.parse(m.endAt) <= now) throw new Error('MISSION_EXPIRED');
        if (m.mode === 'solo' && m.maxPlayers !== 1) throw new Error('INVALID_SOLO_PLAYER_RANGE');
        const existingGroup = this.state.groups.find(g => ['forming', 'in_raid', 'review'].includes(g.state) && g.members.some(x => [x.profileId, x.scavProfileId].includes(profileId) || (scavProfileId && [x.profileId, x.scavProfileId].includes(scavProfileId))));
        if (existingGroup) {
            if (existingGroup.missionId === missionId && existingGroup.state === 'forming') return clone(existingGroup);
            if (existingGroup.state === 'review') throw new Error('PLAYER_REVIEW_PENDING');
            throw new Error('PLAYER_ALREADY_ASSIGNED');
        }
        let group = this.state.groups.find(g => g.missionId === missionId && g.state === 'forming' && g.members.length < m.maxPlayers);
        if (!group) { group = { id: id('grp'), missionId, state: 'forming', members: [], createdAt: new Date().toISOString(), raidId: null }; this.state.groups.push(group); }
        if (group.members.some(x => x.profileId === profileId || (scavProfileId && x.scavProfileId === scavProfileId))) return clone(group);
        if (group.members.length >= m.maxPlayers) throw new Error('GROUP_FULL');
        group.members.push({ profileId, scavProfileId, displayName: text(displayName, 40, 'DISPLAY_NAME'), ready: false, acceptedAt: new Date().toISOString(), result: 'pending' });
        this.persist(); return clone(group);
    }

    setReady(groupId, profileId, ready) {
        const g = this.state.groups.find(x => x.id === groupId && x.state === 'forming');
        if (!g) throw new Error('GROUP_NOT_FOUND');
        profileId = requireProfileId(profileId);
        const member = g.members.find(x => x.profileId === profileId);
        if (!member) throw new Error('NOT_GROUP_MEMBER');
        member.ready = ready === true; this.persist();
        const mission = this.state.missions.find(x => x.id === g.missionId);
        return { group: clone(g), canStart: mission && mission.status === 'published' && (!mission.endAt || Date.parse(mission.endAt) > Date.now()) && g.members.length >= mission.minPlayers && g.members.every(x => x.ready) };
    }

    leaveGroup(groupId, profileId) {
        const g = this.state.groups.find(x => x.id === groupId && x.state === 'forming');
        if (!g) throw new Error('GROUP_NOT_FOUND');
        profileId = requireProfileId(profileId);
        const index = g.members.findIndex(x => x.profileId === profileId);
        if (index < 0) throw new Error('NOT_GROUP_MEMBER');
        g.members.splice(index, 1);
        if (!g.members.length) this.state.groups.splice(this.state.groups.indexOf(g), 1);
        this.persist();
        return g.members.length ? clone(g) : { id: g.id, missionId: g.missionId, state: 'cancelled', members: [] };
    }

    startGroup(groupId, raidId) {
        const g = this.state.groups.find(x => x.id === groupId && x.state === 'forming');
        if (!g) throw new Error('GROUP_NOT_FOUND');
        const m = this.state.missions.find(x => x.id === g.missionId);
        if (!m || m.status !== 'published' || (m.startAt && Date.parse(m.startAt) > Date.now()) || (m.endAt && Date.parse(m.endAt) <= Date.now()) || g.members.length < m.minPlayers || !g.members.every(x => x.ready)) throw new Error('GROUP_NOT_READY');
        const validatedRaidId = text(raidId, 100, 'RAID_ID', true);
        g.state = 'in_raid'; g.raidId = validatedRaidId; g.startedAt = new Date().toISOString();
        g.progress = Object.fromEntries(m.objectives.map(o => [o.id, 0])); g.progressTrust = {}; g.evidenceEvents = []; g.processedEventIds = []; this.persist(); return clone(g);
    }

    // Call only from a server-side SPT/Fika event adapter. Never expose this method as a public client endpoint.
    recordRaidEvent(groupId, event) {
        const g = this.state.groups.find(x => x.id === groupId && x.state === 'in_raid');
        if (!g) throw new Error('RAID_NOT_ACTIVE');
        const m = this.state.missions.find(x => x.id === g.missionId);
        if (!event || typeof event !== 'object' || !OBJECTIVES.has(event.type)) throw new Error('INVALID_RAID_EVENT');
        const source = String(event.source || '');
        const serverVerified = event.evidenceTrust === 'server_verified' && ['fika-server-adapter', 'spt-server-adapter'].includes(source);
        const hostAttested = event.evidenceTrust === 'host_attested' && source === 'fika-host-client'
            && event.reporterProfileId && g.members.some(member => String(member.profileId) === String(event.reporterProfileId) || String(member.scavProfileId || '') === String(event.reporterProfileId))
            && String(event.reporterProfileId) === String(event.matchId) && event.type === 'kill' && event.victimIsAi === true
            && String(event.matchId || '') === String(g.raidId || '');
        if (!serverVerified && !hostAttested) throw new Error('UNTRUSTED_RAID_EVENT');
        const eventId = text(event.eventId, 120, 'EVENT_ID', true);
        const eventMap = text(event.map, 40, 'EVENT_MAP', true).toLowerCase();
        if (eventMap !== String(m.map || '').toLowerCase()) throw new Error('RAID_EVENT_MAP_MISMATCH');
        const amount = integer(event.amount, 1, 1000, 'EVENT_AMOUNT', 1);
        // Kill/collection/visit events must identify a real member of this operation.
        // Lifecycle-wide extraction/survival events may be aggregate, but any supplied
        // profile identity is still checked against the accepted roster.
        const actorBoundTypes = new Set(['kill', 'kill_type', 'collect', 'visit']);
        if (actorBoundTypes.has(event.type) && !event.profileId) throw new Error('RAID_EVENT_ACTOR_REQUIRED');
        if (event.profileId) {
            const actorId = requireProfileId(event.profileId);
            if (!g.members.some(member => member.profileId === actorId || member.scavProfileId === actorId)) {
                throw new Error('RAID_EVENT_ACTOR_NOT_MEMBER');
            }
        }
        if (!Array.isArray(g.processedEventIds)) g.processedEventIds = [];
        if (g.processedEventIds.includes(eventId)) return clone(g.progress);
        if (hostAttested) {
            const reporterId = requireProfileId(event.reporterProfileId);
            if (!g.members.some(member => member.profileId === reporterId || member.scavProfileId === reporterId)) throw new Error('HOST_REPORTER_NOT_MEMBER');
            if (reporterId !== String(event.matchId)) throw new Error('HOST_REPORTER_MATCH_MISMATCH');
            if (event.matchId !== g.raidId) throw new Error('RAID_EVENT_MATCH_MISMATCH');
            const victimId = requireProfileId(event.victimProfileId);
            if (g.members.some(member => member.profileId === victimId || member.scavProfileId === victimId)) throw new Error('RAID_EVENT_VICTIM_IS_MEMBER');
            const category = text(event.targetCategory, 40, 'EVENT_TARGET_CATEGORY', true).toLowerCase();
            if (!['scav', 'boss', 'boss_guard', 'raider', 'rogue', 'cultist', 'pmc', 'other', 'unknown'].includes(category)) throw new Error('INVALID_EVENT_TARGET_CATEGORY');
        }
        if (!g.progress || typeof g.progress !== 'object' || Array.isArray(g.progress)) {
            g.progress = Object.fromEntries(m.objectives.map(objective => [objective.id, 0]));
        }
        if (!g.progressTrust || typeof g.progressTrust !== 'object' || Array.isArray(g.progressTrust)) g.progressTrust = {};
        if (!Array.isArray(g.evidenceEvents)) g.evidenceEvents = [];
        const targetCandidates = [event.target, event.targetCategory].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
        for (const objective of m.objectives) {
            const matchingType = objective.type === event.type || (event.type === 'kill' && objective.type === 'kill_type');
            if (!matchingType) continue;
            if (objective.target && !targetCandidates.includes(String(objective.target).toLowerCase())) continue;
            if (objective.params.map && String(objective.params.map).toLowerCase() !== (eventMap || String(m.map || '').toLowerCase())) continue;
            g.progress[objective.id] = Math.min(objective.count, (g.progress[objective.id] || 0) + amount);
            if (g.progressTrust[objective.id] !== 'server_verified') g.progressTrust[objective.id] = event.evidenceTrust;
        }
        g.evidenceEvents.push({
            eventId, type: event.type, profileId: event.profileId ? String(event.profileId) : null,
            amount, target: String(event.target || ''), targetCategory: String(event.targetCategory || ''),
            victimProfileId: event.victimProfileId ? String(event.victimProfileId) : null,
            victimRole: String(event.victimRole || ''), victimSide: String(event.victimSide || ''),
            reporterProfileId: event.reporterProfileId ? String(event.reporterProfileId) : null,
            matchId: event.matchId ? String(event.matchId) : null,
            evidenceTrust: event.evidenceTrust, source, timestamp: new Date().toISOString()
        });
        if (g.evidenceEvents.length > 1000) g.evidenceEvents.splice(0, g.evidenceEvents.length - 1000);
        // Bound persisted deduplication state so a long-running server cannot grow
        // the operations store without limit. IDs are scoped to this raid group.
        g.processedEventIds.push(eventId);
        if (g.processedEventIds.length > 10000) g.processedEventIds.splice(0, g.processedEventIds.length - 10000);
        this.persist(); return clone(g.progress);
    }

    finishGroup(groupId, raidOutcome) {
        const g = this.state.groups.find(x => x.id === groupId && x.state === 'in_raid');
        if (!g) throw new Error('RAID_NOT_ACTIVE');
        const m = this.state.missions.find(x => x.id === g.missionId);
        const requiredDone = m.objectives.filter(o => o.required).every(o => (g.progress[o.id] || 0) >= o.count);
        const alive = new Set(Array.isArray(raidOutcome && raidOutcome.aliveProfileIds) ? raidOutcome.aliveProfileIds : []);
        const extracted = new Set(Array.isArray(raidOutcome && raidOutcome.extractedProfileIds) ? raidOutcome.extractedProfileIds : []);
        const raidVerified = raidOutcome && raidOutcome.verified === true && raidOutcome.evidenceTrust === 'server_verified' && raidOutcome.source === 'fika-server-adapter';
        const results = [];
        for (const member of g.members) {
            const survived = alive.has(member.profileId);
            const escaped = extracted.has(member.profileId);
            const success = raidVerified && requiredDone && survived && escaped;
            member.result = success ? 'success' : (raidVerified ? 'failed' : 'review');
            results.push({ profileId: member.profileId, success, result: member.result });
            if (success) this.award(m, g, member.profileId);
        }
        g.finishedAt = new Date().toISOString();
        g.results = results;
        if (raidVerified) g.state = 'completed';
        else {
            g.state = 'review';
            g.reviewData = { requiredDone, aliveProfileIds: [...alive], extractedProfileIds: [...extracted], objectiveEvidence: (g.evidenceEvents || []).slice(-200), progressTrust: clone(g.progressTrust || {}), evidenceTrust: String(raidOutcome && raidOutcome.evidenceTrust || 'untrusted_client_report'), source: String(raidOutcome && raidOutcome.source || 'unknown'), submittedAt: g.finishedAt };
        }
        this.persist(); return clone(g);
    }

    setAnnouncementId(missionId, announcementId) {
        const m = this.state.missions.find(x => x.id === missionId);
        if (!m) throw new Error('MISSION_NOT_FOUND');
        m.announcementId = announcementId == null || announcementId === '' ? null : text(announcementId, 80, 'ANNOUNCEMENT_ID', true);
        m.updatedAt = new Date().toISOString(); this.persist(); return clone(m);
    }

    reviewQueue() { return this.state.groups.filter(g => g.state === 'review').map(clone); }

    resolveReview(groupId, decision, note, reviewer = 'ADMIN', attestation = {}) {
        const g = this.state.groups.find(x => x.id === groupId && x.state === 'review');
        if (!g) throw new Error('REVIEW_NOT_FOUND');
        if (!['approve', 'deny'].includes(decision)) throw new Error('INVALID_REVIEW_DECISION');
        const reviewNote = text(note, 1000, 'REVIEW_NOTE', true);
        const reviewedBy = text(reviewer, 80, 'REVIEWER', true);
        const m = this.state.missions.find(x => x.id === g.missionId);
        if (!m) throw new Error('MISSION_NOT_FOUND');
        const data = g.reviewData || {};
        const alive = new Set(data.aliveProfileIds || []);
        const extracted = new Set(data.extractedProfileIds || []);
        if (decision === 'approve') {
            if (!attestation || attestation.confirmed !== true) throw new Error('REVIEW_ATTESTATION_REQUIRED');
            const lifecycleEvidenceComplete = data.requiredDone === true && g.members.every(x => alive.has(x.profileId) && extracted.has(x.profileId));
            const adminEvidenceComplete = attestation.objectivesConfirmed === true && attestation.allMembersConfirmed === true;
            if (!lifecycleEvidenceComplete && !adminEvidenceComplete) throw new Error('REVIEW_EVIDENCE_INCOMPLETE');
            for (const member of g.members) { member.result = 'success'; this.award(m, g, member.profileId); }
        } else {
            for (const member of g.members) member.result = 'denied';
        }
        g.state = 'completed'; g.review = { decision, note: reviewNote, reviewer: reviewedBy, attested: decision === 'approve', attestationMethod: decision === 'approve' ? (attestation.objectivesConfirmed === true && attestation.allMembersConfirmed === true ? 'admin_manual_evidence_confirmation' : 'server_lifecycle_evidence') : null, objectivesConfirmed: decision === 'approve' && attestation.objectivesConfirmed === true, allMembersConfirmed: decision === 'approve' && attestation.allMembersConfirmed === true, reviewedAt: new Date().toISOString() };
        this.persist(); return clone(g);
    }

    award(mission, group, profileId) {
        const key = `${mission.id}:${group.id}:${profileId}`;
        if (this.state.awards.some(a => a.key === key)) return false;
        const record = { id: id('award'), key, missionId: mission.id, groupId: group.id, profileId,
            points: mission.rewards.points, roubles: mission.rewards.roubles, items: clone(mission.rewards.items), createdAt: new Date().toISOString(), status: 'pending_delivery' };
        this.state.awards.push(record);
        const stats = this.state.playerStats[profileId] || { points: 0, completedMissions: 0 };
        stats.points += record.points; stats.completedMissions += 1; this.state.playerStats[profileId] = stats;
        return true;
    }

    getPlayer(profileId) {
        profileId = requireProfileId(profileId);
        const stats = this.state.playerStats[profileId] || { points: 0, completedMissions: 0 };
        const defaults = [{ name: 'Recruit', points: 0 }, { name: 'Private', points: 1000 }, { name: 'Corporal', points: 3000 }, { name: 'Sergeant', points: 7000 }, { name: 'Lieutenant', points: 15000 }, { name: 'Captain', points: 30000 }, { name: 'Major', points: 50000 }, { name: 'Colonel', points: 80000 }, { name: 'General', points: 120000 }];
        const configured = Array.isArray(this.options.ranks) ? this.options.ranks.filter(r => r && typeof r.name === 'string' && r.name.trim() && Number.isSafeInteger(Number(r.points)) && Number(r.points) >= 0).map(r => ({ name: r.name.trim().slice(0, 40), points: Number(r.points) })) : [];
        const ranks = configured.length ? configured : defaults;
        const rank = ranks.filter(r => stats.points >= r.points).sort((a,b) => b.points-a.points)[0] || ranks.reduce((a,b) => a.points <= b.points ? a : b);
        return { profileId, ...clone(stats), rank: rank.name };
    }
}

module.exports = { OperationsService };
