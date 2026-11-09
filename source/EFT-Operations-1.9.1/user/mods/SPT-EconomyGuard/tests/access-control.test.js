'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { AccessControl, ipMatchesCidr, normalizeIp } = require('../src/access-control');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-access-control-'));
const access = new AccessControl(root, { info(){}, warn(){}, error(){} });
const id = '0123456789abcdef01234567';
assert.strictEqual(access.getLoginDecision(id).allowed, true, 'existing profiles remain allowed until optional approval-only mode is enabled');
access.state.settings.requireApprovedLogin = true;
assert.strictEqual(access.getLoginDecision(id).code, 'ACCOUNT_NOT_ALLOWLISTED');
access.approveProfile(id, { username: 'friend01', edition: 'Standard' });
assert.strictEqual(access.getLoginDecision(id).allowed, true);
access.addBan(id, 'confirmed abuse');
assert.strictEqual(access.getLoginDecision(id).code, 'ACCOUNT_BANNED');
access.removeBan(id);
assert.strictEqual(access.getLoginDecision(id).allowed, true);
access.addBan(id, 'temporary test', new Date(Date.now() + 60000).toISOString());
assert.strictEqual(access.isBanActive(id), true);
access.state.bans[id].expiresAt = '2000-01-01T00:00:00.000Z';
assert.strictEqual(access.isBanActive(id), false, 'expired bans stop applying');

assert.strictEqual(normalizeIp('::ffff:203.0.113.5'), '203.0.113.5');
assert.strictEqual(ipMatchesCidr('203.0.113.5', '203.0.113.0/24'), true);
assert.strictEqual(ipMatchesCidr('203.0.114.5', '203.0.113.0/24'), false);
assert.strictEqual(ipMatchesCidr('2001:db8::1', '2001:db8::/32'), true);
assert.strictEqual(ipMatchesCidr('2001:dead::1', '2001:db8::/32'), false);
assert.strictEqual(ipMatchesCidr('203.0.113.5', '203.0.113.5'), true);
access.updateSettings({ enforceIpAllowlist: true, allowedIps: ['203.0.113.0/24'] });
assert.strictEqual(access.isIpAllowed('203.0.113.7'), true);
assert.strictEqual(access.isIpAllowed('198.51.100.9'), false);
assert.strictEqual(access.isIpAllowed('127.0.0.1'), true, 'loopback remains available for local server operations');
assert.throws(() => access.updateSettings({ enforceIpAllowlist: true, allowedIps: [] }), /IP_ALLOWLIST_EMPTY/);

const spoofReq = { socket: { remoteAddress: '198.51.100.2' }, headers: { 'x-forwarded-for': '203.0.113.7' } };
assert.strictEqual(access.getClientIp(spoofReq), '198.51.100.2', 'forwarded headers are ignored unless direct peer is trusted');
access.updateSettings({ trustedProxyIps: ['198.51.100.2'] });
assert.strictEqual(access.getClientIp(spoofReq), '203.0.113.7', 'trusted proxy may pass the real client IP');

const reloaded = new AccessControl(root, { info(){}, warn(){}, error(){} });
assert.strictEqual(reloaded.state.settings.enforceIpAllowlist, true);
assert.strictEqual(reloaded.state.approvedProfiles[id].username, 'friend01');
fs.rmSync(root, { recursive: true, force: true });

// A damaged security registry must never be interpreted as an empty/open allowlist.
const corruptRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-access-corrupt-'));
const securityDir = path.join(corruptRoot, 'security');
fs.mkdirSync(securityDir, { recursive: true });
fs.writeFileSync(path.join(securityDir, 'access-control.json'), '{ definitely-not-json');
const degraded = new AccessControl(corruptRoot, { info(){}, warn(){}, error(){} });
assert.strictEqual(degraded.state.degraded, true);
assert.strictEqual(degraded.isIpAllowed('127.0.0.1'), true, 'local loopback remains reachable for administrator repair');
assert.strictEqual(degraded.isIpAllowed('203.0.113.7'), false, 'remote access fails closed if the security registry is corrupt');
assert.strictEqual(degraded.save(), false, 'corrupt registry must not be overwritten with empty defaults');
assert.ok(fs.readdirSync(securityDir).some(x => x.endsWith('.bak')), 'corrupt source is preserved for recovery');
fs.rmSync(corruptRoot, { recursive: true, force: true });
console.log('PASS access-control bans, approvals, IP/CIDR allowlisting, trusted-proxy checks and fail-closed recovery');
