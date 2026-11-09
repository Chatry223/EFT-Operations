'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Fika243OperationsAdapter } = require('./fika243-adapter');
const { OperationsService } = require('./service');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eft-fika243-'));
const modDir = path.join(root, 'user', 'mods', 'SPT-EconomyGuard');
const fikaDir = path.join(root, 'user', 'mods', 'fika-server');
const dataDir = path.join(root, 'operations-data');
fs.mkdirSync(modDir, { recursive: true });
fs.mkdirSync(fikaDir, { recursive: true });
fs.writeFileSync(path.join(fikaDir, 'package.json'), JSON.stringify({ version: '2.4.3', sptVersion: '~3.11.0' }));

const adapter = new Fika243OperationsAdapter({ modDir, operations: { dataDir }, logger: { info() {}, warn() {}, debug() {} } });
assert.equal(adapter.getStatus().enabled, true, 'only the configured Fika 2.4.3 / SPT 3.11 line should enable hooks');
assert.equal(adapter.getStatus().fikaServerVersion, '2.4.3');
assert.equal(adapter.getStatus().fikaClientTargetVersion, '1.2.3');
assert.equal(adapter.getStatus().fikaClientConfigLastVersion, '1.2.3');
assert.match(adapter.getStatus().fikaClientConfigEvidence, /advisory only/);
assert.equal(adapter.getStatus().operationsClientPluginVersion, '0.1.0');

const matchService = {
    getMatch(id) { return id === 'match-1' ? { players: new Map([['profile-a', {}], ['profile-b', {}]]) } : null; },
    endMatch(id, reason) { return { id, reason }; }
};
assert.equal(adapter.patchMatchService(matchService), true);
const originalResult = matchService.endMatch('match-1', 'host_left');
assert.deepEqual(originalResult, { id: 'match-1', reason: 'host_left' });
const matchEvents = adapter.getRecentEvents(10);
assert.equal(matchEvents.length, 1);
assert.equal(matchEvents[0].type, 'fika_match_end');
assert.deepEqual(matchEvents[0].players.sort(), ['profile-a', 'profile-b']);
assert.equal(matchEvents[0].evidenceTrust, 'fika_match_end_lifecycle_with_authenticated_roster');
assert.equal(matchEvents[0].rewardEligible, false, 'a match-end hook alone must never authorize rewards');

// A raid-end request is client-originated. Preserve it for review, but mark it untrusted.
adapter.services.saveServer = { getProfile() { return { characters: { pmc: { _id: 'abcdef0123456789abcdef01', Info: { Nickname: 'pmc-name' } }, scav: { _id: 'abcdef0123456789abcdef02', Info: { Nickname: 'scav-name' } } } }; } };
adapter.services.fikaMatchService = { getMatchIdByProfile() { return 'match-1'; }, getMatch(id) { return id === 'match-1' ? { hostUsername: 'pmc-name' } : null; } };
const raidEnd = adapter.captureRaidEnd('session-1', { serverId: 'woods.123', results: { result: 'Survived', exitName: 'Outskirts', playTime: 1200 } });
assert.equal(raidEnd.matchId, 'match-1');
assert.equal(raidEnd.profileId, 'abcdef0123456789abcdef01');
assert.equal(raidEnd.evidenceTrust, 'untrusted_client_report');
assert.equal(raidEnd.rewardEligible, false, 'client raid-result payloads must never authorize rewards');

