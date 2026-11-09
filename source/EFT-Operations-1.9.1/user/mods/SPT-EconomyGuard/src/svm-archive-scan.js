'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_ARCHIVES = 500;
const MAX_ENTRIES_PER_ARCHIVE = 20000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_ENTRIES = 50;
const MAX_PREVIEW_TOTAL_BYTES = 4 * 1024 * 1024;
const TARGET = /(?:^|\\/)(?:Loader\\/loader\\.json|Presets\\/v[1-9][0-9]*\\.json)$/i;

function crc32(buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function readAt(fd, length, position) {
    if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) throw new Error('ZIP_INVALID_RANGE');
    const out = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
        const n = fs.readSync(fd, out, done, length - done, position + done);
        if (!n) throw new Error('ZIP_TRUNCATED');
        done += n;
    }
    return out;
}

function findEndRecord(buffer) {
    const min = Math.max(0, buffer.length - 22 - 0xffff);
    for (let i = buffer.length - 22; i >= min; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) {
            const commentLength = buffer.readUInt16LE(i + 20);
            if (i + 22 + commentLength === buffer.length) return i;
        }
    }
    throw new Error('ZIP_CENTRAL_DIRECTORY_NOT_FOUND');
}

function parseDirectory(fd, stat) {
    if (!stat.isFile() || stat.size < 22 || stat.size > MAX_ARCHIVE_BYTES) throw new Error('ZIP_SIZE_LIMIT');
    const tailSize = Math.min(stat.size, 22 + 0xffff);
    const tail = readAt(fd, tailSize, stat.size - tailSize);
    const eocd = findEndRecord(tail);
    const disk = tail.readUInt16LE(eocd + 4);
    const directoryDisk = tail.readUInt16LE(eocd + 6);
    const diskCount = tail.readUInt16LE(eocd + 8);
    const count = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    const eocdAbsolute = stat.size - tailSize + eocd;
    if (disk || directoryDisk || diskCount !== count) throw new Error('ZIP_MULTIDISK_NOT_SUPPORTED');
    if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) throw new Error('ZIP64_NOT_SUPPORTED');
    if (count > MAX_ENTRIES_PER_ARCHIVE || directorySize > MAX_DIRECTORY_BYTES || directoryOffset + directorySize > eocdAbsolute) throw new Error('ZIP_DIRECTORY_LIMIT');
    const directory = readAt(fd, directorySize, directoryOffset);
    const entries = [];
    let offset = 0;
    for (let i = 0; i < count; i++) {
        if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP_DIRECTORY_CORRUPT');
        const flags = directory.readUInt16LE(offset + 8);
        const method = directory.readUInt16LE(offset + 10);
        const crc = directory.readUInt32LE(offset + 16);
        const compressedSize = directory.readUInt32LE(offset + 20);
        const uncompressedSize = directory.readUInt32LE(offset + 24);
        const nameLength = directory.readUInt16LE(offset + 28);
        const extraLength = directory.readUInt16LE(offset + 30);
        const commentLength = directory.readUInt16LE(offset + 32);
        const localOffset = directory.readUInt32LE(offset + 42);
        const nameStart = offset + 46;
        const next = nameStart + nameLength + extraLength + commentLength;
        if (next > directory.length) throw new Error('ZIP_DIRECTORY_CORRUPT');
        if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('ZIP64_NOT_SUPPORTED');
        const name = directory.toString(flags & 0x0800 ? 'utf8' : 'latin1', nameStart, nameStart + nameLength).replace(/\\/g, '/');
        if (TARGET.test(name) && !name.endsWith('/')) entries.push({ name, flags, method, crc, compressedSize, uncompressedSize, localOffset, directoryOffset });
        offset = next;
    }
    if (offset !== directory.length) throw new Error('ZIP_DIRECTORY_SIZE_MISMATCH');
    return entries;
}

function listZipEntries(file) {
    const fd = fs.openSync(file, 'r');
    try {
        return parseDirectory(fd, fs.fstatSync(fd)).map(entry => ({
            name: entry.name, method: entry.method, compressedSize: entry.compressedSize,
            uncompressedSize: entry.uncompressedSize, encrypted: !!(entry.flags & 1)
        }));
    } finally { fs.closeSync(fd); }
}

