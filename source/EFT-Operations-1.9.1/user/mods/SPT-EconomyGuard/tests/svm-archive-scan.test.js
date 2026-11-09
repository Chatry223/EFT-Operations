'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { SvmArchiveScanner, listZipEntries, readZipJsonEntries, crc32 } = require('../src/svm-archive-scan');

function makeZip(items) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const item of items) {
        const name = item.name;
        const raw = Buffer.from(item.data === undefined ? '' : JSON.stringify(item.data), 'utf8');
        const compressed = item.method === 8 ? zlib.deflateRawSync(raw) : raw;
        const filename = Buffer.from(name, 'utf8');
        const crc = crc32(raw);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(item.method || 0, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(filename.length, 26);
        locals.push(local, filename, compressed);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(item.method || 0, 10);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(filename.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, filename);
        offset += local.length + filename.length + compressed.length;
    }
    const centralBytes = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(items.length, 8);
    end.writeUInt16LE(items.length, 10);
    end.writeUInt32LE(centralBytes.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralBytes, end]);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eftops-zip-scan-'));
try {
    fs.mkdirSync(path.join(root, 'user', 'mods'), { recursive: true });
    const archive = path.join(root, 'settings-backup.zip');
    fs.writeFileSync(archive, makeZip([
        { name: 'SVM/Loader/loader.json', data: { preset: 'v6' } },
        { name: 'SVM/Presets/v6.json', data: { Traders: { EnableTraders: true }, Items: { EnableItems: false, ItemPriceMult: 1 } }, method: 8 },
        { name: 'readme.txt', data: 'ignored' }
    ]));
    fs.writeFileSync(path.join(root, 'ordinary.zip'), makeZip([{ name: 'readme.txt' }]));
    fs.writeFileSync(path.join(root, 'user', 'mods', 'nested.zip'), makeZip([{ name: 'Presets/v3.json', data: { test: true } }]));
    const direct = listZipEntries(archive);
    assert.deepStrictEqual(direct.map(item => item.name), ['SVM/Loader/loader.json', 'SVM/Presets/v6.json']);
    const parsed = readZipJsonEntries(archive);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].data.preset, 'v6');
    assert.strictEqual(parsed[1].data.Traders.EnableTraders, true);
    assert.strictEqual(parsed[1].data.Items.EnableItems, false);
    const result = new SvmArchiveScanner(root).scan();
    assert.strictEqual(result.scannedArchives, 3);
    assert.strictEqual(result.matchingArchives, 2);
    assert.ok(result.archives.some(item => item.path === 'settings-backup.zip'));
    assert.ok(result.archives.some(item => item.path === 'user/mods/nested.zip'));
    assert.ok(!result.archives.some(item => item.path === 'ordinary.zip'));

    const corrupt = path.join(root, 'corrupt.zip');
    const bytes = makeZip([{ name: 'Presets/v9.json', data: { safe: true } }]);
    const localNameLength = bytes.readUInt16LE(26);
    bytes[30 + localNameLength] ^= 0x01;
    fs.writeFileSync(corrupt, bytes);
    assert.strictEqual(readZipJsonEntries(corrupt)[0].error, 'ZIP_CRC_OR_SIZE_MISMATCH');
    console.log('SVM archive scan tests passed.');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