// Fika 2.4.3 update callbacks receive the authenticated SPT session ID.
// Reject attempts to add/mark a different account's profile in the match.
let acceptedUpdateCalls = 0;
const fakeUpdateCallbacks = {
    handleRaidAddPlayer(url, info, sessionId) { acceptedUpdateCalls++; return 'added'; },
    handlePlayerDied(url, info, sessionId) { acceptedUpdateCalls++; return 'dead'; }
};
assert.equal(adapter.patchUpdateCallbacks(fakeUpdateCallbacks), true);
assert.equal(fakeUpdateCallbacks.handleRaidAddPlayer('', { profileId: 'abcdef0123456789abcdef01' }, 'session-1'), 'added');
assert.equal(fakeUpdateCallbacks.handlePlayerDied('', { profileId: 'abcdef0123456789abcdef02' }, 'session-1'), 'dead');
assert.equal(acceptedUpdateCalls, 2);
const deathEvidence = adapter.getRecentEvents(20).find(event => event.type === 'fika_player_died');
assert.ok(deathEvidence, 'authenticated Fika player-death reports should be retained for review');
assert.equal(deathEvidence.profileId, 'abcdef0123456789abcdef01');
assert.equal(deathEvidence.reportedCharacterProfileId, 'abcdef0123456789abcdef02');
assert.equal(deathEvidence.evidenceTrust, 'authenticated_client_report');
assert.equal(deathEvidence.rewardEligible, false, 'player-death reports must not auto-award');
const raidEvidenceWithVictim = adapter.captureRaidEnd('session-1', {
    serverId: 'woods.456',
    results: {
        result: 'Survived',
        exitName: 'Outskirts',
        profile: {
            Stats: {
                Eft: {
                    Victims: [{ ProfileId: 'abcdef0123456789abcdef02', Name: 'Scav-Test', Role: 'assault', Side: 'Savage', Level: 5, Distance: 42, Weapon: 'weapon-test', Location: 'Woods' }],
                    SessionCounters: { Items: [{ Key: ['KilledSavage'], Value: 1 }] },
                    FoundInRaidItems: [{ QuestId: 'quest-1', ItemId: 'item-1' }],
                    DroppedItems: [{ QuestId: 'quest-1', ItemId: 'item-2', ZoneId: 'zone-1' }]
                }
            }
        }
    }
});
assert.equal(raidEvidenceWithVictim.reportedVictimCount, 1);
assert.equal(raidEvidenceWithVictim.reportedKillCountsByRole.assault, 1);
assert.equal(raidEvidenceWithVictim.corroboratedVictimCount, 1, 'Fika death reports should corroborate matching PMC/Scav victim IDs');
assert.equal(raidEvidenceWithVictim.reportedSessionCounters[0].value, 1);
assert.equal(raidEvidenceWithVictim.reportedFoundInRaidQuestItems.length, 1);
assert.equal(raidEvidenceWithVictim.reportedDroppedQuestItems.length, 1);
assert.equal(raidEvidenceWithVictim.evidenceTrust, 'untrusted_client_report');
assert.equal(raidEvidenceWithVictim.rewardEligible, false);
assert.throws(() => fakeUpdateCallbacks.handleRaidAddPlayer('', { profileId: 'abcdef0123456789abcdef99' }, 'session-1'), /FIKA_SESSION_PROFILE_MISMATCH/);
assert.throws(() => fakeUpdateCallbacks.handlePlayerDied('', { profileId: 'abcdef0123456789abcdef99' }, 'session-1'), /FIKA_SESSION_PROFILE_MISMATCH/);
assert.equal(acceptedUpdateCalls, 2, 'mismatched account IDs must be rejected before Fika mutates its match registry');

// Raid creation and host/member leave requests must also match the authenticated account.
let acceptedRaidCalls = 0;
const fakeRaidCallbacks = {
    handleRaidCreate(url, info, sessionId) { acceptedRaidCalls++; return 'created'; },
    handleRaidLeave(url, info, sessionId) { acceptedRaidCalls++; return 'left'; }
};
assert.equal(adapter.patchRaidCallbacks(fakeRaidCallbacks), true);
assert.equal(fakeRaidCallbacks.handleRaidCreate('', { serverId: 'match-1', hostUsername: 'pmc-name' }, 'session-1'), 'created');
assert.equal(fakeRaidCallbacks.handleRaidLeave('', { serverId: 'match-1', profileId: 'abcdef0123456789abcdef02' }, 'session-1'), 'left');
assert.equal(fakeRaidCallbacks.handleRaidLeave('', { serverId: 'match-1', profileId: 'match-1' }, 'session-1'), 'left', 'host sentinel must be authenticated using Fika match host identity');
assert.equal(acceptedRaidCalls, 3);
assert.throws(() => fakeRaidCallbacks.handleRaidCreate('', { serverId: 'match-2', hostUsername: 'someone-else' }, 'session-1'), /FIKA_HOST_SESSION_IDENTITY_MISMATCH/);
assert.throws(() => fakeRaidCallbacks.handleRaidLeave('', { serverId: 'match-1', profileId: 'abcdef0123456789abcdef99' }, 'session-1'), /FIKA_SESSION_PROFILE_MISMATCH/);
assert.equal(acceptedRaidCalls, 3, 'spoofed create/leave requests must be rejected before Fika mutates matches');

