'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Fika243OperationsAdapter } = require('./fika243-adapter');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eft-fika243-'));
const modDir = path.join(root, 'user', 'mods', 'SPT-EconomyGuard');
const fikaDir = path.join(root, 'user', 'mods', 'fika-server');
const dataDir = path.join(root, 'operations-data');
fs.mkdirSync(modDir, { recursive: true });
fs.mkdirSync(fikaDir, { recursive: true });
fs.writeFileSync(path.join(fikaDir, 'package.json'), JSON.stringify({ version: '2.4.3', sptVersion: '~3.11.0' }));

const adapter = new Fika243OperationsAdapter({ modDir, operations: { dataDir }, logger: { info() {}, warn() {}, debug() {} } });
assert.equal(adapter.getStatus().enabled, true, 'only the configured Fika 2.4.3 / SPT 3.11 line should enable hooks');

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
assert.equal(matchEvents[0].evidenceTrust, 'lifecycle_observation');
assert.equal(matchEvents[0].rewardEligible, false, 'a match-end hook alone must never authorize rewards');

// A raid-end request is client-originated. Preserve it for review, but mark it untrusted.
adapter.services.saveServer = { getProfile() { return { characters: { pmc: { _id: 'abcdef0123456789abcdef01' }, scav: { _id: 'abcdef0123456789abcdef02' } } }; } };
adapter.services.fikaMatchService = { getMatchIdByProfile() { return 'match-1'; } };
const raidEnd = adapter.captureRaidEnd('session-1', { serverId: 'woods.123', results: { result: 'Survived', exitName: 'Outskirts', playTime: 1200 } });
assert.equal(raidEnd.matchId, 'match-1');
assert.equal(raidEnd.profileId, 'abcdef0123456789abcdef01');
assert.equal(raidEnd.evidenceTrust, 'untrusted_client_report');
assert.equal(raidEnd.rewardEligible, false, 'client raid-result payloads must never authorize rewards');

// Unsupported Fika versions must remain disabled.
fs.writeFileSync(path.join(fikaDir, 'package.json'), JSON.stringify({ version: '2.4.4', sptVersion: '~3.11.0' }));
const mismatch = new Fika243OperationsAdapter({ modDir, operations: { dataDir }, logger: { info() {}, warn() {}, debug() {} } });
assert.equal(mismatch.getStatus().enabled, false);
assert.equal(mismatch.getStatus().reason, 'FIKA_VERSION_MISMATCH');

fs.rmSync(root, { recursive: true, force: true });
console.log('Fika243OperationsAdapter: all tests passed');
