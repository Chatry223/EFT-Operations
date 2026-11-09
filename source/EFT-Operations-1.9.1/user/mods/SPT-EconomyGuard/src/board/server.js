'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
};
const STATIC = {
    '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/static/board.css': { file: 'board.css', type: 'text/css; charset=utf-8' },
    '/static/board.js': { file: 'board.js', type: 'text/javascript; charset=utf-8' }
};

// Read-only public HTTP server. It has no authentication because it exposes only the sanitised snapshot
// produced by core.buildSnapshot(); there is no route that reads profiles, tokens, IPs or admin data.
class BoardServer {
    constructor({ webDir, getState, getBackground, getNewsMedia, getTitle, logger, limits = {} }) {
        this.webDir = webDir;
        this.getState = getState;
        this.getBackground = getBackground;
        this.getNewsMedia = getNewsMedia || (() => null);
        this.getTitle = getTitle || (() => 'Server status');
        this.logger = logger || console;
        this.rateLimit = limits.perMinute || 240;
        this.hits = new Map();
        this.server = null;
        this.stats = { requests: 0, rateLimited: 0, startedAt: null };
        this.fileCache = new Map();
        this.sweeper = null;
    }

    isRunning() { return !!(this.server && this.server.listening); }
    address() { return this.server && this.server.address(); }

    start(host, port) {
        return new Promise((resolve, reject) => {
            if (this.server) return reject(new Error('ALREADY_RUNNING'));
            const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => this.handle(req, res));
            server.requestTimeout = 15000;
            server.headersTimeout = 10000;
            server.keepAliveTimeout = 5000;
            server.maxConnections = 400;
            const onError = err => { server.removeListener('listening', onListening); this.server = null; reject(err); };
            const onListening = () => {
                server.removeListener('error', onError);
                server.on('error', err => this.logger.warn(`[StatusBoard] HTTP server error: ${err.message}`));
                this.stats.startedAt = new Date().toISOString();
                this.sweeper = setInterval(() => this.sweep(), 60000);
                if (this.sweeper.unref) this.sweeper.unref();
                resolve(server.address());
            };
            server.once('error', onError);
            server.once('listening', onListening);
            this.server = server;
            server.listen(port, host);
        });
    }

    stop() {
        return new Promise(resolve => {
            const server = this.server;
            if (!server) return resolve();
            this.server = null;
            if (this.sweeper) { clearInterval(this.sweeper); this.sweeper = null; }
            server.close(() => resolve());
            if (server.closeAllConnections) server.closeAllConnections();
        });
    }

    sweep() {
        const cutoff = Date.now() - 60000;
        for (const [ip, row] of this.hits) if (row.start < cutoff) this.hits.delete(ip);
    }

    limited(ip) {
        const now = Date.now();
        let row = this.hits.get(ip);
        if (!row || now - row.start >= 60000) { row = { start: now, count: 0 }; this.hits.set(ip, row); }
        row.count++;
        return row.count > this.rateLimit;
    }

    send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
        const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        res.writeHead(status, { 'Content-Type': type, 'Content-Length': payload.length, ...SECURITY_HEADERS, ...extra });
        res.end(res.req && res.req.method === 'HEAD' ? undefined : payload);
    }

    loadStatic(entry) {
        const file = path.join(this.webDir, entry.file);
        const stat = fs.statSync(file);
        const cached = this.fileCache.get(file);
        if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
        let body = fs.readFileSync(file);
        if (entry.file === 'index.html') body = Buffer.from(body.toString('utf8').replace('%%TITLE%%', escapeHtml(this.getTitle())));
        const record = { mtimeMs: stat.mtimeMs, body, etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"` };
        this.fileCache.set(file, record);
        return record;
    }

    handle(req, res) {
        res.req = req;
        this.stats.requests++;
        const ip = req.socket && req.socket.remoteAddress || 'unknown';
        if (req.method !== 'GET' && req.method !== 'HEAD') return this.send(res, 405, { error: 'method_not_allowed' }, undefined, { Allow: 'GET, HEAD' });
        if (this.limited(ip)) { this.stats.rateLimited++; return this.send(res, 429, { error: 'too_many_requests' }, undefined, { 'Retry-After': '30' }); }
        let pathname;
        try { pathname = new URL(req.url, 'http://board.local').pathname; } catch (_) { return this.send(res, 400, { error: 'bad_request' }); }
        try {
            if (STATIC[pathname]) return this.serveStatic(req, res, STATIC[pathname]);
            if (pathname === '/api/state') return this.serveState(req, res);
            if (pathname === '/media/background') return this.serveMedia(req, res, this.getBackground());
            const news = /^\/media\/a\/([a-f0-9]{10})$/.exec(pathname);
            if (news) return this.serveMedia(req, res, this.getNewsMedia(news[1]));
            if (pathname === '/healthz') return this.send(res, 200, 'ok', 'text/plain; charset=utf-8', { 'Cache-Control': 'no-store' });
            return this.send(res, 404, { error: 'not_found' });
        } catch (err) {
            this.logger.warn(`[StatusBoard] Request failed (${pathname}): ${err.message}`);
            return this.send(res, 500, { error: 'unavailable' });
        }
    }

    serveStatic(req, res, entry) {
        const record = this.loadStatic(entry);
        if (req.headers['if-none-match'] === record.etag) { res.writeHead(304, { ETag: record.etag, ...SECURITY_HEADERS }); return res.end(); }
        return this.send(res, 200, record.body, entry.type, { ETag: record.etag, 'Cache-Control': 'no-cache' });
    }

    serveState(req, res) {
        const state = this.getState();
        if (req.headers['if-none-match'] === state.etag) { res.writeHead(304, { ETag: state.etag, 'Cache-Control': 'no-cache', ...SECURITY_HEADERS }); return res.end(); }
        return this.send(res, 200, state.body, 'application/json; charset=utf-8', { ETag: state.etag, 'Cache-Control': 'no-cache' });
    }

    serveMedia(req, res, bg) {
        if (!bg) return this.send(res, 404, { error: 'not_found' });
        let stat;
        try { stat = fs.statSync(bg.file); } catch (_) { return this.send(res, 404, { error: 'not_found' }); }
        const size = stat.size;
        const headers = { 'Content-Type': bg.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=300', ...SECURITY_HEADERS };
        let start = 0, end = size - 1, status = 200;
        const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
        if (range && (range[1] || range[2])) {
            if (range[1] === '') { start = Math.max(0, size - Number(range[2])); }
            else { start = Number(range[1]); if (range[2] !== '') end = Math.min(size - 1, Number(range[2])); }
            if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}`, ...SECURITY_HEADERS }); return res.end(); }
            status = 206;
            headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        }
        headers['Content-Length'] = end - start + 1;
        res.writeHead(status, headers);
        if (req.method === 'HEAD') return res.end();
        const stream = fs.createReadStream(bg.file, { start, end });
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
    }
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

module.exports = { BoardServer, SECURITY_HEADERS };
