'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function monthKey(timestamp = Date.now()) {
    const d = new Date(timestamp);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

class Storage {
    constructor(baseDir, config, logger) {
        this.baseDir = baseDir;
        this.config = config || {};
        this.logger = logger || console;
        this.auditDir = path.join(baseDir, 'logs');
        this.ledgerDir = path.join(baseDir, 'ledger');
        this.casesDir = path.join(baseDir, 'cases');
        this.reportsDir = path.join(baseDir, 'reports');
        this.policyDir = path.join(baseDir, 'policies');
        this.policyUsageDir = path.join(this.policyDir, 'usage');
        this.policyFile = path.join(this.policyDir, 'restrictions.json');
        for (const dir of [baseDir, this.auditDir, this.ledgerDir, this.casesDir, this.reportsDir, this.policyDir, this.policyUsageDir]) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.policyFile)) {
            try { fs.writeFileSync(this.policyFile, JSON.stringify({ enabled: true, players: {}, items: {} }, null, 2), 'utf8'); } catch (err) { this.logger.error(`[EconomyGuard] Could not create restrictions file: ${err.message}`); }
        }
        this.prune();
    }

    appendRotating(dir, prefix, record) {
        const month = monthKey();
        const file = path.join(dir, `${prefix}-${month}.jsonl`);
        const maxBytes = (Number(this.config.maxFileSizeMb) || 8) * 1024 * 1024;
        let target = file;
        try {
            if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
                const partPattern = new RegExp(`^${prefix}-${month}-part(\\d+)\\.jsonl$`, 'i');
                const parts = fs.readdirSync(dir).map(name => {
                    const match = name.match(partPattern);
                    return match ? { name, number: Number(match[1]) } : null;
                }).filter(Boolean).sort((a, b) => b.number - a.number);
                const latest = parts.length ? parts[0] : null;
                if (latest && fs.statSync(path.join(dir, latest.name)).size < maxBytes) {
                    target = path.join(dir, latest.name);
                } else {
                    const nextNumber = latest ? latest.number + 1 : 1;
                    target = path.join(dir, `${prefix}-${month}-part${String(nextNumber).padStart(3, '0')}.jsonl`);
                }
            }
            fs.appendFileSync(target, JSON.stringify(record) + '\n', 'utf8');
        } catch (err) {
            this.logger.error(`[EconomyGuard] Could not write ${target}: ${err.message}`);
        }
    }

    audit(record) {
        this.appendRotating(this.auditDir, 'audit', record);
    }

    ledger(record) {
        this.appendRotating(this.ledgerDir, 'ledger', record);
    }

    createCase(data) {
        const id = `EG-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const item = { caseId: id, createdAt: new Date().toISOString(), status: 'OPEN', ...data };
        try {
            fs.writeFileSync(path.join(this.casesDir, `${id}.json`), JSON.stringify(item, null, 2), 'utf8');
        } catch (err) {
            this.logger.error(`[EconomyGuard] Could not write case ${id}: ${err.message}`);
        }
        return item;
    }

    loadRecentLedger(maxLines = 50000) {
        const files = fs.readdirSync(this.ledgerDir).filter(f => /^ledger-.*\.jsonl$/i.test(f)).sort().reverse();
        const events = [];
        for (const file of files) {
            if (events.length >= maxLines) break;
            try {
                const lines = fs.readFileSync(path.join(this.ledgerDir, file), 'utf8').split(/\r?\n/);
                for (let i = lines.length - 1; i >= 0 && events.length < maxLines; i--) {
                    if (!lines[i]) continue;
                    try { events.push(JSON.parse(lines[i])); } catch (_) { /* ignore a truncated line */ }
                }
            } catch (err) {
                this.logger.warn(`[EconomyGuard] Could not read ledger ${file}: ${err.message}`);
            }
        }
        return events.reverse();
    }

    loadRestrictions() {
        try {
            const data = JSON.parse(fs.readFileSync(this.policyFile, 'utf8'));
            return data && typeof data === 'object' ? { enabled: data.enabled !== false, players: data.players || {}, items: data.items || {} } : { enabled: true, players: {}, items: {} };
        } catch (err) {
            this.logger.warn(`[EconomyGuard] Restrictions file could not be read; no player restrictions loaded: ${err.message}`);
            return { enabled: false, players: {}, items: {} };
        }
    }


    saveRestrictions(data) {
        const safe = { enabled: data && data.enabled !== false, players: data && data.players && typeof data.players === 'object' ? data.players : {}, items: data && data.items && typeof data.items === 'object' ? data.items : {} };
        const temp = `${this.policyFile}.tmp`;
        try {
            fs.writeFileSync(temp, JSON.stringify(safe, null, 2), 'utf8');
            fs.renameSync(temp, this.policyFile);
            return true;
        } catch (err) {
            try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) { /* best effort */ }
            this.logger.error(`[EconomyGuard] Could not save restrictions: ${err.message}`);
            return false;
        }
    }

    loadRecentJsonl(dir, pattern, maxLines = 1000) {
        const files = fs.readdirSync(dir).filter(f => pattern.test(f)).sort().reverse();
        const events = [];
        for (const file of files) {
            if (events.length >= maxLines) break;
            try {
                const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
                for (let i = lines.length - 1; i >= 0 && events.length < maxLines; i--) {
                    if (!lines[i]) continue;
                    try { events.push(JSON.parse(lines[i])); } catch (_) { /* ignore truncated lines */ }
                }
            } catch (err) { this.logger.warn(`[EconomyGuard] Could not read ${file}: ${err.message}`); }
        }
        return events.reverse();
    }

    loadCases(maxFiles = 1000) {
        const names = fs.readdirSync(this.casesDir).filter(f => /^EG-.*\.json$/i.test(f)).sort().reverse().slice(0, maxFiles);
        const rows = [];
        for (const name of names) {
            try { rows.push(JSON.parse(fs.readFileSync(path.join(this.casesDir, name), 'utf8'))); }
            catch (err) { this.logger.warn(`[EconomyGuard] Could not read case ${name}: ${err.message}`); }
        }
        return rows;
    }

    updateCase(caseId, patch) {
        if (!/^EG-[A-Z0-9-]+$/i.test(String(caseId || ''))) return null;
        const file = path.join(this.casesDir, `${caseId}.json`);
        if (!fs.existsSync(file)) return null;
        try {
            const current = JSON.parse(fs.readFileSync(file, 'utf8'));
            const next = { ...current, ...patch, caseId: current.caseId, updatedAt: new Date().toISOString() };
            const temp = `${file}.tmp`;
            fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
            fs.renameSync(temp, file);
            return next;
        } catch (err) { this.logger.error(`[EconomyGuard] Could not update case ${caseId}: ${err.message}`); return null; }
    }

    recordPolicyUsage(record) {
        const month = monthKey(Number(record && record.timestamp) || Date.now());
        const file = path.join(this.policyUsageDir, `usage-${month}.jsonl`);
        try { fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8'); }
        catch (err) { this.logger.error(`[EconomyGuard] Could not write policy usage: ${err.message}`); }
    }

    loadRecentPolicyUsage(maxLines = 50000) {
        const files = fs.readdirSync(this.policyUsageDir).filter(f => /^usage-\d{4}-\d{2}\.jsonl$/i.test(f)).sort().reverse();
        const events = [];
        const cutoff = Date.now() - 40 * 86400000;
        for (const file of files) {
            if (events.length >= maxLines) break;
            try {
                const lines = fs.readFileSync(path.join(this.policyUsageDir, file), 'utf8').split(/\r?\n/);
                for (let i = lines.length - 1; i >= 0 && events.length < maxLines; i--) {
                    if (!lines[i]) continue;
                    try {
                        const row = JSON.parse(lines[i]);
                        if (Number(row.timestamp) >= cutoff) events.push(row);
                    } catch (_) { /* ignore a truncated line */ }
                }
            } catch (err) { this.logger.warn(`[EconomyGuard] Could not read policy usage ${file}: ${err.message}`); }
        }
        return events;
    }

    prune() {
        const retention = this.config || {};
        const deleteByAge = (dir, pattern, days) => {
            if (!days || days <= 0) return;
            const cutoff = Date.now() - days * 86400000;
            let names = [];
            try { names = fs.readdirSync(dir); } catch (_) { return; }
            for (const name of names) {
                if (!pattern.test(name)) continue;
                const full = path.join(dir, name);
                try {
                    if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
                } catch (_) { /* best effort */ }
            }
        };
        deleteByAge(this.auditDir, /^audit-.*\.jsonl$/i, Number(retention.auditRetentionDays) || 0);
        deleteByAge(this.ledgerDir, /^ledger-.*\.jsonl$/i, Number(retention.ledgerRetentionDays) || 0);
        deleteByAge(this.policyUsageDir, /^usage-.*\.jsonl$/i, Number(retention.policyUsageRetentionDays) || 45);
        // Keep OPEN evidence indefinitely. Only manually closed/resolved cases are
        // eligible for retention cleanup, preventing active investigations from vanishing.
        const caseDays = Number(retention.caseRetentionDays) || 0;
        if (caseDays > 0) {
            const cutoff = Date.now() - caseDays * 86400000;
            let names = [];
            try { names = fs.readdirSync(this.casesDir); } catch (_) { names = []; }
            for (const name of names) {
                if (!/^EG-.*\.json$/i.test(name)) continue;
                const full = path.join(this.casesDir, name);
                try {
                    const stat = fs.statSync(full);
                    if (stat.mtimeMs >= cutoff) continue;
                    const record = JSON.parse(fs.readFileSync(full, 'utf8'));
                    const status = String(record.status || 'OPEN').toUpperCase();
                    if (status === 'OPEN' || status === 'PENDING') continue;
                    fs.unlinkSync(full);
                } catch (_) { /* malformed evidence is retained for manual inspection */ }
            }
        }
    }
}

module.exports = { Storage };
