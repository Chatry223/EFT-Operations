'use strict';
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const data = path.resolve(root, 'SPT-EconomyGuard-Data');
const reportDir = path.join(data, 'reports');
fs.mkdirSync(reportDir, { recursive: true });

function readJsonl(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const file of fs.readdirSync(dir).filter(x => x.endsWith('.jsonl'))) {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const line of content.split(/\r?\n/)) {
            if (!line) continue;
            try { out.push(JSON.parse(line)); } catch (_) { /* ignore partial final line */ }
        }
    }
    return out;
}

const audit = readJsonl(path.join(data, 'logs'));
const ledger = readJsonl(path.join(data, 'ledger'));
const casesDir = path.join(data, 'cases');
const cases = fs.existsSync(casesDir)
    ? fs.readdirSync(casesDir).filter(x => x.endsWith('.json')).map(x => {
        try { return JSON.parse(fs.readFileSync(path.join(casesDir, x), 'utf8')); } catch (_) { return null; }
    }).filter(Boolean)
    : [];

const summary = {
    generatedAt: new Date().toISOString(),
    auditEvents: audit.length,
    fleaLedgerEvents: ledger.length,
    openCases: cases.filter(c => c.status === 'OPEN').length,
    cases: cases.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    recentBlocked: audit.filter(e => e.type === 'TRANSACTION_BLOCKED').slice(-200).reverse(),
    recentFleaTrades: ledger.slice(-200).reverse()
};

const jsonPath = path.join(reportDir, 'latest-report.json');
fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const rows = cases.map(c => `<tr><td>${esc(c.caseId)}</td><td>${esc(c.createdAt)}</td><td>${esc(c.severity)}</td><td>${esc(c.type)}</td><td>${esc(c.status)}</td><td><pre>${esc(JSON.stringify(c.evidence, null, 2))}</pre></td></tr>`).join('');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>SPT EconomyGuard Report</title><style>body{font:14px Segoe UI,Arial;background:#0d1117;color:#c9d1d9;margin:24px}h1{color:#58a6ff}section{background:#161b22;padding:16px;margin:12px 0;border:1px solid #30363d;border-radius:8px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #30363d;padding:8px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;max-width:600px}</style><h1>SPT EconomyGuard</h1><section><b>Generated:</b> ${esc(summary.generatedAt)}<br><b>Audit events:</b> ${summary.auditEvents}<br><b>Flea ledger events:</b> ${summary.fleaLedgerEvents}<br><b>Open cases:</b> ${summary.openCases}</section><section><h2>Cases</h2><table><tr><th>ID</th><th>Created</th><th>Severity</th><th>Type</th><th>Status</th><th>Evidence</th></tr>${rows}</table></section></html>`;
const htmlPath = path.join(reportDir, 'latest-report.html');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log(`JSON report: ${jsonPath}`);
console.log(`HTML report: ${htmlPath}`);
