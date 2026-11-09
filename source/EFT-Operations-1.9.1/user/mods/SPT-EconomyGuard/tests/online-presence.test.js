'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');
const { AdminPanelServer } = require('../src/admin-panel');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-online-presence-'));
  const modDir = path.join(root, 'mod');
  fs.mkdirSync(path.join(modDir, 'config'), { recursive: true });
  const profileId = '0123456789abcdef01234567';
  const profile = {
    info: { id: profileId, username: 'online_friend', edition: 'Standard' },
    characters: { pmc: { Info: { Nickname: 'LivePMC', Level: 42 } } }
  };
  const saveServer = { getProfile: id => id === profileId ? profile : null, getProfiles: () => ({ [profileId]: profile }) };
  const config = {
    enabled: true, mode: 'audit', dataDirectory: path.join(root, 'data'),
    restrictions: { enabled: true }, storage: { caseRetentionDays: 30 },
    notifications: { enabled: true, prefix: 'TEST', separator: '\n', messages: {} },
    price: { maxOvervalueRatio: 20 }, flea: { maxTrackedEventsInMemory: 100 }
  };
  fs.writeFileSync(path.join(modDir, 'config', 'config.json'), JSON.stringify(config, null, 2));

  class FakeFikaPresenceService {
    constructor() { this.onlinePlayers = {}; }
    addPlayerPresence(id) {
      this.onlinePlayers[id] = { nickname: 'LivePMC', level: 42, activity: 0, activityStartedTimestamp: Math.floor(Date.now() / 1000), raidInformation: null };
    }
    updatePlayerPresence(id, data) {
      if (this.onlinePlayers[id]) this.onlinePlayers[id] = { ...this.onlinePlayers[id], ...data, activityStartedTimestamp: Math.floor(Date.now() / 1000) };
    }
    removePlayerPresence(id) { delete this.onlinePlayers[id]; }
  }
  const fikaPresenceService = new FakeFikaPresenceService();
  const guard = new EconomyGuard(modDir, config, { info(){}, warn(){}, error(){} }, { saveServer, fikaPresenceService });
  guard.installFikaPresenceService(fikaPresenceService);
  assert.strictEqual(guard.health.hooks['FikaPresenceService.addPlayerPresence'], true);
  assert.strictEqual(guard.health.hooks['FikaPresenceService.updatePlayerPresence'], true);
  assert.strictEqual(guard.health.hooks['FikaPresenceService.removePlayerPresence'], true);
  assert.strictEqual(guard.health.onlinePlayers.available, true);

  fikaPresenceService.addPlayerPresence(profileId);
  assert.strictEqual(guard.onlinePresence.size, 1, 'Fika connection adds one online profile');
  const connectedAt = guard.onlinePresence.get(profileId).connectedAt;
  guard.accessControl.recordRequest('203.0.113.22', profileId, '/client/game/keepalive', 'ALLOWED');

  const panel = new AdminPanelServer(modDir, guard, { info(){}, warn(){}, error(){} }, { enabled: true, host: '127.0.0.1', port: 0 }, { saveServer, fikaPresenceService });
  let online = panel.getOnlinePlayers();
  assert.strictEqual(online.available, true);
  assert.strictEqual(online.count, 1);
  assert.strictEqual(online.players[0].profileId, profileId);
  assert.strictEqual(online.players[0].nickname, 'LivePMC');
  assert.strictEqual(online.players[0].username, 'online_friend');
  assert.strictEqual(online.players[0].activityLabel, 'IN MENU');
  assert.strictEqual(online.players[0].lastIp, '203.0.113.22');
  assert.strictEqual(online.players[0].connectedAt, connectedAt);

  fikaPresenceService.updatePlayerPresence(profileId, {
    activity: 1,
    raidInformation: { location: 'woods', side: 1, time: 3 }
  });
  online = panel.getOnlinePlayers();
  assert.strictEqual(online.players[0].activityLabel, 'IN RAID');
  assert.deepStrictEqual(online.players[0].raid, { location: 'woods', side: 1, sideLabel: 'Scav', time: 3, timeLabel: '3' });
  assert.strictEqual(online.players[0].connectedAt, connectedAt, 'activity changes must not reset the connection start time');

  // Exercise the authenticated API route as the UI uses it.
  panel.start();
  await new Promise(resolve => setTimeout(resolve, 50));
  const port = panel.server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/online`, {
    headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${panel.token}` }
  });
  assert.strictEqual(response.status, 200);
  const payload = await response.json();
  assert.strictEqual(payload.count, 1);
  assert.strictEqual(payload.players[0].activityLabel, 'IN RAID');
  const unauthorized = await fetch(`http://127.0.0.1:${port}/api/online`, {
    headers: { Host: `127.0.0.1:${port}`, Authorization: 'Bearer bad' }
  });
  assert.strictEqual(unauthorized.status, 401);

  fikaPresenceService.removePlayerPresence(profileId);
  online = panel.getOnlinePlayers();
  assert.strictEqual(guard.onlinePresence.size, 0, 'Fika disconnect removes the online profile');
  assert.strictEqual(guard.health.onlinePlayers.count, 0, 'health online count follows WebSocket disconnect');
  assert.strictEqual(online.count, 0);
  fikaPresenceService.addPlayerPresence(profileId);
  assert.notStrictEqual(guard.onlinePresence.get(profileId).connectedAt, connectedAt, 'a fresh WebSocket connection starts a new connected-since time');
  fikaPresenceService.removePlayerPresence(profileId);
  await new Promise(resolve => panel.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS Fika online presence, activities, raid details, last IP and authenticated panel API');
})().catch(err => { console.error(err); process.exitCode = 1; });
