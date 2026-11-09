'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { cleanName, DEFAULT_SCORE_WEIGHTS } = require('./core');

const PROFILE_RE = /^[a-f0-9]{24}$/i;
const MEDIA_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const SECTION_KEYS = ['leaderboard', 'online', 'raids', 'market', 'trades', 'feed'];
const MAX_PMC_ENTRIES = 3000;
const MAX_NEWS = 40;
const NEWS_KINDS = ['news', 'update', 'event', 'alert'];
const BRAND_RE = /economy\s*guard/i;
const CARD_IDS = ['fleaOffers', 'raidsCompleted', 'totalKills', 'registeredPlayers', 'activeRaids'];
const TAB_IDS = ['leaderboard', 'online', 'raids', 'market', 'activity'];
const TOP_IDS = ['announcements', 'cards'];

function defaultLayout() {
    const list = (ids, on) => ids.map(id => ({ id, enabled: on.includes(id) }));
    return {
        top: list(TOP_IDS, TOP_IDS),
        cards: list(CARD_IDS, ['fleaOffers']),
        headerLines: list(CARD_IDS, ['raidsCompleted']),
        tabs: TAB_IDS.slice()
    };
}

// Ordered list of {id, enabled}. Unknown ids and duplicates are dropped; ids that are missing are appended
// with their current (or default) state, so an old saved layout keeps working after new widgets are added.
function sanitizeToggleList(input, allowed, fallback) {
    if (!Array.isArray(input)) fail('INVALID_BOARD_LAYOUT');
    const out = [], seen = new Set();
    for (const item of input) {
        const id = item && typeof item === 'object' ? item.id : item;
        if (!allowed.includes(id) || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, enabled: item && item.enabled === true });
    }
    for (const id of allowed) if (!seen.has(id)) out.push({ id, enabled: (fallback.find(f => f.id === id) || { enabled: false }).enabled });
    return out;
}
function sanitizeOrder(input, allowed) {
    if (!Array.isArray(input)) fail('INVALID_BOARD_LAYOUT');
    const out = input.filter((id, i) => allowed.includes(id) && input.indexOf(id) === i);
    for (const id of allowed) if (!out.includes(id)) out.push(id);
    return out;
}
function sanitizeLayout(input, current) {
    if (!input || typeof input !== 'object') fail('INVALID_BOARD_LAYOUT');
    const base = current || defaultLayout();
    const next = JSON.parse(JSON.stringify(base));
    if (input.top !== undefined) next.top = sanitizeToggleList(input.top, TOP_IDS, base.top);
    if (input.cards !== undefined) next.cards = sanitizeToggleList(input.cards, CARD_IDS, base.cards);
    if (input.headerLines !== undefined) next.headerLines = sanitizeToggleList(input.headerLines, CARD_IDS, base.headerLines);
    if (input.tabs !== undefined) next.tabs = sanitizeOrder(input.tabs, TAB_IDS);
    return next;
}
const MAX_EVENTS = 300;

function defaultSettings(seed = {}) {
    return {
        enabled: seed.enabled !== false,
        host: typeof seed.host === 'string' && seed.host ? seed.host : '0.0.0.0',
        port: Number.isInteger(seed.port) ? seed.port : 1234,
        serverName: 'Bronson Server',
        tagline: 'Live server status',
        language: 'en',
        allowLanguageSwitch: true,
        accent: '#e7b45b',
        refreshSeconds: 10,
        background: { source: 'none', value: '', overlay: 0.55 },
        sections: Object.fromEntries(SECTION_KEYS.map(k => [k, true])),
        showPmc: true,
        showPmcBadge: false,
        onlineIncludesMarket: true,
        layout: defaultLayout(),
        showMarketTraders: true,
        marketTradersLimit: 40,
        leaderboardLimit: 200,
        hideBanned: true,
        hiddenProfiles: {},
        score: { ...DEFAULT_SCORE_WEIGHTS },
        raidTtlMinutes: 60
    };
}

function fail(code) { throw new Error(code); }

