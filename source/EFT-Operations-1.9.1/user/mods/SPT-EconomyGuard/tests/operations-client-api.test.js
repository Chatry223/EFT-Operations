'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OperationsService } = require('../src/operations/service');
const { OperationsClientApi } = require('../src/operations/client-api');
function reviewChecklist(objectiveIds, memberIndexes, outcomes = {}) {
    const objectiveEvidenceRefs = {};
    for (const objectiveId of objectiveIds) objectiveEvidenceRefs[objectiveId] = `Test evidence for objective ${objectiveId}`;
    const memberEvidenceRefs = {};
    const memberOutcomes = {};
    for (const memberIndex of memberIndexes) {
        const key = String(memberIndex);
        memberEvidenceRefs[key] = `Test evidence for member ${memberIndex}`;
        memberOutcomes[key] = outcomes[key] || 'success';
    }
    return { confirmed: true, confirmedObjectiveIds: objectiveIds, confirmedMemberIndexes: memberIndexes, objectiveEvidenceRefs, memberEvidenceRefs, memberOutcomes };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eft-ops-api-'));
const operations = new OperationsService(root, { info() {}, warn() {} });
const playerA = 'abcdef0123456789abcdef01';
const playerB = 'abcdef0123456789abcdef02';
const saveServer = { getProfile(sessionId) {
    if (sessionId === 'session-a') return { info: { Nickname: 'AccountAlpha' }, characters: { pmc: { _id: playerA, Info: { Nickname: 'Alpha' } }, scav: { _id: 'abcdef0123456789abcdef09', Info: { Nickname: 'Alpha-Scav' } } } };
    if (sessionId === 'session-b') return { info: { Nickname: 'AccountBravo' }, characters: { pmc: { _id: playerB, Info: { Nickname: 'Bravo' } }, scav: { _id: 'abcdef0123456789abcdef10', Info: { Nickname: 'Bravo-Scav' } } } };
    if (sessionId === 'abcdef0123456789abcdef90') return { info: { username: 'headless-test', password: 'fika-headless' }, characters: {
        pmc: { _id: 'abcdef0123456789abcdef91', Info: { Nickname: 'headless-test' } },
        scav: { _id: 'abcdef0123456789abcdef92', Info: { Nickname: 'headless-test-scav' } }
    } };
    throw new Error('NO_PROFILE');
} };
const responses = { noBody: value => ({ wrapped: value }) };
const api = new OperationsClientApi({ operations, saveServer, httpResponseUtil: responses, logger: { info() {}, warn() {} } });
const normalizedMap = operations.normalizeMission({ title: 'Map normalization', map: 'WoOdS', mode: 'solo', minPlayers: 1, maxPlayers: 1, objectives: [{ id: 'extract', type: 'extract', count: 1 }], rewards: {} });
assert.equal(normalizedMap.map, 'woods');
const mission = operations.save({ title: 'Client API Mission', description: 'Safe player bridge', map: 'woods', mode: 'squad', minPlayers: 2, maxPlayers: 2,
    objectives: [{ id: 'scavs', type: 'kill', target: 'scav', count: 2 }, { id: 'boss', type: 'kill_type', target: 'boss', count: 1 }, { id: 'visit', type: 'visit', target: 'bunker2', count: 1 }, { id: 'extract', type: 'extract', count: 1 }], rewards: { points: 50, roubles: 1000, items: [] } });
operations.setStatus(mission.id, 'published');

const list = api.listMissions('', {}, 'session-a').wrapped;
assert.equal(list.ok, true);
assert.equal(list.missions.length, 1);
assert.equal(list.missions[0].id, mission.id);
assert.equal(api.listMissions('', {}, '').wrapped.error, 'SESSION_UNAVAILABLE');

const acceptedA = api.acceptMission('', { missionId: mission.id, profileId: playerB }, 'session-a').wrapped;
assert.equal(acceptedA.ok, true);
assert.equal(acceptedA.group.members[0].displayName, 'Alpha');
assert.equal(acceptedA.group.members[0].profileId, undefined, 'private profile IDs are not exposed to clients');
assert.equal(operations.state.groups[0].members[0].scavProfileId, 'abcdef0123456789abcdef09', 'Scav identity is resolved server-side and stored privately');
const acceptedB = api.acceptMission('', { missionId: mission.id }, 'session-b').wrapped;
assert.equal(acceptedB.ok, true);
assert.equal(acceptedB.group.id, acceptedA.group.id);
assert.equal(acceptedA.group.isLeader, true);
assert.equal(acceptedB.group.isLeader, false);
assert.equal(acceptedA.group.leaderName, 'Alpha');
assert.equal(acceptedB.group.leaderName, 'Alpha');
assert.equal(acceptedA.group.members[0].profileId, undefined, 'public group must not expose profile IDs');
assert.equal(acceptedA.group.minPlayers, 2);
assert.equal(acceptedA.group.maxPlayers, 2);
assert.equal(acceptedA.group.readyCount, 0);
assert.equal(api.playerState('', {}, 'session-a').wrapped.canStart, false);

const readyA = api.setReady('', { groupId: acceptedA.group.id, ready: true }, 'session-a').wrapped;
assert.equal(readyA.ok, true);
assert.equal(readyA.canStart, false);
const readyB = api.setReady('', { groupId: acceptedA.group.id, ready: true }, 'session-b').wrapped;
assert.equal(readyB.canStart, true);
assert.equal(api.playerState('', {}, 'session-a').wrapped.canStart, true);
assert.equal(api.playerState('', {}, 'session-a').wrapped.group.readyCount, 2);
assert.equal(api.setReady('', { groupId: acceptedA.group.id, ready: true }, 'unknown').wrapped.error, 'NO_PROFILE');
assert.equal(api.setReady('', { groupId: acceptedA.group.id, ready: true }, 'session-a').wrapped.ok, true);
const left = api.leaveGroup('', { groupId: acceptedA.group.id }, 'session-a').wrapped;
assert.equal(left.ok, true);
assert.equal(left.group.members.length, 1);
assert.equal(api.leaveGroup('', { groupId: acceptedA.group.id }, 'session-a').wrapped.error, 'NOT_GROUP_MEMBER');
const leftB = api.leaveGroup('', { groupId: acceptedA.group.id }, 'session-b').wrapped;
assert.equal(leftB.ok, true);

const hostMission = operations.save({ title: 'Fika Host Evidence', map: 'woods', mode: 'squad', minPlayers: 2, maxPlayers: 2,
    objectives: [{ id: 'scavs', type: 'kill', target: 'scav', count: 2 }, { id: 'boss', type: 'kill_type', target: 'boss', count: 1 }, { id: 'visit', type: 'visit', target: 'bunker2', count: 1 }, { id: 'extract', type: 'extract', count: 1 }],
    rewards: { points: 500, roubles: 0, items: [] } });
operations.setStatus(hostMission.id, 'published');
const hostA = api.acceptMission('', { missionId: hostMission.id }, 'session-a').wrapped;
const hostB = api.acceptMission('', { missionId: hostMission.id }, 'session-b').wrapped;
api.setReady('', { groupId: hostA.group.id, ready: true }, 'session-a');
api.setReady('', { groupId: hostA.group.id, ready: true }, 'session-b');
operations.startGroup(hostA.group.id, 'abcdef0123456789abcdef10');
const activeFikaProfiles = new Set(['abcdef0123456789abcdef10', playerA]);
api.fikaOperationsAdapter = {
    isProfileInFikaMatch(matchId, profileId) {
        return matchId === 'abcdef0123456789abcdef10' && activeFikaProfiles.has(profileId);
    }
};

const hostKill = { eventId: 'host-kill-001', groupId: hostA.group.id, matchId: 'abcdef0123456789abcdef10',
    killerProfileId: 'abcdef0123456789abcdef10', victimProfileId: 'abcdef0123456789abcdef11',
    victimRole: 'assault', victimSide: 'Savage', victimIsAi: true };
assert.equal(api.hostRaidEvent('', hostKill, 'session-a').wrapped.error, 'HOST_PROFILE_MISMATCH', 'the Fika host may be a non-leader squad member');
assert.equal(api.hostRaidEvent('', Object.assign({}, hostKill, { killerProfileId: 'abcdef0123456789abcdef99' }), 'session-b').wrapped.error, 'KILLER_NOT_GROUP_MEMBER');
assert.equal(api.hostRaidEvent('', Object.assign({}, hostKill, { victimIsAi: false }), 'session-b').wrapped.error, 'INVALID_HOST_KILL_EVIDENCE');
const firstKill = api.hostRaidEvent('', hostKill, 'session-b').wrapped;
assert.equal(firstKill.ok, true);
assert.equal(firstKill.evidenceTrust, 'host_attested');
assert.equal(firstKill.group.objectiveProgress.find(x => x.id === 'scavs').progress, 1);
assert.equal(firstKill.group.objectiveProgress.find(x => x.id === 'scavs').trust, 'host_attested');
assert.deepEqual(firstKill.group.objectiveProgress.find(x => x.id === 'scavs').evidenceCounts, [{ trust: 'host_attested', count: 1 }]);
const liveHostGroup = operations.state.groups.find(x => x.id === hostA.group.id);
const hostEventCountAfterFirstKill = liveHostGroup.evidenceEvents.length;
assert.equal(api.hostRaidEvent('', Object.assign({}, hostKill, { eventId: 'host-kill-new-id-same-victim' }), 'session-b').wrapped.ok, true);
assert.equal(liveHostGroup.evidenceEvents.length, hostEventCountAfterFirstKill, 'a new eventId cannot count the same AI victim twice');
assert.equal(api.hostRaidEvent('', Object.assign({}, hostKill, { killerProfileId: playerB, eventId: 'host-kill-actor-not-in-live-match' }), 'session-b').wrapped.error, 'FIKA_ACTOR_NOT_IN_MATCH',
    'an accepted squad member who is not actually present in the Fika match cannot report an objective');
const savedTrustLedger = liveHostGroup.progressByTrust;
delete liveHostGroup.progressByTrust;
const legacyState = api.playerState('', {}, 'session-b').wrapped;
assert.equal(legacyState.group.objectiveProgress.find(x => x.id === 'scavs').trust, 'legacy_unattributed');
liveHostGroup.progressByTrust = savedTrustLedger;
assert.equal(operations.state.groups.find(x => x.id === hostA.group.id).evidenceEvents.length, 1);
const duplicateKill = api.hostRaidEvent('', hostKill, 'session-b').wrapped;
assert.equal(duplicateKill.ok, true);
assert.equal(duplicateKill.group.objectiveProgress.find(x => x.id === 'scavs').progress, 1, 'duplicate host event IDs cannot advance progress twice');
const bossKill = api.hostRaidEvent('', Object.assign({}, hostKill, {
    eventId: 'host-kill-002', victimProfileId: 'abcdef0123456789abcdef12', victimRole: 'bossKilla'
}), 'session-b').wrapped;
assert.equal(bossKill.ok, true);
assert.equal(bossKill.group.objectiveProgress.find(x => x.id === 'boss').progress, 1);
const nonHostVisit = api.hostRaidEvent('', { type: 'visit', eventId: 'host-visit-001', matchId: 'abcdef0123456789abcdef10', actorProfileId: 'abcdef0123456789abcdef10', triggerId: 'bunker2' }, 'session-a').wrapped;
assert.equal(nonHostVisit.error, 'HOST_PROFILE_MISMATCH');
const hostVisit = api.hostRaidEvent('', { type: 'visit', eventId: 'host-visit-001', matchId: 'abcdef0123456789abcdef10', actorProfileId: 'abcdef0123456789abcdef10', triggerId: 'bunker2' }, 'session-b').wrapped;
assert.equal(hostVisit.ok, true);
assert.equal(hostVisit.group.objectiveProgress.find(x => x.id === 'visit').progress, 1);
assert.equal(hostVisit.group.objectiveProgress.find(x => x.id === 'visit').trust, 'host_attested');
const visitEvidenceCount = liveHostGroup.evidenceEvents.filter(event => event.type === 'visit').length;
const duplicateVisit = api.hostRaidEvent('', { type: 'visit', eventId: 'host-visit-001', matchId: 'abcdef0123456789abcdef10', actorProfileId: 'abcdef0123456789abcdef10', triggerId: 'bunker2' }, 'session-b').wrapped;
assert.equal(duplicateVisit.group.objectiveProgress.find(x => x.id === 'visit').progress, 1);
const semanticDuplicateVisit = api.hostRaidEvent('', { type: 'visit', eventId: 'host-visit-new-id-same-trigger', matchId: 'abcdef0123456789abcdef10', actorProfileId: 'abcdef0123456789abcdef10', triggerId: 'bunker2' }, 'session-b').wrapped;
assert.equal(semanticDuplicateVisit.ok, true);
assert.equal(liveHostGroup.evidenceEvents.filter(event => event.type === 'visit').length, visitEvidenceCount, 'one operator cannot inflate visits by changing eventId');
const hostReview = operations.finishGroup(hostA.group.id, { verified: true, aliveProfileIds: [playerA, playerB], extractedProfileIds: [playerA, playerB] });
assert.equal(hostReview.state, 'review', 'host-attested kills never trigger automatic completion or rewards');
assert.equal(operations.state.awards.length, 0);
assert.equal(hostReview.reviewData.objectiveEvidence.length, 3);
// Close the reviewed prior group before reusing the same operators in the next test raid.
operations.resolveReview(hostA.group.id, 'deny', 'Test setup: previous run evidence not approved', 'ADMIN');

// Fika 2.4.3 Headless uses its authenticated SPT Session ID as the Fika serverId,
// but remains a telemetry reporter rather than a mission squad member or a server verifier.
const headlessMission = operations.save({ title: 'Headless Host Mission', map: 'woods', mode: 'squad', minPlayers: 2, maxPlayers: 2,
    objectives: [{ id: 'scavs', type: 'kill', target: 'scav', count: 1 }],
    rewards: { points: 125, roubles: 0, items: [] } });
operations.setStatus(headlessMission.id, 'published');
const headlessA = api.acceptMission('', { missionId: headlessMission.id }, 'session-a').wrapped;
const headlessB = api.acceptMission('', { missionId: headlessMission.id }, 'session-b').wrapped;
api.setReady('', { groupId: headlessA.group.id, ready: true }, 'session-a');
api.setReady('', { groupId: headlessA.group.id, ready: true }, 'session-b');
operations.startGroup(headlessA.group.id, 'abcdef0123456789abcdef90');
const headlessKill = api.hostRaidEvent('', {
    eventId: 'headless-host-kill-001', matchId: 'abcdef0123456789abcdef90',
    killerProfileId: playerA, victimProfileId: 'abcdef0123456789abcdef93',
    victimRole: 'assault', victimSide: 'Savage', victimIsAi: true
}, 'abcdef0123456789abcdef90').wrapped;
assert.equal(headlessKill.ok, true, 'authenticated Fika Headless host may report for the linked mission Match');
assert.equal(headlessKill.evidenceTrust, 'host_attested');
assert.equal(headlessKill.group.objectiveProgress[0].progress, 1);
assert.equal(headlessKill.group.objectiveProgress[0].trust, 'host_attested');
assert.equal(operations.state.groups.find(group => group.id === headlessA.group.id).evidenceEvents[0].reporterKind, 'fika_headless_host');
assert.equal(api.hostRaidEvent('', {
    eventId: 'headless-host-kill-wrong-match', matchId: 'abcdef0123456789abcdef91',
    killerProfileId: playerA, victimProfileId: 'abcdef0123456789abcdef94',
    victimRole: 'assault', victimSide: 'Savage', victimIsAi: true
}, 'abcdef0123456789abcdef90').wrapped.error, 'HEADLESS_HOST_PROFILE_MISMATCH');
assert.equal(api.hostRaidEvent('', {
    eventId: 'headless-host-kill-not-member', matchId: 'abcdef0123456789abcdef90',
    killerProfileId: 'abcdef0123456789abcdef99', victimProfileId: 'abcdef0123456789abcdef95',
    victimRole: 'assault', victimSide: 'Savage', victimIsAi: true
}, 'abcdef0123456789abcdef90').wrapped.error, 'KILLER_NOT_GROUP_MEMBER');
const headlessReview = operations.finishGroup(headlessA.group.id, { verified: false, source: 'fika-server-adapter', evidenceTrust: 'fika_match_end_lifecycle_with_authenticated_roster', aliveProfileIds: [], extractedProfileIds: [] });
assert.equal(headlessReview.state, 'review');
assert.equal(operations.state.awards.filter(award => award.groupId === headlessA.group.id).length, 0,
    'Headless host telemetry remains review-only and never triggers automatic rewards');

const campaignOps = new OperationsService(path.join(root, 'campaign-data'), { info() {}, warn() {} });
const campaignMission1 = campaignOps.save({ title: 'Blackout 01', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1, campaignId: 'Operation Blackout', campaignOrder: 1, objectives: [{ id: 'exit', type: 'extract' }], rewards: { points: 500, roubles: 0, items: [] } });
const campaignMission2 = campaignOps.save({ title: 'Blackout 02', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1, campaignId: 'operation-blackout', campaignOrder: 2, requiredPoints: 0, objectives: [{ id: 'exit', type: 'extract' }], rewards: { points: 200, roubles: 0, items: [] } });
const campaignMission3 = campaignOps.save({ title: 'Blackout 03', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1, campaignId: 'operation-blackout', campaignOrder: 3, requiredPoints: 600, objectives: [{ id: 'exit', type: 'extract' }], rewards: { points: 0, roubles: 0, items: [] } });
const campaignMission4 = campaignOps.save({ title: 'Blackout 04', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1, campaignId: 'operation-blackout', campaignOrder: 4, objectives: [{ id: 'exit', type: 'extract' }], rewards: { points: 100, roubles: 0, items: [] } });
assert.equal(campaignMission1.campaignId, 'operation-blackout');
assert.equal(campaignMission1.campaignOrder, 1);
assert.throws(() => campaignOps.save({ title: 'Duplicate Blackout 02', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1,
    campaignId: 'operation-blackout', campaignOrder: 2, objectives: [{ id: 'exit', type: 'extract' }] }), /DUPLICATE_CAMPAIGN_SEQUENCE/);
assert.throws(() => campaignOps.save({ title: 'Sequence without campaign', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1,
    campaignOrder: 1, objectives: [{ id: 'exit', type: 'extract' }] }), /CAMPAIGN_ORDER_REQUIRES_ID/);
campaignOps.setStatus(campaignMission1.id, 'published');
campaignOps.setStatus(campaignMission2.id, 'published');
campaignOps.setStatus(campaignMission3.id, 'published');
campaignOps.setStatus(campaignMission4.id, 'published');
const campaignApi = new OperationsClientApi({ operations: campaignOps, saveServer, httpResponseUtil: responses, logger: { info() {}, warn() {} } });
const lockedCampaignList = campaignApi.listMissions('', {}, 'session-a').wrapped;
const lockedSecond = lockedCampaignList.missions.find(item => item.id === campaignMission2.id);
const lockedThird = lockedCampaignList.missions.find(item => item.id === campaignMission3.id);
assert.equal(lockedSecond.locked, true);
assert.equal(lockedSecond.lockReason, 'CAMPAIGN_PREREQUISITES_NOT_MET');
assert.equal(lockedThird.locked, true);
assert.equal(lockedThird.lockReason, 'RANK_REQUIREMENT_NOT_MET');
assert.throws(() => campaignOps.accept(campaignMission2.id, playerA, 'Alpha'), /CAMPAIGN_PREREQUISITES_NOT_MET/);
const campaignGroup1 = campaignOps.accept(campaignMission1.id, playerA, 'Alpha');
campaignOps.setReady(campaignGroup1.id, playerA, true);
campaignOps.startGroup(campaignGroup1.id, 'raid-blackout-01');
campaignOps.finishGroup(campaignGroup1.id, { verified: false, source: 'fika-client-report', evidenceTrust: 'client_report_only', aliveProfileIds: [], extractedProfileIds: [] });
campaignOps.resolveReview(campaignGroup1.id, 'approve', 'Admin verified mission evidence', 'ADMIN', reviewChecklist(['exit'], [0]));
assert.equal(campaignOps.getMissionEligibility(campaignMission2.id, playerA).available, true);
const campaignGroup2 = campaignOps.accept(campaignMission2.id, playerA, 'Alpha');
campaignOps.setReady(campaignGroup2.id, playerA, true);
campaignOps.startGroup(campaignGroup2.id, 'raid-blackout-02');
campaignOps.finishGroup(campaignGroup2.id, { verified: false, source: 'fika-client-report', evidenceTrust: 'client_report_only', aliveProfileIds: [], extractedProfileIds: [] });
campaignOps.resolveReview(campaignGroup2.id, 'approve', 'Admin verified mission evidence', 'ADMIN', reviewChecklist(['exit'], [0]));
assert.equal(campaignOps.getPlayer(playerA).points, 700);
assert.equal(campaignOps.getPlayer(playerA).rank, 'Recruit');
assert.equal(campaignOps.getPlayer(playerA).nextRank, 'Private');
assert.equal(campaignOps.getPlayer(playerA).pointsToNextRank, 300);
assert.equal(campaignOps.getPlayer(playerA).rankProgressPercent, 70);
assert.equal(campaignOps.getMissionEligibility(campaignMission3.id, playerA).available, true);
const unlockedCampaignList = campaignApi.listMissions('', {}, 'session-a').wrapped;
assert.equal(unlockedCampaignList.missions.find(item => item.id === campaignMission3.id).locked, false);
assert.equal(unlockedCampaignList.missions.find(item => item.id === campaignMission4.id).locked, true);
const campaignGroup3 = campaignOps.accept(campaignMission3.id, playerA, 'Alpha');
campaignOps.setReady(campaignGroup3.id, playerA, true);
campaignOps.startGroup(campaignGroup3.id, 'raid-blackout-03');
campaignOps.finishGroup(campaignGroup3.id, { verified: false, source: 'fika-client-report', evidenceTrust: 'client_report_only', aliveProfileIds: [], extractedProfileIds: [] });
campaignOps.resolveReview(campaignGroup3.id, 'deny', 'Evidence did not meet requirements', 'ADMIN');
assert.equal(campaignOps.getMissionEligibility(campaignMission4.id, playerA).available, false,
    'a denied operation must not unlock the next campaign mission');
assert.equal(campaignOps.getPlayer(playerA).points, 700, 'a denied operation must not add rank points');

const soloMission = operations.save({ title: 'Empty Squad Cleanup', map: 'customs', mode: 'solo', minPlayers: 1, maxPlayers: 1, objectives: [{ id: 'exit', type: 'extract' }] });
operations.setStatus(soloMission.id, 'published');
const soloGroup = operations.accept(soloMission.id, 'abcdef0123456789abcdef03', 'Solo');
const emptyGroup = operations.leaveGroup(soloGroup.id, 'abcdef0123456789abcdef03');
assert.equal(emptyGroup.state, 'cancelled');
assert.equal(operations.state.groups.some(g => g.id === soloGroup.id), false, 'empty forming groups are removed from active storage');

let registered;
const container = { resolve(name) {
    if (name === 'StaticRouterModService') return { registerStaticRouter(routerName, routes, prefix) { registered = { routerName, routes, prefix }; } };
    throw new Error('NOT_FOUND');
} };
assert.equal(api.register(container), true);
assert.equal(registered.routerName, 'EFTOperationsClientApi');
assert.equal(registered.prefix, 'EFTOperations');
assert.deepEqual(registered.routes.map(x => x.url), [
    '/client/eft/operations/missions', '/client/eft/operations/state', '/client/eft/operations/accept', '/client/eft/operations/ready', '/client/eft/operations/leave', '/client/eft/operations/host-event'
]);
const routeList = registered.routes[0].action('', {}, 'session-a').wrapped;
assert.equal(routeList.ok, true);

fs.rmSync(root, { recursive: true, force: true });
console.log('OperationsClientApi: all tests passed');
