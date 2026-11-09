'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');
const { AdminPanelServer } = require('../src/admin-panel');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-access-admin-'));
  const modDir = path.join(root, 'mod');
  fs.mkdirSync(path.join(modDir, 'config'), { recursive: true });
  const config = {
    enabled: true, mode: 'protect', dataDirectory: path.join(root, 'data'),
    restrictions: { enabled: true }, storage: { caseRetentionDays: 30 },
    notifications: { enabled: true, prefix: 'TEST', separator: '\\n', messages: {} },
    price: { maxOvervalueRatio: 20 }, flea: { maxTrackedEventsInMemory: 100 }
  };
  fs.writeFileSync(path.join(modDir, 'config', 'config.json'), JSON.stringify(config, null, 2));

  const profileId = 'abcdef0123456789abcdef01';
  const profiles = {};
  const saveServer = {
    getProfiles: () => profiles,
    getProfile: id => profiles[id]
  };
  const launcherController = {
    connect: () => ({ editions: ['Standard', 'Edge Of Darkness'] }),
    register: async info => {
      if (Object.values(profiles).some(p => p.info.username.toLowerCase() === info.username.toLowerCase())) return '';
      profiles[profileId] = { info: { id: profileId, username: info.username, password: info.password, edition: info.edition }, characters: { pmc: { Info: { Nickname: '' } } } };
      return profileId;
    }
  };
  const guard = new EconomyGuard(modDir, config, { info(){}, warn(){}, error(){} }, { saveServer, launcherController });
  const panel = new AdminPanelServer(modDir, guard, { info(){}, warn(){}, error(){} }, { enabled: true, host: '127.0.0.1', port: 0 }, { saveServer, launcherController });

  const created = await panel.createServerAccount({ username: 'approved_user', password: 'ValidStrongPassword123!', edition: 'Standard' });
  assert.strictEqual(created.profileId, profileId);
  assert.strictEqual(created.status, 'CREATED');
  assert.strictEqual(guard.accessControl.state.approvedProfiles[profileId].source, 'ADMIN_CREATED');
  assert.strictEqual(guard.accessControl.getLoginDecision(profileId).allowed, true);
  assert.throws(() => panel.createServerAccount({ username: 'second', password: 'short', edition: 'Standard' }), /INVALID_PASSWORD/);
  assert.throws(() => panel.createServerAccount({ username: 'bad_edition', password: 'ValidStrongPassword123!', edition: 'Unknown' }), /INVALID_EDITION/);

  panel.banAccount({ profileId, reason: 'Admin reviewed ban', expiresAt: null });
  assert.strictEqual(guard.accessControl.getLoginDecision(profileId).code, 'ACCOUNT_BANNED');
  assert.strictEqual(panel.unbanAccount(profileId), true);
  assert.strictEqual(guard.accessControl.getLoginDecision(profileId).allowed, true);

  panel.updateAccessSettings({ requireApprovedLogin: true, allowLauncherRegistration: false });
  panel.revokeExistingAccount(profileId);
  assert.strictEqual(guard.accessControl.getLoginDecision(profileId).code, 'ACCOUNT_NOT_ALLOWLISTED');
  panel.approveExistingAccount(profileId);
  assert.strictEqual(guard.accessControl.getLoginDecision(profileId).allowed, true);

  panel.updateAccessSettings({ enforceIpAllowlist: true, allowedIps: ['203.0.113.20/32'] });
  assert.strictEqual(guard.accessControl.isIpAllowed('203.0.113.20'), true);
  assert.strictEqual(guard.accessControl.isIpAllowed('198.51.100.10'), false);
  assert.throws(() => panel.updateAccessSettings({ enforceIpAllowlist: true, allowedIps: [] }), /IP_ALLOWLIST_EMPTY/);

  const data = panel.getAccessData();
  assert.strictEqual(data.accounts.length, 1);
  assert.strictEqual(data.accounts[0].profileId, profileId);
  assert.strictEqual(data.approvedCount, 1);
  assert.strictEqual(data.settings.allowLauncherRegistration, false);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS admin-created accounts, approval gating, bans/unbans and IP policy management');
})().catch(err => { console.error(err); process.exitCode = 1; });