function validateHost(value) {
    const host = String(value || '').trim();
    if (host === 'auto' || host === 'localhost' || net.isIP(host)) return host;
    return fail('INVALID_BOARD_HOST');
}
function validatePort(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('INVALID_BOARD_PORT');
    return port;
}

// Validates a settings patch against the current settings. Unknown keys are ignored; invalid values throw.
function applySettingsPatch(current, patch, reservedPorts = []) {
    const next = JSON.parse(JSON.stringify(current));
    const p = patch || {};
    if (p.enabled !== undefined) next.enabled = p.enabled === true;
    if (p.host !== undefined) next.host = validateHost(p.host);
    if (p.port !== undefined) {
        next.port = validatePort(p.port);
        if (reservedPorts.includes(next.port)) fail('BOARD_PORT_RESERVED');
    }
    if (p.serverName !== undefined) {
        const name = cleanName(p.serverName, 40);
        if (!name) fail('INVALID_BOARD_NAME');
        if (/economy\s*guard/i.test(name)) fail('BOARD_NAME_NOT_ALLOWED');
        next.serverName = name;
    }
    if (p.tagline !== undefined) {
        const tagline = cleanName(p.tagline, 90);
        if (/economy\s*guard/i.test(tagline)) fail('BOARD_NAME_NOT_ALLOWED');
        next.tagline = tagline;
    }
    if (p.language !== undefined) { if (!['en', 'fa'].includes(p.language)) fail('INVALID_BOARD_LANGUAGE'); next.language = p.language; }
    if (p.allowLanguageSwitch !== undefined) next.allowLanguageSwitch = p.allowLanguageSwitch === true;
    if (p.accent !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(String(p.accent))) fail('INVALID_BOARD_ACCENT'); next.accent = String(p.accent).toLowerCase(); }
    if (p.refreshSeconds !== undefined) { const v = Number(p.refreshSeconds); if (!Number.isInteger(v) || v < 5 || v > 120) fail('INVALID_BOARD_REFRESH'); next.refreshSeconds = v; }
    if (p.background !== undefined) {
        const b = p.background || {};
        const source = b.source === undefined ? next.background.source : b.source;
        if (!['none', 'media', 'path'].includes(source)) fail('INVALID_BOARD_BACKGROUND');
        const value = b.value === undefined ? next.background.value : String(b.value || '').trim().replace(/^"(.*)"$/, '$1');
        if (value.length > 500 || /[\u0000-\u001f]/.test(value)) fail('INVALID_BOARD_BACKGROUND');
        if (source !== 'none' && !MEDIA_EXT[path.extname(value).toLowerCase()]) fail('INVALID_BOARD_BACKGROUND_TYPE');
        if (source === 'media' && value !== path.basename(value)) fail('INVALID_BOARD_BACKGROUND');
        const overlay = b.overlay === undefined ? next.background.overlay : Number(b.overlay);
        if (!Number.isFinite(overlay) || overlay < 0 || overlay > 0.9) fail('INVALID_BOARD_BACKGROUND');
        next.background = { source, value: source === 'none' ? '' : value, overlay };
    }
    if (p.sections !== undefined) {
        if (!p.sections || typeof p.sections !== 'object') fail('INVALID_BOARD_SECTIONS');
        for (const key of SECTION_KEYS) if (p.sections[key] !== undefined) next.sections[key] = p.sections[key] === true;
    }
    for (const key of ['showPmc', 'showPmcBadge', 'onlineIncludesMarket', 'showMarketTraders', 'hideBanned']) if (p[key] !== undefined) next[key] = p[key] === true;
    if (p.layout !== undefined) next.layout = sanitizeLayout(p.layout, current.layout);
    if (p.marketTradersLimit !== undefined) { const v = Number(p.marketTradersLimit); if (!Number.isInteger(v) || v < 0 || v > 200) fail('INVALID_BOARD_LIMIT'); next.marketTradersLimit = v; }
    if (p.leaderboardLimit !== undefined) { const v = Number(p.leaderboardLimit); if (!Number.isInteger(v) || v < 10 || v > 500) fail('INVALID_BOARD_LIMIT'); next.leaderboardLimit = v; }
    if (p.raidTtlMinutes !== undefined) { const v = Number(p.raidTtlMinutes); if (!Number.isInteger(v) || v < 5 || v > 240) fail('INVALID_BOARD_TTL'); next.raidTtlMinutes = v; }
    if (p.score !== undefined) {
        if (!p.score || typeof p.score !== 'object') fail('INVALID_BOARD_SCORE');
        for (const key of Object.keys(DEFAULT_SCORE_WEIGHTS)) {
            if (p.score[key] === undefined) continue;
            const v = Number(p.score[key]);
            if (!Number.isFinite(v) || v < 0 || v > 10000) fail('INVALID_BOARD_SCORE');
            next.score[key] = v;
        }
    }
    return next;
}

