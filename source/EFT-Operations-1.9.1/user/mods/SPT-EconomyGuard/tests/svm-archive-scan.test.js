'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SvmArchiveScanner, listZipEntries } = require('../src/svm-archive-scan');

function makeZip(names) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const name of names) {
        const filename = Buffer.from(name, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt16LE(filename.length, 26);
        locals.push(local, filename);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(filename.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, filename);
        offset += local.length + filename.length;
    }
    const centralBytes = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(names.length, 8);
    end.writeUInt16LE(names.length, 10);
    end.writeUInt32LE(centralBytes.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralBytes, end]);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eftops-zip-scan-'));
try {
    fs.mkdirSync(path.join(root, 'user', 'mods'), { recursive: true });
    fs.writeFileSync(path.join(root, 'settings-backup.zip'), makeZip([
        'SVM/Loader/loader.json', 'SVM/Presets/v6.json', 'readme.txt'
    ]));
    fs.writeFileSync(path.join(root, 'ordinary.zip'), makeZip(['readme.txt', 'data/config.json']));
    fs.writeFileSync(path.join(root, 'user', 'mods', 'nested.zip'), makeZip(['Presets/v3.json']));
    const direct = listZipEntries(path.join(root, 'settings-backup.zip'));
    assert.deepStrictEqual(direct.map(item => item.name), ['SVM/Loader/loader.json', 'SVM/Presets/v6.json']);
    const result = new SvmArchiveScanner(root).scan();
    assert.strictEqual(result.scannedArchives, 3);
    assert.strictEqual(result.matchingArchives, 2);
    assert.ok(result.archives.some(item => item.path === 'settings-backup.zip'));
    assert.ok(result.archives.some(item => item.path === 'user/mods/nested.zip'));
    assert.ok(!result.archives.some(item => item.path === 'ordinary.zip'));
    console.log('SVM archive scan tests passed.');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
