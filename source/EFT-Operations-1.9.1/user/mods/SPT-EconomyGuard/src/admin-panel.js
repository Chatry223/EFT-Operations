'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const PROFILE_RE = /^[a-f0-9]{24}$/i;
const TPL_RE = /^[a-f0-9]{24}$/i;
const CHANNELS = new Set(['any', 'trader-money', 'trader-barter', 'flea-money', 'flea-barter']);

function safeCall(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }
function safeArray(value) { return Array.isArray(value) ? value : []; }

class AdminPanelServer {
    constructor(modDir, guard, logger, config, serverContext = {}) {
        this.modDir = modDir;
        this.guard = guard;
        this.logger = logger || console;
        this.config = config || {};
        this.serverContext = serverContext || {};
        this.accessControl = guard.accessControl;
        this.launcherController = this.serverContext.launcherController || guard.serverContext.launcherController || null;
        this.saveServer = this.serverContext.saveServer || guard.serverContext.saveServer || null;
        this.fikaPresenceService = this.serverContext.fikaPresenceService || guard.serverContext.fikaPresenceService || null;
        this.board = this.serverContext.board || null; // optional public status site (set by mod.js)
        this.operations = this.serverContext.operations || null;
        this.fikaOperationsAdapter = this.serverContext.fikaOperationsAdapter || null;
        this.rewardDelivery = this.serverContext.rewardDelivery || null;
        this.dataDir = guard.storage.baseDir;
        this.webDir = path.join(modDir, 'web');
        this.tokenFile = path.join(this.dataDir, 'admin.token');
        this.server = null;
        this.token = this.loadOrCreateToken();
        this.failedAuth = new Map();
    }

    log(level, message) {
        const fn = this.logger && (this.logger[level] || this.logger.info);
        if (typeof fn === 'function') fn.call(this.logger, `[EconomyGuard Admin] ${message}`);
        else console.log(`[EconomyGuard Admin] ${message}`);
    }