// Exact Fika 2.4.3 lifecycle simulation: bind a ready operation group only
// after all mission members have joined the same map/match, then create a review
// record at match end. Client extraction reports remain untrusted and award nothing.
const lifecycleRoot = path.join(root, 'lifecycle');
const lifecycleModDir = path.join(lifecycleRoot, 'user', 'mods', 'SPT-EconomyGuard');
const lifecycleFikaDir = path.join(lifecycleRoot, 'user', 'mods', 'fika-server');
fs.mkdirSync(lifecycleModDir, { recursive: true });
fs.mkdirSync(lifecycleFikaDir, { recursive: true });
fs.writeFileSync(path.join(lifecycleFikaDir, 'package.json'), JSON.stringify({ version: '2.4.3', sptVersion: '~3.11.0' }));
const ops = new OperationsService(lifecycleRoot, { info() {}, warn() {} });
const mission = ops.save({ title: 'Fika linked mission', map: 'woods', mode: 'squad', minPlayers: 2, maxPlayers: 2,
    objectives: [{ id: 'extract', type: 'extract', count: 1, required: true }], rewards: { points: 100, roubles: 0, items: [] } });
ops.setStatus(mission.id, 'published');
const group = ops.accept(mission.id, 'abcdef0123456789abcdef11', 'One');
ops.accept(mission.id, 'abcdef0123456789abcdef12', 'Two', 'abcdef0123456789abcdef13');
ops.setReady(group.id, 'abcdef0123456789abcdef11', true);
ops.setReady(group.id, 'abcdef0123456789abcdef12', true);
const lifecycleAdapter = new Fika243OperationsAdapter({ modDir: lifecycleModDir, operations: ops, logger: { info() {}, warn() {}, debug() {} } });
class FakeFikaMatchService {
    constructor() { this.matches = new Map([['match-live', { locationData: { Id: 'woods' }, raidConfig: { location: 'woods' }, players: new Map([['match-live', { isDead: false }]]) }]]); }
    getMatch(id) { return this.matches.get(id); }
    getMatchIdByProfile() { return 'match-live'; }
    addPlayerToMatch(matchId, playerId, data) { this.matches.get(matchId).players.set(playerId, data); }
    createMatch(data) { this.matches.set(data.serverId, { locationData: { Id: 'woods' }, raidConfig: { location: 'woods' }, players: new Map() }); return true; }
    deleteMatch(matchId) { this.matches.delete(matchId); }
    endMatch(matchId, reason) { const match = this.matches.get(matchId); this.deleteMatch(matchId); return { matchId, reason, match }; }
}
const liveMatchService = new FakeFikaMatchService();
lifecycleAdapter.services.fikaMatchService = liveMatchService;
const raidProfiles = new Map();
const profileFor = (sessionId, pmcItems = [], scavItems = []) => ({
    characters: {
        pmc: { _id: sessionId, Info: { Nickname: 'PMC-' + sessionId.slice(-2) }, Inventory: { items: pmcItems } },
        scav: { _id: sessionId === 'abcdef0123456789abcdef12' ? 'abcdef0123456789abcdef13' : 'abcdef0123456789abcdef14',
            Info: { Nickname: 'Scav-' + sessionId.slice(-2) }, Inventory: { items: scavItems } }
    }
});
raidProfiles.set('abcdef0123456789abcdef11', profileFor('abcdef0123456789abcdef11', [
    { _id: 'pre-item', _tpl: 'tpl-stack', upd: { StackObjectsCount: 2 } }
]));
raidProfiles.set('abcdef0123456789abcdef12', profileFor('abcdef0123456789abcdef12', [], [
    { _id: 'scav-pre', _tpl: 'tpl-scav', upd: { StackObjectsCount: 1 } }
]));
lifecycleAdapter.services.saveServer = { getProfile(sessionId) { return raidProfiles.get(sessionId) || null; } };
assert.equal(lifecycleAdapter.patchMatchService(liveMatchService), true);
assert.equal(ops.state.groups.find(x => x.id === group.id).state, 'forming', 'Fika 2.4.3 first registers the host under the synthetic serverId; this must not count as the host PMC profile');
liveMatchService.addPlayerToMatch('match-live', 'abcdef0123456789abcdef11', { isDead: false });
assert.equal(ops.state.groups.find(x => x.id === group.id).state, 'forming', 'one member is not enough to bind a two-person mission');
liveMatchService.addPlayerToMatch('match-live', 'abcdef0123456789abcdef13', { isDead: false });
assert.equal(ops.state.groups.find(x => x.id === group.id).state, 'in_raid', 'all ready members in the same Fika match starts the operation');
assert.equal(ops.state.groups.find(x => x.id === group.id).raidId, 'match-live');
assert.deepEqual(ops.state.groups.find(x => x.id === group.id).members.map(x => x.scavProfileId), [null, 'abcdef0123456789abcdef13']);
ops.recordRaidEvent(group.id, { type: 'extract', amount: 1, map: 'woods', source: 'fika-server-adapter', evidenceTrust: 'server_verified' });
assert.ok(lifecycleAdapter.captureRaidStart('abcdef0123456789abcdef11', { playerSide: 'pmc', location: 'woods' }, { location: 'woods' }));
assert.ok(lifecycleAdapter.captureRaidStart('abcdef0123456789abcdef12', { playerSide: 'savage', location: 'woods' }, { location: 'woods' }));
raidProfiles.set('abcdef0123456789abcdef11', profileFor('abcdef0123456789abcdef11', [
    { _id: 'pre-item', _tpl: 'tpl-stack', upd: { StackObjectsCount: 5, SpawnedInSession: true } },
    { _id: 'new-item', _tpl: 'tpl-new', upd: { StackObjectsCount: 1, SpawnedInSession: true } }
]));
raidProfiles.set('abcdef0123456789abcdef12', profileFor('abcdef0123456789abcdef12', [], [
    { _id: 'scav-pre', _tpl: 'tpl-scav', upd: { StackObjectsCount: 1 } }
]));
const lootRaidEnd = lifecycleAdapter.captureRaidEnd('abcdef0123456789abcdef11', {
    serverId: 'woods.1',
    results: { result: 'Survived', exitName: 'Outskirts', profile: { Inventory: { items: [
        { _id: 'pre-item', _tpl: 'tpl-stack', upd: { StackObjectsCount: 5, SpawnedInSession: true } },
        { _id: 'new-item', _tpl: 'tpl-new', upd: { StackObjectsCount: 1, SpawnedInSession: true } }
    ] } } }
});
assert.equal(lootRaidEnd.lootSnapshotAvailable, true);
assert.equal(lootRaidEnd.serverProfileAvailable, true);
assert.equal(lootRaidEnd.reportedLootItemCount, 4);
assert.equal(lootRaidEnd.reportedLootByTpl['tpl-stack'], 3);
assert.equal(lootRaidEnd.reportedLootByTpl['tpl-new'], 1);
lifecycleAdapter.captureRaidEnd('abcdef0123456789abcdef12', { serverId: 'woods.1', results: { result: 'Survived', exitName: 'Outskirts' } });
liveMatchService.endMatch('match-live', 'host_left');
const finishedGroup = ops.state.groups.find(x => x.id === group.id);
assert.equal(finishedGroup.state, 'review', 'Fika match end must enter manual review, not auto-award');
assert.equal(finishedGroup.reviewData.evidenceTrust, 'fika_registry_and_client_reports_unverified');
assert.deepEqual(finishedGroup.reviewData.aliveProfileIds.sort(), ['abcdef0123456789abcdef11', 'abcdef0123456789abcdef12']);
assert.deepEqual(finishedGroup.reviewData.extractedProfileIds.sort(), ['abcdef0123456789abcdef11', 'abcdef0123456789abcdef12']);
assert.equal(ops.state.awards.length, 0, 'untrusted extraction reports must never issue rewards');
assert.equal(lifecycleAdapter.getRecentEvents(20).some(x => x.type === 'mission_group_linked'), true);
assert.equal(lifecycleAdapter.getRecentEvents(20).some(x => x.type === 'mission_group_review_created'), true);

