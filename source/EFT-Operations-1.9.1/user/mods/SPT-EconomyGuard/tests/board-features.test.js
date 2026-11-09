'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const core = require('../src/board/core');
const { BoardStore, defaultSettings, defaultLayout, sanitizeLayout, applySettingsPatch } = require('../src/board/store');
const { EconomyGuard } = require('../src/engine');
const { AdminPanelServer } = require('../src/admin-panel');
const { StatusBoard } = require('../src/board');

const quiet = { info() {}, warn() {}, error() {} };
const SECRET = 'c'.repeat(64);
const A = 'aaaa00000000000000000001', B = 'bbbb00000000000000000002';
const counters = map => ({ Items: Object.entries(map).map(([k, v]) => ({ Key: k.split('/'), Value: v })) });
const prof = (id, nick, lvl, c) => ({ info: { id, username: `u_${nick}` }, characters: { pmc: { _id: id, Info: { Nickname: nick, Level: lvl }, Stats: { Eft: { OverallCounters: counters(c) } } } } });
const profiles = { [A]: prof(A, 'Alpha', 20, { Kills: 10, 'Sessions/Pmc': 300, 'Sessions/Savage': 5 }), [B]: prof(B, 'Bravo', 10, { Kills: 5, 'Sessions/Pmc': 168 }) };
const offer = (id, name) => ({ user: { id, nickname: name, memberType: 0, rating: 3 }, items: [{ _tpl: 't', upd: { StackObjectsCount: 1 } }], requirementsCost: 1000, requirements: [{ _tpl: '5449016a4bdc2d6f028b456f', count: 1 }] });
const baseCtx = () => ({ settings: defaultSettings(), secret: SECRET, profiles, presence: new Map(), presenceAvailable: true, activeRaids: [], offers: null, ledger: [], itemName: t => t, registry: { pmcs: {} }, events: [], isBanned: () => false, moneyTpls: new Set(['5449016a4bdc2d6f028b456f']) });

// ---- raids completed: honest rounding
assert.deepStrictEqual(core.roundRaids(473), { exact: 473, value: 470, approx: true });
assert.deepStrictEqual(core.roundRaids(1200), { exact: 1200, value: 1200, approx: false });
assert.strictEqual(core.roundRaids(-5).value, 0);
let snap = core.buildSnapshot(baseCtx());
assert.strictEqual(snap.counters.raidsCompleted.exact, 300 + 5 + 168, 'sum of every profile\'s PMC + scav raid counters');
assert.strictEqual(snap.counters.raidsCompleted.value, 470);

// ---- unified Online: real players + AI PMCs in raid + flea sellers, each name once
const ctx = baseCtx();
ctx.presence = new Map([[A, { activity: 3 }]]);
ctx.registry = { pmcs: { rex: { name: 'Rex', level: 20, kills: 1, deaths: 0, raids: 1 }, mia: { name: 'Mia', level: 30, kills: 0, deaths: 0, raids: 1 } } };
ctx.activeRaids = [{ key: 'k', map: 'woods', status: 'in_game', startedAt: Date.now(), playerIds: [], deadIds: new Set(), bots: ['rex', 'mia'] }];
ctx.offers = [offer('f1', 'Wolf'), offer('f2', 'Wolf'), offer('f3', 'Fox'), offer('f4', 'rex'), offer('f5', 'Alpha')];
snap = core.buildSnapshot(ctx);
assert.strictEqual(snap.counters.online, 1 + 2 + 2, 'Alpha online + Rex/Mia in raid + Wolf/Fox on the flea; "rex" listed twice counts once; "Alpha" is a real player');
const rexRow = snap.leaderboard.find(r => r.name === 'Rex'); assert.strictEqual(rexRow.status, 'online');
assert.strictEqual(snap.leaderboard.find(r => r.name === 'Alpha').status, 'online'); assert.strictEqual(snap.leaderboard.find(r => r.name === 'Bravo').status, 'offline');
ctx.settings.onlineIncludesMarket = false;
assert.strictEqual(core.buildSnapshot(ctx).counters.online, 3, 'switch removes flea sellers from the Online number');
ctx.settings.onlineIncludesMarket = true; ctx.activeRaids = [];
assert.strictEqual(core.buildSnapshot(ctx).counters.online, 1 + 3, 'with the raid gone only the flea sellers (Wolf, Fox, rex) and Alpha remain');
assert.strictEqual(core.buildSnapshot(ctx).leaderboard.find(r => r.name === 'Mia').status, 'offline', 'AI PMCs go offline when their raid is gone');
ctx.settings.showPmc = false; ctx.activeRaids = [{ key: 'k', map: 'woods', playerIds: [], deadIds: new Set(), bots: ['rex'] }];
assert.strictEqual(core.buildSnapshot(ctx).counters.online, 1 + 3, 'hiding AI PMCs keeps raid PMCs out of Online');

// ---- meta flags + layout travel with the snapshot; badge off by default
snap = core.buildSnapshot(baseCtx());
assert.strictEqual(snap.meta.showPmcBadge, false); assert.deepStrictEqual(snap.meta.layout.tabs, defaultLayout().tabs);
assert.deepStrictEqual(snap.announcements, []);

