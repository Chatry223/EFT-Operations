'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OperationsService } = require('../src/operations/service');
const { OperationsClientApi } = require('../src/operations/client-api');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eft-ops-api-'));
const operations = new OperationsService(root, { info() {}, warn() {} });
const playerA = 'abcdef0123456789abcdef01';
const playerB = 'abcdef0123456789abcdef02';
const saveServer = { getProfile(sessionId) {
    if (sessionId === 'session-a') return { info: { Nickname: 'AccountAlpha' }, characters: { pmc: { _id: playerA, Info: { Nickname: 'Alpha' } }, scav: { _id: 'abcdef0123456789abcdef09', Info: { Nickname: 'Alpha-Scav' } } } };
    if (sessionId === 'session-b') return { info: { Nickname: 'AccountBravo' }, characters: { pmc: { _id: playerB, Info: { Nickname: 'Bravo' } }, scav: { _id: 'abcdef0123456789abcdef10', Info: { Nickname: 'Bravo-Scav' } } } };
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
const duplicateVisit = api.hostRaidEvent('', { type: 'visit', eventId: 'host-visit-001', matchId: 'abcdef0123456789abcdef10', actorProfileId: 'abcdef0123456789abcdef10', triggerId: 'bunker2' }, 'session-b').wrapped;
assert.equal(duplicateVisit.group.objectiveProgress.find(x => x.id === 'visit').progress, 1);
const hostReview = operations.finishGroup(hostA.group.id, { verified: true, aliveProfileIds: [playerA, playerB], extractedProfileIds: [playerA, playerB] });
assert.equal(hostReview.state, 'review', 'host-attested kills never trigger automatic completion or rewards');
assert.equal(operations.state.awards.length, 0);
assert.equal(hostReview.reviewData.objectiveEvidence.length, 3);

const campaignOps = new OperationsService(path.join(root, 'campaign-data'), { info() {}, warn() {} });
const campaignMission1 = campaignOps.save({ title: 'Blackout 01', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1, campaignId: 'Operation Blackout', campaignOrder: 1, objectives: [{ id: 'exit', type: 'extract' }], rewards: { points: 500, roubles: 0, items: [] } });
const campaignMission2 = campaignOps.save({ title: 'Blackout 02', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1, campaignId: 'operation-blackout', campaignOrder: 2, requiredPoints: 0, objectives: [{ id: 'exit', type: 'extract' }], rewards: { points: 200, roubles: 0, items: [] } });
const campaignMission3 = campaignOps.save({ title: 'Blackout 03', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1, campaignId: 'operation-blackout', campaignOrder: 3, requiredPoints: 600, objectives: [{ id: 'exit', type: 'extract' }], rewards: { points: 0, roubles: 0, items: [] } });
assert.equal(campaignMission1.campaignId, 'operation-blackout');
assert.equal(campaignMission1.campaignOrder, 1);
assert.throws(() => campaignOps.save({ title: 'Duplicate Blackout 02', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1,
    campaignId: 'operation-blackout', campaignOrder: 2, objectives: [{ id: 'exit', type: 'extract' }] }), /DUPLICATE_CAMPAIGN_SEQUENCE/);
assert.throws(() => campaignOps.save({ title: 'Sequence without campaign', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1,
    campaignOrder: 1, objectives: [{ id: 'exit', type: 'extract' }] }), /CAMPAIGN_ORDER_REQUIRES_ID/);
campaignOps.setStatus(campaignMission1.id, 'published');
campaignOps.setStatus(campaignMission2.id, 'published');
campaignOps.setStatus(campaignMission3.id, 'published');
const campaignApi = new OperationsClientApi({ operations: campaignOps, saveServer, httpResponseUtil: responses, logger: { info() {}, warn() {} } });
const lockedCampaignList = campaignApi.listMissions('', {}, 'session-a').wrapped;
const lockedSecond = lockedCampaignList.missions.find(item => item.id === campaignMission2.id);
const lockedThird = lockedCampaignList.missions.find(item => item.id === campaignMission3.id);
assert.equal(lockedSecond.locked, true);
assert.equal(lockedSecond.lockReason, 'CAMPAIGN_PREREQUISITES_NOT_MET');
assert.equal(lockedThird.locked, true);
assert.equal(lockedThird.lockReason, 'RANK_REQUIREMENT_NOT_MET');
assert.throws(() => campaignOps.accept(campaignMission2.id, playerA, 'Alpha'), /CAMPAIGN_PREREQUISITES_NOT_MET/);
campaignOps.award(campaignMission1, { id: 'approved-blackout-01' }, playerA);
assert.equal(campaignOps.getMissionEligibility(campaignMission2.id, playerA).available, true);
campaignOps.accept(campaignMission2.id, playerA, 'Alpha');
campaignOps.award(campaignMission2, { id: 'approved-blackout-02' }, playerA);
assert.equal(campaignOps.getPlayer(playerA).points, 700);
assert.equal(campaignOps.getPlayer(playerA).rank, 'Recruit');
assert.equal(campaignOps.getPlayer(playerA).nextRank, 'Private');
assert.equal(campaignOps.getPlayer(playerA).pointsToNextRank, 300);
assert.equal(campaignOps.getPlayer(playerA).rankProgressPercent, 70);
assert.equal(campaignOps.getMissionEligibility(campaignMission3.id, playerA).available, true);
const unlockedCampaignList = campaignApi.listMissions('', {}, 'session-a').wrapped;
assert.equal(unlockedCampaignList.missions.find(item => item.id === campaignMission3.id).locked, false);

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