// Installation status must only say ready when every expected Fika/SPT hook is present.
const statusAdapter = new Fika243OperationsAdapter({ modDir, operations: { dataDir }, logger: { info() {}, warn() {}, debug() {} } });
const statusMatchService = {
    matches: new Map(),
    getMatch(id) { return this.matches.get(id) || null; },
    addPlayerToMatch() {},
    endMatch(id, reason) { this.deleteMatch(id); },
    deleteMatch(id) { this.matches.delete(id); },
    createMatch(data) { this.matches.set(data.serverId, { players: new Map(), locationData: { Id: 'woods' } }); return true; }
};
const statusInstances = {
    SaveServer: { getProfile() { return null; } },
    FikaUpdateCallbacks: { handleRaidAddPlayer() {}, handlePlayerDied() {} },
    FikaRaidCallbacks: { handleRaidCreate() {}, handleRaidLeave() {} },
    FikaMatchService: statusMatchService,
    LocationLifecycleService: { startLocalRaid() { return { location: 'woods' }; }, endLocalRaid() {} }
};
const statusContainer = {
    afterResolution() {},
    resolve(token) {
        if (!statusInstances[token]) throw new Error('not registered');
        return statusInstances[token];
    }
};
assert.equal(statusAdapter.install(statusContainer), true);
assert.equal(statusAdapter.getStatus().observerInstalled, true);
assert.equal(statusAdapter.getStatus().hookState, 'ready');
assert.deepEqual(statusAdapter.getStatus().missingHooks, []);
assert.equal(statusAdapter.getStatus().matchDeleteHook, true);
assert.equal(statusAdapter.getStatus().matchCreateHook, true);