    loadOrCreateToken() {
        try {
            if (fs.existsSync(this.tokenFile)) {
                const existing = fs.readFileSync(this.tokenFile, 'utf8').trim();
                if (/^[a-f0-9]{64}$/i.test(existing)) return existing;
            }
            const token = crypto.randomBytes(32).toString('hex');
            fs.writeFileSync(this.tokenFile, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'w' });
            return token;
        } catch (err) {
            this.log('error', `Could not create admin token: ${err.message}`);
            throw err;
        }
    }

    start() {
        const cfg = this.config || {};
        if (cfg.enabled === false) {
            this.log('info', 'Local admin panel disabled by configuration.');
            return false;
        }
        const host = cfg.host || '127.0.0.1';
        if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
            this.log('error', 'Admin panel bind rejected. This build only permits loopback binding; use an SSH tunnel for remote access.');
            return false;
        }
        const port = cfg.port === 0 ? 0 : (Number(cfg.port) || 6970);
        this.server = http.createServer((req, res) => this.handle(req, res));
        this.server.on('error', err => {
            this.guard.health.adminPanel = { enabled: false, error: err.message, host, port };
            this.guard.writeHealth();
            this.log('error', `Panel server failed: ${err.message}`);
        });
        this.server.listen(port, host, () => {
            const actualPort = this.server.address() && this.server.address().port || port;
            this.guard.health.adminPanel = { enabled: true, host, port: actualPort, remoteAccess: 'SSH_TUNNEL_ONLY', auth: 'TOKEN' };
            this.guard.writeHealth();
            this.log('info', `Local admin panel: http://${host}:${actualPort}/`);
            this.log('info', `Admin token file: ${this.tokenFile}`);
            this.log('warn', 'Remote access is not exposed. Use an SSH local port-forward; do not port-forward this HTTP service to the public internet.');
        });
        return true;
    }

    isLoopback(req) {
        const remote = String(req.socket && req.socket.remoteAddress || '');
        const host = String(req.headers.host || '').toLowerCase();
        const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host);
        const localAddr = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
        return localAddr && localHost;
    }

    send(res, status, data, type = 'application/json; charset=utf-8') {
        const body = type.startsWith('application/json') ? JSON.stringify(data) : String(data);
        res.writeHead(status, {
            'Content-Type': type,
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
        });
        res.end(body);
    }

    unauthorized(res, ip) {
        const now = Date.now();
        const state = this.failedAuth.get(ip) || { count: 0, until: 0 };
        if (state.until > now) return this.send(res, 429, { error: 'AUTH_RATE_LIMIT' });
        state.count++;
        if (state.count >= 10) { state.count = 0; state.until = now + 60000; }
        this.failedAuth.set(ip, state);
        return this.send(res, 401, { error: 'UNAUTHORIZED' });
    }

    isAuthorized(req) {
        const header = String(req.headers.authorization || '');
        if (!header.startsWith('Bearer ')) return false;
        const candidate = Buffer.from(header.slice(7));
        const expected = Buffer.from(this.token);
        return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
    }

    async readBody(req) {
        return new Promise((resolve, reject) => {
            let size = 0;
            const chunks = [];
            req.on('data', chunk => {
                size += chunk.length;
                if (size > 65536) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
                chunks.push(chunk);
            });
            req.on('end', () => {
                try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
                catch (_) { reject(new Error('INVALID_JSON')); }
            });
            req.on('error', reject);
        });
    }

    readRecent(dir, pattern, max = 300) {
        try { return this.guard.storage.loadRecentJsonl(dir, pattern, max); }
        catch (_) { return []; }
    }

    getCases() { return this.guard.storage.loadCases(1500); }

    getPlayers() {
        const byId = new Map();
        const touch = (id, values = {}) => {
            if (!id || typeof id !== 'string') return;
            const row = byId.get(id) || { profileId: id, names: [], caseCount: 0, ledgerEvents: 0, lastSeen: null, blocked: false, blockExpiresAt: null };
            if (values.name && !row.names.includes(values.name)) row.names.push(values.name);
            if (values.caseCount) row.caseCount += values.caseCount;
            if (values.ledgerEvents) row.ledgerEvents += values.ledgerEvents;
            const ts = values.timestamp || null;
            const parsedTs = ts ? Date.parse(ts) : NaN;
            const parsedExisting = row.lastSeen ? Date.parse(row.lastSeen) : NaN;
            if (ts && Number.isFinite(parsedTs) && (!Number.isFinite(parsedExisting) || parsedTs > parsedExisting)) row.lastSeen = ts;
            byId.set(id, row);
        };
        const cases = this.getCases();
        for (const c of cases) {
            const e = c.evidence || {};
            const id = e.profileId || e.sessionID || e.sessionId || e.buyerId || null;
            touch(id, { name: e.playerName, caseCount: 1, timestamp: c.createdAt });
            touch(e.sellerId, { timestamp: c.createdAt });
            touch(e.buyerId, { timestamp: c.createdAt });
        }
        const ledger = this.readRecent(this.guard.storage.ledgerDir, /^ledger-.*\.jsonl$/i, 3000);
        for (const e of ledger) {
            const epoch = Number(e.timestamp);
            const fallbackTimestamp = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch).toISOString() : null;
            const timestamp = e.timestampIso || fallbackTimestamp;
            touch(e.buyerId, { ledgerEvents: 1, timestamp });
            touch(e.sellerId, { ledgerEvents: 1, timestamp });
        }
        const restrictions = this.guard.restrictions || {};
        for (const [id, block] of Object.entries(restrictions.players || {})) {
            const row = byId.get(id) || { profileId: id, names: [], caseCount: 0, ledgerEvents: 0, lastSeen: null };
            row.blocked = (block.blocked === true || block.blockAllPurchases === true) && !(block.blockedUntil && Date.parse(block.blockedUntil) <= Date.now());
            row.blockExpiresAt = Object.prototype.hasOwnProperty.call(block, 'blockedUntil') ? block.blockedUntil : (block.expiresAt || null);
            row.blockReason = block.reason || '';
            byId.set(id, row);
        }
        return [...byId.values()].sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
    }

    getSummary() {
        const cases = this.getCases();
        const audit = this.readRecent(this.guard.storage.auditDir, /^audit-.*\.jsonl$/i, 1500);
        const ledger = this.readRecent(this.guard.storage.ledgerDir, /^ledger-.*\.jsonl$/i, 1500);
        const activeCases = cases.filter(c => ['OPEN', 'PENDING'].includes(String(c.status || 'OPEN').toUpperCase()));
        const last24 = Date.now() - 86400000;
        const recentAudit = audit.filter(e => Date.parse(e.timestamp || '') >= last24 || Number(e.epoch || 0) >= last24);
        const types = {};
        for (const c of cases) types[c.type || 'UNKNOWN'] = (types[c.type || 'UNKNOWN'] || 0) + 1;
        const recentBlocked = recentAudit.filter(e => e.type === 'TRANSACTION_BLOCKED').length;
        const totalRub = ledger.reduce((sum, e) => sum + (Number(e.valueRub) || 0), 0);
        const daily = {};
        for (const e of audit) {
            const date = String(e.timestamp || '').slice(0, 10);
            if (date) {
                daily[date] ||= { date, events: 0, blocked: 0 };
                daily[date].events++;
                if (e.type === 'TRANSACTION_BLOCKED') daily[date].blocked++;
            }
        }
        return {
            mode: this.guard.config.mode,
            version: this.guard.health.version,
            health: this.guard.health,
            counts: { totalCases: cases.length, openCases: activeCases.length, blockedLast24h: recentBlocked, auditEvents: audit.length, ledgerEvents: ledger.length, players: this.getPlayers().length, totalRecordedValueRub: Math.round(totalRub) },
            casesByType: types,
            timeline: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)).slice(-30),
            recentCases: cases.slice(0, 8),
            recentAudit: audit.slice(-20).reverse(),
            recentLedger: ledger.slice(-20).reverse()
        };
    }

    saveConfigPatch(patch) {
        const allowed = {};
        if (patch.mode !== undefined) {
            const mode = String(patch.mode).toLowerCase();
            if (!['audit', 'protect'].includes(mode)) throw new Error('INVALID_MODE');
            allowed.mode = mode;
        }
        if (patch.notifications !== undefined) {
            if (!patch.notifications || typeof patch.notifications !== 'object') throw new Error('INVALID_NOTIFICATIONS');
            const current = this.guard.config.notifications || {};
            const next = { ...current };
            if (patch.notifications.enabled !== undefined) next.enabled = !!patch.notifications.enabled;
            if (patch.notifications.prefix !== undefined) next.prefix = String(patch.notifications.prefix).slice(0, 120);
            if (patch.notifications.separator !== undefined) next.separator = String(patch.notifications.separator).slice(0, 12);
            if (patch.notifications.includeCaseId !== undefined) next.includeCaseId = !!patch.notifications.includeCaseId;
            if (patch.notifications.messages !== undefined) {
                if (!patch.notifications.messages || typeof patch.notifications.messages !== 'object' || Array.isArray(patch.notifications.messages)) throw new Error('INVALID_MESSAGES');
                next.messages = { ...(current.messages || {}) };
                for (const [key, value] of Object.entries(patch.notifications.messages)) {
                    if (!(key === 'default' || /^[A-Z0-9_]{2,80}$/.test(key)) || typeof value !== 'string' || value.length > 500) throw new Error('INVALID_MESSAGE_ENTRY');
                    next.messages[key] = value;
                }
            }
            allowed.notifications = next;
        }
        if (patch.price !== undefined) {
            const p = patch.price;
            if (!p || typeof p !== 'object') throw new Error('INVALID_PRICE_SETTINGS');
            const next = { ...(this.guard.config.price || {}) };
            for (const key of ['maxOvervalueRatio', 'minUndervalueRatio', 'marketReviewOvervalueRatio', 'marketReviewUndervalueRatio', 'referenceDisagreementRatio', 'minimumReferenceRoubles', 'unknownItemReviewThresholdRoubles']) {
                if (p[key] !== undefined) {
                    const value = Number(p[key]);
                    if (!Number.isFinite(value) || value <= 0 || value > 100000) throw new Error(`INVALID_${key}`);
                    if ((key === 'minUndervalueRatio' || key === 'marketReviewUndervalueRatio') && value >= 1) throw new Error(`INVALID_${key}`);
                    if ((key === 'maxOvervalueRatio' || key === 'marketReviewOvervalueRatio' || key === 'referenceDisagreementRatio') && value <= 1) throw new Error(`INVALID_${key}`);
                    next[key] = value;
                }
            }
            if (p.allowSingleReferenceSourceForBlocking !== undefined) next.allowSingleReferenceSourceForBlocking = !!p.allowSingleReferenceSourceForBlocking;
            allowed.price = next;
        }
        const nextConfig = { ...this.guard.config, ...allowed };
        const target = path.join(this.modDir, 'config', 'config.json');
        const temp = `${target}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(nextConfig, null, 2), 'utf8');
        fs.renameSync(temp, target);
        Object.assign(this.guard.config, allowed);
        this.guard.health.mode = this.guard.config.mode;
        this.guard.writeHealth();
        return { mode: this.guard.config.mode, notifications: this.guard.config.notifications, price: this.guard.config.price };
    }

    validateExpiry(value) {
        if (value === null || value === undefined || value === '') return null;
        const timestamp = Date.parse(value);
        if (!Number.isFinite(timestamp) || timestamp <= Date.now() || timestamp > Date.now() + 3660 * 86400000) throw new Error('INVALID_EXPIRY');
        return new Date(timestamp).toISOString();
    }

    addPlayerBlock(body) {
        const id = String(body.profileId || '').toLowerCase();
        if (!PROFILE_RE.test(id)) throw new Error('INVALID_PROFILE_ID');
        const restrictions = this.guard.restrictions;
        const previous = restrictions.players[id] || { rules: [] };
        if (!Object.prototype.hasOwnProperty.call(previous, 'blockedUntil') && previous.expiresAt && Array.isArray(previous.rules)) {
            previous.rules = previous.rules.map(rule => ({ ...rule, expiresAt: rule.expiresAt || previous.expiresAt }));
            delete previous.expiresAt;
        }
        restrictions.players[id] = {
            ...previous,
            blocked: body.blocked !== false,
            reason: String(body.reason || 'Administrator block').slice(0, 300),
            createdAt: previous.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            blockedUntil: this.validateExpiry(body.expiresAt),
            playerName: String(body.playerName || previous.playerName || '').slice(0, 64)
        };
        if (!this.guard.storage.saveRestrictions(restrictions)) throw new Error('SAVE_FAILED');
        this.guard.restrictions = restrictions;
        return restrictions.players[id];
    }

    removePlayerBlock(id) {
        id = String(id || '').toLowerCase();
        if (!PROFILE_RE.test(id)) throw new Error('INVALID_PROFILE_ID');
        const player = this.guard.restrictions.players[id];
        if (!player) return false;
        if (!Object.prototype.hasOwnProperty.call(player, 'blockedUntil') && player.expiresAt && Array.isArray(player.rules)) {
            player.rules = player.rules.map(rule => ({ ...rule, expiresAt: rule.expiresAt || player.expiresAt }));
            delete player.expiresAt;
        }
        player.blocked = false;
        player.blockAllPurchases = false;
        player.blockedUntil = null;
        player.blockedStartsAt = null;
        player.updatedAt = new Date().toISOString();
        if (!this.guard.storage.saveRestrictions(this.guard.restrictions)) throw new Error('SAVE_FAILED');
        return true;
    }

    addItemBlock(body) {
        const tpl = String(body.tpl || '').toLowerCase();
        if (!TPL_RE.test(tpl)) throw new Error('INVALID_TPL');
        const previous = this.guard.restrictions.items[tpl] || {};
        const channels = Array.isArray(body.channels) && body.channels.length ? [...new Set(body.channels)] : ['any'];
        if (channels.some(x => !CHANNELS.has(x))) throw new Error('INVALID_CHANNEL');
        this.guard.restrictions.items[tpl] = {
            ...previous,
            blocked: body.blocked !== false,
            reason: String(body.reason || 'Administrator item block').slice(0, 300),
            channels,
            createdAt: previous.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: this.validateExpiry(body.expiresAt)
        };
        if (!this.guard.storage.saveRestrictions(this.guard.restrictions)) throw new Error('SAVE_FAILED');
        return this.guard.restrictions.items[tpl];
    }

    removeItemBlock(tpl) {
        tpl = String(tpl || '').toLowerCase();
        if (!TPL_RE.test(tpl)) throw new Error('INVALID_TPL');
        delete this.guard.restrictions.items[tpl];
        if (!this.guard.storage.saveRestrictions(this.guard.restrictions)) throw new Error('SAVE_FAILED');
        return true;
    }

    addPlayerRule(body) {
        const id = String(body.profileId || '').toLowerCase();
        if (!PROFILE_RE.test(id)) throw new Error('INVALID_PROFILE_ID');
        const tpl = body.tpl ? String(body.tpl).toLowerCase() : null;
        if (tpl && !TPL_RE.test(tpl)) throw new Error('INVALID_TPL');
        const channel = String(body.channel || 'any');
        if (!CHANNELS.has(channel)) throw new Error('INVALID_CHANNEL');
        const rule = {
            ruleId: crypto.randomBytes(8).toString('hex'), tpl, channel,
            traderId: body.traderId ? String(body.traderId) : null,
            block: body.block === true,
            maxPerTransaction: body.maxPerTransaction ? Number(body.maxPerTransaction) : null,
            dailyLimit: body.dailyLimit ? Number(body.dailyLimit) : null,
            expiresAt: this.validateExpiry(body.expiresAt),
            reason: String(body.reason || 'Administrator purchase rule').slice(0, 300)
        };
        for (const key of ['maxPerTransaction', 'dailyLimit']) if (rule[key] !== null && (!Number.isSafeInteger(rule[key]) || rule[key] <= 0)) throw new Error(`INVALID_${key}`);
        const player = this.guard.restrictions.players[id] || { rules: [] };
        player.rules = Array.isArray(player.rules) ? player.rules : [];
        player.rules.push(rule);
        player.updatedAt = new Date().toISOString();
        this.guard.restrictions.players[id] = player;
        if (!this.guard.storage.saveRestrictions(this.guard.restrictions)) throw new Error('SAVE_FAILED');
        return rule;
    }

    removePlayerRule(profileId, ruleId) {
        const id = String(profileId || '').toLowerCase();
        if (!PROFILE_RE.test(id)) throw new Error('INVALID_PROFILE_ID');
        const player = this.guard.restrictions.players[id];
        if (!player) return false;
        player.rules = (player.rules || []).filter(rule => rule.ruleId !== ruleId);
        player.updatedAt = new Date().toISOString();
        if (!this.guard.storage.saveRestrictions(this.guard.restrictions)) throw new Error('SAVE_FAILED');
        return true;
    }


    getOnlinePlayers() {
        const available = this.guard.health.onlinePlayers && this.guard.health.onlinePlayers.available === true;
        const tracked = this.guard.onlinePresence instanceof Map ? this.guard.onlinePresence : new Map();
        const recentIps = this.accessControl && this.accessControl.state && Array.isArray(this.accessControl.state.recentIps)
            ? this.accessControl.state.recentIps : [];
        const activityLabels = {
            0: 'IN MENU', 1: 'IN RAID', 2: 'IN STASH', 3: 'IN HIDEOUT', 4: 'IN FLEA'
        };
        const toIso = value => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric) || numeric <= 0) return null;
            const ms = numeric < 100000000000 ? numeric * 1000 : numeric;
            const date = new Date(ms);
            return Number.isNaN(date.getTime()) ? null : date.toISOString();
        };
        const players = [];
        for (const [profileId, presence] of tracked.entries()) {
            const profile = this.saveServer && typeof this.saveServer.getProfile === 'function'
                ? safeCall(() => this.saveServer.getProfile(profileId), null) : null;
            const pmcInfo = profile && profile.characters && profile.characters.pmc && profile.characters.pmc.Info || {};
            const accountInfo = profile && profile.info || {};
            const ipRows = recentIps.filter(row => String(row.profileId || '').toLowerCase() === String(profileId).toLowerCase());
            ipRows.sort((a, b) => String(b.lastSeen || b.timestamp).localeCompare(String(a.lastSeen || a.timestamp)));
            const ipRecord = ipRows[0] || null;
            const activity = Number(presence.activity);
            const lastPresence = Date.parse(presence.lastPresenceUpdateAt || presence.connectedAt || '');
            const lastHttp = Date.parse(ipRecord && (ipRecord.lastSeen || ipRecord.timestamp) || '');
            const lastSeenAt = new Date(Math.max(Number.isFinite(lastPresence) ? lastPresence : 0, Number.isFinite(lastHttp) ? lastHttp : 0) || Date.now()).toISOString();
            const raid = activity === 1 && presence.raidInformation ? presence.raidInformation : null;
            const sideLabels = { 0: 'PMC', 1: 'Scav' };
            const timeLabels = { 0: 'Current', 1: 'Past' };
            players.push({
                profileId,
                username: String(accountInfo.username || ''),
                nickname: String(presence.nickname || pmcInfo.Nickname || accountInfo.username || 'Unknown'),
                level: Number.isFinite(Number(presence.level)) ? Number(presence.level) : (Number.isFinite(Number(pmcInfo.Level)) ? Number(pmcInfo.Level) : null),
                activity: Number.isFinite(activity) ? activity : null,
                activityLabel: activityLabels[activity] || 'ONLINE',
                connectedAt: presence.connectedAt || null,
                lastSeenAt,
                lastIp: ipRecord && ipRecord.ip || null,
                requestCount: ipRecord ? Number(ipRecord.count || 0) : 0,
                activityStartedAt: toIso(presence.activityStartedTimestamp),
                raid: raid ? { location: String(raid.location || ''), side: raid.side, sideLabel: sideLabels[raid.side] || String(raid.side ?? 'Unknown'), time: raid.time, timeLabel: timeLabels[raid.time] || String(raid.time ?? 'Unknown') } : null
            });
        }
        players.sort((a, b) => String(a.nickname).localeCompare(String(b.nickname)));
        return {
            available,
            source: 'FIKA_NOTIFICATION_WEBSOCKET_PRESENCE',
            count: players.length,
            players,
            hooks: this.guard.health.onlinePlayers && this.guard.health.onlinePlayers.hooks || {},
            updatedAt: new Date().toISOString(),
            note: available ? 'Online means the player has an active Fika notification WebSocket presence.' : 'Fika presence hooks are unavailable; online status cannot be determined reliably.'
        };
    }

    getAccessData() {
        const current = this.accessControl.getStateForPanel();
        const profiles = this.getAccountProfiles();
        return { ...current, accounts: profiles.accounts, editions: profiles.editions, hooks: this.guard.health.accessControl || {} };
    }

    getAccountProfiles() {
        const raw = this.saveServer && typeof this.saveServer.getProfiles === 'function' ? this.saveServer.getProfiles() : {};
        const approved = this.accessControl.state.approvedProfiles || {};
        const bans = this.accessControl.state.bans || {};
        const accounts = Object.entries(raw).map(([profileId, profile]) => {
            const info = profile && profile.info || {};
            const pmc = profile && profile.characters && profile.characters.pmc || {};
            const activeBan = this.accessControl.isBanActive(profileId);
            return {
                profileId,
                username: String(info.username || ''),
                nickname: String(pmc.Info && pmc.Info.Nickname || ''),
                edition: String(info.edition || ''),
                approved: !!approved[profileId],
                banned: activeBan,
                ban: bans[profileId] || null
            };
        }).sort((a, b) => a.username.localeCompare(b.username));
        const connectInfo = this.launcherController && typeof this.launcherController.connect === 'function' ? safeCall(() => this.launcherController.connect(), null) : null;
        const editions = safeArray(connectInfo && connectInfo.editions);
        return { accounts, editions };
    }

    createServerAccount(body) {
        if (!this.launcherController || typeof this.launcherController.register !== 'function' || !this.saveServer || typeof this.saveServer.getProfiles !== 'function' || typeof this.saveServer.getProfile !== 'function') throw new Error('ACCOUNT_PROVISIONING_UNAVAILABLE');
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const edition = String(body.edition || '');
        if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error('INVALID_USERNAME');
        if (password.length < 12 || password.length > 128) throw new Error('INVALID_PASSWORD');
        const options = this.launcherController.connect();
        const editions = safeArray(options && options.editions);
        if (!editions.includes(edition)) throw new Error('INVALID_EDITION');
        const existing = this.saveServer && this.saveServer.getProfiles ? Object.values(this.saveServer.getProfiles()).some(p => p && p.info && p.info.username.toLowerCase() === username.toLowerCase()) : false;
        if (existing) throw new Error('USERNAME_ALREADY_EXISTS');
        return this.launcherController.register({ username, password, edition }).then(profileId => {
            if (!profileId || typeof profileId !== 'string') throw new Error('ACCOUNT_CREATION_FAILED');
            const profile = safeCall(() => this.saveServer.getProfile(profileId), null);
            if (!profile || !profile.info) throw new Error('ACCOUNT_CREATION_NOT_FOUND');
            this.accessControl.approveProfile(profileId, { username, edition, nickname: '', source: 'ADMIN_CREATED' });
            this.accessControl.audit('ADMIN_ACCOUNT_CREATED', { profileId, username, edition });
            return { profileId, username, edition, password, status: 'CREATED' };
        });
    }

    banAccount(body) {
        const id = String(body.profileId || '').toLowerCase();
        const profile = this.saveServer && this.saveServer.getProfile ? safeCall(() => this.saveServer.getProfile(id), null) : null;
        if (!profile) throw new Error('PROFILE_NOT_FOUND');
        const reason = String(body.reason || 'Banned by server administrator.').trim().slice(0, 500);
        return this.accessControl.addBan(id, reason, body.expiresAt || null);
    }

    unbanAccount(profileId) {
        return this.accessControl.removeBan(profileId);
    }

    approveExistingAccount(profileId) {
        const id = String(profileId || '').toLowerCase();
        const profile = this.saveServer && this.saveServer.getProfile ? safeCall(() => this.saveServer.getProfile(id), null) : null;
        if (!profile || !profile.info) throw new Error('PROFILE_NOT_FOUND');
        const info = profile.info;
        const nickname = profile.characters && profile.characters.pmc && profile.characters.pmc.Info && profile.characters.pmc.Info.Nickname || '';
        return this.accessControl.approveProfile(id, { username: info.username, edition: info.edition, nickname, source: 'ADMIN_APPROVED_EXISTING' });
    }

    revokeExistingAccount(profileId) {
        return this.accessControl.revokeProfile(profileId);
    }

    updateAccessSettings(body) {
        const allowed = {
            allowLauncherRegistration: body.allowLauncherRegistration,
            requireApprovedLogin: body.requireApprovedLogin,
            enforceIpAllowlist: body.enforceIpAllowlist,
            allowLoopback: body.allowLoopback,
            allowedIps: body.allowedIps,
            trustedProxyIps: body.trustedProxyIps
        };
        for (const key of Object.keys(allowed)) if (allowed[key] === undefined) delete allowed[key];
        const settings = this.accessControl.updateSettings(allowed);
        this.guard.health.accessControl = {
            ...(this.guard.health.accessControl || {}),
            degraded: this.accessControl.state.degraded === true,
            registrationMode: settings.allowLauncherRegistration ? 'OPEN' : 'ADMIN_CREATED_ONLY',
            approvedLoginRequired: settings.requireApprovedLogin,
            ipAllowlistEnabled: settings.enforceIpAllowlist,
            activeBans: this.accessControl.getStateForPanel().activeBanCount
        };
        this.guard.writeHealth();
        return settings;
    }

    async handle(req, res) {
        if (!this.isLoopback(req)) return this.send(res, 403, { error: 'LOOPBACK_ONLY' });
        const url = new URL(req.url, 'http://127.0.0.1');
        const pathname = url.pathname;
        if (req.method === 'GET' && pathname === '/') return this.serveFile(res, 'index.html');
        if (req.method === 'GET' && pathname === '/app.js') return this.serveFile(res, 'app.js');
        if (req.method === 'GET' && pathname === '/styles.css') return this.serveFile(res, 'styles.css');
        if (req.method === 'GET' && pathname === '/board-admin.js') return this.serveFile(res, 'board-admin.js');
        if (req.method === 'GET' && pathname === '/operations-admin.js') return this.serveFile(res, 'operations-admin.js');
        if (!pathname.startsWith('/api/')) return this.send(res, 404, { error: 'NOT_FOUND' });
        const ip = req.socket.remoteAddress || 'local';
        if (!this.isAuthorized(req)) return this.unauthorized(res, ip);
        try {
            if (req.method === 'GET' && pathname === '/api/summary') return this.send(res, 200, this.getSummary());
            if (req.method === 'GET' && pathname === '/api/health') return this.send(res, 200, this.guard.health);
            if (req.method === 'GET' && pathname === '/api/cases') return this.send(res, 200, this.getCases());
            if (req.method === 'GET' && pathname === '/api/players') return this.send(res, 200, this.getPlayers());
            if (req.method === 'GET' && pathname === '/api/restrictions') return this.send(res, 200, this.guard.restrictions);
            if (req.method === 'GET' && pathname === '/api/config') return this.send(res, 200, { mode: this.guard.config.mode, notifications: this.guard.config.notifications, price: this.guard.config.price });
            if (req.method === 'GET' && pathname === '/api/access') return this.send(res, 200, this.getAccessData());
            if (req.method === 'GET' && pathname === '/api/online') return this.send(res, 200, this.getOnlinePlayers());
            if (req.method === 'GET' && pathname === '/api/board') return this.send(res, 200, this.requireBoard().getAdminState());
            if (req.method === 'GET' && pathname === '/api/operations') return this.send(res, 200, this.requireOperations().list());
            if (req.method === 'GET' && pathname === '/api/operations/awards') return this.send(res, 200, this.requireOperations().state.awards.slice(-500).reverse());
            if (req.method === 'GET' && pathname === '/api/operations/reviews') {
                const operations = this.requireOperations();
                const queue = operations.reviewQueue();
                const events = this.fikaOperationsAdapter && typeof this.fikaOperationsAdapter.getRecentEvents === 'function'
                    ? this.fikaOperationsAdapter.getRecentEvents(500) : [];
                return this.send(res, 200, queue.map(group => {
                    const mission = ((operations.state && operations.state.missions) || []).find(item => item.id === group.missionId);
                    const fikaEvidence = events.filter(event => event.groupId
                        ? String(event.groupId) === String(group.id)
                        : (!!group.raidId && String(event.matchId || '') === String(group.raidId)));
                    const raidEnds = fikaEvidence.filter(event => event.type === 'player_raid_end');
                    const victims = raidEnds.flatMap(event => event.reportedVictims || []);
                    const normalizeRole = role => {
                        const value = String(role || '').toLowerCase();
                        if (value.startsWith('pmc')) return 'pmc';
                        if (value === 'assault' || value === 'marksman' || value === 'cursedassault' || value.includes('scav')) return 'scav';
                        if (value.startsWith('boss')) return 'boss';
                        if (value.includes('follower')) return 'boss_guard';
                        if (value.includes('raider')) return 'raider';
                        if (value.includes('rogue') || value === 'exusec') return 'rogue';
                        if (value.includes('cultist') || value.startsWith('sectant')) return 'cultist';
                        return value;
                    };
                    const objectiveEvidence = (mission && mission.objectives || []).map(objective => {
                        const target = String(objective.target || '').toLowerCase();
                        let reportedCount = 0;
                        if (objective.type === 'kill' || objective.type === 'kill_type') {
                            reportedCount = victims.filter(victim => !target || normalizeRole(victim.role) === target
                                || String(victim.role || '').toLowerCase() === target).length;
                        } else if (objective.type === 'collect') {
                            reportedCount = raidEnds.reduce((sum, event) => {
                                const loot = event.reportedLootByTpl || {};
                                const tpl = Object.keys(loot).find(key => key.toLowerCase() === target);
                                return sum + Number(tpl ? loot[tpl] : 0);
                            }, 0);
                        } else if (objective.type === 'extract' || objective.type === 'survive') {
                            const seen = new Set();
                            for (const event of raidEnds) {
                                const exitMatches = objective.type === 'survive' || !target || String(event.exitName || '').toLowerCase() === target;
                                if (exitMatches && String(event.exitStatus || '').toLowerCase() === 'survived') seen.add(String(event.profileId || event.displayName || 'unknown'));
                            }
                            reportedCount = seen.size;
                        } else if (objective.type === 'raid_complete') {
                            reportedCount = fikaEvidence.filter(event => event.type === 'fika_match_end').length;
                        }
                        const verifiedCount = Number((group.progress || {})[objective.id] || 0);
                        return {
                            objectiveId: objective.id,
                            type: objective.type,
                            target: objective.target || '',
                            requiredCount: objective.count,
                            required: objective.required !== false,
                            verifiedCount,
                            reportedCount,
                            evidenceStatus: verifiedCount >= objective.count ? 'server_verified' : reportedCount > 0 && objective.type === 'raid_complete' ? 'fika_lifecycle_observed_unverified' : reportedCount > 0 ? 'client_report_only' : 'no_evidence'
                        };
                    });
                    return {
                        ...group,
                        missionTitle: mission ? mission.title : group.missionId,
                        fikaEvidence,
                        objectiveEvidence
                    };
                }));
            }
            if (req.method === 'GET' && pathname === '/api/operations/fika') return this.send(res, 200, this.fikaOperationsAdapter ? { status: this.fikaOperationsAdapter.getStatus(), events: this.fikaOperationsAdapter.getRecentEvents(150) } : { status: { detected: false, enabled: false, reason: 'OPERATIONS_OR_FIKA_ADAPTER_DISABLED' }, events: [] });
            if (req.method === 'GET' && pathname === '/api/operations/leaderboard') {
                const operations = this.requireOperations();
                const names = new Map();
                try {
                    const profiles = this.saveServer && typeof this.saveServer.getProfiles === 'function' ? this.saveServer.getProfiles() : {};
                    for (const profile of Object.values(profiles || {})) {
                        const characters = profile && profile.characters || {};
                        const pmc = characters.pmc || {};
                        const scav = characters.scav || {};
                        const info = profile && profile.info || {};
                        const displayName = String((pmc.Info && pmc.Info.Nickname) || (scav.Info && scav.Info.Nickname) || info.Nickname || info.username || 'Unknown operator').slice(0, 40);
                        if (pmc._id) names.set(String(pmc._id), displayName);
                        if (scav._id) names.set(String(scav._id), displayName);
                    }
                } catch (err) { this.log('warn', `Could not resolve leaderboard display names: ${err.message}`); }
                const rows = Object.keys(operations.state.playerStats).map(profileId => {
                    const player = operations.getPlayer(profileId);
                    return { displayName: names.get(profileId) || 'Unknown operator', rank: player.rank, points: player.points, completedMissions: player.completedMissions };
                }).sort((a, b) => b.points - a.points).slice(0, 200);
                return this.send(res, 200, rows);
            }
            if (req.method === 'GET' && pathname === '/api/activity') return this.send(res, 200, {
                audit: this.readRecent(this.guard.storage.auditDir, /^audit-.*\.jsonl$/i, 1000).reverse(),
                ledger: this.readRecent(this.guard.storage.ledgerDir, /^ledger-.*\.jsonl$/i, 1000).reverse()
            });
            if (req.method === 'POST') {
                const body = await this.readBody(req);
                if (pathname === '/api/operations/save') return this.send(res, 200, { ok: true, mission: this.requireOperations().save(body) });
                if (pathname === '/api/operations/publish') { const o = this.requireOperations(); const draft = o.get(body.id); if (!draft || draft.status !== 'draft') throw new Error('MISSION_NOT_FOUND'); let announcement = null; try { if (this.board) announcement = this.board.saveNews({ title: draft.title, text: draft.description.slice(0,400), kind: 'event', enabled: true, startsAt: draft.startAt, endsAt: draft.endAt, media: { source: 'none', value: '' } }); if (announcement) o.setAnnouncementId(body.id, announcement.id); const mission = o.setStatus(body.id, 'published'); return this.send(res, 200, { ok: true, mission, announcement }); } catch (err) { if (announcement && this.board) { try { this.board.deleteNews(announcement.id); } catch (_) { /* retain original publish error */ } try { o.setAnnouncementId(body.id, null); } catch (_) { /* retain original publish error */ } } throw err; } }
                if (pathname === '/api/operations/close') { const o = this.requireOperations(); const current = o.get(body.id); if (!current) throw new Error('MISSION_NOT_FOUND'); let event = null; if (this.board && current.announcementId && this.board.store) event = this.board.store.listNews().find(x => x.id === current.announcementId) || null; if (event) this.board.saveNews({ ...event, enabled: false }); try { const mission = o.setStatus(body.id, 'closed'); return this.send(res, 200, { ok: true, mission }); } catch (err) { if (event) { try { this.board.saveNews({ ...event, enabled: true }); } catch (_) { /* preserve original lifecycle error */ } } throw err; } }
                if (pathname === '/api/operations/delivery/reconcile') { if (!this.rewardDelivery) throw new Error('REWARD_DELIVERY_UNAVAILABLE'); const result = this.rewardDelivery.reconcileAward(body.awardId, body.decision, body.note, 'ADMIN'); return this.send(res, 200, { ok: true, delivery: result }); }
                if (pathname === '/api/operations/review') { const result = this.requireOperations().resolveReview(body.groupId, body.decision, body.note, 'ADMIN', body.attestation || {}); const delivery = body.decision === 'approve' && this.rewardDelivery ? this.rewardDelivery.deliverGroup(result.id) : []; return this.send(res, 200, { ok: true, group: result, delivery }); }
                if (pathname === '/api/board/settings') return this.send(res, 200, { ok: true, board: await this.requireBoard().applyAdminUpdate(body) });
                if (pathname === '/api/board/news') { const b = this.requireBoard(); if (body.op === 'delete') b.deleteNews(body.id); else b.saveNews(body.item); return this.send(res, 200, { ok: true, board: b.getAdminState() }); }
                if (pathname === '/api/board/hide') { const b = this.requireBoard(); b.setHidden(body.profileId, body.hidden === true); return this.send(res, 200, { ok: true, board: b.getAdminState() }); }
                if (pathname === '/api/board/reset-pmc') { const b = this.requireBoard(); b.resetPmcStats(); return this.send(res, 200, { ok: true, board: b.getAdminState() }); }
                if (pathname === '/api/access/account') return this.send(res, 200, { ok: true, account: await this.createServerAccount(body) });
                if (pathname === '/api/access/ban') return this.send(res, 200, { ok: true, ban: this.banAccount(body) });
                if (pathname === '/api/access/unban') return this.send(res, 200, { ok: this.unbanAccount(body.profileId) });
                if (pathname === '/api/access/approve') return this.send(res, 200, { ok: true, approval: this.approveExistingAccount(body.profileId) });
                if (pathname === '/api/access/revoke') return this.send(res, 200, { ok: this.revokeExistingAccount(body.profileId) });
                if (pathname === '/api/access/settings') return this.send(res, 200, { ok: true, settings: this.updateAccessSettings(body) });
                if (pathname === '/api/restrictions/player') return this.send(res, 200, { ok: true, player: this.addPlayerBlock(body) });
                if (pathname === '/api/restrictions/player/remove') return this.send(res, 200, { ok: this.removePlayerBlock(body.profileId) });
                if (pathname === '/api/restrictions/item') return this.send(res, 200, { ok: true, item: this.addItemBlock(body) });
                if (pathname === '/api/restrictions/item/remove') return this.send(res, 200, { ok: this.removeItemBlock(body.tpl) });
                if (pathname === '/api/restrictions/rule') return this.send(res, 200, { ok: true, rule: this.addPlayerRule(body) });
                if (pathname === '/api/restrictions/rule/remove') return this.send(res, 200, { ok: this.removePlayerRule(body.profileId, body.ruleId) });
                if (pathname === '/api/config') return this.send(res, 200, { ok: true, config: this.saveConfigPatch(body) });
                if (pathname === '/api/cases/resolve') {
                    const caseId = String(body.caseId || '');
                    const status = String(body.status || 'RESOLVED').toUpperCase();
                    if (!['OPEN', 'PENDING', 'RESOLVED', 'DISMISSED'].includes(status)) throw new Error('INVALID_CASE_STATUS');
                    const record = this.guard.storage.updateCase(caseId, { status, resolution: String(body.resolution || '').slice(0, 1000), resolvedBy: 'ADMIN_PANEL' });
                    if (!record) throw new Error('CASE_NOT_FOUND');
                    return this.send(res, 200, { ok: true, case: record });
                }
            }
            return this.send(res, 404, { error: 'NOT_FOUND' });
        } catch (err) {
            const known = ['INVALID_PROFILE_ID', 'INVALID_TPL', 'INVALID_CHANNEL', 'INVALID_EXPIRY', 'INVALID_MODE', 'INVALID_NOTIFICATIONS', 'INVALID_MESSAGES', 'INVALID_MESSAGE_ENTRY', 'INVALID_PRICE_SETTINGS', 'INVALID_CASE_STATUS', 'CASE_NOT_FOUND', 'BODY_TOO_LARGE', 'INVALID_JSON', 'INVALID_USERNAME', 'INVALID_PASSWORD', 'INVALID_EDITION', 'USERNAME_ALREADY_EXISTS', 'ACCOUNT_CREATION_FAILED', 'ACCOUNT_CREATION_NOT_FOUND', 'ACCOUNT_PROVISIONING_UNAVAILABLE', 'PROFILE_NOT_FOUND', 'INVALID_IP_LIST', 'INVALID_IP_ENTRY', 'IP_ALLOWLIST_EMPTY', 'SAVE_FAILED', 'MISSION_NOT_FOUND', 'MISSION_NOT_EDITABLE', 'MISSION_UNAVAILABLE', 'GROUP_FULL', 'GROUP_NOT_FOUND', 'NOT_GROUP_MEMBER', 'GROUP_NOT_READY', 'RAID_NOT_ACTIVE', 'OPERATIONS_UNAVAILABLE', 'INVALID_MISSION', 'INVALID_TITLE', 'INVALID_DESCRIPTION', 'INVALID_MAP', 'INVALID_MODE', 'INVALID_MIN_PLAYERS', 'INVALID_MAX_PLAYERS', 'INVALID_OBJECTIVES', 'INVALID_REWARD_POINTS', 'INVALID_REWARD_ROUBLES', 'INVALID_REWARD_TPL', 'INVALID_REWARD_ITEM_COUNT', 'INVALID_START_AT', 'INVALID_END_AT', 'MISSION_NOT_READY'];
            const status = known.includes(err.message) || String(err.message).startsWith('INVALID_') || String(err.message).startsWith('BOARD_') || String(err.message).startsWith('NEWS_') ? 400 : 500;
            this.log(status === 500 ? 'error' : 'warn', `Admin API ${pathname}: ${err.message}`);
            return this.send(res, status, { error: err.message || 'INTERNAL_ERROR' });
        }
    }

    requireOperations() {
        if (!this.operations) throw new Error('OPERATIONS_UNAVAILABLE');
        return this.operations;
    }

    requireBoard() {
        if (!this.board) throw new Error('BOARD_UNAVAILABLE');
        return this.board;
    }

    serveFile(res, name) {
        const map = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'styles.css': 'text/css; charset=utf-8', 'board-admin.js': 'text/javascript; charset=utf-8', 'operations-admin.js': 'text/javascript; charset=utf-8' };
        const type = map[name];
        if (!type) return this.send(res, 404, 'Not found', 'text/plain; charset=utf-8');
        try {
            const body = fs.readFileSync(path.join(this.webDir, name));
            res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'" });
            res.end(body);
        } catch (err) { this.send(res, 500, { error: `PANEL_FILE_ERROR: ${err.message}` }); }
    }
}

module.exports = { AdminPanelServer };