function validateMedia(media, previous) {
    const m = media === undefined ? previous : media;
    if (!m || m.source === undefined || m.source === 'none') return { source: 'none', value: '' };
    if (!['media', 'path'].includes(m.source)) fail('INVALID_BOARD_BACKGROUND');
    const value = String(m.value || '').trim().replace(/^"(.*)"$/, '$1');
    if (!value || value.length > 500 || /[\u0000-\u001f]/.test(value)) fail('INVALID_BOARD_BACKGROUND');
    if (!MEDIA_EXT[path.extname(value).toLowerCase()]) fail('INVALID_BOARD_BACKGROUND_TYPE');
    if (m.source === 'media' && value !== path.basename(value)) fail('INVALID_BOARD_BACKGROUND');
    return { source: m.source, value };
}

function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const t = Date.parse(value);
    if (!Number.isFinite(t)) fail('INVALID_NEWS_DATE');
    return new Date(t).toISOString();
}

// Validates one announcement. `existing` is the stored record when editing, so omitted fields keep their value.
function normalizeAnnouncement(input, existing) {
    if (!input || typeof input !== 'object') fail('INVALID_NEWS');
    const prev = existing || {};
    const pick = (key, fallback) => input[key] === undefined ? (prev[key] === undefined ? fallback : prev[key]) : input[key];
    const title = cleanName(pick('title', ''), 80);
    if (!title) fail('INVALID_NEWS_TITLE');
    const text = String(pick('text', '') || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 400);
    if (BRAND_RE.test(title) || BRAND_RE.test(text)) fail('BOARD_NAME_NOT_ALLOWED');
    const kind = pick('kind', 'news');
    if (!NEWS_KINDS.includes(kind)) fail('INVALID_NEWS_KIND');
    const startsAt = parseDate(pick('startsAt', null));
    const endsAt = parseDate(pick('endsAt', null));
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) fail('INVALID_NEWS_DATE');
    let link = null;
    const rawLink = pick('link', null);
    if (rawLink && (rawLink.url || rawLink.label)) {
        const url = String(rawLink.url || '').trim();
        let parsed; try { parsed = new URL(url); } catch (_) { fail('INVALID_NEWS_LINK'); }
        if (!['http:', 'https:'].includes(parsed.protocol) || url.length > 300) fail('INVALID_NEWS_LINK');
        const label = cleanName(rawLink.label || 'Learn more', 30) || 'Learn more';
        if (BRAND_RE.test(label)) fail('BOARD_NAME_NOT_ALLOWED');
        link = { label, url: parsed.toString() };
    }
    const now = new Date().toISOString();
    return {
        id: prev.id || crypto.randomBytes(5).toString('hex'), title, text, kind, enabled: pick('enabled', true) === true,
        startsAt, endsAt, link, media: validateMedia(input.media, prev.media), createdAt: prev.createdAt || now, updatedAt: now
    };
}

function readJson(file, fallback, logger) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        try { fs.renameSync(file, `${file}.corrupt-${Date.now()}.bak`); } catch (_) { /* keep going with defaults */ }
        if (logger) logger.warn(`[StatusBoard] ${path.basename(file)} was unreadable and was moved aside: ${err.message}`);
        return fallback;
    }
}

function writeJsonAtomic(file, data) {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temp, file);
}

