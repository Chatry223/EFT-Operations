'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SvmConfigService } = require('../src/svm-config');

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eftops-svm-'));
    const mods = path.join(root, 'user', 'mods');
    const modDir = path.join(mods, 'SPT-EconomyGuard');
    const svmDir = path.join(mods, '[SVM] Server Value Modifier');
    const dataDir = path.join(root, 'SPT-EconomyGuard-Data');
    writeJson(path.join(svmDir, 'package.json'), { version: '1.11.1', sptVersion: '3.11.x' });
    writeJson(path.join(svmDir, 'Loader', 'loader.json'), { CurrentlySelectedPreset: 'v6' });
    writeJson(path.join(svmDir, 'Presets', 'v6.json'), {
        PresetNotes: 'fixture',
        Items: { EnableItems: false, ItemPriceMult: 1 },
        Traders: {
            EnableTraders: true,
            TraderMarkup: { Prapor: 25, Skier: 20, Fence: 17 },
            TraderSell: { Prapor: 6.45, Skier: 5.1 },
            Fence: { EnableFence: false, PriceMult: 1.2, PresetMult: 2, StockTime_Min: 50, StockTime_Max: 150 }
        }
    });
    writeJson(path.join(svmDir, 'Presets', 'v5.json'), { Items: { ItemPriceMult: 7 }, Traders: {} });
    fs.mkdirSync(modDir, { recursive: true });
    return { root, svmDir, dataDir, service: new SvmConfigService(modDir, dataDir, { info() {}, warn() {} }) };
}

(function testReadsSelectedPresetAndTraderTwenty() {
    const f = fixture();
    try {
        const status = f.service.getStatus();
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.version, '1.11.1');
        assert.strictEqual(status.activePreset, 'v6');
        assert.strictEqual(status.traderMarkup.Skier, 20);
        assert.strictEqual(status.itemPriceMultiplier, 1);
        assert.strictEqual(status.tradersEnabled, true);
        assert.strictEqual(status.itemsEnabled, false);
        assert.strictEqual(status.itemPriceMultiplierActive, false);
        assert.strictEqual(status.fence.enabled, false);
        assert.strictEqual(status.fence.priceMultiplier, 1.2);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
})();

(function testWritesOnlyActivePresetAndCreatesBackup() {
    const f = fixture();
    try {
        const result = f.service.update({
            traderMarkup: { Skier: 22, Prapor: 30 },
            traderSell: { Prapor: 7.25 },
            itemPriceMultiplier: 1.5,
            fence: { priceMultiplier: 1.4 }
        });
        assert.strictEqual(result.changed, true);
        assert.deepStrictEqual(result.changes.sort(), [
            'Items.ItemPriceMult', 'Traders.Fence.PriceMult', 'Traders.TraderMarkup.Prapor',
            'Traders.TraderMarkup.Skier', 'Traders.TraderSell.Prapor'
        ].sort());
        const v6 = JSON.parse(fs.readFileSync(path.join(f.svmDir, 'Presets', 'v6.json'), 'utf8'));
        const v5 = JSON.parse(fs.readFileSync(path.join(f.svmDir, 'Presets', 'v5.json'), 'utf8'));
        assert.strictEqual(v6.Traders.TraderMarkup.Skier, 22);
        assert.strictEqual(v6.Items.ItemPriceMult, 1.5);
        assert.strictEqual(v5.Items.ItemPriceMult, 7);
        const backups = path.join(f.dataDir, 'backups', 'svm');
        assert.strictEqual(fs.readdirSync(backups).length, 1);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
})();

(function testExplicitlyTogglesTraderAndItemSections() {
    const f = fixture();
    try {
        const result = f.service.update({ tradersEnabled: false, itemsEnabled: true });
        assert.strictEqual(result.changed, true);
        assert.ok(result.changes.includes('Traders.EnableTraders'));
        assert.ok(result.changes.includes('Items.EnableItems'));
        const preset = JSON.parse(fs.readFileSync(path.join(f.svmDir, 'Presets', 'v6.json'), 'utf8'));
        assert.strictEqual(preset.Traders.EnableTraders, false);
        assert.strictEqual(preset.Items.EnableItems, true);
        const status = f.service.getStatus();
        assert.strictEqual(status.tradersEnabled, false);
        assert.strictEqual(status.itemsEnabled, true);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
})();

(function testRejectsNonBooleanSectionSwitches() {
    const f = fixture();
    try {
        assert.throws(() => f.service.update({ itemsEnabled: 'true' }), /INVALID_SVM_ITEMS_ENABLED/);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(f.svmDir, 'Presets', 'v6.json'), 'utf8')).Items.EnableItems, false);
        assert.strictEqual(fs.existsSync(path.join(f.dataDir, 'backups', 'svm')), false);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
})();

(function testRejectsPresetSymlinkOutsideSvmDirectory() {
    const f = fixture();
    try {
        if (process.platform === 'win32') return; // Symlink creation may require elevated Windows privileges.
        const external = path.join(f.root, 'external-preset.json');
        writeJson(external, { Traders: { EnableTraders: true, TraderMarkup: { Skier: 99 } } });
        const active = path.join(f.svmDir, 'Presets', 'v6.json');
        fs.unlinkSync(active);
        fs.symlinkSync(external, active);
        const status = f.service.getStatus();
        assert.strictEqual(status.available, false);
        assert.strictEqual(status.reason, 'SVM_PRESET_OUTSIDE_DIRECTORY');
        assert.throws(() => f.service.update({ traderMarkup: { Skier: 20 } }), /SVM_PRESET_OUTSIDE_DIRECTORY/);
        assert.strictEqual(JSON.parse(fs.readFileSync(external, 'utf8')).Traders.TraderMarkup.Skier, 99);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
})();

(function testReadOnlyWhenSvmVersionIsNotAudited() {
    const f = fixture();
    try {
        writeJson(path.join(f.svmDir, 'package.json'), { version: '1.12.0', sptVersion: '3.11.x' });
        const status = f.service.getStatus();
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.compatible, false);
        assert.throws(() => f.service.update({ traderMarkup: { Skier: 21 } }), /SVM_VERSION_NOT_VERIFIED/);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
})();

(function testRejectsUnknownTraderAndInvalidFenceRangeWithoutWriting() {
    const f = fixture();
    try {
        assert.throws(() => f.service.update({ traderMarkup: { UnknownTrader: 20 } }), /UNKNOWN_SVM_TRADER/);
        assert.throws(() => f.service.update({ traderMarkup: { Skier: 100.1 } }), /INVALID_SVM_TRADER_MARKUP/);
        assert.throws(() => f.service.update({ fence: { stockTimeMin: 200, stockTimeMax: 100 } }), /INVALID_SVM_FENCE_STOCK_RANGE/);
        const preset = JSON.parse(fs.readFileSync(path.join(f.svmDir, 'Presets', 'v6.json'), 'utf8'));
        assert.strictEqual(preset.Traders.TraderMarkup.Skier, 20);
        assert.strictEqual(fs.existsSync(path.join(f.dataDir, 'backups', 'svm')), false);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
})();

console.log('SVM config tests passed.');
