'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Fika243OperationsAdapter } = require('../src/operations/fika243-adapter');
const { OperationsService } = require('../src/operations/service');

function makeContainer(instances) {
  const callbacks = new Map();
  return {
    callbacks,
    afterResolution(token, cb) { if (!callbacks.has(token)) callbacks.set(token, []); callbacks.get(token).push(cb); },
    resolve(token) { const value = instances[token]; if (!value) throw new Error('not registered'); for (const cb of callbacks.get(token) || []) cb(token, value); return value; }
  };
}

async function testFika243LifecycleAndAcceptedLootEvidence() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-fika243-'));
  try {
    const modDir = path.join(root, 'user', 'mods', 'SPT-EconomyGuard');
    const fikaDir = path.join(root, 'user', 'mods', 'fika-server');
    fs.mkdirSync(modDir, { recursive: true }); fs.mkdirSync(fikaDir, { recursive: true });
    fs.writeFileSync(path.join(fikaDir, 'package.json'), JSON.stringify({ version: '2.4.3', sptVersion: '~3.11' }));

    const hostProfileId = 'abcdef0123456789abcdef01';
    const scavProfileId = 'abcdef0123456789abcdef02';
    const otherProfileId = 'abcdef0123456789abcdef03';
    const oldItemId = 'abcdef0123456789abcdef04';
    const newItemId = 'abcdef0123456789abcdef05';
    const lootTpl = 'abcdef0123456789abcdef06';
    const makeProfile = items => ({
      info: { Nickname: 'Alpha' },
      characters: {
        pmc: { _id: hostProfileId, Info: { Nickname: 'Alpha' }, Inventory: { items } },
        scav: { _id: scavProfileId, Info: { Nickname: 'Alpha-Scav' }, Inventory: { items: [] } }
      }
    });
    let currentProfile = makeProfile([{ _id: oldItemId, _tpl: lootTpl, upd: { StackObjectsCount: 1 } }]);
    const saveServer = { getProfile: () => currentProfile };

    const operations = new OperationsService(path.join(root, 'data'), { info() {}, warn() {} });
    const mission = operations.save({
      title: 'Accepted loot test', map: 'woods', mode: 'solo', minPlayers: 1, maxPlayers: 1,
      objectives: [{ id: 'collect-key', type: 'collect', target: lootTpl, count: 2 }],
      rewards: { points: 100, roubles: 0, items: [] }
    });
    operations.setStatus(mission.id, 'published');
    const group = operations.accept(mission.id, hostProfileId, 'Alpha', scavProfileId);
    operations.setReady(group.id, hostProfileId, true);
    operations.startGroup(group.id, hostProfileId);

    const matchService = {
      getMatchIdByProfile: () => hostProfileId,
      getMatchIdByPlayer: () => null,
      getMatch: () => ({ players: new Map([[hostProfileId, { isDead: false }]]) }),
      endMatch(matchId, reason) { this.ended = [matchId, reason]; }
    };
    const lifecycle = {
      async startLocalRaid() { return 'start-result'; },
      async endLocalRaid() { this.originalCalled = true; return 'original-result'; }
    };
    const container = makeContainer({ SaveServer: saveServer, FikaMatchService: matchService, LocationLifecycleService: lifecycle });
    const adapter = new Fika243OperationsAdapter({ modDir, operations, logger: { info() {}, warn() {}, debug() {} } });
    assert.strictEqual(adapter.install(container), true);
    assert.strictEqual(adapter.getStatus().serverVersion, '2.4.3');
    assert.strictEqual(adapter.getStatus().fikaClientTargetVersion, '1.2.3');
    container.resolve('SaveServer');
    container.resolve('FikaMatchService');
    container.resolve('LocationLifecycleService');

    const startResult = await lifecycle.startLocalRaid('session-id', { playerSide: 'pmc', serverId: 'woods.pmc.123' });
    assert.strictEqual(startResult, 'start-result');
    currentProfile = makeProfile([
      { _id: oldItemId, _tpl: lootTpl, upd: { StackObjectsCount: 1 } },
      { _id: newItemId, _tpl: lootTpl, upd: { StackObjectsCount: 2, SpawnedInSession: true } }
    ]);
    const reportedProfile = {
      Inventory: { items: currentProfile.characters.pmc.Inventory.items },
      Stats: { Eft: { Victims: [], SessionCounters: { Items: [] } } }
    };
    const result = await lifecycle.endLocalRaid('session-id', {
      serverId: 'woods.pmc.123',
      results: { result: 'Survived', exitName: 'Outskirts', playTime: 600, profile: reportedProfile }
    });
    assert.strictEqual(result, 'original-result');
    assert.strictEqual(lifecycle.originalCalled, true);

    const activeGroup = operations.state.groups.find(item => item.id === group.id);
    assert.strictEqual(activeGroup.progress['collect-key'], 2, 'only inventory delta accepted into the SPT server profile advances collect objectives');
    assert.strictEqual(activeGroup.progressTrust['collect-key'], 'spt_accepted_client_delta');
    const lootEvidence = activeGroup.evidenceEvents.find(item => item.type === 'collect');
    assert.strictEqual(lootEvidence.source, 'spt-server-adapter');
    assert.strictEqual(lootEvidence.evidenceTrust, 'spt_accepted_client_delta');
    assert.strictEqual(lootEvidence.amount, 2);

    matchService.endMatch(hostProfileId, 'host shutdown');
    assert.deepStrictEqual(matchService.ended, [hostProfileId, 'host shutdown']);
    assert.strictEqual(activeGroup.state, 'review', 'Fika lifecycle and client reports never auto-award a completed mission');
    assert.strictEqual(activeGroup.reviewData.requiredDone, true);
    assert.strictEqual(operations.state.awards.length, 0);

    const events = adapter.getRecentEvents(10);
    assert.strictEqual(events.length, 3);
    const raid = events.find(x => x.type === 'player_raid_end');
    assert.strictEqual(raid.matchId, hostProfileId);
    assert.strictEqual(raid.profileId, hostProfileId);
    assert.strictEqual(raid.evidenceTrust, 'untrusted_client_report');
    assert.strictEqual(raid.rewardEligible, false);
    assert.strictEqual(raid.reportedLootByTpl[lootTpl], 2);
    assert.strictEqual(raid.acceptedLootByTpl[lootTpl], 2);
    const start = events.find(x => x.type === 'fika_raid_start');
    assert.strictEqual(start.evidenceTrust, 'fika_server_lifecycle');
    const ended = events.find(x => x.type === 'fika_match_end');
    assert.deepStrictEqual(ended.players.sort(), [hostProfileId, otherProfileId].sort());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testUnsupportedVersionDoesNotPatch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-fika-mismatch-'));
  try {
    const modDir = path.join(root, 'user', 'mods', 'SPT-EconomyGuard');
    const fikaDir = path.join(root, 'user', 'mods', 'fika-server');
    fs.mkdirSync(modDir, { recursive: true }); fs.mkdirSync(fikaDir, { recursive: true });
    fs.writeFileSync(path.join(fikaDir, 'package.json'), JSON.stringify({ version: '2.4.8', sptVersion: '~3.11' }));
    const adapter = new Fika243OperationsAdapter({ modDir, operations: { dataDir: path.join(root, 'data') }, logger: { warn() {} } });
    assert.strictEqual(adapter.install(makeContainer({})), false);
    assert.strictEqual(adapter.getStatus().enabled, false);
    assert.strictEqual(adapter.getStatus().reason, 'FIKA_VERSION_MISMATCH');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

Promise.resolve().then(testFika243LifecycleAndAcceptedLootEvidence).then(() => {
  testUnsupportedVersionDoesNotPatch();
  process.stdout.write('Fika 2.4.3 adapter tests passed\\n');
}).catch(error => { console.error(error); process.exitCode = 1; });
