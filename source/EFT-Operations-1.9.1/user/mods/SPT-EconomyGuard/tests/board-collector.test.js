'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BoardStore } = require('../src/board/store');
const { BoardCollector } = require('../src/board/collector');

const quiet = { info() {}, warn() {}, error() {} };
const HOST = 'aaaa00000000000000000001', GUEST = 'bbbb00000000000000000002';
const profiles = {
  [HOST]: { info: { id: HOST }, characters: { pmc: { _id: HOST, Info: { Nickname: 'Hosty', Level: 20 } } } },
  [GUEST]: { info: { id: GUEST }, characters: { pmc: { _id: GUEST, Info: { Nickname: 'Guesty', Level: 11 } } } }
};
const saveServer = { getProfiles: () => profiles, getProfile: id => profiles[id] };
const bot = (name, role, level, side) => ({ Info: { Nickname: name, Level: level, Side: side, Settings: { Role: role } } });

// A minimal tsyringe-like container: resolve() builds one instance per token, afterResolution callbacks run on resolve.
class FakeContainer {
  constructor() { this.instances = new Map(); this.factories = new Map(); this.after = new Map(); }
  register(token, factory) { this.factories.set(token, factory); }
  afterResolution(token, cb) { (this.after.get(token) || this.after.set(token, []).get(token)).push(cb); }
  resolve(token) {
    if (!this.factories.has(token)) throw new Error(`Cannot resolve ${token}`);
    if (!this.instances.has(token)) this.instances.set(token, this.factories.get(token)());
    const inst = this.instances.get(token);
    for (const cb of this.after.get(token) || []) cb(null, inst);
    return inst;
  }
}