class BoardStore {
    constructor(baseDir, seed, logger) {
        this.logger = logger || console;
        this.dir = path.join(baseDir, 'statusboard');
        this.mediaDir = path.join(this.dir, 'media');
        fs.mkdirSync(this.mediaDir, { recursive: true });
        this.settingsFile = path.join(this.dir, 'settings.json');
        this.registryFile = path.join(this.dir, 'pmc-registry.json');
        this.eventsFile = path.join(this.dir, 'events.json');
        this.newsFile = path.join(this.dir, 'announcements.json');
        this.secretFile = path.join(this.dir, 'secret.key');
        const saved = readJson(this.settingsFile, null, this.logger);
        const base = defaultSettings(seed);
        this.settings = saved && typeof saved === 'object' ? this.mergeSaved(base, saved) : base;
        this.secret = this.loadSecret();
        const registry = readJson(this.registryFile, { version: 1, pmcs: {} }, this.logger);
        this.registry = registry && registry.pmcs && typeof registry.pmcs === 'object' ? registry : { version: 1, pmcs: {} };
        const events = readJson(this.eventsFile, [], this.logger);
        this.events = Array.isArray(events) ? events.slice(-MAX_EVENTS) : [];
        const news = readJson(this.newsFile, [], this.logger);
        this.news = Array.isArray(news) ? news.filter(n => n && typeof n.id === 'string' && /^[a-f0-9]{10}$/.test(n.id)).slice(0, MAX_NEWS) : [];
        this.timers = new Map();
        if (!saved) this.saveSettings();
    }

    mergeSaved(base, saved) {
        try { return { ...applySettingsPatch(base, { ...saved, hiddenProfiles: undefined }), hiddenProfiles: this.cleanHidden(saved.hiddenProfiles) }; }
        catch (err) {
            this.logger.warn(`[StatusBoard] Saved settings contain an invalid value (${err.message}); defaults were restored for the affected fields.`);
            const safe = { ...base, hiddenProfiles: this.cleanHidden(saved.hiddenProfiles) };
            for (const key of Object.keys(saved)) {
                try { Object.assign(safe, applySettingsPatch(safe, { [key]: saved[key] }), { hiddenProfiles: safe.hiddenProfiles }); } catch (_) { /* skip bad key */ }
            }
            return safe;
        }
    }

    cleanHidden(value) {
        const out = {};
        for (const id of Object.keys(value && typeof value === 'object' ? value : {})) if (PROFILE_RE.test(id) && value[id]) out[id.toLowerCase()] = true;
        return out;
    }

    loadSecret() {
        try {
            if (fs.existsSync(this.secretFile)) {
                const existing = fs.readFileSync(this.secretFile, 'utf8').trim();
                if (/^[a-f0-9]{64}$/.test(existing)) return existing;
            }
        } catch (_) { /* generate below */ }
        const secret = crypto.randomBytes(32).toString('hex');
        try { fs.writeFileSync(this.secretFile, `${secret}\n`, { encoding: 'utf8', mode: 0o600 }); } catch (err) { this.logger.warn(`[StatusBoard] Could not persist the anonymisation key: ${err.message}`); }
        return secret;
    }

    saveSettings() { try { writeJsonAtomic(this.settingsFile, this.settings); return true; } catch (err) { this.logger.error(`[StatusBoard] Could not save settings: ${err.message}`); return false; } }

    updateSettings(patch, reservedPorts) {
        const next = applySettingsPatch(this.settings, patch, reservedPorts);
        const previous = this.settings;
        this.settings = next;
        if (!this.saveSettings()) { this.settings = previous; fail('SAVE_FAILED'); }
        return this.settings;
    }

    setHidden(profileId, hidden) {
        const id = String(profileId || '').toLowerCase();
        if (!PROFILE_RE.test(id)) fail('INVALID_PROFILE_ID');
        if (hidden) this.settings.hiddenProfiles[id] = true; else delete this.settings.hiddenProfiles[id];
        if (!this.saveSettings()) fail('SAVE_FAILED');
        return Object.keys(this.settings.hiddenProfiles);
    }

    schedule(name, fn, delayMs = 4000) {
        if (this.timers.has(name)) return;
        const timer = setTimeout(() => { this.timers.delete(name); try { fn(); } catch (err) { this.logger.warn(`[StatusBoard] Deferred write ${name} failed: ${err.message}`); } }, delayMs);
        if (timer.unref) timer.unref();
        this.timers.set(name, timer);
    }

