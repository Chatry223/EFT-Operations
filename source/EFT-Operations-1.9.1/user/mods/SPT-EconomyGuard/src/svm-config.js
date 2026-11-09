'use strict';

const fs = require('fs');
const path = require('path');

const TRADER_KEYS = new Set(['Prapor', 'Therapist', 'Fence', 'Skier', 'Peacekeeper', 'Mechanic', 'Ragman', 'Jaeger', 'Ref']);

function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

class SvmConfigService {
    constructor(modDir, dataDir, logger = console) {
        this.modDir = modDir;
        this.dataDir = dataDir;
        this.logger = logger || console;
        this.svmDir = this.findSvmDirectory();
    }

    findSvmDirectory() {
        const modsDir = path.resolve(this.modDir, '..');
        try {
            const name = fs.readdirSync(modsDir).find(item => item.toLowerCase() === '[svm] server value modifier');
            return name ? path.join(modsDir, name) : null;
        } catch (_) { return null; }
    }

    readJson(file) {
        return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    }

    resolveActivePreset() {
        if (!this.svmDir) throw new Error('SVM_NOT_INSTALLED');
        const loaderFile = path.join(this.svmDir, 'Loader', 'loader.json');
        const loader = this.readJson(loaderFile);
        const selected = String(loader.CurrentlySelectedPreset || '').trim();
        if (!/^v[1-9][0-9]*$/.test(selected)) throw new Error('SVM_PRESET_NOT_SELECTED');
        const presetFile = path.join(this.svmDir, 'Presets', selected + '.json');
        if (!fs.existsSync(presetFile)) throw new Error('SVM_ACTIVE_PRESET_MISSING');
        const preset = this.readJson(presetFile);
        if (!isObject(preset.Traders)) throw new Error('SVM_TRADER_SECTION_MISSING');
        return { loaderFile, presetFile, selected, preset };
    }

    getStatus() {
        try {
            if (!this.svmDir) return { installed: false, available: false, reason: 'SVM_NOT_INSTALLED' };
            const pkgFile = path.join(this.svmDir, 'package.json');
            const pkg = fs.existsSync(pkgFile) ? this.readJson(pkgFile) : {};
            const active = this.resolveActivePreset();
            const compatible = String(pkg.version || '') === '1.11.1' && /^3\.11(?:\.x)?$/.test(String(pkg.sptVersion || ''));
            const traders = active.preset.Traders;
            const markup = isObject(traders.TraderMarkup) ? traders.TraderMarkup : {};
            const sell = isObject(traders.TraderSell) ? traders.TraderSell : {};
            const fence = isObject(traders.Fence) ? traders.Fence : {};
            const numeric = value => Number.isFinite(Number(value)) ? Number(value) : null;
            return {
                installed: true,
                available: true,
                version: String(pkg.version || 'unknown'),
                sptVersion: String(pkg.sptVersion || 'unknown'),
                compatible,
                activePreset: active.selected,
                presetNotes: String(active.preset.PresetNotes || ''),
                traderMarkup: Object.fromEntries(Object.entries(markup).filter(([key, value]) => TRADER_KEYS.has(key) && Number.isFinite(Number(value))).map(([key, value]) => [key, numeric(value)])),
                traderSell: Object.fromEntries(Object.entries(sell).filter(([key, value]) => TRADER_KEYS.has(key) && Number.isFinite(Number(value))).map(([key, value]) => [key, numeric(value)])),
                itemPriceMultiplier: active.preset.Items && numeric(active.preset.Items.ItemPriceMult),
                fence: {
                    priceMultiplier: numeric(fence.PriceMult),
                    presetMultiplier: numeric(fence.PresetMult),
                    stockTimeMin: numeric(fence.StockTime_Min),
                    stockTimeMax: numeric(fence.StockTime_Max)
                },
                restartRequired: true,
                reason: null
            };
        } catch (err) {
            return { installed: !!this.svmDir, available: false, reason: err.message || 'SVM_READ_FAILED' };
        }
    }

