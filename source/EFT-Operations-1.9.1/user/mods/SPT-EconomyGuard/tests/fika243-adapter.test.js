'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Fika243OperationsAdapter } = require('../src/operations/fika243-adapter');

function makeContainer(instances) {
  const callbacks = new Map();
  return {
    callbacks,
    afterResolution(token, cb) { if (!callbacks.has(token)) callbacks.set(token, []); callbacks.get(token).push(cb); },
    resolve(token) { const value = instances[token]; if (!value) throw new Error('not registered'); for (const cb of callbacks.get(token) || []) cb(token, value); return value; }
  };
}

(function testFika243ReadOnlyLifecycleCapture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-fika243-'));
  const modDir = path.join(root, 'user', 'mods', 'SPT-EconomyGuard');
  const fikaDir = path.join(root, 'user', 'mods', 'fika-server');
  fs.mkdirSync(modDir, { recursive: true }); fs.mkdirSync(fikaDir, { recursive: true });
  fs.writeFileSync(path.join(fikaDir, 'package.json'), JSON.stringify({ version: '2.4.3', sptVersion: '~3.11' }));
  const operations = { dataDir: path.join(root, 'data', 'operations') };
  const matchService = {
    getMatchIdByProfile: () => 'fika-match-1',
    getMatchIdByPlayer: () => null,
    getMatch: () => ({ players: new Map([['pmc-profile-id', {}], ['other-pmc-id', {}]]) }),
    endMatch(matchId, reason) { this.ended = [matchId, reason]; }
  };
  const saveServer = { getProfile: () => ({ characters: { pmc: { _id: 'pmc-profile-id' }, scav: { _id: 'scav-profile-id' } } }) };
  const lifecycleProto = { endLocalRaid(sessionId, request) { this.originalCalled = true; return 'original-result'; } };
  const lifecycle = Object.create(lifecycleProto);
  const container = makeContainer({ SaveServer: saveServer, FikaMatchService: matchService, LocationLifecycleService: lifecycle });
  const adapter = new Fika243OperationsAdapter({ modDir, operations, logger: { info() {}, warn() {}, debug() {} } });
  assert.strictEqual(adapter.install(container), true);
  assert.strictEqual(adapter.getStatus().serverVersion, '2.4.3');
  assert.strictEqual(adapter.getStatus().fikaClientTargetVersion, '1.2.3');
  const result = lifecycleProto.endLocalRaid.call(lifecycle, 'session-id', { serverId: 'bigmap.pmc.123', results: { result: 'Survived', exitName: 'ZB-1011', playTime: 600 } });
  assert.strictEqual(result, 'original-result');
  assert.strictEqual(lifecycle.originalCalled, true);
  matchService.endMatch('fika-match-1', 'host shutdown');
  const events = adapter.getRecentEvents(10);
  assert.strictEqual(events.length, 2);
  const raid = events.find(x => x.type === 'player_raid_end');
  assert.strictEqual(raid.matchId, 'fika-match-1');
  assert.strictEqual(raid.profileId, 'pmc-profile-id');
  assert.strictEqual(raid.evidenceTrust, 'untrusted_client_report');
  assert.strictEqual(raid.rewardEligible, false);
  const ended = events.find(x => x.type === 'fika_match_end');
  assert.deepStrictEqual(ended.players.sort(), ['other-pmc-id', 'pmc-profile-id']);
  fs.rmSync(root, { recursive: true, force: true });
})();

(function testUnsupportedVersionDoesNotPatch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-fika-mismatch-'));
  const modDir = path.join(root, 'user', 'mods', 'SPT-EconomyGuard');
  const fikaDir = path.join(root, 'user', 'mods', 'fika-server');
  fs.mkdirSync(modDir, { recursive: true }); fs.mkdirSync(fikaDir, { recursive: true });
  fs.writeFileSync(path.join(fikaDir, 'package.json'), JSON.stringify({ version: '2.4.8', sptVersion: '~3.11' }));
  const adapter = new Fika243OperationsAdapter({ modDir, operations: { dataDir: path.join(root, 'data') }, logger: { warn() {} } });
  assert.strictEqual(adapter.install(makeContainer({})), false);
  assert.strictEqual(adapter.getStatus().enabled, false);
  assert.strictEqual(adapter.getStatus().reason, 'FIKA_VERSION_MISMATCH');
  fs.rmSync(root, { recursive: true, force: true });
})();

process.stdout.write('Fika 2.4.3 adapter tests passed\n');
