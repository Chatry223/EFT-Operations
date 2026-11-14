'use strict';
const assert = require('assert');
const core = require('../src/board/core');
const { defaultSettings } = require('../src/board/store');

const SECRET = 'a'.repeat(64);
function counters(map) { return { Items: Object.entries(map).map(([k, v]) => ({ Key: k.split('/'), Value: v })) }; }
function profile(id, nickname, level, stats, username = `acct_${nickname}`) {
  return {
    info: { id, aid: 111, username, password: `pw_${nickname}` },
    characters: {
      pmc: { _id: id, Info: { Nickname: nickname, Level: level, Side: 'Usec', Experience: 1000 }, Stats: { Eft: { TotalInGameTime: 7200, LastSessionDate: 1700000000, OverallCounters: counters(stats) } } },
      scav: { _id: `scav${id.slice(4)}` }
    }
  };
}
const A = 'aaaa00000000000000000001', B = 'bbbb00000000000000000002', C = 'cccc00000000000000000003', H = 'dddd00000000000000000004', X = 'eeee00000000000000000005';
const profiles = {
  [A]: profile(A, 'Alpha', 30, { Kills: 100, Deaths: 20, 'Sessions/Pmc': 50, 'ExitStatus/Survived/Pmc': 25, HeadShots: 10, KilledBoss: 2, KilledPmc: 4 }),
  [B]: profile(B, 'Bravo', 10, { Kills: 5, Deaths: 10, 'Sessions/Pmc': 10, 'ExitStatus/Survived/Pmc': 2 }),
  [C]: profile(C, 'Charlie', 50, { Kills: 1, Deaths: 0 }),
  [H]: profile(H, 'headless_abc', 1, {}, 'headless_abc'),
  [X]: { info: { id: X, username: 'nocharacter' }, characters: { pmc: { Info: {} } } }
};
const base = () => ({
  settings: defaultSettings(), secret: SECRET, profiles, presence: new Map(), presenceAvailable: true, activeRaids: [], offers: null,
  ledger: [], itemName: t => `Item ${t.slice(-3)}`, registry: { pmcs: {} }, events: [], isBanned: () => false, moneyTpls: new Set(['5449016a4bdc2d6f028b456f'])
});

// --- player extraction + scoring
const stats = core.extractPlayerStats(profiles[A]);
assert.strictEqual(stats.kills, 100); assert.strictEqual(stats.kd, 5); assert.strictEqual(stats.survivalRate, 50);
assert.strictEqual(stats.playtimeHours, 2); assert.strictEqual(stats.killedBoss, 2);
assert.strictEqual(core.extractPlayerStats(profiles[X]), null, 'accounts without a character are skipped');
assert.strictEqual(core.extractPlayerStats(profiles[H]), null, 'Fika headless host profiles are infrastructure, not players');
assert.strictEqual(core.computeScore(stats), 30 * 100 + 100 * 10 + 25 * 20 + 10 * 2 + 2 * 25 - 20 * 2);
assert.strictEqual(core.computeScore({ level: 1, kills: 0, deaths: 999 }), 0, 'score never goes negative');
assert.strictEqual(core.computeScore({ level: 2, kills: 1 }, { level: 1, kill: 1 }), 3, 'weights are configurable');

// --- anonymisation
assert.strictEqual(core.publicId(SECRET, A), core.publicId(SECRET, A), 'public ids are stable');
assert.notStrictEqual(core.publicId(SECRET, A), core.publicId('b'.repeat(64), A), 'public ids depend on the secret');
assert.ok(!core.publicId(SECRET, A).includes(A.slice(0, 6)));

let snap = core.buildSnapshot(base());
assert.deepStrictEqual(snap.leaderboard.map(r => r.name), ['Alpha', 'Charlie', 'Bravo'].sort((x, y) => snap.leaderboard.findIndex(r => r.name === x) - snap.leaderboard.findIndex(r => r.name === y)));
assert.strictEqual(snap.leaderboard[0].rank, 1);
assert.ok(snap.leaderboard.every((r, i, arr) => i === 0 || arr[i - 1].score >= r.score), 'sorted by score');
assert.strictEqual(snap.leaderboard.length, 3, 'headless and character-less accounts are not listed');
const json = JSON.stringify(snap);
for (const secret of [A, B, C, H, X, 'acct_Alpha', 'pw_Alpha', 'acct_Bravo', 'pw_Charlie', 'scav' + A.slice(4), 'nocharacter']) assert.ok(!json.includes(secret), `public snapshot must not contain ${secret}`);