function readZipJsonEntries(file, options = {}) {
    const maxJsonBytes = Math.min(MAX_JSON_BYTES, Math.max(1024, Number(options.maxJsonBytes) || MAX_JSON_BYTES));
    const maxEntries = Math.min(MAX_PREVIEW_ENTRIES, Math.max(1, Number(options.maxEntries) || MAX_PREVIEW_ENTRIES));
    const maxTotalJsonBytes = Math.min(MAX_PREVIEW_TOTAL_BYTES, Math.max(1024, Number(options.maxTotalJsonBytes) || MAX_PREVIEW_TOTAL_BYTES));
    const fd = fs.openSync(file, 'r');
    try {
        const stat = fs.fstatSync(fd);
        const allEntries = parseDirectory(fd, stat);
        const selectedEntries = allEntries.slice(0, maxEntries);
        const results = [];
        let totalBytes = 0;
        let truncated = allEntries.length > selectedEntries.length;
        for (const entry of selectedEntries) {
            if (entry.flags & 1) { results.push({ name: entry.name, ok: false, error: 'ZIP_ENTRY_ENCRYPTED' }); continue; }
            if (![0, 8].includes(entry.method)) { results.push({ name: entry.name, ok: false, error: 'ZIP_COMPRESSION_UNSUPPORTED' }); continue; }
            if (entry.uncompressedSize > maxJsonBytes || entry.compressedSize > MAX_JSON_BYTES) { results.push({ name: entry.name, ok: false, error: 'ZIP_JSON_SIZE_LIMIT' }); continue; }
            if (totalBytes + entry.uncompressedSize > maxTotalJsonBytes) {
                truncated = true;
                results.push({ name: entry.name, ok: false, error: 'ZIP_PREVIEW_TOTAL_LIMIT' });
                break;
            }
            totalBytes += entry.uncompressedSize;
            if (entry.localOffset + 30 > stat.size || entry.localOffset >= entry.directoryOffset) {
                results.push({ name: entry.name, ok: false, error: 'ZIP_LOCAL_HEADER_INVALID' });
                continue;
            }
            const local = readAt(fd, 30, entry.localOffset);
            if (local.readUInt32LE(0) !== 0x04034b50) { results.push({ name: entry.name, ok: false, error: 'ZIP_LOCAL_HEADER_INVALID' }); continue; }
            const localFlags = local.readUInt16LE(6);
            const localMethod = local.readUInt16LE(8);
            if (localMethod !== entry.method || localFlags !== entry.flags) {
                results.push({ name: entry.name, ok: false, error: 'ZIP_LOCAL_METADATA_MISMATCH' });
                continue;
            }
            const localNameLength = local.readUInt16LE(26);
            const localExtraLength = local.readUInt16LE(28);
            const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
            if (dataOffset < entry.localOffset + 30 || dataOffset > entry.directoryOffset
                || dataOffset + entry.compressedSize > entry.directoryOffset) {
                results.push({ name: entry.name, ok: false, error: 'ZIP_DATA_RANGE_INVALID' });
                continue;
            }
            const localName = readAt(fd, localNameLength, entry.localOffset + 30)
                .toString(localFlags & 0x0800 ? 'utf8' : 'latin1').replace(/\\/g, '/');
            if (localName !== entry.name) { results.push({ name: entry.name, ok: false, error: 'ZIP_LOCAL_NAME_MISMATCH' }); continue; }
            const compressed = readAt(fd, entry.compressedSize, dataOffset);
            let data;
            try {
                data = entry.method === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: maxJsonBytes });
            } catch (_) { results.push({ name: entry.name, ok: false, error: 'ZIP_DECOMPRESSION_FAILED' }); continue; }
            if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) {
                results.push({ name: entry.name, ok: false, error: 'ZIP_CRC_OR_SIZE_MISMATCH' });
                continue;
            }
            try {
                const parsed = JSON.parse(data.toString('utf8'));
                results.push({ name: entry.name, ok: true, data: parsed });
            } catch (_) { results.push({ name: entry.name, ok: false, error: 'ZIP_JSON_INVALID' }); }
        }
        results.truncated = truncated;
        results.totalMatchingEntries = allEntries.length;
        results.previewedEntries = results.length;
        results.previewBytes = totalBytes;
        return results;
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
        while (stack.length && seen.size < this.maxArchives) {
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
                if (seen.size >= this.maxArchives) break;
            }
        }
        return { scannedArchives: seen.size, matchingArchives: archives.length, truncated: stack.length > 0 || seen.size >= this.maxArchives, archives, errors: errors.slice(0, 100) };
    }
}

module.exports = { SvmArchiveScanner, listZipEntries, readZipJsonEntries, crc32 };
