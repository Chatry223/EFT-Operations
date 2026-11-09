'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./core');
const { BoardStore, defaultLayout } = require('./store');
const { BoardCollector } = require('./collector');
const { BoardServer } = require('./server');

function safeCall(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }

// Facade that owns the public status site. It is deliberately a closed unit:
//   * it only READS from the guard (presence map, ledger tail, ban list) and never changes its state,
//   * it has its own HTTP server, its own data folder (SPT-EconomyGuard-Data/statusboard) and its own settings,
//   * start() never throws, so a failure here cannot prevent the economic firewall or the admin panel from running.
class StatusBoard {
    constructor({ modDir, guard, logger, seed = {}, services = {}, reservedPorts = [] }) {
        this.modDir = modDir;
        this.guard = guard;
        this.logger = logger || console;
        this.services = services;
        this.reservedPorts = reservedPorts;
        this.store = new BoardStore(guard.storage.baseDir, seed, this.logger);
        this.collector = new BoardCollector({ store: this.store, guard, logger: this.logger, services });
        this.server = new BoardServer({
            webDir: path.join(modDir, 'web-public'),
            getState: () => this.getState(),
            getBackground: () => this.store.resolveBackground(),
            getNewsMedia: id => this.store.resolveNewsMedia(id),
            getTitle: () => this.store.settings.serverName,
            logger: this.logger
        });
        this.cache = null;
        this.nameCache = new Map();
        this.lastError = null;
        this.boundTo = null;
    }

    log(level, message) {
        const fn = this.logger && (this.logger[level] || this.logger.info);
        if (typeof fn === 'function') fn.call(this.logger, `[StatusBoard] ${message}`);
    }

    // ---- lifecycle ---------------------------------------------------------------------------------------
    async start(container) {
        try { this.collector.install(container); } catch (err) { this.log('warn', `Live collection could not be installed: ${err.message}`); }
        await this.syncServer();
        this.publishHealth();
        return this.server.isRunning();
    }

    async stop() {
        try { await this.server.stop(); } catch (_) { /* shutting down */ }
        try { this.store.flush(); } catch (_) { /* best effort */ }
    }

    resolveHost(setting) {
        if (setting === 'localhost') return '127.0.0.1';
        if (setting === 'auto') {
            const cfg = this.services.configServer && safeCall(() => this.services.configServer.getConfig('spt-http'), null);
            return cfg && typeof cfg.ip === 'string' && cfg.ip ? cfg.ip : '0.0.0.0';
        }
        return setting;
    }

    async syncServer() {
        const settings = this.store.settings;
        try { if (this.server.isRunning()) await this.server.stop(); } catch (_) { /* restart below */ }
        this.boundTo = null;
        if (!settings.enabled) { this.lastError = null; this.log('info', 'Public status site is switched off.'); return false; }
        const host = this.resolveHost(settings.host);
        try {
            const addr = await this.server.start(host, settings.port);
            this.boundTo = { host: addr.address, port: addr.port };
            this.lastError = null;
            this.log('info', `Public status site listening on ${addr.address}:${addr.port}`);
            return true;
        } catch (err) {
            this.lastError = `${err.code || 'ERROR'}: ${err.message}`;
            this.log('error', `Public status site could not start on ${host}:${settings.port} (${this.lastError}). The rest of the server is unaffected.`);
            throw err;
        } finally { this.publishHealth(); }
    }

    publishHealth() {
        try {
            this.guard.health.statusBoard = {
                enabled: this.store.settings.enabled, running: this.server.isRunning(), bound: this.boundTo, lastError: this.lastError,
                collector: this.collector.health
            };
            this.guard.writeHealth();
        } catch (_) { /* health is informational */ }
    }

    // ---- data --------------------------------------------------------------------------------------------
    itemName(tpl) {
        const id = String(tpl || '');
        if (!id) return 'Unknown item';
        if (this.nameCache.has(id)) return this.nameCache.get(id);
        let name = null;
        const locale = this.services.localeService && safeCall(() => this.services.localeService.getLocaleDb('en'), null)
            || this.services.localeService && safeCall(() => this.services.localeService.getLocaleDb(), null);
        if (locale) name = locale[`${id} ShortName`] || locale[`${id} Name`] || null;
        if (!name && this.services.databaseServer) {
            const item = safeCall(() => this.services.databaseServer.getTables().templates.items[id], null);
            name = item && (item._props && item._props.ShortName || item._name) || null;
        }
        name = core.cleanName(name || 'Unknown item', 60);
        if (name !== 'Unknown item') this.nameCache.set(id, name);
        return name;
    }

