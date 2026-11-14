'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Fika243OperationsAdapter } = require('../src/operations/fika243-adapter');

async function run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-fika-item-send-'));
    try {
        const modDir = path.join(root, 'user', 'mods', 'SPT-EconomyGuard');
        const fikaDir = path.join(root, 'user', 'mods', 'fika-server');
        const dataDir = path.join(root, 'data');
        fs.mkdirSync(modDir, { recursive: true });
        fs.mkdirSync(fikaDir, { recursive: true });
        fs.writeFileSync(path.join(fikaDir, 'package.json'), JSON.stringify({ version: '2.4.3', sptVersion: '~3.11' }));
        fs.mkdirSync(path.join(fikaDir, 'assets', 'configs'), { recursive: true });
        fs.writeFileSync(path.join(fikaDir, 'assets', 'configs', 'fika.jsonc'), JSON.stringify({ server: { allowItemSending: true } }));

        const rootId = 'item-root';
        const childId = 'item-child';
        const senderProfile = {
            characters: { pmc: { _id: 'sender-pmc', Inventory: { items: [
                { _id: rootId, _tpl: 'tpl-container', parentId: 'hideout' },
                { _id: childId, _tpl: 'tpl-ammo', parentId: rootId, upd: { StackObjectsCount: 60 } },
                { _id: 'unrelated', _tpl: 'tpl-unrelated', parentId: 'hideout' }
            ] } } }
        };
        const receiverProfile = { characters: { pmc: { _id: 'receiver-pmc', Inventory: { items: [] } } } };
        const profiles = new Map([['sender-session', senderProfile], ['receiver-session', receiverProfile]]);
        const saveServer = { getProfile: id => profiles.get(id) || null };
        const adapter = new Fika243OperationsAdapter({
            modDir, operations: { dataDir }, logger: { info() {}, warn() {}, debug() {} }
        });
        adapter.services.saveServer = saveServer;

        const response = { success: true, opaque: { preserved: true } };
        const controller = {
            async sendItem(_pmcData, body, sessionId) {
                assert.strictEqual(body.id, rootId);
                assert.strictEqual(sessionId, 'sender-session');
                senderProfile.characters.pmc.Inventory.items =
                    senderProfile.characters.pmc.Inventory.items.filter(item => item._id !== rootId && item._id !== childId);
                return response;
            }
        };
        assert.strictEqual(adapter.patchItemSendingController(controller), true);
        assert.strictEqual(adapter.getStatus().itemSending.monitored, true);
        assert.strictEqual(adapter.patchItemSendingController(controller), true, 'hook installation is idempotent');
        const actual = await controller.sendItem({}, { id: rootId, target: 'receiver-session' }, 'sender-session');
        assert.strictEqual(actual, response, 'the Fika response object must be returned unchanged');

        let events = adapter.getRecentEvents(10);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'fika_item_send_observed');
        assert.strictEqual(events[0].transferState, 'sender_inventory_debited');
        assert.strictEqual(events[0].senderProfileId, 'sender-pmc');
        assert.strictEqual(events[0].targetProfileId, 'receiver-pmc');
        assert.strictEqual(events[0].itemCount, 2);
        assert.deepStrictEqual(events[0].itemTplCounts, { 'tpl-container': 1, 'tpl-ammo': 60 });
        assert.strictEqual(events[0].source, 'FikaSendItemController.sendItem');
        assert.strictEqual(events[0].evidenceTrust, 'fika_server_controller_observation');
        assert.strictEqual(events[0].rewardEligible, false);

        // A rejected/failed Fika operation must remain visible as not confirmed,
        // and the wrapper must preserve the original response unchanged.
        const failedController = {
            async sendItem() { return { warnings: [{ code: 'ITEM_NOT_FOUND' }] }; }
        };
        adapter.patchItemSendingController(failedController);
        const failedResponse = await failedController.sendItem({}, { id: 'missing-item', target: 'receiver-session' }, 'sender-session');
        assert.strictEqual(failedResponse.warnings[0].code, 'ITEM_NOT_FOUND');
        events = adapter.getRecentEvents(10);
        assert.strictEqual(events[0].transferState, 'not_confirmed');
        assert.strictEqual(events[0].rewardEligible, false);

        const throwingController = { async sendItem() { throw new Error('simulated-fika-failure'); } };
        adapter.patchItemSendingController(throwingController);
        await assert.rejects(() => throwingController.sendItem({}, { id: rootId, target: 'receiver-session' }, 'sender-session'), /simulated-fika-failure/);
        events = adapter.getRecentEvents(10);
        assert.strictEqual(events[0].transferState, 'controller_threw');
        assert.match(events[0].error, /simulated-fika-failure/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

run().then(() => process.stdout.write('Fika item-sending observer tests passed\\n'))
    .catch(error => { console.error(error); process.exitCode = 1; });