// --- presence (online) + raid cards
const presence = new Map([[A, { activity: 1, raidInformation: { location: 'bigmap', side: 0 }, activityStartedTimestamp: 1700000100 }], [B, { activity: 0, raidInformation: null, activityStartedTimestamp: 1700000200 }]]);
const ctx = base(); ctx.presence = presence;
ctx.registry = { pmcs: { rex: { name: 'Rex', level: 22, side: 'Bear', kills: 3, deaths: 1, raids: 2, lastSeen: 1700000000000, lastMap: 'bigmap' }, alpha: { name: 'alpha', level: 5, side: 'Usec', kills: 0, deaths: 0, raids: 1 }, ghost: { name: 'Ghost', level: 9, kills: 0, deaths: 0, raids: 0 } } };
ctx.activeRaids = [{ key: A, map: 'bigmap', status: 'in_game', startedAt: Date.now() - 60000, playerIds: [A, 'unknown-id'], deadIds: new Set(), bots: ['rex', 'alpha'] }];
snap = core.buildSnapshot(ctx);
assert.strictEqual(snap.counters.playersOnline, 2); assert.strictEqual(snap.counters.playersInRaid, 1);
assert.strictEqual(snap.online.players.find(p => p.name === 'Alpha').map, 'Customs');
assert.strictEqual(snap.counters.pmcInRaid, 1, 'a PMC that shares a real player name is dropped, and unknown ids never leak');
assert.deepStrictEqual(snap.raids[0].players, [{ name: 'Alpha', dead: false }]);
assert.strictEqual(snap.raids[0].pmcCount, 1);
const rex = snap.leaderboard.find(r => r.name === 'Rex');
assert.ok(rex && rex.kind === 'pmc' && rex.online && rex.map === 'Customs');
assert.ok(!snap.leaderboard.some(r => r.name === 'Ghost'), 'PMCs never seen in a raid are not ranked');
assert.strictEqual(snap.leaderboard.filter(r => r.name.toLowerCase() === 'alpha').length, 1, 'no duplicate of a real nickname');

// --- hiding: banned, manual, events
const hideCtx = base(); hideCtx.isBanned = id => id === B; hideCtx.settings.hiddenProfiles = { [C]: true };
hideCtx.events = [
  { type: 'raid', at: 'x', player: 'Bravo', actors: [core.publicId(SECRET, B)] }, { type: 'kill', at: 'x', killer: 'Alpha', victim: 'Charlie', victimKind: 'player', actors: [core.publicId(SECRET, A)] },
  { type: 'raid', at: 'y', player: 'Alpha', map: 'Woods', actors: [core.publicId(SECRET, A)] }
];
snap = core.buildSnapshot(hideCtx);
assert.deepStrictEqual(snap.leaderboard.map(r => r.name), ['Alpha'], 'banned and manually hidden players disappear');
assert.strictEqual(snap.events.length, 1, 'events that mention hidden players are removed');
assert.ok(!('actors' in snap.events[0]));
hideCtx.settings.hideBanned = false;
assert.ok(core.buildSnapshot(hideCtx).leaderboard.some(r => r.name === 'Bravo'), 'hideBanned can be switched off');

// --- market
const offer = (id, name, memberType, tpl, count, cost, extra = {}) => ({ user: { id, nickname: name, memberType, rating: 3.4 }, items: [{ _tpl: tpl, upd: { StackObjectsCount: count } }], requirementsCost: cost, requirements: [{ _tpl: '5449016a4bdc2d6f028b456f', count: cost }], startTime: 1700000000 + (extra.t || 0), ...extra });
const mctx = base();
mctx.offers = [offer('r1', 'Wolf', 0, 'aaa111', 2, 2000), offer('r2', 'Wolf', 0, 'aaa111', 1, 3000), offer('r3', 'Fox', 0, 'aaa111', 1, 5000), offer(A, 'Alpha', 0, 'bbb222', 4, 4000, { t: 50 }), offer('trader', 'Prapor', 4, 'ccc333', 1, 100),
  { user: { id: 'r9', nickname: 'Barterer', memberType: 0 }, items: [{ _tpl: 'ddd444', upd: { StackObjectsCount: 1 } }], requirements: [{ _tpl: 'eee555', count: 1 }] }];