// ---- layout validation
const base = defaultLayout();
const edited = sanitizeLayout({ tabs: ['market', 'nope', 'leaderboard', 'market'], cards: [{ id: 'totalKills', enabled: true }, { id: 'zzz', enabled: true }], top: [{ id: 'cards', enabled: true }, { id: 'announcements', enabled: false }] }, base);
assert.deepStrictEqual(edited.tabs, ['market', 'leaderboard', 'online', 'raids', 'activity'], 'unknown/duplicate ids dropped, missing ids appended');
assert.deepStrictEqual(edited.cards.map(c => c.id), ['totalKills', 'fleaOffers', 'raidsCompleted', 'registeredPlayers', 'activeRaids']);
assert.strictEqual(edited.cards.find(c => c.id === 'fleaOffers').enabled, true, 'missing ids keep their previous state');
assert.deepStrictEqual(edited.top.map(t => [t.id, t.enabled]), [['cards', true], ['announcements', false]]);
assert.throws(() => sanitizeLayout('x', base), /INVALID_BOARD_LAYOUT/); assert.throws(() => sanitizeLayout({ tabs: 'x' }, base), /INVALID_BOARD_LAYOUT/);
assert.deepStrictEqual(applySettingsPatch(defaultSettings(), { layout: { tabs: ['raids'] } }).layout.tabs[0], 'raids');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-news-'));
  const store = new BoardStore(dir, {}, quiet);
  const now = Date.now(), iso = ms => new Date(now + ms).toISOString();

  // ---- announcements: validation
  const a = store.saveNews({ title: '  New wipe  ', text: 'Starts Friday', kind: 'event', link: { url: 'https://example.com/wipe', label: 'Details' } });
  assert.ok(/^[a-f0-9]{10}$/.test(a.id)); assert.strictEqual(a.title, 'New wipe'); assert.strictEqual(a.enabled, true); assert.strictEqual(a.link.label, 'Details');
  assert.throws(() => store.saveNews({ title: '' }), /INVALID_NEWS_TITLE/);
  assert.throws(() => store.saveNews({ title: 'x', kind: 'weird' }), /INVALID_NEWS_KIND/);
  assert.throws(() => store.saveNews({ title: 'x', link: { url: 'javascript:alert(1)' } }), /INVALID_NEWS_LINK/);
  assert.throws(() => store.saveNews({ title: 'x', link: { url: 'not a url' } }), /INVALID_NEWS_LINK/);
  assert.throws(() => store.saveNews({ title: 'x', startsAt: iso(5000), endsAt: iso(1000) }), /INVALID_NEWS_DATE/);
  assert.throws(() => store.saveNews({ title: 'x', startsAt: 'banana' }), /INVALID_NEWS_DATE/);
  assert.throws(() => store.saveNews({ title: 'EconomyGuard news' }), /BOARD_NAME_NOT_ALLOWED/);
  assert.throws(() => store.saveNews({ title: 'x', media: { source: 'path', value: '/etc/passwd' } }), /INVALID_BOARD_BACKGROUND_TYPE/);
  assert.throws(() => store.saveNews({ title: 'x', media: { source: 'media', value: '../a.png' } }), /INVALID_BOARD_BACKGROUND/);
  assert.throws(() => store.saveNews({ id: 'aaaaaaaaaa', title: 'x' }), /NEWS_NOT_FOUND/);
  assert.strictEqual(store.saveNews({ id: a.id, title: 'Renamed' }).text, 'Starts Friday', 'omitted fields keep their stored value on edit');
  assert.strictEqual(store.listNews().length, 1);

  // ---- schedule windows
  store.saveNews({ title: 'Future', startsAt: iso(3600e3) });
  store.saveNews({ title: 'Expired', startsAt: iso(-7200e3), endsAt: iso(-3600e3) });
  store.saveNews({ title: 'Off', enabled: false });
  store.saveNews({ title: 'Running', startsAt: iso(-1000), endsAt: iso(3600e3) });
  assert.deepStrictEqual(store.activeNews(now).map(n => n.title).sort(), ['Renamed', 'Running'], 'only enabled items inside their window are public');
  assert.deepStrictEqual(store.activeNews(now + 2 * 3600e3).map(n => n.title).sort(), ['Future', 'Renamed'], 'schedule is evaluated live');

  // ---- persistence + corrupt file safety
  const again = new BoardStore(dir, {}, quiet);
  assert.strictEqual(again.listNews().length, 5);
  fs.writeFileSync(path.join(dir, 'statusboard', 'announcements.json'), '{broken');
  assert.deepStrictEqual(new BoardStore(dir, {}, quiet).listNews(), [], 'unreadable file is moved aside, not fatal');
  store.deleteNews(a.id); assert.throws(() => store.deleteNews(a.id), /NEWS_NOT_FOUND/);

  // ---- end to end: media route, public payload, admin route
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-news-e2e-'));
  const modDir = path.join(root, 'mod');
  fs.mkdirSync(path.join(modDir, 'config'), { recursive: true });
  for (const d of ['web', 'web-public']) fs.cpSync(path.join(__dirname, '..', d), path.join(modDir, d), { recursive: true });
  const config = { enabled: true, mode: 'protect', dataDirectory: path.join(root, 'data'), restrictions: { enabled: true }, storage: { caseRetentionDays: 30 }, notifications: { enabled: true, prefix: 'T', separator: '\\n', messages: {} }, price: { maxOvervalueRatio: 20 }, flea: { maxTrackedEventsInMemory: 100 } };
  fs.writeFileSync(path.join(modDir, 'config', 'config.json'), JSON.stringify(config));
  const saveServer = { getProfiles: () => profiles, getProfile: id => profiles[id] };
  const guard = new EconomyGuard(modDir, config, quiet, { saveServer });
  const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const bport = await freePort();
  const panel = new AdminPanelServer(modDir, guard, quiet, { enabled: true, host: '127.0.0.1', port: 0 }, { saveServer });
  panel.start(); await new Promise(r => panel.server.listening ? r() : panel.server.once('listening', r)); const aport = panel.server.address().port;
  const board = new StatusBoard({ modDir, guard, logger: quiet, seed: { host: '127.0.0.1', port: bport }, services: { saveServer }, reservedPorts: [aport] });
  panel.board = board; await board.start(null);
  const get = (port, route, headers = {}) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: route, headers }, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString() })); }).on('error', reject));
  const admin = (route, body) => fetch(`http://127.0.0.1:${aport}${route}`, { method: body ? 'POST' : 'GET', headers: { Host: `127.0.0.1:${aport}`, 'Content-Type': 'application/json', Authorization: `Bearer ${panel.token}` }, body: body ? JSON.stringify(body) : undefined });

  fs.writeFileSync(path.join(board.store.mediaDir, 'banner.png'), 'PNGDATA');
  const saved = await (await admin('/api/board/news', { item: { title: 'Server wipe', text: 'Friday 20:00', kind: 'event', media: { source: 'media', value: 'banner.png' }, startsAt: new Date(Date.now() - 1000).toISOString() } })).json();
  const id = saved.board.news[0].id; assert.strictEqual(saved.board.news[0].mediaFound, true);
  await admin('/api/board/news', { item: { title: 'Hidden draft', enabled: false, media: { source: 'media', value: 'banner.png' } } });
  const draftId = (await (await admin('/api/board')).json()).news.find(n => n.title === 'Hidden draft').id;
  const state = JSON.parse((await get(bport, '/api/state')).body);
  assert.deepStrictEqual(state.announcements.map(n => n.title), ['Server wipe'], 'drafts never reach the public payload');
  assert.strictEqual(state.announcements[0].media.kind, 'image'); assert.ok(state.announcements[0].media.url.startsWith(`/media/a/${id}?v=`));
  assert.ok(!JSON.stringify(state).includes('banner.png') && !JSON.stringify(state).includes(root), 'no server paths in the public payload');
  const media = await get(bport, `/media/a/${id}`); assert.strictEqual(media.status, 200); assert.strictEqual(media.headers['content-type'], 'image/png'); assert.strictEqual(media.body, 'PNGDATA');
  assert.strictEqual((await get(bport, `/media/a/${draftId}`)).status, 404, 'inactive announcement media is not served');
  assert.strictEqual((await get(bport, '/media/a/../../etc')).status, 404); assert.strictEqual((await get(bport, '/media/a/ZZZZZZZZZZ')).status, 404);
  const bad = await admin('/api/board/news', { item: { title: 'x', link: { url: 'javascript:1' } } }); assert.strictEqual(bad.status, 400); assert.match((await bad.json()).error, /INVALID_NEWS_LINK/);
  const unauth = await fetch(`http://127.0.0.1:${aport}/api/board/news`, { method: 'POST', headers: { Host: `127.0.0.1:${aport}`, 'Content-Type': 'application/json' }, body: '{}' }); assert.strictEqual(unauth.status, 401);
  const del = await (await admin('/api/board/news', { op: 'delete', id })).json(); assert.ok(!del.board.news.some(n => n.id === id));
  assert.strictEqual(JSON.parse((await get(bport, '/api/state')).body).announcements.length, 0, 'deleted announcements disappear immediately');

  // layout through the admin route
  const lay = await (await admin('/api/board/settings', { layout: { tabs: ['activity', 'market'], cards: [{ id: 'raidsCompleted', enabled: true }] }, showPmcBadge: true, onlineIncludesMarket: false })).json();
  assert.strictEqual(lay.board.settings.layout.tabs[0], 'activity'); assert.strictEqual(lay.board.settings.showPmcBadge, true);
  const st2 = JSON.parse((await get(bport, '/api/state')).body); assert.strictEqual(st2.meta.layout.tabs[0], 'activity'); assert.strictEqual(st2.meta.showPmcBadge, true);

  await board.stop(); panel.server.close();
  console.log('board-features tests passed');
})().catch(err => { console.error(err); process.exit(1); });