// Fika 2.4.3 can delete a match without endMatch; both paths must create one review event.
statusMatchService.createMatch({ serverId: 'dedupe-match' });
statusMatchService.endMatch('dedupe-match', 'test-end');
assert.equal(statusAdapter.getRecentEvents(20).filter(event => event.type === 'fika_match_end' && event.matchId === 'dedupe-match').length, 1);
statusMatchService.createMatch({ serverId: 'dedupe-match' });
statusMatchService.deleteMatch('dedupe-match');
assert.equal(statusAdapter.getRecentEvents(20).filter(event => event.type === 'fika_match_end' && event.matchId === 'dedupe-match').length, 2);

// Partial DI availability must never be reported as fully installed.
const partialAdapter = new Fika243OperationsAdapter({ modDir, operations: { dataDir }, logger: { info() {}, warn() {}, debug() {} } });
const partialContainer = { afterResolution() {}, resolve(token) { if (token === 'SaveServer') return { getProfile() {} }; throw new Error('not registered yet'); } };
assert.equal(partialAdapter.install(partialContainer), true);
assert.equal(partialAdapter.getStatus().observerInstalled, false);
assert.equal(partialAdapter.getStatus().hookState, 'pending_or_partial');

// Unsupported Fika versions must remain disabled.
fs.writeFileSync(path.join(fikaDir, 'package.json'), JSON.stringify({ version: '2.4.4', sptVersion: '~3.11.0' }));
const mismatch = new Fika243OperationsAdapter({ modDir, operations: { dataDir }, logger: { info() {}, warn() {}, debug() {} } });
assert.equal(mismatch.getStatus().enabled, false);
assert.equal(mismatch.getStatus().reason, 'FIKA_VERSION_MISMATCH');