mctx.ledger = [{ timestamp: 1700000300000, buyerId: B, sellerId: A, itemTpl: 'bbb222', itemCount: 2, valueRub: 2000 }, { timestamp: 1700000400000, buyerId: A, sellerId: 'randomfake', itemTpl: 'aaa111', itemCount: 1, valueRub: 3000 }, { timestamp: 1, buyerId: 'unknown', sellerId: A, itemTpl: 'x', itemCount: 1, valueRub: 1 }];
snap = core.buildSnapshot(mctx);
assert.deepStrictEqual(snap.market.totals, { offers: 6, playerOffers: 1, pmcOffers: 4, traderOffers: 1, pmcTraders: 3 });
assert.strictEqual(snap.market.topItems[0].tpl, 'aaa111'); assert.strictEqual(snap.market.topItems[0].listings, 3);
assert.strictEqual(snap.market.topItems[0].minPrice, 1000); assert.strictEqual(snap.market.topItems[0].maxPrice, 5000); assert.strictEqual(snap.market.topItems[0].medianPrice, 3000);
assert.deepStrictEqual(snap.market.playerListings.map(r => [r.seller, r.qty, r.price]), [['Alpha', 4, 4000]]);
assert.deepStrictEqual(snap.online.market.map(r => r.name), ['Wolf', 'Barterer', 'Fox'].sort((a, b) => ({ Wolf: 0, Barterer: 1, Fox: 2 }[a] - ({ Wolf: 0, Barterer: 1, Fox: 2 }[b]))), 'flea PMCs are listed by activity');
assert.strictEqual(snap.trades.length, 2, 'trades by unknown buyers are skipped');
assert.strictEqual(snap.trades[0].buyer, 'Alpha'); assert.strictEqual(snap.trades[0].seller, null); assert.strictEqual(snap.trades[0].sellerKind, 'pmc');
assert.ok(!JSON.stringify(snap).includes('randomfake') && !JSON.stringify(snap).includes('"r1"'), 'fake seller ids never leak');
mctx.settings.showMarketTraders = false;
assert.deepStrictEqual(core.buildSnapshot(mctx).online.market, []); assert.strictEqual(core.buildSnapshot(mctx).market.totals.pmcTraders, 3);
assert.strictEqual(core.buildSnapshot(base()).market.available, false, 'missing offer source degrades gracefully');
mctx.settings.showPmc = false;
assert.ok(core.buildSnapshot(mctx).leaderboard.every(r => r.kind === 'player'));

// --- helpers
assert.strictEqual(core.mapName('factory4_day'), 'Factory'); assert.strictEqual(core.mapName('SomethingNew'), 'SomethingNew');
assert.strictEqual(core.cleanName('  A\u0000  b  '), 'A b');
assert.strictEqual(core.classifyVictim({ Role: 'pmcBEAR' }), 'pmc'); assert.strictEqual(core.classifyVictim({ Role: 'bossKilla' }), 'boss'); assert.strictEqual(core.classifyVictim({ Role: 'assault' }), 'scav');
assert.strictEqual(core.classifyVictim({ Side: 'Usec' }), 'pmc', 'missing Role falls back to Side'); assert.strictEqual(core.classifyVictim({ Side: 'Savage' }), 'scav'); assert.strictEqual(core.classifyVictim({}), 'unknown');

const D = 'ffff00000000000000000006';
const opAlpha = JSON.parse(JSON.stringify(profiles[A]));
opAlpha.characters.pmc._id = D; // Operations are keyed by PMC character ID, not the top-level account key.
const opCtx = base();
opCtx.profiles = { [A]: opAlpha, [B]: profiles[B], [C]: profiles[C] };
const operationLookups = [];
const operationStats = {
  [D]: { points: 2500, completedMissions: 3, rank: 'Corporal', nextRank: 'Sergeant', pointsToNextRank: 500, rankProgressPercent: 75 },
  [B]: { points: 1000, completedMissions: 1, rank: 'Private', nextRank: 'Corporal', pointsToNextRank: 2000, rankProgressPercent: 0 },
  [C]: { points: 0, completedMissions: 0, rank: 'Recruit', nextRank: 'Private', pointsToNextRank: 1000, rankProgressPercent: 0 }
};
opCtx.operations = { getPlayer(id) { operationLookups.push(id); return operationStats[id]; } };
const operationsSnap = core.buildSnapshot(opCtx);
assert.strictEqual(operationsSnap.meta.operationsAvailable, true);
assert.deepStrictEqual(operationsSnap.operationsLeaderboard.map(row => [row.rank, row.name, row.points, row.completedMissions, row.militaryRank]), [
  [1, 'Alpha', 2500, 3, 'Corporal'],
  [2, 'Bravo', 1000, 1, 'Private']
], 'mission points are ranked separately from the game-stat leaderboard');
assert.ok(operationLookups.includes(D), 'mission stats are queried using the PMC character ID');
assert.ok(!JSON.stringify(operationsSnap).includes(D) && !JSON.stringify(operationsSnap).includes(A) && !JSON.stringify(operationsSnap).includes(B),
  'public operations leaderboard must not reveal account or character profile IDs');
opCtx.settings.hiddenProfiles = { [A]: true };
const hiddenOperationsSnap = core.buildSnapshot(opCtx);
assert.deepStrictEqual(hiddenOperationsSnap.operationsLeaderboard.map(row => row.name), ['Bravo'],
  'manually hidden players must also be hidden from mission standings');

console.log('board-core tests passed');
