'use strict';

const fs = require('fs');
const path = require('path');

const MAX_ARCHIVES = 500;
const MAX_ENTRIES_PER_ARCHIVE = 20000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const TARGET = /(?:^|\/)(?:loader\.json|v[1-9][0-9]*\.json)$/i;

function findEndRecord(buffer) {
    const min = Math.max(0, buffer.length - 22 - 0xffff);
    for (let i = buffer.length - 22; i >= min; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) return i;
    }
    throw new Error('ZIP_CENTRAL_DIRECTORY_NOT_FOUND');
}

function listZipEntries(file) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 22 || stat.size > MAX_ARCHIVE_BYTES) throw new Error('ZIP_SIZE_LIMIT');
    const fd = fs.openSync(file, 'r');
    try {
        const tailSize = Math.min(stat.size, 22 + 0xffff);
        const tail = Buffer.alloc(tailSize);
        fs.readSync(fd, tail, 0, tailSize, stat.size - tailSize);
        const eocd = findEndRecord(tail);
        const count = tail.readUInt16LE(eocd + 10);
        const directorySize = tail.readUInt32LE(eocd + 12);
        const directoryOffset = tail.readUInt32LE(eocd + 16);
        if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) throw new Error('ZIP64_NOT_SUPPORTED');
        if (count > MAX_ENTRIES_PER_ARCHIVE || directoryOffset + directorySize > stat.size) throw new Error('ZIP_DIRECTORY_LIMIT');
        const directory = Buffer.alloc(directorySize);
        fs.readSync(fd, directory, 0, directorySize, directoryOffset);
        const entries = [];
        let offset = 0;
        for (let i = 0; i < count; i++) {
            if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP_DIRECTORY_CORRUPT');
            const flags = directory.readUInt16LE(offset + 8);
            const method = directory.readUInt16LE(offset + 10);
            const compressedSize = directory.readUInt32LE(offset + 20);
            const uncompressedSize = directory.readUInt32LE(offset + 24);
            const nameLength = directory.readUInt16LE(offset + 28);
            const extraLength = directory.readUInt16LE(offset + 30);
            const commentLength = directory.readUInt16LE(offset + 32);
            const nameStart = offset + 46;
            const next = nameStart + nameLength + extraLength + commentLength;
            if (next > directory.length) throw new Error('ZIP_DIRECTORY_CORRUPT');
            const name = directory.toString(flags & 0x0800 ? 'utf8' : 'latin1', nameStart, nameStart + nameLength).replace(/\\/g, '/');
            if (TARGET.test(name) && !name.endsWith('/')) {
                entries.push({ name, method, compressedSize, uncompressedSize, encrypted: !!(flags & 1) });
            }
            offset = next;
        }
        return entries;
    } finally { fs.closeSync(fd); }
}

class SvmArchiveScanner {
    constructor(serverRoot, options = {}) {
        this.serverRoot = path.resolve(serverRoot);
        this.maxArchives = Math.min(MAX_ARCHIVES, Math.max(1, Number(options.maxArchives) || MAX_ARCHIVES));
    }

    scan() {
        const archives = [];
        const errors = [];
        const stack = [this.serverRoot];
        const seen = new Set();
        while (stack.length && archives.length < this.maxArchives) {
            const dir = stack.pop();
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
            catch (err) { errors.push({ path: path.relative(this.serverRoot, dir), error: err.code || 'READ_FAILED' }); continue; }
            for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { stack.push(full); continue; }
                if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.zip') continue;
                const canonical = path.resolve(full);
                if (seen.has(canonical)) continue;
                seen.add(canonical);
                try {
                    const matches = listZipEntries(full);
                    if (matches.length) archives.push({
                        path: path.relative(this.serverRoot, full).split(path.sep).join('/'),
                        size: fs.statSync(full).size,
                        matches: matches.slice(0, 200).map(item => ({
                            entry: item.name, method: item.method, compressedSize: item.compressedSize,
                            uncompressedSize: item.uncompressedSize, encrypted: item.encrypted
                        }))
                    });
                } catch (err) {
                    errors.push({ path: path.relative(this.serverRoot, full).split(path.sep).join('/'), error: err.message || 'ZIP_SCAN_FAILED' });
                }
                if (archives.length >= this.maxArchives) break;
            }
        }
        return { scannedArchives: seen.size, matchingArchives: archives.length, truncated: stack.length > 0 || seen.size >= this.maxArchives, archives, errors: errors.slice(0, 100) };
    }
}

module.exports = { SvmArchiveScanner, listZipEntries };