class BotController { generate(sessionId, info) { return Promise.resolve(this.bots); } }
class MatchCallbacks { endLocalRaid(url, info, sessionId) { this.calls = (this.calls || 0) + 1; return 'null-response'; } }
class LocationLifecycleService { endLocalRaid() { throw new Error('prototype version must not be used'); } }

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-collector-'));
  const store = new BoardStore(dir, {}, quiet);
  const fikaMatches = new Map([[HOST, { status: 1, locationData: { Id: 'bigmap' }, timestamp: new Date().toISOString(), players: new Map([[HOST, { isDead: false }], [GUEST, { isDead: true }]]) }]]);
  const fika = { getMatchIdByProfile: id => fikaMatches.has(id) ? id : (id === GUEST ? HOST : undefined), getMatch: id => fikaMatches.get(id), getAllMatches: () => fikaMatches };
  const guard = { onlinePresence: new Map() };
  const collector = new BoardCollector({ store, guard, logger: quiet, services: { saveServer } });

  const container = new FakeContainer();
  const botController = new BotController(); botController.bots = [];
  const matchCallbacks = new MatchCallbacks();
  const lifecycle = new LocationLifecycleService();
  container.register('FikaMatchService', () => fika);
  container.register('RagfairServer', () => ({ getOffers: () => [{ user: { id: 'x' } }] }));
  container.register('BotController', () => botController);
  container.register('MatchCallbacks', () => matchCallbacks);
  container.register('LocationLifecycleService', () => lifecycle);
  collector.install(container);
  assert.ok(collector.health.hooks.botGeneration && collector.health.hooks.raidEnd && collector.health.hooks.raidEndLifecycle && collector.health.hooks.fikaMatches && collector.health.hooks.offers);
  assert.strictEqual(collector.getOffers().length, 1);

  // Fika assigns its own endLocalRaid on the instance AFTER our hook was installed (worst-case load order).
  let fikaEndCalls = 0;
  lifecycle.endLocalRaid = function (sessionId, request) { fikaEndCalls++; return 'fika-result'; };

  // 1) Bot generation: return value untouched, PMC bots recorded, scavs and real-player names ignored.
  botController.bots = [bot('Rex', 'pmcBEAR', 22, 'Bear'), bot('Mia', 'pmcUSEC', 30, 'Usec'), bot('ScavGuy', 'assault', 5, 'Savage'), bot('Guesty', 'pmcUSEC', 1, 'Usec'), bot('Rex', 'pmcBEAR', 22, 'Bear')];
  const returned = botController.generate(HOST, {});
  assert.ok(returned instanceof Promise, 'original promise is returned to SPT');
  assert.strictEqual(await returned, botController.bots);
  await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(Object.keys(store.registry.pmcs).sort(), ['mia', 'rex']);
  assert.strictEqual(store.registry.pmcs.rex.raids, 1, 'a bot counts once per raid even if listed twice');
  assert.strictEqual(store.registry.pmcs.rex.lastMap, 'bigmap');
  const raids = collector.getActiveRaids(Date.now(), 60);
  assert.strictEqual(raids.length, 1); assert.deepStrictEqual(raids[0].bots.sort(), ['mia', 'rex']);
  assert.deepStrictEqual(raids[0].playerIds.sort(), [GUEST, HOST].sort()); assert.ok(raids[0].deadIds.has(GUEST));

  // A rejected generation promise is still delivered to SPT and does not trip the board.
  const failing = new BotController(); failing.generate = BotController.prototype.generate; botController.generate = function () { return Promise.reject(new Error('boom')); };
  await assert.rejects(botController.generate(HOST, {}), /boom/);

  // 2) Raid end through the Fika-assigned instance method AND MatchCallbacks (de-duplicated).
  const endRequest = {
    serverId: 'bigmap.pmc.123', results: { result: 'killed', playTime: 600, profile: { Info: { Side: 'Usec' }, Stats: { Eft: {
      Victims: [{ Name: 'Rex', Role: 'pmcBEAR', Level: 22, Side: 'Bear' }, { Name: 'x', Role: 'assault' }, { Name: 'Guesty', Role: 'pmcUSEC', Level: 11, Side: 'Usec' }, { Name: 'Big', Role: 'bossKilla' }],
      Aggressor: { Name: 'Mia', Role: 'pmcUSEC', Level: 30, Side: 'Usec' } } } } }
  };
  assert.strictEqual(lifecycle.endLocalRaid(GUEST, endRequest), 'fika-result', 'Fika method result is preserved');
  assert.strictEqual(matchCallbacks.endLocalRaid('/client/match/local/end', endRequest, GUEST), 'null-response');
  assert.strictEqual(fikaEndCalls, 1); assert.strictEqual(matchCallbacks.calls, 1);
  const types = store.events.map(e => e.type);
  assert.deepStrictEqual(types.sort(), ['death', 'kill', 'kill', 'kill', 'raid'], 'one raid report despite two hooks; scav kill is not itemised');
  assert.strictEqual(store.registry.pmcs.rex.deaths, 1); assert.strictEqual(store.registry.pmcs.mia.kills, 1);
  const raidEvent = store.events.find(e => e.type === 'raid');
  assert.strictEqual(raidEvent.player, 'Guesty'); assert.strictEqual(raidEvent.map, 'Customs'); assert.strictEqual(raidEvent.result, 'killed'); assert.strictEqual(raidEvent.kills, 4); assert.strictEqual(raidEvent.scavKills, 1);
  assert.strictEqual(store.events.find(e => e.type === 'kill' && e.victim === 'Guesty').victimKind, 'player', 'player-vs-player kills are labelled as such');
  assert.strictEqual(store.events.find(e => e.type === 'death').killerKind, 'pmc');
  assert.strictEqual(collector.getActiveRaids().length, 1, 'a guest leaving does not end the host raid');

  // 2b) Aggressor without a Role field is still attributed through Side (AI PMC credited, scav not).
  collector.onRaidEnded(HOST, { serverId: 'woods.pmc.9', results: { result: 'killed', playTime: 99, profile: { Info: { Side: 'Usec' }, Stats: { Eft: { Victims: [], Aggressor: { Name: 'Mia', Side: 'Usec' } } } } } });
  assert.strictEqual(store.registry.pmcs.mia.kills, 2);
  collector.onRaidEnded(HOST, { serverId: 'woods.pmc.10', results: { result: 'killed', playTime: 98, profile: { Info: { Side: 'Usec' }, Stats: { Eft: { Victims: [], Aggressor: { Name: 'Scavvy', Side: 'Savage' } } } } } });
  assert.strictEqual(store.events.filter(e => e.type === 'death').pop().killerKind, 'scav');

  // 3) Host leaving closes the raid: bots go offline (Fika match removed too).
  fikaMatches.delete(HOST);
  assert.strictEqual(collector.getActiveRaids().length, 0, 'raid vanishes when Fika drops the match');

  // 4) Solo (no Fika): raid lives until host reports the end or the TTL expires.
  const solo = new BoardCollector({ store, guard, logger: quiet, services: { saveServer } });
  solo.onBotsGenerated(HOST, [bot('Solo', 'pmcUSEC', 7, 'Usec')]);
  assert.strictEqual(solo.getActiveRaids(Date.now(), 60).length, 1);
  assert.strictEqual(solo.getActiveRaids(Date.now() + 61 * 60000, 60).length, 0, 'TTL clears stale raids');
  solo.onBotsGenerated(HOST, [bot('Solo2', 'pmcUSEC', 7, 'Usec')]);
  solo.onRaidEnded(HOST, { serverId: 'woods.pmc.1', results: { result: 'survived', playTime: 5, profile: { Info: { Side: 'Usec' }, Stats: { Eft: {} } } } });
  assert.strictEqual(solo.getActiveRaids().length, 0, 'host end-of-raid closes a solo raid');

  // 5) Circuit breaker: repeated internal failures disable the collector, never SPT.
  const bad = new BoardCollector({ store, guard, logger: quiet, services: { saveServer } });
  bad.onBotsGenerated = () => { throw new Error('internal'); };
  class BotControllerB extends BotController { generate() { return Promise.resolve(this.bots); } }
  const c2 = new FakeContainer(); const bc2 = new BotControllerB(); bc2.bots = [bot('Z', 'pmcUSEC', 1, 'Usec')];
  c2.register('BotController', () => bc2); bad.install(c2);
  for (let i = 0; i < 30; i++) assert.strictEqual(await bc2.generate(HOST, {}), bc2.bots);
  await new Promise(r => setImmediate(r));
  assert.strictEqual(bad.disabled, true); assert.ok(bad.health.errors > 20);
  assert.strictEqual(await bc2.generate(HOST, {}), bc2.bots, 'SPT keeps working after the collector disables itself');

  // 6) Missing services: install on an empty container must not throw.
  new BoardCollector({ store, guard, logger: quiet, services: {} }).install(new FakeContainer());
  new BoardCollector({ store, guard, logger: quiet, services: {} }).install(null);

  store.flush();
  const reloaded = new BoardStore(dir, {}, quiet);
  assert.ok(reloaded.registry.pmcs.rex && reloaded.events.length >= 5, 'registry and events persist across restarts');
  console.log('board-collector tests passed');
})().catch(err => { console.error(err); process.exit(1); });