fs.rmSync(root, { recursive: true, force: true });

async function verifyAsyncLifecycleWrappers() {
    const asyncRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eft-fika-async-'));
    const asyncModDir = path.join(asyncRoot, 'user', 'mods', 'SPT-EconomyGuard');
    fs.mkdirSync(asyncModDir, { recursive: true });
    const asyncOperations = {
        dataDir: path.join(asyncRoot, 'data'),
        state: { groups: [{ state: 'forming', members: [{ profileId: 'abcdef0123456789abcdef21' }] }] }
    };
    let profileState = {
        characters: {
            pmc: { _id: 'abcdef0123456789abcdef21', Info: { Nickname: 'Async-PMC' }, Inventory: { items: [
                { _id: 'async-pre', _tpl: 'tpl-async', upd: { StackObjectsCount: 2 } }
            ] } },
            scav: { _id: 'abcdef0123456789abcdef22', Inventory: { items: [] } }
        }
    };
    const asyncAdapter = new Fika243OperationsAdapter({ modDir: asyncModDir, operations: asyncOperations, logger: { info() {}, warn() {}, debug() {} } });
    asyncAdapter.services.saveServer = { getProfile() { return profileState; } };
    asyncAdapter.services.fikaMatchService = { getMatchIdByProfile() { return 'async-match'; } };
    const asyncLifecycleService = {
        async startLocalRaid() { await Promise.resolve(); return { location: 'woods' }; },
        async endLocalRaid() {
            await Promise.resolve();
            profileState = {
                characters: {
                    pmc: { _id: 'abcdef0123456789abcdef21', Info: { Nickname: 'Async-PMC' }, Inventory: { items: [
                        { _id: 'async-pre', _tpl: 'tpl-async', upd: { StackObjectsCount: 4, SpawnedInSession: true } },
                        { _id: 'async-new', _tpl: 'tpl-new', upd: { StackObjectsCount: 1, SpawnedInSession: true } }
                    ] } },
                    scav: { _id: 'abcdef0123456789abcdef22', Inventory: { items: [] } }
                }
            };
            return { accepted: true };
        }
    };
    assert.equal(asyncAdapter.patchLifecycle(asyncLifecycleService), true);
    await asyncLifecycleService.startLocalRaid('session-async', { playerSide: 'pmc', location: 'woods' });
    assert.equal(asyncAdapter.raidSnapshots.size, 1, 'raid-start snapshot must be captured after the async start handler resolves');
    const result = await asyncLifecycleService.endLocalRaid('session-async', {
        serverId: 'woods.789',
        results: { result: 'Survived', profile: { Inventory: { items: [
            { _id: 'async-pre', _tpl: 'tpl-async', upd: { StackObjectsCount: 4, SpawnedInSession: true } },
            { _id: 'async-new', _tpl: 'tpl-new', upd: { StackObjectsCount: 1, SpawnedInSession: true } }
        ] } } }
    });
    assert.equal(result.accepted, true);
    const event = asyncAdapter.getRecentEvents(10).find(item => item.type === 'player_raid_end');
    assert.ok(event, 'raid-end evidence must be captured after the async SPT handler');
    assert.equal(event.reportedLootItemCount, 3);
    assert.equal(asyncAdapter.raidSnapshots.size, 0);
    fs.rmSync(asyncRoot, { recursive: true, force: true });
}

verifyAsyncLifecycleWrappers()
    .then(() => console.log('Fika243OperationsAdapter: all tests passed'))
    .catch(error => { console.error(error); process.exitCode = 1; });
