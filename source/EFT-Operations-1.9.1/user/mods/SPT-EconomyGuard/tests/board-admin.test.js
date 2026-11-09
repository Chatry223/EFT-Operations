'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { EconomyGuard } = require('../src/engine');
const { AdminPanelServer } = require('../src/admin-panel');
const { StatusBoard } = require('../src/board');

const quiet = { info() {}, warn() {}, error() {} };
const ID = 'abcdef0123456789abcdef01';
const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-admin-'));
  const modDir = path.join(root, 'mod');
  fs.mkdirSync(path.join(modDir, 'config'), { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'web'), path.join(modDir, 'web'), { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'web-public'), path.join(modDir, 'web-public'), { recursive: true });
  const config = { enabled: true, mode: 'protect', dataDirectory: path.join(root, 'data'), restrictions: { enabled: true }, storage: { caseRetentionDays: 30 }, notifications: { enabled: true, prefix: 'T', separator: '\\n', messages: {} }, price: { maxOvervalueRatio: 20 }, flea: { maxTrackedEventsInMemory: 100 } };
  fs.writeFileSync(path.join(modDir, 'config', 'config.json'), JSON.stringify(config));
  const profiles = { [ID]: { info: { id: ID, username: 'acct', password: 'pw' }, characters: { pmc: { _id: ID, Info: { Nickname: 'Visible' } } } } };
  const saveServer = { getProfiles: () => profiles, getProfile: id => profiles[id] };
  const guard = new EconomyGuard(modDir, config, quiet, { saveServer });
  const panel = new AdminPanelServer(modDir, guard, quiet, { enabled: true, host: '127.0.0.1', port: 0 }, { saveServer });
  panel.start();
  await new Promise(r => panel.server.listening ? r() : panel.server.once('listening', r));
  const adminPort = panel.server.address().port;
  const boardPort = await freePort();
  const board = new StatusBoard({ modDir, guard, logger: quiet, seed: { enabled: true, host: '127.0.0.1', port: boardPort }, services: { saveServer }, reservedPorts: [adminPort] });
  panel.board = board; // exactly what mod.js does
  await board.start(null);

  const call = (route, body, auth = true) => fetch(`http://127.0.0.1:${adminPort}${route}`, { method: body ? 'POST' : 'GET', headers: { Host: `127.0.0.1:${adminPort}`, 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${panel.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });

  assert.strictEqual((await call('/api/board', null, false)).status, 401, 'board admin API requires the admin token');
  assert.strictEqual((await call('/api/board/settings', { port: 1 }, false)).status, 401);
  const js = await fetch(`http://127.0.0.1:${adminPort}/board-admin.js`, { headers: { Host: `127.0.0.1:${adminPort}` } });
  assert.strictEqual(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
  const html = await (await fetch(`http://127.0.0.1:${adminPort}/`, { headers: { Host: `127.0.0.1:${adminPort}` } })).text();
  assert.ok(html.includes('/board-admin.js') && html.includes('/app.js'), 'original panel page still loads its own script');

  const state = await (await call('/api/board')).json();
  assert.strictEqual(state.runtime.running, true); assert.strictEqual(state.settings.port, boardPort);
  assert.deepStrictEqual(state.players.map(p => p.nickname), ['Visible']);

  const newPort = await freePort();
  const ok = await call('/api/board/settings', { port: newPort, serverName: 'Night Server', tagline: 'Hello' });
  assert.strictEqual(ok.status, 200); assert.strictEqual((await ok.json()).board.settings.serverName, 'Night Server');
  assert.strictEqual((await fetch(`http://127.0.0.1:${newPort}/healthz`)).status, 200);

  const reserved = await call('/api/board/settings', { port: adminPort });
  assert.strictEqual(reserved.status, 400); assert.match((await reserved.json()).error, /BOARD_PORT_RESERVED/);
  const badName = await call('/api/board/settings', { serverName: 'EconomyGuard' });
  assert.strictEqual(badName.status, 400);
  const hidden = await (await call('/api/board/hide', { profileId: ID, hidden: true })).json();
  assert.strictEqual(hidden.board.players[0].hidden, true);
  const reset = await call('/api/board/reset-pmc', {}); assert.strictEqual(reset.status, 200);

  // Detached board: the original panel still answers everything else and the board routes report a clean error.
  panel.board = null;
  const detached = await call('/api/board'); assert.strictEqual(detached.status, 400); assert.match((await detached.json()).error, /BOARD_UNAVAILABLE/);
  assert.strictEqual((await call('/api/health')).status, 200, 'main panel API is unaffected');

  await board.stop(); panel.server.close();
  console.log('board-admin tests passed');
})().catch(err => { console.error(err); process.exit(1); });
