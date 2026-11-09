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
    if (sessionId === 'session-a') return { info: { Nickname: 'Alpha' }, characters: { pmc: { _id: playerA } } };
    if (sessionId === 'session-b') return { info: { Nickname: 'Bravo' }, characters: { pmc: { _id: playerB } } };
    throw new Error('NO_PROFILE');
} };
const responses = { noBody: value => ({ wrapped: value }) };
const api = new OperationsClientApi({ operations, saveServer, httpResponseUtil: responses, logger: { info() {}, warn() {} } });
const mission = operations.save({ title: 'Client API Mission', description: 'Safe player bridge', map: 'woods', mode: 'squad', minPlayers: 2, maxPlayers: 2,
    objectives: [{ id: 'extract', type: 'extract', count: 1 }], rewards: { points: 50, roubles: 1000, items: [] } });
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
const acceptedB = api.acceptMission('', { missionId: mission.id }, 'session-b').wrapped;
assert.equal(acceptedB.ok, true);
assert.equal(acceptedB.group.id, acceptedA.group.id);

const readyA = api.setReady('', { groupId: acceptedA.group.id, ready: true }, 'session-a').wrapped;
assert.equal(readyA.ok, true);
assert.equal(readyA.canStart, false);
const readyB = api.setReady('', { groupId: acceptedA.group.id, ready: true }, 'session-b').wrapped;
assert.equal(readyB.canStart, true);
assert.equal(api.setReady('', { groupId: acceptedA.group.id, ready: true }, 'unknown').wrapped.error, 'NO_PROFILE');
assert.equal(api.setReady('', { groupId: acceptedA.group.id, ready: true }, 'session-a').wrapped.ok, true);
const left = api.leaveGroup('', { groupId: acceptedA.group.id }, 'session-a').wrapped;
assert.equal(left.ok, true);
assert.equal(left.group.members.length, 1);
assert.equal(api.leaveGroup('', { groupId: acceptedA.group.id }, 'session-a').wrapped.error, 'NOT_GROUP_MEMBER');
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
    '/client/eft/operations/missions', '/client/eft/operations/state', '/client/eft/operations/accept', '/client/eft/operations/ready', '/client/eft/operations/leave'
]);
const routeList = registered.routes[0].action('', {}, 'session-a').wrapped;
assert.equal(routeList.ok, true);

fs.rmSync(root, { recursive: true, force: true });
console.log('OperationsClientApi: all tests passed');