    update(input) {
        if (!isObject(input)) throw new Error('INVALID_SVM_UPDATE');
        const active = this.resolveActivePreset();
        const pkg = this.readJson(path.join(this.svmDir, 'package.json'));
        if (String(pkg.version || '') !== '1.11.1' || !/^3\.11(?:\.x)?$/.test(String(pkg.sptVersion || ''))) throw new Error('SVM_VERSION_NOT_VERIFIED');
        const preset = active.preset;
        const changes = [];
        const number = (value, min, max, field, integer = false) => {
            const n = Number(value);
            if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error('INVALID_SVM_' + field.toUpperCase());
            return n;
        };

        if (input.traderMarkup !== undefined) {
            if (!isObject(input.traderMarkup) || !isObject(preset.Traders.TraderMarkup)) throw new Error('INVALID_SVM_TRADER_MARKUP');
            for (const [trader, value] of Object.entries(input.traderMarkup)) {
                if (!TRADER_KEYS.has(trader) || !Object.prototype.hasOwnProperty.call(preset.Traders.TraderMarkup, trader)) throw new Error('UNKNOWN_SVM_TRADER');
                const next = number(value, 0, 1000, 'trader_markup');
                if (Number(preset.Traders.TraderMarkup[trader]) !== next) {
                    preset.Traders.TraderMarkup[trader] = next;
                    changes.push('Traders.TraderMarkup.' + trader);
                }
            }
        }

        if (input.traderSell !== undefined) {
            if (!isObject(input.traderSell) || !isObject(preset.Traders.TraderSell)) throw new Error('INVALID_SVM_TRADER_SELL');
            for (const [trader, value] of Object.entries(input.traderSell)) {
                if (!TRADER_KEYS.has(trader) || !Object.prototype.hasOwnProperty.call(preset.Traders.TraderSell, trader)) throw new Error('UNKNOWN_SVM_TRADER');
                const next = number(value, 0, 1000, 'trader_sell');
                if (Number(preset.Traders.TraderSell[trader]) !== next) {
                    preset.Traders.TraderSell[trader] = next;
                    changes.push('Traders.TraderSell.' + trader);
                }
            }
        }

        if (input.itemPriceMultiplier !== undefined) {
            if (!isObject(preset.Items) || !Object.prototype.hasOwnProperty.call(preset.Items, 'ItemPriceMult')) throw new Error('SVM_ITEM_PRICE_SETTING_MISSING');
            preset.Items.ItemPriceMult = number(input.itemPriceMultiplier, 0, 1000, 'item_price_multiplier');
            changes.push('Items.ItemPriceMult');
        }

        if (input.fence !== undefined) {
            if (!isObject(input.fence) || !isObject(preset.Traders.Fence)) throw new Error('INVALID_SVM_FENCE');
            const fields = { priceMultiplier: ['PriceMult', 0, 1000], presetMultiplier: ['PresetMult', 0, 1000], stockTimeMin: ['StockTime_Min', 1, 10080], stockTimeMax: ['StockTime_Max', 1, 10080] };
            for (const [key, [target, min, max]] of Object.entries(fields)) {
                if (input.fence[key] === undefined) continue;
                const next = number(input.fence[key], min, max, 'fence_' + key, key.startsWith('stockTime'));
                if (Number(preset.Traders.Fence[target]) !== next) {
                    preset.Traders.Fence[target] = next;
                    changes.push('Traders.Fence.' + target);
                }
            }
            if (Number(preset.Traders.Fence.StockTime_Min) > Number(preset.Traders.Fence.StockTime_Max)) throw new Error('INVALID_SVM_FENCE_STOCK_RANGE');
        }

        if (!changes.length) return { ok: true, changed: false, changes: [], status: this.getStatus(), restartRequired: true };
        const backupDir = path.join(this.dataDir, 'backups', 'svm');
        fs.mkdirSync(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupDir, active.selected + '-' + stamp + '.json');
        fs.copyFileSync(active.presetFile, backupFile);
        const tempFile = active.presetFile + '.eftoperations.tmp';
        try {
            fs.writeFileSync(tempFile, JSON.stringify(preset, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
            fs.renameSync(tempFile, active.presetFile);
        } catch (err) {
            try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) { /* keep original error */ }
            throw err;
        }
        return { ok: true, changed: true, changes, backupCreated: true, status: this.getStatus(), restartRequired: true };
    }
}

module.exports = { SvmConfigService };