    buildContext() {
        const settings = this.store.settings;
        const guard = this.guard;
        const saveServer = this.services.saveServer;
        const online = guard.health && guard.health.onlinePlayers;
        const bg = this.store.resolveBackground();
        return {
            now: Date.now, settings, secret: this.store.secret,
            profiles: saveServer && typeof saveServer.getProfiles === 'function' ? safeCall(() => saveServer.getProfiles(), {}) : {},
            presence: guard.onlinePresence, presenceAvailable: !!(online && online.available),
            activeRaids: this.collector.getActiveRaids(Date.now(), settings.raidTtlMinutes),
            offers: this.collector.getOffers(),
            ledger: Array.isArray(guard.recentLedger) ? guard.recentLedger : [],
            isBanned: id => guard.accessControl.isBanActive(id),
            itemName: tpl => this.itemName(tpl),
            moneyTpls: guard.moneyTpls,
            registry: this.store.registry, events: this.store.events,
            announcements: this.store.activeNews().map(n => {
                const media = this.store.resolveMedia(n.media);
                return {
                    id: n.id, kind: n.kind, title: n.title, text: n.text, startsAt: n.startsAt, endsAt: n.endsAt,
                    publishedAt: n.startsAt || n.createdAt, link: n.link,
                    media: media ? { kind: media.kind, url: `/media/a/${n.id}?v=${Math.floor(safeCall(() => fs.statSync(media.file).mtimeMs, 0))}` } : null
                };
            }),
            background: bg ? { kind: bg.kind, url: `/media/background?v=${Math.floor(safeCall(() => fs.statSync(bg.file).mtimeMs, 0))}`, overlay: settings.background.overlay } : null
        };
    }

    invalidate() { this.cache = null; }

    getState() {
        const now = Date.now();
        if (this.cache && now - this.cache.at < 3000) return this.cache;
        const snapshot = core.buildSnapshot(this.buildContext());
        const stable = JSON.stringify({ ...snapshot, meta: { ...snapshot.meta, generatedAt: 0 } });
        this.cache = {
            at: now, body: JSON.stringify(snapshot),
            etag: `"${crypto.createHash('sha1').update(stable).digest('hex').slice(0, 20)}"`
        };
        return this.cache;
    }

    // ---- admin-facing API (called by the main admin panel) --------------------------------------------------
    addressHints() {
        const port = this.boundTo ? this.boundTo.port : this.store.settings.port;
        const host = this.boundTo ? this.boundTo.host : this.resolveHost(this.store.settings.host);
        if (host && host !== '0.0.0.0' && host !== '::') return [`http://${host}:${port}`];
        const urls = [];
        for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${port}`);
        return urls.length ? urls : [`http://127.0.0.1:${port}`];
    }

    getAdminState() {
        const s = this.store.settings;
        const profiles = this.services.saveServer && safeCall(() => this.services.saveServer.getProfiles(), {}) || {};
        const players = Object.entries(profiles).map(([id, p]) => ({ profileId: id, nickname: core.cleanName(p && p.characters && p.characters.pmc && p.characters.pmc.Info && p.characters.pmc.Info.Nickname), hidden: !!s.hiddenProfiles[id] }))
            .filter(p => p.nickname && !core.isInfrastructureProfile(profiles[p.profileId])).sort((a, b) => a.nickname.localeCompare(b.nickname));
        return {
            settings: s,
            layoutDefaults: defaultLayout(),
            runtime: {
                running: this.server.isRunning(), bound: this.boundTo, lastError: this.lastError, urls: this.addressHints(),
                requests: this.server.stats.requests, rateLimited: this.server.stats.rateLimited, startedAt: this.server.stats.startedAt,
                collector: this.collector.health, trackedPmc: Object.keys(this.store.registry.pmcs).length
            },
            media: { dir: this.store.mediaDir, files: this.store.listMedia(), backgroundResolved: !!this.store.resolveBackground() },
            news: this.store.listNews().map(n => ({ ...n, mediaFound: n.media.source === 'none' ? null : !!this.store.resolveMedia(n.media) })),
            players
        };
    }

    async applyAdminUpdate(patch) {
        const previous = JSON.parse(JSON.stringify(this.store.settings));
        this.store.updateSettings(patch, this.reservedPorts);
        this.invalidate();
        const next = this.store.settings;
        if (previous.enabled !== next.enabled || previous.host !== next.host || previous.port !== next.port) {
            try { await this.syncServer(); }
            catch (err) {
                this.store.settings = previous;
                this.store.saveSettings();
                this.invalidate();
                try { await this.syncServer(); } catch (_) { /* previous binding also unavailable */ }
                throw new Error(`BOARD_BIND_FAILED: ${err.code || ''} ${err.message}`.trim());
            }
        }
        return this.getAdminState();
    }

    // Announcements: validated, persisted, and visible to the public only while their schedule window is open.
    saveNews(item) { const saved = this.store.saveNews(item); this.invalidate(); return saved; }
    deleteNews(id) { const r = this.store.deleteNews(id); this.invalidate(); return r; }

    setHidden(profileId, hidden) { const r = this.store.setHidden(profileId, hidden); this.invalidate(); return r; }
    resetPmcStats() { this.store.resetPmcStats(); this.invalidate(); return true; }
}

module.exports = { StatusBoard };
