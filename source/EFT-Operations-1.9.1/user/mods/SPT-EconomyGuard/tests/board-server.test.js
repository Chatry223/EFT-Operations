'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { EconomyGuard } = require('../src/engine');
const { StatusBoard } = require('../src/board');

const quiet = { info() {}, warn() {}, error() {} };
const ID = 'abcdef0123456789abcdef01';
function get(port, route, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers, agent: false }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), raw: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}
const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-server-'));
  const modDir = path.join(root, 'mod');
  fs.mkdirSync(path.join(modDir, 'config'), { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'web-public'), path.join(modDir, 'web-public'), { recursive: true });
  const config = { enabled: true, mode: 'protect', dataDirectory: path.join(root, 'data'), restrictions: { enabled: true }, storage: { caseRetentionDays: 30 }, notifications: { enabled: true, prefix: 'T', separator: '\\n', messages: {} }, price: { maxOvervalueRatio: 20 }, flea: { maxTrackedEventsInMemory: 100 } };
  fs.writeFileSync(path.join(modDir, 'config', 'config.json'), JSON.stringify(config));
  const profiles = { [ID]: { info: { id: ID, username: 'secret_account', password: 'secret_pw' }, characters: { pmc: { _id: ID, Info: { Nickname: 'PublicName', Level: 12, Side: 'Bear' }, Stats: { Eft: { OverallCounters: { Items: [{ Key: ['Kills'], Value: 7 }] } } } } } } };
  const saveServer = { getProfiles: () => profiles, getProfile: id => profiles[id] };
  const guard = new EconomyGuard(modDir, config, quiet, { saveServer });
  const port = await freePort();
  const reserved = await freePort();
  const board = new StatusBoard({ modDir, guard, logger: quiet, seed: { enabled: true, host: '127.0.0.1', port }, services: { saveServer }, reservedPorts: [reserved] });
  await board.start(null);
  assert.ok(board.server.isRunning());

  // --- routes & headers
  const page = await get(port, '/');
  assert.strictEqual(page.status, 200); assert.match(page.headers['content-type'], /text\/html/);
  assert.ok(page.body.includes('<title>Bronson Server</title>'), 'title comes from settings');
  assert.ok(!/economy\s*guard/i.test(page.body) && !/economy\s*guard/i.test((await get(port, '/static/board.js')).body) && !/economy\s*guard/i.test((await get(port, '/static/board.css')).body), 'public assets never mention the main mod');
  assert.ok(page.headers['content-security-policy'].includes("script-src 'self'")); assert.strictEqual(page.headers['x-frame-options'], 'DENY'); assert.strictEqual(page.headers['server'], undefined);
  assert.strictEqual((await get(port, '/static/board.js')).status, 200);
  const state = await get(port, '/api/state'); assert.strictEqual(state.status, 200);
  const snap = JSON.parse(state.body);
  assert.deepStrictEqual(snap.leaderboard.map(r => r.name), ['PublicName']);
  for (const secret of ['secret_account', 'secret_pw', ID]) assert.ok(!state.body.includes(secret), `API must not leak ${secret}`);
  const cond = await get(port, '/api/state', { 'If-None-Match': state.headers.etag }); assert.strictEqual(cond.status, 304);

  // --- hardening
  assert.strictEqual((await get(port, '/', {}, 'POST')).status, 405);
  assert.strictEqual((await get(port, '/api/admin')).status, 404);
  assert.strictEqual((await get(port, '/api/profiles')).status, 404);
  for (const evil of ['/static/../../config/config.json', '/static/%2e%2e/%2e%2e/src/mod.js', '/media/../secret.key', '/..%2fconfig%2fconfig.json']) {
    const r = await get(port, evil); assert.strictEqual(r.status, 404, `traversal ${evil} must 404`); assert.ok(!r.body.includes('adminPanel'));
  }
  assert.strictEqual((await get(port, '/media/background')).status, 404, 'no background configured');

  // --- background media with range support
  const video = path.join(root, 'bg.mp4'); fs.writeFileSync(video, Buffer.from('0123456789abcdefghij'));
  await board.applyAdminUpdate({ background: { source: 'path', value: video, overlay: 0.4 } });
  const snap2 = JSON.parse((await get(port, '/api/state')).body);
  assert.strictEqual(snap2.meta.background.kind, 'video'); assert.ok(snap2.meta.background.url.startsWith('/media/background?v='));
  const full = await get(port, '/media/background'); assert.strictEqual(full.status, 200); assert.strictEqual(full.headers['content-type'], 'video/mp4'); assert.strictEqual(full.body, '0123456789abcdefghij');
  const part = await get(port, '/media/background', { Range: 'bytes=5-9' }); assert.strictEqual(part.status, 206); assert.strictEqual(part.body, '56789'); assert.strictEqual(part.headers['content-range'], 'bytes 5-9/20');
  assert.strictEqual((await get(port, '/media/background', { Range: 'bytes=-4' })).body, 'ghij');
  assert.strictEqual((await get(port, '/media/background', { Range: 'bytes=50-60' })).status, 416);
  await assert.rejects(board.applyAdminUpdate({ background: { source: 'path', value: '/etc/passwd' } }), /INVALID_BOARD_BACKGROUND_TYPE/, 'only whitelisted media types can be configured');
  await assert.rejects(board.applyAdminUpdate({ background: { source: 'media', value: '../x.mp4' } }), /INVALID_BOARD_BACKGROUND/);
  fs.writeFileSync(path.join(board.store.mediaDir, 'clip.webp'), 'x');
  await board.applyAdminUpdate({ background: { source: 'media', value: 'clip.webp' } });
  assert.deepStrictEqual(board.getAdminState().media.files, ['clip.webp']); assert.strictEqual((await get(port, '/media/background')).headers['content-type'], 'image/webp');

  // --- rate limit
  board.server.rateLimit = 5; board.server.hits.clear();
  const codes = []; for (let i = 0; i < 8; i++) codes.push((await get(port, '/healthz')).status);
  assert.ok(codes.includes(429) && codes[0] === 200, 'excess requests are rate limited');
  board.server.rateLimit = 240; board.server.hits.clear();

  // --- admin control: power, port change, rollback on failure, reserved ports
  const newPort = await freePort();
  await board.applyAdminUpdate({ port: newPort });
  assert.strictEqual((await get(newPort, '/healthz')).status, 200); await assert.rejects(get(port, '/healthz'));
  await assert.rejects(board.applyAdminUpdate({ port: reserved }), /BOARD_PORT_RESERVED/);
  const blocker = net.createServer(); await new Promise(r => blocker.listen(0, '0.0.0.0', r)); const busy = blocker.address().port;
  await assert.rejects(board.applyAdminUpdate({ port: busy }), /BOARD_BIND_FAILED/);
  assert.strictEqual(board.store.settings.port, newPort, 'settings roll back after a failed bind');
  assert.strictEqual((await get(newPort, '/healthz')).status, 200, 'previous binding is restored');
  blocker.close();
  await board.applyAdminUpdate({ enabled: false });
  await assert.rejects(get(newPort, '/healthz')); assert.strictEqual(board.getAdminState().runtime.running, false);
  await board.applyAdminUpdate({ enabled: true });
  assert.strictEqual((await get(newPort, '/healthz')).status, 200);
  await assert.rejects(board.applyAdminUpdate({ serverName: 'EconomyGuard Live' }), /BOARD_NAME_NOT_ALLOWED/);
  await assert.rejects(board.applyAdminUpdate({ host: 'not an ip' }), /INVALID_BOARD_HOST/);
  await assert.rejects(board.applyAdminUpdate({ port: 70000 }), /INVALID_BOARD_PORT/);
  await board.applyAdminUpdate({ serverName: 'Bronson Server', host: '0.0.0.0', port: newPort });
  assert.strictEqual(board.getAdminState().runtime.bound.host, '0.0.0.0', 'listening on all interfaces so the Fika IP works');

  // --- hide a player: gone from public API, restored on request
  board.setHidden(ID, true);
  assert.deepStrictEqual(JSON.parse((await get(newPort, '/api/state')).body).leaderboard, []);
  board.setHidden(ID, false);
  assert.strictEqual(JSON.parse((await get(newPort, '/api/state')).body).leaderboard.length, 1);
  assert.throws(() => board.setHidden('not-an-id', true), /INVALID_PROFILE_ID/);
  assert.ok(!JSON.stringify(board.getAdminState().runtime).includes('secret_account'));

  // --- settings survive a restart of the module
  await board.stop();
  const again = new StatusBoard({ modDir, guard, logger: quiet, seed: { enabled: true, host: '127.0.0.1', port }, services: { saveServer }, reservedPorts: [] });
  assert.strictEqual(again.store.settings.port, newPort, 'saved port wins over the config seed');
  assert.strictEqual(again.store.secret, board.store.secret, 'anonymisation key is persistent');
  await again.start(null); assert.strictEqual((await get(newPort, '/healthz')).status, 200); await again.stop();

  // --- a failing start never throws into the host mod
  const blocker2 = net.createServer(); await new Promise(r => blocker2.listen(0, '0.0.0.0', r));
  const failing = new StatusBoard({ modDir, guard, logger: quiet, seed: { enabled: true, host: '0.0.0.0', port: blocker2.address().port }, services: { saveServer } });
  failing.store.settings.port = blocker2.address().port;
  await failing.start(null).then(() => assert.fail('expected rejection'), err => assert.match(err.code || err.message, /EADDRINUSE/));
  assert.ok(failing.lastError); blocker2.close();
  console.log('board-server tests passed');
})().catch(err => { console.error(err); process.exit(1); });
