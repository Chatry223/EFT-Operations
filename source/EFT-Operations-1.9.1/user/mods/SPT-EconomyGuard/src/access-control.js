'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');

const PROFILE_RE = /^[a-f0-9]{24}$/i;
const DEFAULT_STATE = {
    schema: 1,
    degraded: false,
    settings: {
        allowLauncherRegistration: false,
        requireApprovedLogin: false,
        enforceIpAllowlist: false,
        allowLoopback: true,
        allowedIps: [],
        trustedProxyIps: []
    },
    bans: {},
    approvedProfiles: {},
    recentIps: [],
    audit: []
};

function normalizeIp(value) {
    let ip = String(value || '').trim();
    if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
    if (ip.startsWith('::ffff:')) {
        const mapped = ip.slice(7);
        if (net.isIP(mapped) === 4) return mapped;
    }
    return ip.toLowerCase();
}

function ipv4ToBigInt(ip) {
    if (net.isIP(ip) !== 4) return null;
    const parts = ip.split('.').map(Number);
    return parts.reduce((n, part) => (n << 8n) | BigInt(part), 0n);
}

function ipv6ToBigInt(ip) {
    ip = normalizeIp(ip).split('%')[0];
    if (net.isIP(ip) !== 6) return null;
    if (ip.includes('.')) {
        const lastColon = ip.lastIndexOf(':');
        const v4 = ip.slice(lastColon + 1);
        const n = ipv4ToBigInt(v4);
        if (n === null) return null;
        const high = Number((n >> 16n) & 0xffffn).toString(16);
        const low = Number(n & 0xffffn).toString(16);
        ip = `${ip.slice(0, lastColon + 1)}${high}:${low}`;
    }
    const split = ip.split('::');
    if (split.length > 2) return null;
    const left = split[0] ? split[0].split(':') : [];
    const right = split.length === 2 && split[1] ? split[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if ((split.length === 1 && missing !== 0) || (split.length === 2 && missing < 1)) return null;
    const groups = [...left, ...Array(missing).fill('0'), ...right];
    if (groups.length !== 8 || groups.some(x => !/^[0-9a-f]{1,4}$/i.test(x))) return null;
    return groups.reduce((n, group) => (n << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function ipMatchesCidr(ip, rule) {
    const normalizedIp = normalizeIp(ip);
    const value = String(rule || '').trim();
    if (!value) return false;
    const slash = value.indexOf('/');
    if (slash < 0) return normalizedIp === normalizeIp(value);
    const base = normalizeIp(value.slice(0, slash));
    const prefixText = value.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixText)) return false;
    const prefix = Number(prefixText);
    const version = net.isIP(base);
    if (version === 4 && net.isIP(normalizedIp) === 4) {
        if (prefix < 0 || prefix > 32) return false;
        const a = ipv4ToBigInt(normalizedIp), b = ipv4ToBigInt(base);
        if (a === null || b === null) return false;
        const shift = BigInt(32 - prefix);
        return (a >> shift) === (b >> shift);
    }
    if (version === 6 && net.isIP(normalizedIp) === 6) {
        if (prefix < 0 || prefix > 128) return false;
        const a = ipv6ToBigInt(normalizedIp), b = ipv6ToBigInt(base);
        if (a === null || b === null) return false;
        const shift = BigInt(128 - prefix);
        return (a >> shift) === (b >> shift);
    }
    return false;
}

function mergeState(input) {
    const state = { ...DEFAULT_STATE, ...(input || {}) };
    state.degraded = false;
    state.settings = { ...DEFAULT_STATE.settings, ...((input && input.settings) || {}) };
    for (const key of ['allowedIps', 'trustedProxyIps']) {
        state.settings[key] = Array.isArray(state.settings[key]) ? [...new Set(state.settings[key].map(String).map(x => x.trim()).filter(Boolean))] : [];
    }
    state.bans = state.bans && typeof state.bans === 'object' ? state.bans : {};
    state.approvedProfiles = state.approvedProfiles && typeof state.approvedProfiles === 'object' ? state.approvedProfiles : {};
    state.recentIps = Array.isArray(state.recentIps) ? state.recentIps.slice(-300) : [];
    state.audit = Array.isArray(state.audit) ? state.audit.slice(-500) : [];
    return state;
}

class AccessControl {
    constructor(baseDir, logger) {
        this.baseDir = path.join(baseDir, 'security');
        this.file = path.join(this.baseDir, 'access-control.json');
        this.logger = logger || console;
        fs.mkdirSync(this.baseDir, { recursive: true });
        this.state = this.load();
        this.lastSaveAt = 0;
        this.lastDeniedAt = new Map();
    }

    log(level, message) {
        const fn = this.logger && (this.logger[level] || this.logger.info);
        if (typeof fn === 'function') fn.call(this.logger, `[EconomyGuard Access] ${message}`);
    }

    load() {
        try {
            if (!fs.existsSync(this.file)) {
                const fresh = mergeState(DEFAULT_STATE);
                this.writeState(fresh);
                return fresh;
            }
            return mergeState(JSON.parse(fs.readFileSync(this.file, 'utf8')));
        } catch (err) {
            const backup = `${this.file}.corrupt-${Date.now()}.bak`;
            try { if (fs.existsSync(this.file)) fs.copyFileSync(this.file, backup); } catch (_) { /* best effort */ }
            this.log('error', `Access-control file is invalid; defaults loaded and corrupt copy preserved at ${backup}: ${err.message}`);
            const degraded = mergeState(DEFAULT_STATE);
            degraded.degraded = true;
            return degraded;
        }
    }

    writeState(state) {
        const temp = `${this.file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
        fs.renameSync(temp, this.file);
    }

    save() {
        if (this.state.degraded) {
            this.log('error', 'Refusing to overwrite a corrupt access-control registry. Restore the preserved .bak file or remove access-control.json deliberately while the server is stopped.');
            return false;
        }
        try {
            this.writeState(this.state);
            this.lastSaveAt = Date.now();
            return true;
        } catch (err) {
            try { if (fs.existsSync(`${this.file}.tmp`)) fs.unlinkSync(`${this.file}.tmp`); } catch (_) { /* best effort */ }
            this.log('error', `Could not save access-control state: ${err.message}`);
            return false;
        }
    }

    audit(type, data = {}) {
        this.state.audit.push({ timestamp: new Date().toISOString(), type, ...data });
        if (this.state.audit.length > 500) this.state.audit.splice(0, this.state.audit.length - 500);
        this.save();
    }

    validateProfileId(id) {
        return typeof id === 'string' && PROFILE_RE.test(id);
    }

    validateExpiry(value) {
        if (value === null || value === undefined || value === '') return null;
        const time = Date.parse(value);
        if (!Number.isFinite(time) || time <= Date.now() || time > Date.now() + 3660 * 86400000) throw new Error('INVALID_EXPIRY');
        return new Date(time).toISOString();
    }

    isBanActive(profileId) {
        const ban = this.state.bans[String(profileId || '').toLowerCase()];
        if (!ban || ban.active === false) return false;
        if (ban.startsAt && Date.parse(ban.startsAt) > Date.now()) return false;
        if (ban.expiresAt && Date.parse(ban.expiresAt) <= Date.now()) return false;
        return true;
    }

    getLoginDecision(profileId) {
        const id = String(profileId || '').toLowerCase();
        if (!this.validateProfileId(id)) return { allowed: false, code: 'PROFILE_NOT_FOUND', reason: 'Profile ID was not resolved.' };
        if (this.isBanActive(id)) {
            const ban = this.state.bans[id];
            return { allowed: false, code: 'ACCOUNT_BANNED', reason: ban.reason || 'Banned by server administrator.', ban };
        }
        if (this.state.settings.requireApprovedLogin && !this.state.approvedProfiles[id]) {
            return { allowed: false, code: 'ACCOUNT_NOT_ALLOWLISTED', reason: 'Profile is not approved by the server administrator.' };
        }
        return { allowed: true, code: 'OK' };
    }

    addBan(profileId, reason, expiresAt = null, actor = 'ADMIN_PANEL') {
        const id = String(profileId || '').toLowerCase();
        if (!this.validateProfileId(id)) throw new Error('INVALID_PROFILE_ID');
        this.state.bans[id] = { active: true, reason: String(reason || 'Banned by server administrator.').slice(0, 500), createdAt: new Date().toISOString(), expiresAt: this.validateExpiry(expiresAt), actor };
        if (!this.save()) throw new Error('SAVE_FAILED');
        this.audit('ACCOUNT_BANNED', { profileId: id, expiresAt: this.state.bans[id].expiresAt, reason: this.state.bans[id].reason });
        return this.state.bans[id];
    }

    removeBan(profileId, actor = 'ADMIN_PANEL') {
        const id = String(profileId || '').toLowerCase();
        if (!this.validateProfileId(id)) throw new Error('INVALID_PROFILE_ID');
        const existed = !!this.state.bans[id];
        delete this.state.bans[id];
        if (!this.save()) throw new Error('SAVE_FAILED');
        if (existed) this.audit('ACCOUNT_UNBANNED', { profileId: id, actor });
        return existed;
    }

    approveProfile(profileId, details = {}) {
        const id = String(profileId || '').toLowerCase();
        if (!this.validateProfileId(id)) throw new Error('INVALID_PROFILE_ID');
        this.state.approvedProfiles[id] = {
            username: String(details.username || '').slice(0, 64),
            nickname: String(details.nickname || '').slice(0, 64),
            edition: String(details.edition || '').slice(0, 64),
            source: String(details.source || 'ADMIN_APPROVED').slice(0, 32),
            createdAt: this.state.approvedProfiles[id] && this.state.approvedProfiles[id].createdAt || new Date().toISOString(),
            approvedAt: new Date().toISOString()
        };
        if (!this.save()) throw new Error('SAVE_FAILED');
        this.audit('ACCOUNT_APPROVED', { profileId: id, username: this.state.approvedProfiles[id].username, source: this.state.approvedProfiles[id].source });
        return this.state.approvedProfiles[id];
    }

    revokeProfile(profileId) {
        const id = String(profileId || '').toLowerCase();
        if (!this.validateProfileId(id)) throw new Error('INVALID_PROFILE_ID');
        const existed = !!this.state.approvedProfiles[id];
        delete this.state.approvedProfiles[id];
        if (!this.save()) throw new Error('SAVE_FAILED');
        if (existed) this.audit('ACCOUNT_REVOKED', { profileId: id });
        return existed;
    }

    updateSettings(patch) {
        const next = { ...this.state.settings };
        for (const key of ['allowLauncherRegistration', 'requireApprovedLogin', 'enforceIpAllowlist', 'allowLoopback']) {
            if (patch[key] !== undefined) next[key] = Boolean(patch[key]);
        }
        for (const key of ['allowedIps', 'trustedProxyIps']) {
            if (patch[key] !== undefined) {
                if (!Array.isArray(patch[key])) throw new Error('INVALID_IP_LIST');
                const values = [...new Set(patch[key].map(x => String(x).trim()).filter(Boolean))];
                for (const value of values) {
                    const base = value.split('/')[0];
                    if (net.isIP(normalizeIp(base)) === 0 || (value.includes('/') && !/^.+\/\d{1,3}$/.test(value))) throw new Error('INVALID_IP_ENTRY');
                    if (value.includes('/') && !ipMatchesCidr(base, value)) throw new Error('INVALID_IP_ENTRY');
                }
                next[key] = values.slice(0, 256);
            }
        }
        if (next.enforceIpAllowlist && next.allowedIps.length === 0) throw new Error('IP_ALLOWLIST_EMPTY');
        this.state.settings = next;
        if (!this.save()) throw new Error('SAVE_FAILED');
        this.audit('ACCESS_SETTINGS_UPDATED', { enforceIpAllowlist: next.enforceIpAllowlist, requireApprovedLogin: next.requireApprovedLogin, allowLauncherRegistration: next.allowLauncherRegistration, allowedIpCount: next.allowedIps.length });
        return this.state.settings;
    }

    getSessionIdFromRequest(req) {
        const cookies = String(req && req.headers && req.headers.cookie || '');
        for (const cookie of cookies.split(';')) {
            const part = cookie.trim();
            if (part.startsWith('PHPSESSID=')) return part.slice('PHPSESSID='.length);
        }
        return '';
    }

    getClientIp(req) {
        const peer = normalizeIp(req && req.socket && req.socket.remoteAddress || '');
        const trusted = this.state.settings.trustedProxyIps.some(rule => ipMatchesCidr(peer, rule));
        if (!trusted) return peer;
        const real = req.headers && req.headers['x-real-ip'];
        const forwarded = req.headers && req.headers['x-forwarded-for'];
        const candidate = normalizeIp(real || (forwarded ? String(forwarded).split(',')[0].trim() : peer));
        return net.isIP(candidate) ? candidate : peer;
    }

    isLoopback(ip) {
        const normalized = normalizeIp(ip);
        return normalized === '127.0.0.1' || normalized === '::1';
    }

    isIpAllowed(ip) {
        const normalized = normalizeIp(ip);
        if (!normalized || net.isIP(normalized) === 0) return false;
        if (this.state.settings.allowLoopback !== false && this.isLoopback(normalized)) return true;
        // Corrupt security data must never turn into an empty/open allowlist.
        if (this.state.degraded) return false;
        if (!this.state.settings.enforceIpAllowlist) return true;
        return this.state.settings.allowedIps.some(rule => ipMatchesCidr(normalized, rule));
    }

    recordRequest(ip, sessionId, route, decision) {
        if (!ip || net.isIP(normalizeIp(ip)) === 0) return;
        const profileId = this.validateProfileId(String(sessionId || '').toLowerCase()) ? String(sessionId).toLowerCase() : '';
        const normalized = normalizeIp(ip);
        const now = Date.now();
        const existing = this.state.recentIps.find(x => x.ip === normalized && String(x.profileId || '') === profileId);
        if (existing) {
            existing.lastSeen = new Date(now).toISOString();
            existing.lastRoute = String(route || '').slice(0, 160);
            existing.count = Number(existing.count || 1) + 1;
            existing.decision = decision || 'ALLOWED';
            const last = Date.parse(existing.lastPersistedAt || existing.timestamp || '');
            if (Number.isFinite(last) && now - last < 60000) return;
            existing.lastPersistedAt = new Date(now).toISOString();
            this.save();
            return;
        }
        const row = { ip: normalized, profileId: profileId || null, route: String(route || '').slice(0, 160), timestamp: new Date(now).toISOString(), lastSeen: new Date(now).toISOString(), lastPersistedAt: new Date(now).toISOString(), count: 1, decision: decision || 'ALLOWED' };
        this.state.recentIps.unshift(row);
        if (this.state.recentIps.length > 300) this.state.recentIps.splice(300);
        this.save();
    }

    recordDeniedRequest(ip, sessionId, route, code) {
        this.recordRequest(ip, sessionId, route, code);
        const key = `${normalizeIp(ip)}|${sessionId || ''}|${route || ''}|${code}`;
        const last = this.lastDeniedAt.get(key) || 0;
        if (Date.now() - last < 60000) return;
        this.lastDeniedAt.set(key, Date.now());
        this.audit('ACCESS_REQUEST_DENIED', { ip: normalizeIp(ip), profileId: sessionId || null, route: String(route || '').slice(0, 160), code });
    }

    getStateForPanel() {
        const now = Date.now();
        const bans = Object.entries(this.state.bans).map(([profileId, ban]) => ({ profileId, ...ban, active: this.isBanActive(profileId) }));
        return {
            settings: { ...this.state.settings },
            degraded: this.state.degraded === true,
            bans,
            approvedProfiles: Object.entries(this.state.approvedProfiles).map(([profileId, data]) => ({ profileId, ...data })),
            recentIps: this.state.recentIps.slice().sort((a, b) => String(b.lastSeen || b.timestamp).localeCompare(String(a.lastSeen || a.timestamp))),
            audit: this.state.audit.slice().reverse(),
            activeBanCount: bans.filter(x => x.active).length,
            approvedCount: Object.keys(this.state.approvedProfiles).length,
            timestamp: new Date(now).toISOString()
        };
    }
}

module.exports = { AccessControl, ipMatchesCidr, normalizeIp };
