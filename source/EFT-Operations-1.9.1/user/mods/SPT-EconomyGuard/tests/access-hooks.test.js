'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-access-hooks-'));
  const profileId = '0123456789abcdef01234567';
  const profiles = {};
  const saveServer = { getProfiles: () => profiles, getProfile: id => profiles[id] };
  const guard = new EconomyGuard(__dirname, {
    enabled: true, mode: 'protect', dataDirectory: path.join(root, 'data'),
    restrictions: { enabled: true }, storage: { caseRetentionDays: 90 }, flea: { maxTrackedEventsInMemory: 10 }
  }, { info(){}, warn(){}, error(){} }, { saveServer });

  class FakeLauncherController {
    constructor() { this.saveServer = saveServer; }
    login(info) { return info.username === 'friend01' ? profileId : ''; }
  }
  const launcher = new FakeLauncherController();
  profiles[profileId] = { info: { id: profileId, username: 'friend01', edition: 'Standard' }, characters: { pmc: { Info: { Nickname: 'TestPlayer' } } } };
  guard.installLauncherController(launcher);
  assert.strictEqual(launcher.login({ username: 'friend01' }), profileId, 'approved non-banned account may log in');
  guard.accessControl.addBan(profileId, 'manual test ban');
  assert.strictEqual(launcher.login({ username: 'friend01' }), '', 'banned account receives no launcher session');
  guard.accessControl.removeBan(profileId);
  guard.accessControl.updateSettings({ requireApprovedLogin: true });
  guard.accessControl.revokeProfile(profileId);
  assert.strictEqual(launcher.login({ username: 'friend01' }), '', 'revoked existing profile cannot log in when approval-only mode is enabled');
  guard.accessControl.approveProfile(profileId, { username: 'friend01', edition: 'Standard' });
  assert.strictEqual(launcher.login({ username: 'friend01' }), profileId, 're-approved profile may log in again');
  guard.accessControl.updateSettings({ requireApprovedLogin: false });
  guard.accessControl.revokeProfile(profileId);

  class FakeLauncherCallbacks {
    constructor() { this.launcherController = { register: async () => { profiles[profileId] = { info: { id: profileId, username: 'newuser', edition: 'Standard' }, characters: { pmc: {} } }; return profileId; } }; }
    async register(url, info, sessionID) { const id = await this.launcherController.register(info); return id ? 'OK' : 'FAILED'; }
  }
  const callbacks = new FakeLauncherCallbacks();
  guard.installLauncherCallbacks(callbacks);
  const denied = await callbacks.register('/launcher/profile/register', { username: 'stranger' }, '');
  assert.strictEqual(denied, 'FAILED', 'standard launcher registration is closed by default');
  assert.strictEqual(guard.accessControl.state.approvedProfiles[profileId], undefined);
  guard.accessControl.state.settings.allowLauncherRegistration = true;
  const allowed = await callbacks.register('/launcher/profile/register', { username: 'newuser' }, '');
  assert.strictEqual(allowed, 'OK');
  assert.ok(guard.accessControl.state.approvedProfiles[profileId], 'open registration auto-approves a newly registered account when explicitly enabled');

  class FakeHttpServer {
    async handleRequest(req, resp) { this.called = true; resp.statusCode = 200; resp.end('ok'); }
  }
  const httpServer = new FakeHttpServer();
  guard.installHttpServer(httpServer);
  guard.accessControl.updateSettings({ enforceIpAllowlist: true, allowedIps: ['203.0.113.0/24'] });
  const blockedResponse = { headers: {}, setHeader(k,v){this.headers[k]=v;}, end(v){this.body=v;this.ended=true;} };
  await httpServer.handleRequest({ url:'/client/game/profile/list', socket:{remoteAddress:'198.51.100.2'}, headers:{cookie:`PHPSESSID=${profileId}`} }, blockedResponse);
  assert.strictEqual(blockedResponse.statusCode, 403);
  assert.strictEqual(httpServer.called, undefined, 'disallowed IP never reaches SPT handlers');

  const bannedResponse = { headers: {}, setHeader(k,v){this.headers[k]=v;}, end(v){this.body=v;this.ended=true;} };
  guard.accessControl.updateSettings({ allowedIps: ['203.0.113.0/24'] });
  guard.accessControl.addBan(profileId, 'active session test');
  await httpServer.handleRequest({ url:'/client/game/profile/list', socket:{remoteAddress:'203.0.113.10'}, headers:{cookie:`PHPSESSID=${profileId}`} }, bannedResponse);
  assert.strictEqual(bannedResponse.statusCode, 403, 'banned existing session is blocked before the route handler');
  assert.strictEqual(httpServer.called, undefined);

  const loginResponse = { headers: {}, setHeader(k,v){this.headers[k]=v;}, end(v){this.body=v;this.ended=true;} };
  await httpServer.handleRequest({ url:'/launcher/profile/login', socket:{remoteAddress:'203.0.113.10'}, headers:{cookie:`PHPSESSID=${profileId}`} }, loginResponse);
  assert.strictEqual(loginResponse.statusCode, 200, 'launcher auth route remains available to switch accounts; controller login itself enforces ban');
  assert.strictEqual(httpServer.called, true);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS SPT launcher login/registration hooks and active-session/IP middleware');
})().catch(err => { console.error(err); process.exitCode = 1; });