    saveRegistry() {
        const entries = Object.entries(this.registry.pmcs);
        if (entries.length > MAX_PMC_ENTRIES) {
            entries.sort((a, b) => Number(b[1].lastSeen || 0) - Number(a[1].lastSeen || 0));
            this.registry.pmcs = Object.fromEntries(entries.slice(0, MAX_PMC_ENTRIES));
        }
        writeJsonAtomic(this.registryFile, this.registry);
    }
    markRegistryDirty() { this.schedule('registry', () => this.saveRegistry()); }

    addEvent(event) {
        this.events.push(event);
        if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
        this.schedule('events', () => writeJsonAtomic(this.eventsFile, this.events));
    }

    flush() {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        try { this.saveRegistry(); writeJsonAtomic(this.eventsFile, this.events); } catch (err) { this.logger.warn(`[StatusBoard] Flush failed: ${err.message}`); }
    }

    // ---- announcements -----------------------------------------------------------------------------------
    listNews() { return this.news.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }

    saveNews(input) {
        const existing = input && input.id ? this.news.find(n => n.id === String(input.id)) : null;
        if (input && input.id && !existing) fail('NEWS_NOT_FOUND');
        if (!existing && this.news.length >= MAX_NEWS) fail('BOARD_TOO_MANY_NEWS');
        const item = normalizeAnnouncement(input, existing);
        const next = existing ? this.news.map(n => n.id === item.id ? item : n) : this.news.concat(item);
        const previous = this.news;
        this.news = next;
        try { writeJsonAtomic(this.newsFile, this.news); } catch (err) { this.news = previous; this.logger.error(`[StatusBoard] Could not save announcements: ${err.message}`); fail('SAVE_FAILED'); }
        return item;
    }

    deleteNews(id) {
        const previous = this.news;
        if (!previous.some(n => n.id === String(id))) fail('NEWS_NOT_FOUND');
        this.news = previous.filter(n => n.id !== String(id));
        try { writeJsonAtomic(this.newsFile, this.news); } catch (err) { this.news = previous; fail('SAVE_FAILED'); }
        return true;
    }

    activeNews(now = Date.now()) {
        return this.news.filter(n => n.enabled && (!n.startsAt || Date.parse(n.startsAt) <= now) && (!n.endsAt || now < Date.parse(n.endsAt)))
            .sort((a, b) => Date.parse(b.startsAt || b.createdAt) - Date.parse(a.startsAt || a.createdAt));
    }

    resolveMedia(media) {
        if (!media || media.source === 'none' || !media.value) return null;
        const type = MEDIA_EXT[path.extname(media.value).toLowerCase()];
        if (!type) return null;
        const file = media.source === 'media' ? path.join(this.mediaDir, path.basename(media.value)) : path.resolve(media.value);
        try { return fs.statSync(file).isFile() ? { file, type, kind: type.startsWith('video') ? 'video' : 'image' } : null; } catch (_) { return null; }
    }

    // Only announcements that are currently public can have their media fetched.
    resolveNewsMedia(id, now = Date.now()) {
        const item = this.activeNews(now).find(n => n.id === String(id));
        return item ? this.resolveMedia(item.media) : null;
    }

    resetPmcStats() { this.registry = { version: 1, pmcs: {} }; this.saveRegistry(); }

    listMedia() {
        try {
            return fs.readdirSync(this.mediaDir).filter(n => MEDIA_EXT[path.extname(n).toLowerCase()]).sort();
        } catch (_) { return []; }
    }

    // Resolves the configured background to an absolute file path, or null. Only whitelisted media types are served.
    resolveBackground() { return this.resolveMedia(this.settings.background); }
}

module.exports = { BoardStore, applySettingsPatch, defaultSettings, defaultLayout, sanitizeLayout, normalizeAnnouncement, MEDIA_EXT, SECTION_KEYS, PROFILE_RE, NEWS_KINDS, CARD_IDS, TAB_IDS };
