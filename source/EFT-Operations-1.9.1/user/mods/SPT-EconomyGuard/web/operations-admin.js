'use strict';
// EFT Operations mission authoring add-on for the existing token-protected admin panel.
(() => {
  try {
    const $ = (s, r = document) => r.querySelector(s);
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nav = $('#mainNav'), content = $('#appContent');
    if (!nav || !content) return;
    let missions = [], selected = null, objectives = [], tab = 'missions', svmStatus = null;
    const button = document.createElement('button');
    button.className = 'nav-item'; button.dataset.view = 'operations';
    button.innerHTML = '<span class="nav-icon">⚔</span>Operations';
    nav.insertBefore(button, nav.querySelector('[data-view="settings"]') || null);
    const view = document.createElement('div'); view.className = 'view'; view.id = 'view-operations'; content.append(view);
    const toast = (message, error = false) => { const el = $('#toast'); if (!el) return; el.textContent = message; el.classList.toggle('error', error); el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3500); };
    async function api(route, body) {
      const token = localStorage.getItem('eg_admin_token') || '';
      const res = await fetch(route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
      const json = await res.json().catch(() => ({})); if (!res.ok) throw new Error(json.error || `HTTP_${res.status}`); return json;
    }
    const dateValue = v => v ? new Date(v).toLocaleString() : '—';
    const newMission = () => ({ title: '', description: '', map: 'bigmap', mode: 'squad', minPlayers: 2, maxPlayers: 4, campaignId: '', campaignOrder: 0, requiredPoints: 0, startAt: null, endAt: null, briefing: { kind: 'letter', body: '', media: '' }, rewards: { points: 500, roubles: 0, items: [] } });
    function resetForm() { selected = newMission(); objectives = [{ id: 'obj_1', type: 'kill', target: '', count: 5, required: true }]; render(); }
    function formHtml() {
      const m = selected || newMission();
      const dt = v => { if(!v) return ''; const d=new Date(v); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
      return `<div class="panel"><div class="panel-head"><div><h3>${m.id ? 'Edit mission draft' : 'Create mission'}</h3><p>Build the operation, define objectives and set the completion reward.</p></div><button type="button" class="secondary-btn" id="opCancel">Cancel</button></div>
        <form id="opMissionForm" class="form-grid">
          <label class="field">Mission title<input name="title" required maxlength="100" value="${esc(m.title)}" placeholder="Operation Blackout"></label>
          <label class="field">Map / location<input name="map" required maxlength="40" value="${esc(m.map)}" placeholder="bigmap"><small class="muted">Use the SPT location ID, not the display name (for example, bigmap = Customs; woods = Woods).</small></label>
          <label class="field">Campaign ID<input name="campaignId" maxlength="60" value="${esc(m.campaignId || '')}" placeholder="operation-blackout"></label>
          <label class="field">Campaign sequence<input name="campaignOrder" type="number" min="0" max="1000" value="${Number(m.campaignOrder || 0)}"></label>
          <label class="field">Minimum rank points<input name="requiredPoints" type="number" min="0" max="1000000" value="${Number(m.requiredPoints || 0)}"></label>
          <div class="field span-2"><small class="muted">Use the same Campaign ID and sequence 1, 2, 3… to create a chain. A later operation unlocks after the operator receives an approved award for every earlier operation in that campaign. Rank points are based on approved mission awards.</small></div>
          <label class="field span-2">Mission description<textarea name="description" rows="3" maxlength="4000">${esc(m.description)}</textarea></label>
          <label class="field">Team mode<select name="mode"><option value="solo"${m.mode==='solo'?' selected':''}>Solo</option><option value="squad"${m.mode==='squad'?' selected':''}>Squad</option><option value="either"${m.mode==='either'?' selected':''}>Solo or squad</option></select></label>
          <label class="field">Players · minimum / maximum<div style="display:flex;gap:8px"><input name="minPlayers" type="number" min="1" max="8" value="${m.minPlayers}" required><input name="maxPlayers" type="number" min="1" max="8" value="${m.maxPlayers}" required></div></label>
          <label class="field">Starts at<input name="startAt" type="datetime-local" value="${dt(m.startAt)}"></label>
          <label class="field">Ends at<input name="endAt" type="datetime-local" value="${dt(m.endAt)}"></label>
          <div class="field span-2"><span>Mission objectives</span><div id="opObjectives">${objectives.map((o,i)=>`<div class="op-objective" data-index="${i}"><select data-o="type"><option value="kill"${o.type==='kill'?' selected':''}>Eliminate target</option><option value="kill_type"${o.type==='kill_type'?' selected':''}>Eliminate target type</option><option value="collect"${o.type==='collect'?' selected':''}>Collect item</option><option value="extract"${o.type==='extract'?' selected':''}>Extract</option><option value="survive"${o.type==='survive'?' selected':''}>Survive</option><option value="visit"${o.type==='visit'?' selected':''}>Visit location</option><option value="raid_complete"${o.type==='raid_complete'?' selected':''}>Complete raid</option></select><input data-o="target" value="${esc(o.target)}" placeholder="Target / item / zone"><input data-o="count" type="number" min="1" max="10000" value="${o.count}"><label class="op-required"><input data-o="required" type="checkbox"${o.required?' checked':''}> Required</label><button type="button" class="action-btn danger" data-op-remove="${i}">Remove</button></div>`).join('')}</div><small class="muted">Target format: Visit = EFT place_id (for example, bunker2); Collect = item template ID; Kill / Kill type = category such as scav, boss, boss_guard, raider, rogue or pmc. Visit and kill evidence is host-attested; collected loot is an SPT-accepted client inventory delta; extract, survive and complete-raid outcomes are client-reported. Every category requires review before rewards.</small><button type="button" class="secondary-btn" id="opAddObjective">＋ Add objective</button></div>
          <label class="field">Briefing type<select name="briefingKind"><option value="letter"${m.briefing?.kind==='letter'?' selected':''}>Military letter</option><option value="video"${m.briefing?.kind==='video'?' selected':''}>Video briefing</option><option value="audio"${m.briefing?.kind==='audio'?' selected':''}>Audio briefing</option><option value="scene"${m.briefing?.kind==='scene'?' selected':''}>3D scene (adapter pending)</option></select></label>
          <label class="field">Briefing media path / URL<input name="briefingMedia" maxlength="300" value="${esc(m.briefing?.media||'')}" placeholder="media/briefing/operation-01.mp4"></label>
          <label class="field span-2">Briefing message<textarea name="briefingBody" rows="4" maxlength="8000">${esc(m.briefing?.body||'')}</textarea></label>
          <label class="field">Reward points<input name="points" type="number" min="0" max="1000000" value="${m.rewards?.points||0}"></label>
          <label class="field">Reward roubles<input name="roubles" type="number" min="0" max="50000000" value="${m.rewards?.roubles||0}"></label>
          <div class="callout span-2"><b>Reward delivery</b><p>Approved points are recorded in the rank ledger. Roubles and item rewards are sent through SPT system mail after an administrator approves the raid review. Failed or interrupted delivery is held for manual reconciliation; it is never retried automatically.</p></div>
          <div class="form-actions span-2"><button class="primary-btn" type="submit">Save mission draft</button><button class="secondary-btn" type="button" id="opExport">Export JSON</button><label class="secondary-btn" style="cursor:pointer">Import JSON<input id="opImport" type="file" accept="application/json,.json" hidden></label></div>
        </form></div>`;
    }
    function missionRows() {
      const ordered = missions.slice().sort((a,b) => String(a.campaignId || '').localeCompare(String(b.campaignId || '')) || Number(a.campaignOrder || 0) - Number(b.campaignOrder || 0) || String(a.title || '').localeCompare(String(b.title || '')));
      return ordered.map(m=>`<tr><td><b>${esc(m.title)}</b><div class="muted">${esc(m.map)} · ${esc(m.mode)} · ${m.minPlayers}-${m.maxPlayers} players</div><div class="muted">${m.campaignId ? 'CAMPAIGN ' + esc(m.campaignId) + (Number(m.campaignOrder||0) ? ' · OP ' + Number(m.campaignOrder) : '') : 'STANDALONE'} · ${Number(m.requiredPoints||0) > 0 ? Number(m.requiredPoints).toLocaleString() + ' MINIMUM RANK POINTS' : 'NO RANK GATE'}</div></td><td><span class="status ${m.status==='published'?'resolved':m.status==='draft'?'pending':'open'}">${esc(m.status.toUpperCase())}</span></td><td>${m.objectives.length} objectives</td><td>${Number(m.rewards?.points||0).toLocaleString()} pts</td><td>${dateValue(m.updatedAt)}</td><td><button class="action-btn" data-op-edit="${esc(m.id)}" ${m.status!=='draft'?'disabled':''}>Edit</button> ${m.status==='draft'?`<button class="action-btn" data-op-publish="${esc(m.id)}">Publish</button>`:m.status==='published'?`<button class="action-btn danger" data-op-close="${esc(m.id)}">Close</button>`:''}</td></tr>`).join('');
    }
    function render() {
      view.innerHTML = `<div class="view-intro"><div><h2>EFT Operations</h2><p>Create military-style missions, publish them as Events on the existing public status site and track the award ledger.</p></div><span class="pill green-pill">MISSION AUTHORING</span></div>
        <div class="tab-row"><button class="subtab${tab==='missions'?' active':''}" data-op-tab="missions">Missions</button><button class="subtab${tab==='leaderboard'?' active':''}" data-op-tab="leaderboard">Ranks & leaderboard</button><button class="subtab${tab==='awards'?' active':''}" data-op-tab="awards">Award ledger</button><button class="subtab${tab==='reviews'?' active':''}" data-op-tab="reviews">Raid reviews</button><button class="subtab${tab==='fika'?' active':''}" data-op-tab="fika">Fika link</button><button class="subtab${tab==='svm'?' active':''}" data-op-tab="svm">SVM / Economy</button></div>
        ${tab==='missions'?`${selected?formHtml():''}<div class="panel"><div class="panel-head"><div><h3>Mission library</h3><p>Drafts can be edited; published missions are locked to preserve the active event revision.</p></div><button class="primary-btn" id="opNew">＋ New mission</button></div><div class="table-wrap"><table><thead><tr><th>MISSION</th><th>STATE</th><th>OBJECTIVES</th><th>REWARD</th><th>UPDATED</th><th></th></tr></thead><tbody>${missionRows()||'<tr><td colspan="6" class="empty">No missions yet. Create the first operation.</td></tr>'}</tbody></table></div></div>`:tab==='leaderboard'?'<div class="panel"><div class="panel-head"><div><h3>Player ranks</h3><p>Ranks are calculated from verified mission points.</p></div></div><div id="opLeaderboard"></div></div>':tab==='awards'?'<div class="panel"><div class="panel-head"><div><h3>Award ledger</h3><p>Every award is idempotent and retained for audit.</p></div></div><div id="opAwards"></div></div>':tab==='reviews'?'<div class="panel"><div class="panel-head"><div><h3>Raid review queue</h3><p>Unverified raid outcomes never award points automatically. Review evidence before approving.</p></div></div><div id="opReviews"></div></div>':tab==='fika'?'<div class="panel"><div class="panel-head"><div><h3>Fika integration</h3><p>Observes Fika 2.4.3 player joins and match end to link ready mission squads. Raid outcome reports remain untrusted until admin review.</p></div></div><div id="opFikaStatus"></div><div id="opFikaEvents"></div></div>':'<div class="panel"><div class="panel-head"><div><h3>SVM · Active server economy preset</h3><p>Live preset reader and controlled settings editor.</p></div></div><div id="opSvmStatus">Loading SVM settings…</div></div>'}`;
      if (tab==='leaderboard') loadLeaderboard(); if (tab==='awards') loadAwards(); if (tab==='reviews') loadReviews(); if (tab==='fika') loadFika(); if (tab==='svm') loadSvm();
    }
    async function refresh() { try { missions = await api('/api/operations'); render(); } catch(e) { view.innerHTML = `<div class="view-intro"><h2>EFT Operations</h2><p>${esc(e.message)}</p></div><div class="callout"><b>Operations service unavailable</b><p>Check that the EconomyGuard mod is loaded with operations enabled.</p></div>`; } }
    function collectForm(f) {
      const d = new FormData(f), rows = [...$('#opObjectives').querySelectorAll('.op-objective')];
      const clean = rows.map((row,i)=>({ id:`obj_${i+1}`, type:row.querySelector('[data-o="type"]').value, target:row.querySelector('[data-o="target"]').value.trim(), count:Number(row.querySelector('[data-o="count"]').value), required:row.querySelector('[data-o="required"]').checked }));
      return { ...(selected?.id?{id:selected.id}:{}), title:d.get('title'), map:d.get('map'), description:d.get('description'), mode:d.get('mode'), minPlayers:Number(d.get('minPlayers')), maxPlayers:Number(d.get('maxPlayers')), campaignId:d.get('campaignId'), campaignOrder:Number(d.get('campaignOrder')||0), requiredPoints:Number(d.get('requiredPoints')||0), startAt:d.get('startAt')?new Date(d.get('startAt')).toISOString():null, endAt:d.get('endAt')?new Date(d.get('endAt')).toISOString():null, objectives:clean, briefing:{kind:d.get('briefingKind'),media:d.get('briefingMedia'),body:d.get('briefingBody')}, rewards:{points:Number(d.get('points')),roubles:Number(d.get('roubles')),items:selected?.rewards?.items||[]} };
    }
    function syncCurrentForm() { const f=$('#opMissionForm'); if(!f) return; const draft=collectForm(f); selected=draft; objectives=draft.objectives.map(x=>({...x})); }
    async function loadLeaderboard() { try { const rows=await api('/api/operations/leaderboard'); $('#opLeaderboard').innerHTML=`<div class="table-wrap"><table><thead><tr><th>PLAYER</th><th>RANK</th><th>POINTS</th><th>NEXT PROMOTION</th><th>COMPLETED</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.displayName||'Unknown operator')}</td><td>${esc(x.rank)}</td><td>${Number(x.points).toLocaleString()}</td><td>${esc(x.nextRank||'MAX RANK')}<div class="muted">${Number(x.pointsToNextRank||0).toLocaleString()} pts · ${Number(x.rankProgressPercent == null ? 100 : x.rankProgressPercent)}%</div></td><td>${x.completedMissions}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No verified awards yet.</td></tr>'}</tbody></table></div>`; } catch(e) { toast(e.message,true); } }
    async function loadAwards() { try { const rows=await api('/api/operations/awards'); $('#opAwards').innerHTML=`<div class="table-wrap"><table><thead><tr><th>MISSION</th><th>PLAYER</th><th>POINTS</th><th>ROUBLES</th><th>DELIVERY</th><th>DATE</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.missionTitle||'Archived operation')}</td><td>${esc(x.displayName||'Unknown operator')}</td><td>${x.points}</td><td>${Number(x.roubles||0).toLocaleString()}</td><td title="${esc(x.deliveryError||'')}">${esc(x.status)} ${['delivery_attention_required','delivering'].includes(x.status)?'<button class="action-btn" data-op-delivery="'+esc(x.id)+'">RECONCILE</button>':''}</td><td>${dateValue(x.createdAt)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No awards recorded.</td></tr>'}</tbody></table></div>`; } catch(e) { toast(e.message,true); } }
    async function loadReviews() {
      try {
        const rows = await api('/api/operations/reviews');
        const rowHtml = rows.map(g => {
          const events = Array.isArray(g.fikaEvidence) ? g.fikaEvidence : [];
          const raidEnds = events.filter(x => x.type === 'player_raid_end');
          const deathReports = events.filter(x => x.type === 'fika_player_died').length;
          const victimCount = raidEnds.reduce((sum, x) => sum + Number(x.reportedVictimCount || 0), 0);
          const corroboratedCount = raidEnds.reduce((sum, x) => sum + Number(x.corroboratedVictimCount || 0), 0);
          const lootCount = raidEnds.reduce((sum, x) => sum + Number(x.reportedLootItemCount || 0), 0);
          const safeEvidence = events.map(x => ({
            type: x.type,
            operator: x.displayName || '',
            map: x.map || '',
            exitStatus: x.exitStatus || '',
            exitName: x.exitName || '',
            trust: x.evidenceTrust || '',
            victims: (x.reportedVictims || []).map(v => ({
              name: v.name, role: v.role, side: v.side, level: v.level,
              distance: v.distance, weapon: v.weapon, location: v.location,
              corroboratedByFikaDeathReport: v.corroboratedByFikaDeathReport
            })),
            lootByTemplate: x.reportedLootByTpl || {},
            lootItems: (x.reportedLootItems || []).map(v => ({ tpl: v.tpl, count: v.count, acceptedBySpt: v.acceptedBySpt })),
            sessionCounters: x.reportedSessionCounters || []
          }));
          const summary = raidEnds.length
            ? raidEnds.length + ' raid reports · ' + victimCount + ' victims · ' + corroboratedCount + ' Fika corroborated · ' + lootCount + ' accepted loot units · ' + deathReports + ' death reports'
            : events.length + ' Fika events · ' + deathReports + ' death reports';
          const objectiveRows = Array.isArray(g.objectiveEvidence) ? g.objectiveEvidence : [];
          const hostEvidence = Array.isArray(g.hostEvidence) ? g.hostEvidence : [];
          const hasHostAttested = objectiveRows.some(item => Number(item.hostAttestedCount || 0) > 0);
          const hasSptAccepted = objectiveRows.some(item => Number(item.sptAcceptedCount || 0) > 0);
          const hasClientReported = objectiveRows.some(item => Number(item.clientReportedCount || 0) > 0);
          const objectiveLabel = hasHostAttested ? 'Host-attested progress · admin review required'
            : hasSptAccepted ? 'SPT-accepted client inventory delta · admin review required'
              : hasClientReported ? 'Client-reported raid outcome · admin review required'
                : (g.reviewData?.requiredDone ? 'Objective counts met · outcome review required' : 'Objectives incomplete');
          const objectiveHtml = objectiveRows.length
            ? '<details><summary>' + esc(objectiveLabel + ' · ' + objectiveRows.length + ' objectives') + '</summary><pre>' + esc(JSON.stringify(objectiveRows, null, 2)) + '</pre></details>'
            : objectiveLabel;
          const evidence = events.length || hostEvidence.length
            ? '<details><summary>' + esc(summary + ' · ' + hostEvidence.length + ' host-attested events') + '</summary><pre>' + esc(JSON.stringify({ raidEvents: safeEvidence, hostEvidence, objectiveEvidence: objectiveRows }, null, 2)) + '</pre></details>'
            : 'No linked Fika evidence';
          return `<tr><td class="mono">${esc(String(g.id).slice(0, 12))}</td><td>${esc(g.missionTitle || g.missionId)}</td><td>${(g.members || []).map(m => esc(m.displayName || 'Unknown operator')).join(', ')}</td><td>${objectiveHtml}</td><td>${evidence}</td><td>${dateValue(g.finishedAt)}</td><td><button class="action-btn" data-op-review="approve" data-group="${esc(g.id)}">Approve</button> <button class="action-btn danger" data-op-review="deny" data-group="${esc(g.id)}">Deny</button></td></tr>`;
        }).join('');
        $('#opReviews').innerHTML = `<div class="table-wrap"><table><thead><tr><th>GROUP</th><th>MISSION</th><th>MEMBERS</th><th>OBJECTIVES</th><th>FIKA EVIDENCE</th><th>SUBMITTED</th><th>ACTION</th></tr></thead><tbody>${rowHtml || '<tr><td colspan="7" class="empty">No raids waiting for review.</td></tr>'}</tbody></table></div>`;
      } catch (e) { toast(e.message, true); }
    }
    async function loadSvm() {
      try {
        const s = await api('/api/svm');
        svmStatus = s;
        const host = $('#opSvmStatus');
        if (!s.available) { host.innerHTML = '<div class="callout"><b>SVM unavailable</b><p>' + esc(s.reason || 'SVM_NOT_AVAILABLE') + '</p></div>'; return; }
        const markup = s.traderMarkup || {}, sell = s.traderSell || {};
        const names = Array.from(new Set(Object.keys(markup).concat(Object.keys(sell))));
        const rows = names.map(name => '<tr><td><b>'+esc(name)+'</b></td><td><input data-svm-markup="'+esc(name)+'" type="number" min="0" max="100" step="0.1" required value="'+(markup[name] == null ? '' : esc(markup[name]))+'" '+(markup[name] == null ? 'disabled' : '')+'></td><td><input data-svm-sell="'+esc(name)+'" type="number" min="0" max="1000" step="0.01" required value="'+(sell[name] == null ? '' : esc(sell[name]))+'" '+(sell[name] == null ? 'disabled' : '')+'></td></tr>').join('');
        host.innerHTML = '<div class="callout"><b>SVM '+esc(s.version)+' · Preset '+esc(s.activePreset)+'</b><p>Only the active preset is edited. Trader section: '+(s.tradersEnabled ? 'ENABLED' : 'DISABLED')+'. TraderMarkup is the trader buyback rate: SVM stores buy_price_coef = 100 - value, so 20 means the trader pays 20% of handbook value when buying from the player. TraderSell multiplies currency-based trader offer costs; barter-only offers are not changed by this field. Item section: '+(s.itemsEnabled ? 'ENABLED' : 'DISABLED (ItemPriceMult is stored but inactive)')+'. Fence section: '+(s.fence && s.fence.enabled ? 'ENABLED' : 'DISABLED (displayed Fence values are stored but inactive)')+'. A backup is created before changes. Restart SPT to apply. '+(s.compatible ? 'Version check passed.' : 'Version not verified; saving is disabled.')+(s.unsupportedTraderSellKeys&&s.unsupportedTraderSellKeys.length ? ' Unsupported TraderSell keys ignored by SVM v1.11.1: '+s.unsupportedTraderSellKeys.map(esc).join(', ')+'.' : '')+'</p></div>' +
          '<form id="opSvmForm"><div class="form-grid"><label class="field"><input type="checkbox" name="tradersEnabled" '+(s.tradersEnabled ? 'checked' : '')+'> Enable SVM Trader settings</label><label class="field"><input type="checkbox" name="itemsEnabled" '+(s.itemsEnabled ? 'checked' : '')+'> Enable SVM Item settings</label></div><div class="table-wrap"><table><thead><tr><th>TRADER</th><th>TRADER BUYBACK RATE (%)</th><th>CURRENCY OFFER COST MULTIPLIER (×)</th></tr></thead><tbody>'+rows+'</tbody></table></div>' +
          '<div class="form-grid"><label class="field">Items · ItemPriceMult ('+(s.itemsEnabled ? 'active' : 'inactive')+')<input name="itemPriceMultiplier" type="number" min="0" max="1000" step="0.01" value="'+(s.itemPriceMultiplier == null ? '' : esc(s.itemPriceMultiplier))+'" required></label>' +
          '<label class="field">Fence · Price multiplier<input name="fencePriceMultiplier" type="number" min="0" max="1000" step="0.01" value="'+(s.fence.priceMultiplier == null ? '' : esc(s.fence.priceMultiplier))+'"></label>' +
          '<label class="field">Fence · Preset multiplier<input name="fencePresetMultiplier" type="number" min="0" max="1000" step="0.01" value="'+(s.fence.presetMultiplier == null ? '' : esc(s.fence.presetMultiplier))+'"></label>' +
          '<label class="field">Fence · Stock time minimum<input name="fenceStockTimeMin" type="number" min="1" max="10080" step="1" value="'+(s.fence.stockTimeMin == null ? '' : esc(s.fence.stockTimeMin))+'"></label>' +
          '<label class="field">Fence · Stock time maximum<input name="fenceStockTimeMax" type="number" min="1" max="10080" step="1" value="'+(s.fence.stockTimeMax == null ? '' : esc(s.fence.stockTimeMax))+'"></label></div>' +
          '<div class="form-actions"><button class="primary-btn" type="submit" '+(s.compatible ? '' : 'disabled')+'>Save SVM settings</button><button class="secondary-btn" type="button" id="opSvmReload">Refresh</button><button class="secondary-btn" type="button" id="opSvmArchives">Search ZIP archives</button></div></form><div id="opSvmArchivesResult"></div>';
      } catch(e) { toast(e.message, true); }
    }
    async function loadSvmArchives() {
      try {
        const result = await api('/api/svm/archives');
        const host = $('#opSvmArchivesResult');
        const rows = (result.archives || []).map(archive => '<tr><td><b>'+esc(archive.path)+'</b></td><td>'+esc(archive.size)+'</td><td>'+archive.matches.map(item => esc(item.entry)+(item.encrypted ? ' · encrypted' : '')).join('<br>')+'</td><td><button type="button" class="action-btn" data-svm-preview="'+esc(archive.path)+'">Preview JSON</button></td></tr>').join('');
        host.innerHTML = '<div class="callout"><b>ZIP archive scan</b><p>Scanned '+esc(result.scannedArchives)+' archives · '+esc(result.matchingArchives)+' contain SVM loader/preset JSON entries'+(result.truncated?' · scan limit reached':'')+'. Archives are indexed only; nothing is extracted or modified.</p></div><div class="table-wrap"><table><thead><tr><th>ARCHIVE</th><th>SIZE (BYTES)</th><th>MATCHING ENTRIES</th><th></th></tr></thead><tbody>'+(rows || '<tr><td colspan="4" class="empty">No SVM preset archives found.</td></tr>')+'</tbody></table></div>';
      } catch (e) { toast(e.message, true); }
    }
    async function previewSvmArchive(archive) {
      try {
        const result = await api('/api/svm/archive-preview?archive=' + encodeURIComponent(archive));
        const host = $('#opSvmArchivesResult');
        const blocks = (result.entries || []).map(entry => '<div class="callout"><b>'+esc(entry.name)+'</b><p>'+(entry.ok ? 'JSON parsed successfully.' : 'Preview unavailable: '+esc(entry.error))+'</p>'+(entry.ok ? '<pre>'+esc(JSON.stringify(entry.data, null, 2))+'</pre>' : '')+'</div>').join('');
        const preview = result.preview || {};
        const note = preview.truncated
          ? '<div class="callout"><b>Preview محدود شد</b><p>'+esc(preview.previewedEntries || result.entries.length)+' مورد از '+esc(preview.totalMatchingEntries || result.entries.length)+' ورودی نمایش داده شد. سقف این پیش‌نمایش ۵۰ فایل و ۴ مگابایت است؛ فایل ZIP تغییری نکرده است.</p></div>'
          : '<div class="callout"><p>'+esc(preview.previewedEntries || result.entries.length)+' ورودی · '+esc(preview.previewBytes || 0)+' بایت JSON خوانده شد.</p></div>';
        host.insertAdjacentHTML('beforeend', '<h3>Archive preview · '+esc(result.archive)+'</h3>'+note+blocks);
      } catch (e) { toast(e.message, true); }
    }
    async function loadFika() { try { const data=await api('/api/operations/fika'); const s=data.status||{}; $('#opFikaStatus').innerHTML=`<div class="callout"><b>${s.enabled?'Fika Server '+esc(s.serverVersion)+' detected':'Fika observer unavailable'}</b><p>Fika client target: ${esc(s.fikaClientTargetVersion||'unknown')} · config Last Version (advisory only): ${esc(s.fikaClientConfigLastVersion||'unknown')} · Operations plugin source: ${esc(s.operationsClientPluginVersion||'not built')} · ${esc(s.observerInstalled?'All required Fika hooks are active':'Hook state: '+(s.hookState||'pending')+' · Missing: '+((s.missingHooks||[]).join(', ')||'unknown'))}</p><p>Lifecycle hook: ${s.lifecycleHook?'installed':'waiting'} · Update identity guard: ${s.updateIdentityHook?'installed':'waiting'} · Raid identity guard: ${s.raidIdentityHook?'installed':'waiting'} · Player-join hook: ${s.playerJoinHook?'installed':'waiting'} · Match lifecycle hook: ${(s.matchEndHook&&s.matchDeleteHook&&s.matchCreateHook)?'installed':'waiting'}</p><p>Fika item sending: ${s.itemSending&&s.itemSending.configured?(s.itemSending.enabled?'ENABLED — transfer route is not monitored':'DISABLED — transfer route closed'):'UNKNOWN — verify fika.jsonc'}.</p><p>Raid reports are labelled <code>untrusted_client_report</code>; no automatic mission awards are generated from these records.</p></div>`; const rows=data.events||[]; $('#opFikaEvents').innerHTML=`<div class="table-wrap"><table><thead><tr><th>TYPE</th><th>OPERATOR / MATCH</th><th>MAP</th><th>RESULT</th><th>EXIT</th><th>RAID EVIDENCE</th><th>TRUST</th><th>TIME</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.type)}</td><td class="mono">${esc(x.displayName||'Fika event')}</td><td>${esc(x.map||'—')}</td><td>${esc(x.exitStatus||x.reason||'—')}</td><td>${esc(x.exitName||'—')}</td><td>${x.type==='player_raid_end' ? '<details><summary>'+esc((x.reportedVictimCount||0)+' victims · '+(x.corroboratedVictimCount||0)+' Fika corroborated · '+(x.reportedLootItemCount||0)+' accepted loot units · '+(x.reportedSessionCounters||[]).length+' counters')+'</summary><pre>'+esc(JSON.stringify({victims:(x.reportedVictims||[]).map(v=>({name:v.name,role:v.role,side:v.side,level:v.level,distance:v.distance,weapon:v.weapon,location:v.location,corroboratedByFikaDeathReport:v.corroboratedByFikaDeathReport})),lootByTemplate:x.reportedLootByTpl||{},lootItems:(x.reportedLootItems||[]).map(v=>({tpl:v.tpl,count:v.count,acceptedBySpt:v.acceptedBySpt})),lootSnapshotAvailable:!!x.lootSnapshotAvailable,sessionCounters:x.reportedSessionCounters||[]},null,2))+'</pre></details>' : x.type==='fika_player_died' ? 'Authenticated player-death report; no killer identity' : '—'}</td><td>${esc(x.evidenceTrust||'—')}</td><td>${dateValue(x.timestamp)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No Fika raid records yet.</td></tr>'}</tbody></table></div>`; } catch(e) { toast(e.message,true); } }
    view.addEventListener('click', e=>{
      if(e.target.id==='opSvmArchives') loadSvmArchives();
      const preview = e.target.closest('[data-svm-preview]');
      if(preview) previewSvmArchive(preview.dataset.svmPreview);
    });
    view.addEventListener('submit', async e=>{
      if(e.target.id==='opSvmForm') {
        e.preventDefault();
        try {
          const data = new FormData(e.target), traderMarkup = {}, traderSell = {};
          e.target.querySelectorAll('[data-svm-markup]').forEach(el=>{ if(!el.disabled) traderMarkup[el.dataset.svmMarkup]=Number(el.value); });
          e.target.querySelectorAll('[data-svm-sell]').forEach(el=>{ if(!el.disabled) traderSell[el.dataset.svmSell]=Number(el.value); });
          if (!svmStatus || !/^[a-f0-9]{64}$/i.test(String(svmStatus.presetRevision || ''))) throw new Error('SVM status changed; refresh the settings before saving.');
          const payload = { expectedPresetRevision:svmStatus.presetRevision, tradersEnabled:data.get('tradersEnabled') === 'on', itemsEnabled:data.get('itemsEnabled') === 'on', traderMarkup, traderSell, itemPriceMultiplier:Number(data.get('itemPriceMultiplier')) };
          const fence = {};
          [['fencePriceMultiplier','priceMultiplier'],['fencePresetMultiplier','presetMultiplier'],['fenceStockTimeMin','stockTimeMin'],['fenceStockTimeMax','stockTimeMax']].forEach(pair=>{ if(data.get(pair[0])!=='') fence[pair[1]]=Number(data.get(pair[0])); });
          if(Object.keys(fence).length) payload.fence=fence;
          const result=await api('/api/svm/update',payload); await loadSvm();
          toast(result.changed ? 'SVM saved. Restart SPT to apply.' : 'No SVM changes.');
        } catch(err) { toast(err.message,true); }
        return;
      }
      if(e.target.id!=='opMissionForm') return; e.preventDefault(); try { const result=await api('/api/operations/save',collectForm(e.target)); selected=null; objectives=[]; await refresh(); toast(`Saved draft: ${result.mission.title}`); } catch(err) { toast(err.message,true); }
    });
    view.addEventListener('click', async e=>{
      const t=e.target;
      if(t.closest('[data-op-tab]')) { tab=t.closest('[data-op-tab]').dataset.opTab; selected=null; render(); return; }
      if(t.id==='opSvmReload') { loadSvm(); return; }
      if(t.id==='opNew') { selected=newMission(); objectives=[{id:'obj_1',type:'kill',target:'',count:5,required:true}]; render(); return; }
      if(t.id==='opCancel') { selected=null; objectives=[]; render(); return; }
      if(t.id==='opAddObjective') { syncCurrentForm(); objectives.push({id:`obj_${objectives.length+1}`,type:'kill',target:'',count:1,required:true}); render(); return; }
      const rem=t.closest('[data-op-remove]'); if(rem) { syncCurrentForm(); objectives.splice(Number(rem.dataset.opRemove),1); render(); return; }
      const edit=t.closest('[data-op-edit]'); if(edit) { selected=JSON.parse(JSON.stringify(missions.find(m=>m.id===edit.dataset.opEdit))); objectives=selected.objectives.map(x=>({...x})); render(); return; }
      const pub=t.closest('[data-op-publish]'); if(pub&&confirm('Publish this mission and create an Event in the existing public status site?')) { try { await api('/api/operations/publish',{id:pub.dataset.opPublish}); await refresh(); toast('Mission published and Event created'); } catch(err) { toast(err.message,true); } return; }
      const close=t.closest('[data-op-close]'); if(close&&confirm('Close this published mission?')) { try { await api('/api/operations/close',{id:close.dataset.opClose}); await refresh(); toast('Mission closed'); } catch(err) { toast(err.message,true); } return; }
      const delivery=t.closest('[data-op-delivery]'); if(delivery) { const choice=prompt('Delivery status is uncertain. Type RETRY only after verifying no mail was sent, or DELIVERED if you verified the mail was received:'); if(!choice) return; const decision=choice.trim().toUpperCase()==='RETRY'?'retry':choice.trim().toUpperCase()==='DELIVERED'?'mark_delivered':null; if(!decision) { toast('Enter RETRY or DELIVERED',true); return; } const note=prompt('Required reconciliation note / evidence reference:'); if(!note?.trim()) return; const warning=decision==='retry'?'Retry can send duplicate items if a previous mail was already delivered. Have you verified no reward mail was sent?':'Only mark delivered after verifying the player received the reward mail.'; if(!confirm(warning+' Continue?')) return; try { await api('/api/operations/delivery/reconcile',{awardId:delivery.dataset.opDelivery,decision,note}); await loadAwards(); toast('Delivery reconciliation saved'); } catch(err) { toast(err.message,true); } return; }
      const review=t.closest('[data-op-review]'); if(review) { const decision=review.dataset.opReview; const note=prompt('Enter the evidence reference / review reason (required):'); if(!note?.trim()) return; const confirmed=decision==='approve' ? confirm('Approve rewards only if you independently verified objective completion and every listed member extraction using server-side evidence. Client raid reports alone are not proof. Continue?') : true; if(!confirmed) return; try { await api('/api/operations/review',{groupId:review.dataset.group,decision,note,attestation:{confirmed:decision==='approve',objectivesConfirmed:decision==='approve',allMembersConfirmed:decision==='approve'}}); await loadReviews(); toast('Raid review saved'); } catch(err) { toast(err.message,true); } return; }
      if(t.id==='opExport'&&selected) { const blob=new Blob([JSON.stringify(collectForm($('#opMissionForm')),null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='eft-operation.json';a.click();URL.revokeObjectURL(a.href); }
    });
    view.addEventListener('change', async e=>{ if(e.target.name==='mode') { const f=$('#opMissionForm'); if(f) { if(e.target.value==='solo') { f.elements.minPlayers.value=1; f.elements.maxPlayers.value=1; } else if(e.target.value==='squad') { f.elements.minPlayers.value=Math.max(2,Number(f.elements.minPlayers.value)||2); f.elements.maxPlayers.value=Math.max(2,Number(f.elements.maxPlayers.value)||4); if(Number(f.elements.maxPlayers.value)<Number(f.elements.minPlayers.value)) f.elements.maxPlayers.value=f.elements.minPlayers.value; } else { f.elements.minPlayers.value=1; f.elements.maxPlayers.value=Math.max(2,Number(f.elements.maxPlayers.value)||4); } } return; } if(e.target.id!=='opImport'||!e.target.files?.[0]) return; try { const data=JSON.parse(await e.target.files[0].text()); for(const key of ['id','revision','status','createdAt','updatedAt','createdBy']) delete data[key]; selected={...newMission(),...data}; objectives=Array.isArray(data.objectives)?data.objectives.map(x=>({...x})):[]; render(); toast('Mission JSON loaded. Review and save the draft.'); } catch(err) { toast(`Invalid mission JSON: ${err.message}`,true); } });
    nav.addEventListener('click',e=>{ if(!e.target.closest('[data-view="operations"]')) return; const title=$('#pageTitle');if(title)title.textContent='EFT Operations';refresh(); });
    const css=document.createElement('style'); css.textContent=`.op-objective{display:grid;grid-template-columns:145px minmax(120px,1fr) 75px auto auto;gap:7px;align-items:center;padding:8px;background:#0c1621;border:1px solid #24374b;border-radius:7px;margin:7px 0}.op-objective input:not([type=checkbox]),.op-objective select{min-width:0;width:100%;background:#0e1722;border:1px solid #2a3a4d;border-radius:6px;color:#d8e4f1;padding:8px;font:inherit;font-size:10px}.op-required{display:flex;gap:4px;align-items:center;font-size:9px;color:#9aadc2}.op-required input{accent-color:#62a7e7}@media(max-width:800px){.op-objective{grid-template-columns:1fr 1fr}.op-objective>*{min-width:0}}`; document.head.append(css);
  } catch(err) { console.warn('EFT Operations admin add-on not loaded:',err); }
})();
