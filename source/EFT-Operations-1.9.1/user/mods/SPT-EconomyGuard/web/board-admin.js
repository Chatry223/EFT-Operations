'use strict';
// Add-on page for the admin panel: controls the public status site (power/address, look, layout editor,
// announcements, player visibility). It attaches itself to the existing navigation only; the original panel
// script is untouched and any error here is contained by the try/catch below.
(() => {
  try {
    const $ = (s, r = document) => r.querySelector(s);
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nav = $('#mainNav'), content = $('#appContent');
    if (!nav || !content) return;
    let data = null, tab = 'general', layout = null, newsForm = null;

    const style = document.createElement('style');
    style.textContent = `#view-board input[type=color]{height:42px;padding:3px;cursor:pointer}#view-board code{word-break:break-all}
      .bd-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}@media(max-width:1100px){.bd-grid{grid-template-columns:1fr}}
      .bd-list{list-style:none;margin:0 0 4px;padding:0;display:grid;gap:7px}
      .bd-item{display:flex;align-items:center;gap:10px;padding:9px 11px;background:#0c1621;border:1px solid #24374b;border-radius:8px;font-size:11px;color:#c2d0df;cursor:grab;user-select:none}
      .bd-item.off{opacity:.55}.bd-item.over{border-color:#4a8bc9;box-shadow:0 0 0 2px #418dd22a}.bd-item.dragging{opacity:.35}
      .bd-grip{color:#5f7690;letter-spacing:-2px;font-size:14px}.bd-item b{flex:1;font-weight:600}.bd-item input{accent-color:#62a7e7;width:16px;height:16px}
      .bd-mini{background:#0c1621;border:1px solid #24374b;border-radius:6px;color:#9fc5e9;width:24px;height:24px;cursor:pointer;font-size:11px;padding:0}.bd-mini:disabled{opacity:.3;cursor:default}
      .wire{border:1px solid #2a3d54;border-radius:10px;padding:10px;background:#0a121b;display:grid;gap:7px;font-size:9px;color:#8fa5bb;position:sticky;top:12px}
      .wire .w-hero{display:flex;justify-content:space-between;gap:6px;border:1px solid #2f4660;border-radius:6px;padding:8px;background:#0f1b29}
      .wire .w-chip{border:1px solid #3a587a;border-radius:6px;padding:4px 6px;min-width:84px;color:#bcd6f0}.wire .w-chip i{display:block;font-style:normal;color:#6f8eae}
      .wire .w-block{border:1px dashed #3a587a;border-radius:6px;padding:8px;text-align:center;color:#a9c4de}.wire .w-block.cards{display:flex;gap:5px;justify-content:center;flex-wrap:wrap;border-style:solid}
      .wire .w-card{border:1px solid #3a587a;border-radius:5px;padding:4px 7px}.wire .w-tabs{display:flex;gap:4px;flex-wrap:wrap}.wire .w-tab{background:#173454;border-radius:5px;padding:3px 7px;color:#cfe4fa}.wire .w-tab.off{display:none}
      .bd-status{font-size:9px;font-weight:800;letter-spacing:.4px;padding:3px 8px;border-radius:20px}.bd-status.live{background:#1c382f;color:#7dd8ad}.bd-status.scheduled{background:#1d3540;color:#8ac9e7}.bd-status.expired{background:#3a2a2a;color:#d9a3a3}.bd-status.draft{background:#3a311f;color:#e9c27a}`;
    document.head.append(style);
    const btn = document.createElement('button');
    btn.className = 'nav-item'; btn.dataset.view = 'board';
    btn.innerHTML = '<span class="nav-icon">◍</span>Status Site';
    nav.insertBefore(btn, nav.querySelector('[data-view="settings"]') || null);
    const view = document.createElement('div');
    view.className = 'view'; view.id = 'view-board';
    content.append(view);

    const toast = (m, err) => { const el = $('#toast'); if (!el) return; el.textContent = m; el.classList.toggle('error', !!err); el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3500); };
    async function api(route, body) {
      const token = localStorage.getItem('eg_admin_token') || '';
      const res = await fetch(route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP_${res.status}`);
      return json;
    }
    const messages = {
      BOARD_PORT_RESERVED: 'That port is used by the game server or this admin panel.', INVALID_BOARD_PORT: 'Port must be 1-65535.', INVALID_BOARD_HOST: 'Host must be an IP address, "auto" or "localhost".',
      BOARD_NAME_NOT_ALLOWED: 'That text is not allowed on the public site.', INVALID_BOARD_NAME: 'Server name cannot be empty.', INVALID_BOARD_BACKGROUND_TYPE: 'Media must be jpg, png, webp, gif, mp4 or webm.',
      INVALID_BOARD_BACKGROUND: 'Invalid media setting.', INVALID_BOARD_ACCENT: 'Accent must be a #rrggbb colour.', BOARD_UNAVAILABLE: 'The status site module is not loaded.',
      INVALID_NEWS_TITLE: 'Title is required.', INVALID_NEWS_KIND: 'Unknown announcement type.', INVALID_NEWS_DATE: 'Check the dates: the end must be after the start.',
      INVALID_NEWS_LINK: 'The link must be a full http:// or https:// address.', NEWS_NOT_FOUND: 'That announcement no longer exists.', BOARD_TOO_MANY_NEWS: 'Too many announcements (max 40). Delete old ones first.',
      INVALID_BOARD_LAYOUT: 'Invalid layout.'
    };
    const explain = e => messages[e.message] || (e.message.startsWith('BOARD_BIND_FAILED') ? `Could not use that address/port — the previous setting was restored. (${e.message.replace('BOARD_BIND_FAILED:', '').trim()})` : e.message);

    async function refresh() {
      try { data = await api('/api/board'); if (!layout) layout = JSON.parse(JSON.stringify(data.settings.layout)); render(); }
      catch (e) { view.innerHTML = `<div class="view-intro"><div><h2>Public Status Site</h2><p>${esc(explain(e))}</p></div></div>`; }
    }
    const sw = (name, label, hint, on) => `<label class="switch-row"><span><b>${esc(label)}</b><small>${esc(hint)}</small></span><input type="checkbox" name="${name}"${on ? ' checked' : ''}></label>`;
    const bool = d => k => d.get(k) === 'on';

    // ---- sub pages ---------------------------------------------------------------------------------------------
    function pageGeneral() {
      const s = data.settings, r = data.runtime;
      const urls = (r.urls || []).map(u => `<code>${esc(u)}</code>`).join(' · ');
      const hooks = r.collector.hooks;
      return `<div class="panel"><div class="panel-head"><div><h3>Status</h3><p>${r.running ? `Players open: ${urls || '—'}` : 'The site is not listening.'}</p></div></div>
          <div class="muted">Requests served: ${esc(r.requests)} · Rate-limited: ${esc(r.rateLimited)} · Tracked AI PMCs: ${esc(r.trackedPmc)} · Hooks: bots ${hooks.botGeneration ? '✓' : '✗'}, raid-end ${hooks.raidEnd || hooks.raidEndLifecycle ? '✓' : '✗'}, Fika raids ${hooks.fikaMatches ? '✓' : '✗'}, flea offers ${hooks.offers ? '✓' : '✗'}</div>
          ${r.lastError ? `<div class="security-warning"><b>LAST ERROR</b><span>${esc(r.lastError)}</span></div>` : ''}</div>
        <div class="panel"><div class="panel-head"><div><h3>Address &amp; power</h3><p>Use 0.0.0.0 so anyone who can reach your Fika IP (for example 10.1.1.1) can open it on the chosen port.</p></div></div>
          <form id="boardServerForm" class="form-grid">
            <label class="field"><span>Site</span><select name="enabled"><option value="true"${s.enabled ? ' selected' : ''}>On</option><option value="false"${s.enabled ? '' : ' selected'}>Off</option></select></label>
            <label class="field"><span>Listen address</span><input name="host" list="boardHosts" value="${esc(s.host)}"><datalist id="boardHosts"><option value="0.0.0.0"><option value="auto"><option value="127.0.0.1"></datalist></label>
            <label class="field"><span>Port</span><input name="port" type="number" min="1" max="65535" value="${esc(s.port)}"></label>
            <div class="form-actions"><button class="primary-btn" type="submit">Apply &amp; restart site</button><span class="muted">If the new address fails, the old one is restored automatically.</span></div>
          </form></div>
        <div class="panel"><div class="panel-head"><div><h3>Maintenance</h3><p>AI PMC statistics are collected from raids after tracking started.</p></div></div>
          <button class="danger-btn" id="boardResetPmc" type="button">Reset AI PMC statistics</button></div>`;
    }

    function pageLook() {
      const s = data.settings, bg = s.background;
      return `<form id="boardLookForm"><div class="panel"><div class="panel-head"><div><h3>Identity &amp; background</h3><p>Name shown on the public page. Do not reuse the admin mod name.</p></div></div>
        <div class="form-grid">
          <label class="field"><span>Server name (English)</span><input name="serverName" maxlength="40" value="${esc(s.serverName)}"></label>
          <label class="field"><span>Tagline</span><input name="tagline" maxlength="90" value="${esc(s.tagline)}"></label>
          <label class="field"><span>Default language</span><select name="language"><option value="en"${s.language === 'en' ? ' selected' : ''}>English</option><option value="fa"${s.language === 'fa' ? ' selected' : ''}>فارسی</option></select></label>
          <label class="field"><span>Accent colour</span><input name="accent" type="color" value="${esc(s.accent)}"></label>
          <label class="field"><span>Refresh every (seconds)</span><input name="refreshSeconds" type="number" min="5" max="120" value="${esc(s.refreshSeconds)}"></label>
          <label class="field"><span>Background</span><select name="bgSource"><option value="none"${bg.source === 'none' ? ' selected' : ''}>None</option><option value="media"${bg.source === 'media' ? ' selected' : ''}>File from media folder</option><option value="path"${bg.source === 'path' ? ' selected' : ''}>Full path on this computer</option></select></label>
          <label class="field"><span>Media folder file</span><select name="bgMedia"><option value="">—</option>${data.media.files.map(f => `<option${bg.source === 'media' && bg.value === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
          <label class="field"><span>…or full file path (jpg/png/webp/gif/mp4/webm)</span><input name="bgPath" value="${esc(bg.source === 'path' ? bg.value : '')}" placeholder="D:\\Media\\tarkov.mp4"></label>
          <label class="field"><span>Dark overlay (0–0.9)</span><input name="overlay" type="number" min="0" max="0.9" step="0.05" value="${esc(bg.overlay)}"></label>
          <div class="field span-2 muted">Media folder: <code>${esc(data.media.dir)}</code> — put images or videos there (also used by announcements). ${bg.source !== 'none' ? (data.media.backgroundResolved ? 'Current background file found.' : '<b>Current background file was not found.</b>') : ''}</div>
        </div></div>
        <div class="panel"><div class="panel-head"><div><h3>What the site shows</h3><p>Page structure and order live in the Layout tab.</p></div></div>
          <div class="access-settings-form">
            ${sw('onlineIncludesMarket', 'Count flea-market sellers as Online', 'The headline Online number also includes sellers with live flea offers. Turn off if the number looks too large.', s.onlineIncludesMarket)}
            ${sw('showPmc', 'Show AI PMCs', 'Lists AI PMCs in the leaderboard, Online tab and raid cards, and counts the ones in raids as Online.', s.showPmc)}
            ${sw('showPmcBadge', 'Mark AI PMCs with a PMC badge', 'Off: AI PMCs look like any other name. On: a small PMC badge and a Players / PMC filter appear.', s.showPmcBadge)}
            ${sw('showMarketTraders', 'List flea PMC sellers in the Online tab', 'Adds the “Active on the flea market” list.', s.showMarketTraders)}
            ${sw('sec_trades', 'Recent flea trades', 'Shows who bought what, by in-game name.', s.sections.trades)}
            ${sw('sec_feed', 'Event feed', 'Kills, deaths and raid results.', s.sections.feed)}
            ${sw('hideBanned', 'Hide banned accounts', 'Banned players disappear from every list.', s.hideBanned)}
          </div>
          <div class="form-grid" style="margin-top:14px">
            <label class="field"><span>Flea PMC names shown (max)</span><input name="marketTradersLimit" type="number" min="0" max="200" value="${esc(s.marketTradersLimit)}"></label>
            <label class="field"><span>Leaderboard rows (max)</span><input name="leaderboardLimit" type="number" min="10" max="500" value="${esc(s.leaderboardLimit)}"></label>
            <label class="field"><span>AI raid lifetime without Fika info (minutes)</span><input name="raidTtlMinutes" type="number" min="5" max="240" value="${esc(s.raidTtlMinutes)}"></label>
          </div></div>
        <div class="panel"><div class="panel-head"><div><h3>Score formula</h3><p>score = level×A + kills×B + survived raids×C + headshots×D + boss kills×E − deaths×F</p></div></div>
          <div class="form-grid">${['level', 'kill', 'survived', 'headshot', 'boss', 'death'].map(k => `<label class="field"><span>Weight: ${k}</span><input name="w_${k}" type="number" min="0" max="10000" step="1" value="${esc(s.score[k])}"></label>`).join('')}</div>
          <div class="form-actions" style="margin-top:14px"><button class="primary-btn" type="submit">Save look &amp; content</button></div></div></form>`;
    }

    // ---- layout editor (drag & drop + arrow buttons + live wireframe) ------------------------------------------------
    const LABELS = {
      top: { announcements: 'Announcements banner', cards: 'Info cards row' },
      cards: { fleaOffers: 'Flea offers', raidsCompleted: 'Raids completed', totalKills: 'Total kills', registeredPlayers: 'Registered players', activeRaids: 'Active raids' },
      tabs: { leaderboard: 'Leaderboard', online: 'Online', raids: 'Raids', market: 'Flea market', activity: 'Activity' }
    };
    const tabOn = id => { const sec = (layout.sections || data.settings.sections); return id === 'activity' ? (sec.feed || sec.trades) : sec[id]; };
    function ensureLayout() { if (!layout.sections) layout.sections = JSON.parse(JSON.stringify(data.settings.sections)); }
    function listHtml(group, items, labels, hasToggle) {
      return `<ul class="bd-list" data-group="${group}">${items.map((it, i) => {
        const id = typeof it === 'string' ? it : it.id, on = group === 'tabs' ? tabOn(id) : it.enabled;
        return `<li class="bd-item${on ? '' : ' off'}" draggable="true" data-group="${group}" data-i="${i}"><span class="bd-grip">⋮⋮</span><b>${esc(labels[id])}</b>
          <button type="button" class="bd-mini" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button type="button" class="bd-mini" data-move="1" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
          ${hasToggle ? `<input type="checkbox" data-toggle="${esc(id)}" ${on ? 'checked' : ''} aria-label="Show ${esc(labels[id])}">` : ''}</li>`;
      }).join('')}</ul>`;
    }
    function wireframe() {
      const lines = layout.headerLines.filter(l => l.enabled).map(l => LABELS.cards[l.id]);
      const blocks = layout.top.filter(b => b.enabled).map(b => b.id === 'announcements'
        ? '<div class="w-block">Announcements banner</div>'
        : (layout.cards.some(c => c.enabled) ? `<div class="w-block cards">${layout.cards.filter(c => c.enabled).map(c => `<span class="w-card">${esc(LABELS.cards[c.id])}</span>`).join('')}</div>` : '')).join('');
      return `<div class="wire"><b style="color:#bcd6f0;font-size:10px">LIVE PREVIEW</b>
        <div class="w-hero"><span>Server name<br>tagline</span><span class="w-chip">Online <b>123</b>${lines.map(l => `<i>${esc(l)}</i>`).join('')}</span></div>
        ${blocks}<div class="w-tabs">${layout.tabs.map(id => `<span class="w-tab${tabOn(id) ? '' : ' off'}">${esc(LABELS.tabs[id])}</span>`).join('')}</div><div class="w-block">Selected tab content</div></div>`;
    }
    function pageLayout() {
      ensureLayout();
      return `<div class="bd-grid"><div>
        <div class="panel"><div class="panel-head"><div><h3>Layout editor</h3><p>Drag rows (or use ▲ ▼) to reorder, tick to show. Nothing changes publicly until you press Save.</p></div></div>
          <h4 style="margin:4px 0 8px;font-size:11px;color:#9fc5e9">Blocks at the top of the page</h4>${listHtml('top', layout.top, LABELS.top, true)}
          <h4 style="margin:16px 0 8px;font-size:11px;color:#9fc5e9">Info cards (row under the banner)</h4>${listHtml('cards', layout.cards, LABELS.cards, true)}
          <h4 style="margin:16px 0 8px;font-size:11px;color:#9fc5e9">Small lines under the Online counter</h4>${listHtml('headerLines', layout.headerLines, LABELS.cards, true)}
          <h4 style="margin:16px 0 8px;font-size:11px;color:#9fc5e9">Tabs (order and visibility)</h4>${listHtml('tabs', layout.tabs, LABELS.tabs, true)}
          <div class="form-actions" style="margin-top:14px"><button class="primary-btn" id="layoutSave" type="button">Save layout</button><button class="secondary-btn" id="layoutReset" type="button">Reset to default</button><button class="text-btn" id="layoutDiscard" type="button">Discard changes</button></div></div>
      </div><div id="wireHost">${wireframe()}</div></div>`;
    }
    const arrayFor = g => layout[g];
    function reorder(group, from, to) { const arr = arrayFor(group); if (to < 0 || to >= arr.length || from === to) return; const [m] = arr.splice(from, 1); arr.splice(to, 0, m); render(); }

    // ---- announcements ----------------------------------------------------------------------------------------
    const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
    const fromLocalInput = v => v ? new Date(v).toISOString() : null;
    const newsState = n => { const now = Date.now(); if (!n.enabled) return ['draft', 'DRAFT']; if (n.startsAt && Date.parse(n.startsAt) > now) return ['scheduled', 'SCHEDULED']; if (n.endsAt && Date.parse(n.endsAt) <= now) return ['expired', 'EXPIRED']; return ['live', 'LIVE']; };
    const fmtDate = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    function newsFormHtml() {
      const n = newsForm, m = n.media || { source: 'none', value: '' };
      return `<div class="panel"><div class="panel-head"><div><h3>${n.id ? 'Edit announcement' : 'New announcement'}</h3><p>Shown in the rotating banner at the top while its dates are active.</p></div></div>
        <form id="boardNewsForm" class="form-grid">
          <label class="field span-2"><span>Title</span><input name="title" maxlength="80" required value="${esc(n.title)}"></label>
          <label class="field span-2"><span>Text (max 400 characters)</span><textarea name="text" rows="3" maxlength="400">${esc(n.text)}</textarea></label>
          <label class="field"><span>Type</span><select name="kind">${['news', 'update', 'event', 'alert'].map(k => `<option value="${k}"${n.kind === k ? ' selected' : ''}>${{ news: 'News', update: 'Update', event: 'Event', alert: 'Notice' }[k]}</option>`).join('')}</select></label>
          <label class="field"><span>Visible</span><select name="enabled"><option value="true"${n.enabled ? ' selected' : ''}>Yes</option><option value="false"${n.enabled ? '' : ' selected'}>No (draft)</option></select></label>
          <label class="field"><span>Show from (empty = now)</span><input name="startsAt" type="datetime-local" value="${esc(toLocalInput(n.startsAt))}"></label>
          <label class="field"><span>Show until (empty = no end)</span><input name="endsAt" type="datetime-local" value="${esc(toLocalInput(n.endsAt))}"></label>
          <label class="field"><span>Image / video</span><select name="mSource"><option value="none"${m.source === 'none' ? ' selected' : ''}>None</option><option value="media"${m.source === 'media' ? ' selected' : ''}>File from media folder</option><option value="path"${m.source === 'path' ? ' selected' : ''}>Full path on this computer</option></select></label>
          <label class="field"><span>Media folder file</span><select name="mMedia"><option value="">—</option>${data.media.files.map(f => `<option${m.source === 'media' && m.value === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
          <label class="field span-2"><span>…or full file path</span><input name="mPath" value="${esc(m.source === 'path' ? m.value : '')}" placeholder="D:\\Media\\banner.jpg"></label>
          <label class="field"><span>Button text (optional)</span><input name="linkLabel" maxlength="30" value="${esc(n.link ? n.link.label : '')}"></label>
          <label class="field"><span>Button link (optional, http/https)</span><input name="linkUrl" value="${esc(n.link ? n.link.url : '')}" placeholder="https://"></label>
          <div class="form-actions span-2"><button class="primary-btn" type="submit">${n.id ? 'Save changes' : 'Publish announcement'}</button><button class="secondary-btn" id="newsCancel" type="button">Cancel</button></div>
        </form></div>`;
    }
    function pageNews() {
      const rows = data.news.map(n => { const [cls, label] = newsState(n); return `<tr><td><b>${esc(n.title)}</b><br><span class="muted">${esc(n.kind)}${n.link ? ' · has button' : ''}${n.media.source !== 'none' ? (n.mediaFound ? ' · media ✓' : ' · <b>media missing</b>') : ''}</span></td>
        <td><span class="bd-status ${cls}">${label}</span></td><td>${esc(fmtDate(n.startsAt))}</td><td>${esc(fmtDate(n.endsAt))}</td>
        <td><button class="action-btn" data-news-edit="${esc(n.id)}">Edit</button> <button class="action-btn" data-news-toggle="${esc(n.id)}">${n.enabled ? 'Hide' : 'Show'}</button> <button class="action-btn danger" data-news-del="${esc(n.id)}">Delete</button></td></tr>`; }).join('');
      return `${newsForm ? newsFormHtml() : ''}<div class="panel"><div class="panel-head"><div><h3>Announcements</h3><p>Newest first. Expired items stay here until you delete them.</p></div><button class="primary-btn" id="newsNew" type="button">+ New announcement</button></div>
        <div class="table-wrap"><table><thead><tr><th>TITLE</th><th>STATE</th><th>FROM</th><th>UNTIL</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">No announcements yet.</td></tr>'}</tbody></table></div></div>`;
    }

    function pagePlayers() {
      return `<div class="panel"><div class="panel-head"><div><h3>Player visibility</h3><p>Hidden players disappear from every public list, feed and raid card. Banned accounts are hidden automatically while “Hide banned” is on.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>IN-GAME NAME</th><th>PUBLIC</th><th></th></tr></thead><tbody>${data.players.map(p => `<tr><td><b>${esc(p.nickname)}</b></td><td>${p.hidden ? '<span class="status open">HIDDEN</span>' : '<span class="status resolved">VISIBLE</span>'}</td><td><button class="action-btn" data-board-hide="${esc(p.profileId)}" data-hidden="${p.hidden ? 'false' : 'true'}">${p.hidden ? 'Show' : 'Hide'}</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No players yet.</td></tr>'}</tbody></table></div></div>`;
    }

    function render() {
      const running = data.runtime.running;
      const tabs = [['general', 'Overview'], ['look', 'Look & content'], ['layout', 'Layout'], ['news', 'Announcements'], ['players', 'Players']];
      const pages = { general: pageGeneral, look: pageLook, layout: pageLayout, news: pageNews, players: pagePlayers };
      view.innerHTML = `<div class="view-intro"><div><h2>Public Status Site</h2><p>Read-only leaderboard, online list, raids, flea market and announcements for your players. Separate from this panel; it never shows account names, IDs or IPs.</p></div>
        <span class="pill ${running ? 'green-pill' : 'red-pill'}">${running ? 'RUNNING' : 'OFF'}</span></div>
        <div class="tab-row">${tabs.map(([id, label]) => `<button class="subtab${tab === id ? ' active' : ''}" data-bd-tab="${id}">${label}</button>`).join('')}</div>${pages[tab]()}`;
    }

    // ---- actions -----------------------------------------------------------------------------------------------
    async function save(body, okMsg) { try { data = (await api('/api/board/settings', body)).board; layout = null; layout = JSON.parse(JSON.stringify(data.settings.layout)); render(); toast(okMsg); } catch (e) { toast(explain(e), true); await refresh(); } }
    async function saveNews(item, okMsg) { try { data = (await api('/api/board/news', { item })).board; newsForm = null; render(); toast(okMsg); } catch (e) { toast(explain(e), true); } }

    view.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target, d = new FormData(f), on = bool(d);
      if (f.id === 'boardServerForm') {
        if (!confirm('Apply the new address/port and restart the public site now?')) return;
        return save({ enabled: d.get('enabled') === 'true', host: String(d.get('host')).trim(), port: Number(d.get('port')) }, 'Site settings applied');
      }
      if (f.id === 'boardLookForm') {
        const src = d.get('bgSource'), value = src === 'media' ? d.get('bgMedia') : src === 'path' ? String(d.get('bgPath')).trim() : '';
        const effective = src !== 'none' && !value ? 'none' : src;
        return save({
          serverName: d.get('serverName'), tagline: d.get('tagline'), language: d.get('language'), accent: d.get('accent'), refreshSeconds: Number(d.get('refreshSeconds')),
          background: { source: effective, value, overlay: Number(d.get('overlay')) },
          sections: { ...data.settings.sections, trades: on('sec_trades'), feed: on('sec_feed') },
          showPmc: on('showPmc'), showPmcBadge: on('showPmcBadge'), onlineIncludesMarket: on('onlineIncludesMarket'), showMarketTraders: on('showMarketTraders'), hideBanned: on('hideBanned'),
          marketTradersLimit: Number(d.get('marketTradersLimit')), leaderboardLimit: Number(d.get('leaderboardLimit')), raidTtlMinutes: Number(d.get('raidTtlMinutes')),
          score: Object.fromEntries(['level', 'kill', 'survived', 'headshot', 'boss', 'death'].map(k => [k, Number(d.get(`w_${k}`))]))
        }, 'Look & content saved');
      }
      if (f.id === 'boardNewsForm') {
        const src = d.get('mSource'), value = src === 'media' ? d.get('mMedia') : src === 'path' ? String(d.get('mPath')).trim() : '';
        const url = String(d.get('linkUrl')).trim(), label = String(d.get('linkLabel')).trim();
        const item = { title: d.get('title'), text: d.get('text'), kind: d.get('kind'), enabled: d.get('enabled') === 'true', startsAt: fromLocalInput(d.get('startsAt')), endsAt: fromLocalInput(d.get('endsAt')), media: { source: src !== 'none' && !value ? 'none' : src, value }, link: url ? { url, label } : null };
        if (newsForm && newsForm.id) item.id = newsForm.id;
        return saveNews(item, newsForm && newsForm.id ? 'Announcement saved' : 'Announcement published');
      }
    });

    view.addEventListener('click', async e => {
      const t = e.target;
      const tabBtn = t.closest('[data-bd-tab]'); if (tabBtn) { tab = tabBtn.dataset.bdTab; render(); return; }
      const hide = t.closest('[data-board-hide]');
      if (hide) { try { data = (await api('/api/board/hide', { profileId: hide.dataset.boardHide, hidden: hide.dataset.hidden === 'true' })).board; render(); } catch (err) { toast(explain(err), true); } return; }
      if (t.id === 'boardResetPmc' && confirm('Erase all collected AI PMC statistics?')) { try { data = (await api('/api/board/reset-pmc', {})).board; render(); toast('AI PMC statistics reset'); } catch (err) { toast(explain(err), true); } return; }
      // layout editor
      const move = t.closest('[data-move]');
      if (move) { const li = move.closest('.bd-item'); reorder(li.dataset.group, Number(li.dataset.i), Number(li.dataset.i) + Number(move.dataset.move)); return; }
      if (t.id === 'layoutSave') { ensureLayout(); const { sections, ...rest } = layout; return save({ layout: rest, sections }, 'Layout saved'); }
      if (t.id === 'layoutReset') { layout = JSON.parse(JSON.stringify(data.layoutDefaults)); layout.sections = { ...data.settings.sections, leaderboard: true, online: true, raids: true, market: true }; render(); toast('Defaults loaded — press Save layout to apply'); return; }
      if (t.id === 'layoutDiscard') { layout = JSON.parse(JSON.stringify(data.settings.layout)); render(); return; }
      // announcements
      if (t.id === 'newsNew') { newsForm = { title: '', text: '', kind: 'news', enabled: true, startsAt: null, endsAt: null, media: { source: 'none', value: '' }, link: null }; render(); view.scrollIntoView({ block: 'start' }); return; }
      if (t.id === 'newsCancel') { newsForm = null; render(); return; }
      const edit = t.closest('[data-news-edit]'); if (edit) { newsForm = JSON.parse(JSON.stringify(data.news.find(n => n.id === edit.dataset.newsEdit))); render(); view.scrollIntoView({ block: 'start' }); return; }
      const tog = t.closest('[data-news-toggle]'); if (tog) { const n = data.news.find(x => x.id === tog.dataset.newsToggle); return saveNews({ id: n.id, title: n.title, enabled: !n.enabled }, n.enabled ? 'Announcement hidden' : 'Announcement visible'); }
      const del = t.closest('[data-news-del]');
      if (del && confirm('Delete this announcement permanently?')) { try { data = (await api('/api/board/news', { op: 'delete', id: del.dataset.newsDel })).board; render(); toast('Announcement deleted'); } catch (err) { toast(explain(err), true); } }
    });
    view.addEventListener('change', e => {
      const box = e.target.closest('[data-toggle]'); if (!box) return;
      ensureLayout();
      const li = box.closest('.bd-item'), group = li.dataset.group, id = box.dataset.toggle;
      if (group === 'tabs') { if (id === 'activity') { layout.sections.feed = box.checked; layout.sections.trades = box.checked; } else layout.sections[id] = box.checked; }
      else layout[group][Number(li.dataset.i)].enabled = box.checked;
      render();
    });
    // drag & drop reordering (the ▲▼ buttons cover touch screens)
    let drag = null;
    view.addEventListener('dragstart', e => { const li = e.target.closest('.bd-item'); if (!li) return; drag = { group: li.dataset.group, i: Number(li.dataset.i) }; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'x'); } catch (_) { /* old browsers */ } });
    view.addEventListener('dragover', e => { const li = e.target.closest('.bd-item'); if (!li || !drag || li.dataset.group !== drag.group) return; e.preventDefault(); view.querySelectorAll('.bd-item.over').forEach(x => x.classList.remove('over')); li.classList.add('over'); });
    view.addEventListener('drop', e => { const li = e.target.closest('.bd-item'); if (!li || !drag || li.dataset.group !== drag.group) return; e.preventDefault(); const from = drag.i; drag = null; reorder(li.dataset.group, from, Number(li.dataset.i)); });
    view.addEventListener('dragend', () => { drag = null; view.querySelectorAll('.bd-item.over,.bd-item.dragging').forEach(x => x.classList.remove('over', 'dragging')); });

    nav.addEventListener('click', e => {
      if (!e.target.closest('[data-view="board"]')) return;
      const title = $('#pageTitle'); if (title) title.textContent = 'Public Status Site';
      refresh();
    });
  } catch (err) { console.warn('Status site admin add-on not loaded:', err); }
})();
