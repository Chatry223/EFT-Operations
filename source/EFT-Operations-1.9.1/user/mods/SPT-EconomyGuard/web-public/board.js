'use strict';
(() => {
  const I18N = {
    en: {
      live: 'Live', offline: 'Connection lost', updated: 'Updated', ago: 'ago', now: 'just now', online_label: 'ONLINE',
      s_flea: 'Flea offers', s_raidsDone: 'Raids completed', s_kills: 'Total kills', s_registered: 'Registered players', s_activeRaids: 'Active raids',
      l_flea: 'flea offers', l_raidsDone: 'raids completed', l_kills: 'total kills', l_registered: 'registered players', l_activeRaids: 'raids in progress',
      t_leaderboard: 'Leaderboard', t_online: 'Online', t_raids: 'Raids', t_market: 'Flea market', t_activity: 'Activity', t_operations: 'Military operations',
      op_title: 'Mission standings', op_rank: 'Military rank', op_points: 'Mission points', op_completed: 'Missions completed',
      op_next: 'Next rank', op_points_to_next: 'points to next rank', op_max_rank: 'Highest rank reached', op_empty: 'No mission rewards have been recorded yet.',
      all: 'All', players: 'Players', pmcs: 'PMC (AI)', search: 'Search name…', me_ph: 'Your in-game name',
      rank: '#', name: 'Name', status: 'Status', level: 'Level', score: 'Score', kills: 'Kills', deaths: 'Deaths', kd: 'K/D', survival: 'Survival', playtime: 'Playtime',
      st_online: 'Online', st_offline: 'Offline', hours: 'h', more: 'Show more', none: 'Nothing to show yet.', headshots: 'Headshots', pmc_kills: 'PMC kills', boss_kills: 'Boss kills',
      sessions: 'Raids', survived: 'Survived', last_seen: 'Last seen', raids_count: 'Raids tracked', last_map: 'Last map', side: 'Side', tracked_note: 'AI-controlled PMC. Stats are collected from raids since tracking started.',
      you_rank: 'You are rank', of: 'of', pts: 'pts', cmp_behind: '{n} pts behind {name}', cmp_ahead: '{n} pts ahead of {name}', not_found: 'No player with that name.',
      online_players: 'Players', online_pmc: 'PMC in raid', online_market: 'Active on the flea market', online_unavailable: 'Live presence is not available right now.',
      menu: 'In menu', raid: 'In raid', stash: 'In stash', hideout: 'In hideout', flea: 'On flea', online: 'Online',
      rating: 'Rating', offers: 'offer(s)', loading: 'Loading', in_game: 'In progress', players_in: 'Players', pmc_in: 'PMC',
      recent_raids: 'Recent raid results', time: 'Time', player: 'Player', map: 'Map', result: 'Result', duration: 'Duration', kills_short: 'Kills',
      r_survived: 'Survived', r_killed: 'Killed', r_left: 'Left', r_runner: 'Run through', r_missinginaction: 'Missing', r_transit: 'Transit', r_unknown: '—',
      m_total: 'Total offers', m_players: 'Player offers', m_pmc: 'PMC offers', m_traders: 'Trader offers', top_items: 'Most listed items', item: 'Item', listings: 'Listings',
      min: 'Min', median: 'Median', max: 'Max', player_listings: 'Latest player listings', seller: 'Seller', price: 'Price', qty: 'Qty', barter: 'Barter',
      recent_trades: 'Recent flea trades', buyer: 'Buyer', pmc_trader: 'PMC trader', market_na: 'Market data is not available.',
      feed: 'Latest events', kind_pmc: 'a PMC', kind_boss: 'a boss', kind_player: 'a player', kind_scav: 'a scav', kind_unknown: 'unknown',
      e_kill: '{a} eliminated {b}', e_death: '{a} was killed by {b}', e_raid: '{a} finished a raid on {m}: {r}', e_trade: '{a} bought {q}× {i} for {p} ₽ from {s}',
      n_news: 'News', n_update: 'Update', n_event: 'Event', n_alert: 'Notice', until: 'until', prev: 'Previous', next: 'Next',
      footer: 'Statistics are updated live from the game server.'
    },
    fa: {
      live: 'زنده', offline: 'قطع ارتباط', updated: 'به‌روزرسانی', ago: 'پیش', now: 'همین الان', online_label: 'آنلاین',
      s_flea: 'آفر فلی‌مارکت', s_raidsDone: 'ریید انجام‌شده', s_kills: 'کل کشته‌ها', s_registered: 'بازیکن ثبت‌شده', s_activeRaids: 'ریید فعال',
      l_flea: 'آفر فلی‌مارکت', l_raidsDone: 'ریید انجام‌شده', l_kills: 'کشته در کل', l_registered: 'بازیکن ثبت‌شده', l_activeRaids: 'ریید در جریان',
      t_leaderboard: 'رتبه‌بندی', t_online: 'آنلاین‌ها', t_raids: 'ریدها', t_market: 'فلی‌مارکت', t_activity: 'رویدادها', t_operations: 'عملیات نظامی',
      op_title: 'رتبه‌بندی مأموریت‌ها', op_rank: 'درجه نظامی', op_points: 'امتیاز مأموریت', op_completed: 'مأموریت تکمیل‌شده',
      op_next: 'درجه بعدی', op_points_to_next: 'امتیاز تا درجه بعدی', op_max_rank: 'بالاترین درجه کسب شده', op_empty: 'هنوز پاداش مأموریتی ثبت نشده است.',
      all: 'همه', players: 'بازیکنان', pmcs: 'PMC (هوش مصنوعی)', search: 'جست‌وجوی نام…', me_ph: 'نام داخل بازی شما',
      rank: 'رتبه', name: 'نام', status: 'وضعیت', level: 'لول', score: 'امتیاز', kills: 'کشته', deaths: 'مرگ', kd: 'K/D', survival: 'بقا', playtime: 'زمان بازی',
      st_online: 'آنلاین', st_offline: 'آفلاین', hours: 'ساعت', more: 'نمایش بیشتر', none: 'هنوز چیزی برای نمایش نیست.', headshots: 'هدشات', pmc_kills: 'کشتن PMC', boss_kills: 'کشتن باس',
      sessions: 'ریدها', survived: 'زنده‌مانده', last_seen: 'آخرین حضور', raids_count: 'ریدهای ثبت‌شده', last_map: 'آخرین نقشه', side: 'سمت', tracked_note: 'PMC کنترل‌شده با هوش مصنوعی. آمار از ریدهای بعد از شروع ردیابی جمع می‌شود.',
      you_rank: 'رتبه شما', of: 'از', pts: 'امتیاز', cmp_behind: '{n} امتیاز عقب‌تر از {name}', cmp_ahead: '{n} امتیاز جلوتر از {name}', not_found: 'بازیکنی با این نام پیدا نشد.',
      online_players: 'بازیکنان', online_pmc: 'PMC در ریید', online_market: 'فعال در فلی‌مارکت', online_unavailable: 'وضعیت زنده در حال حاضر در دسترس نیست.',
      menu: 'در منو', raid: 'در ریید', stash: 'در استش', hideout: 'در هایدآوت', flea: 'در فلی', online: 'آنلاین',
      rating: 'امتیاز', offers: 'آفر', loading: 'در حال لود', in_game: 'در جریان', players_in: 'بازیکنان', pmc_in: 'PMC',
      recent_raids: 'نتیجه ریدهای اخیر', time: 'زمان', player: 'بازیکن', map: 'نقشه', result: 'نتیجه', duration: 'مدت', kills_short: 'کشته',
      r_survived: 'زنده ماند', r_killed: 'کشته شد', r_left: 'خارج شد', r_runner: 'فرار', r_missinginaction: 'گم‌شده', r_transit: 'ترنزیت', r_unknown: '—',
      m_total: 'کل آفرها', m_players: 'آفر بازیکنان', m_pmc: 'آفر PMCها', m_traders: 'آفر تریدرها', top_items: 'پرآفرترین آیتم‌ها', item: 'آیتم', listings: 'آفر',
      min: 'کمترین', median: 'میانه', max: 'بیشترین', player_listings: 'آخرین آفرهای بازیکنان', seller: 'فروشنده', price: 'قیمت', qty: 'تعداد', barter: 'بارتر',
      recent_trades: 'آخرین معاملات فلی', buyer: 'خریدار', pmc_trader: 'تاجر PMC', market_na: 'اطلاعات بازار در دسترس نیست.',
      feed: 'آخرین رویدادها', kind_pmc: 'یک PMC', kind_boss: 'یک باس', kind_player: 'یک بازیکن', kind_scav: 'یک اسکاو', kind_unknown: 'نامشخص',
      e_kill: '{a} {b} را کشت', e_death: '{a} توسط {b} کشته شد', e_raid: '{a} ریدی در {m} را تمام کرد: {r}', e_trade: '{a} تعداد {q}× {i} را به قیمت {p} ₽ از {s} خرید',
      n_news: 'خبر', n_update: 'به‌روزرسانی', n_event: 'رویداد', n_alert: 'اطلاعیه', until: 'تا', prev: 'قبلی', next: 'بعدی',
      footer: 'آمار به‌صورت زنده از سرور بازی به‌روز می‌شود.'
    }
  };
  const DEFAULT_LAYOUT = { top: [{ id: 'announcements', enabled: true }, { id: 'cards', enabled: true }], cards: [{ id: 'fleaOffers', enabled: true }], headerLines: [{ id: 'raidsCompleted', enabled: true }], tabs: ['leaderboard', 'online', 'raids', 'market', 'activity', 'operations'] };
  const STAT_KEYS = { fleaOffers: ['s_flea', 'l_flea'], raidsCompleted: ['s_raidsDone', 'l_raidsDone'], totalKills: ['s_kills', 'l_kills'], registeredPlayers: ['s_registered', 'l_registered'], activeRaids: ['s_activeRaids', 'l_activeRaids'] };
  const state = { data: null, etag: null, lang: 'en', tab: null, kind: 'all', search: '', sortKey: 'rank', sortDir: 1, limit: 50, me: '', open: new Set(), lastOk: 0, timer: null, topKey: '', cardEls: {}, newsTimer: null, newsIndex: 0 };
  const $ = id => document.getElementById(id);
  const t = key => (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
  const locale = () => state.lang === 'fa' ? 'fa-IR' : 'en-US';
  const fmt = n => (n === null || n === undefined || Number.isNaN(Number(n))) ? '—' : Number(n).toLocaleString(locale());
  const nf1 = n => Number(n).toLocaleString(locale(), { maximumFractionDigits: 1 });
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) { if (kid === null || kid === undefined || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return el;
  }
  const ago = iso => {
    const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    if (!Number.isFinite(s)) return '—';
    if (s < 45) return t('now');
    const m = Math.floor(s / 60); if (m < 60) return `${fmt(m)}m ${t('ago')}`;
    const hr = Math.floor(m / 60); if (hr < 48) return `${fmt(hr)}h ${t('ago')}`;
    return `${fmt(Math.floor(hr / 24))}d ${t('ago')}`;
  };
  const dur = sec => `${fmt(Math.floor(sec / 60))}:${String(sec % 60).padStart(2, '0')}`;
  const tpl = (key, vars) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const shortDate = iso => new Date(iso).toLocaleDateString(state.lang === 'fa' ? 'fa-IR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // Smoothly count to a number; used for the headline figures so changes feel alive without re-rendering.
  function countTo(el, target, suffix) {
    const to = Number(target); if (!Number.isFinite(to)) { el.textContent = '—'; return; }
    const from = Number(el.dataset.v); el.dataset.v = String(to);
    const write = v => { el.textContent = `${fmt(Math.round(v))}${suffix || ''}`; };
    if (!Number.isFinite(from) || from === to || reduceMotion()) { write(to); return; }
    const start = performance.now(), span = 600;
    const step = now => { const k = Math.min(1, (now - start) / span); write(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  const statParts = (id, c) => {
    if (id === 'fleaOffers') return c.marketOffers === null ? null : { n: c.marketOffers, plus: false };
    if (id === 'raidsCompleted') return { n: c.raidsCompleted.value, plus: c.raidsCompleted.approx };
    if (id === 'totalKills') return { n: c.totalKills, plus: false };
    if (id === 'registeredPlayers') return { n: c.registeredPlayers, plus: false };
    if (id === 'activeRaids') return { n: c.activeRaids, plus: false };
    return null;
  };
  const numNode = parts => h('bdi', { dir: 'ltr', text: `${fmt(parts.n)}${parts.plus ? '+' : ''}` });

  // ---- header ---------------------------------------------------------------------------------------------
  function renderHero() {
    const d = state.data, m = d.meta, layout = m.layout || DEFAULT_LAYOUT;
    document.documentElement.lang = state.lang; document.documentElement.dir = state.lang === 'fa' ? 'rtl' : 'ltr';
    document.title = m.name;
    $('serverName').textContent = m.name; $('tagline').textContent = m.tagline || '';
    $('mark').textContent = (m.name || '?').trim().charAt(0).toUpperCase();
    document.documentElement.style.setProperty('--accent', m.accent || '#e7b45b');
    $('langBtn').textContent = state.lang === 'fa' ? 'EN' : 'FA'; $('langBtn').hidden = m.allowLanguageSwitch === false;
    $('foot').textContent = t('footer');
    $('onlineChip').hidden = false; $('onlineLabel').textContent = t('online_label');
    countTo($('onlineNum'), d.counters.online);
    const lines = layout.headerLines.filter(l => l.enabled).map(l => ({ id: l.id, parts: statParts(l.id, d.counters) })).filter(l => l.parts);
    $('onlineLines').replaceChildren(...lines.map(l => h('li', null, h('b', null, numNode(l.parts)), ` ${t(STAT_KEYS[l.id][1])}`)));
  }

  // ---- announcements + stat cards (rebuilt only when their content or the layout changes) ---------------------
  function slideEl(n, active) {
    const media = n.media ? h('div', { class: 'slide-media' }) : h('div', { class: 'slide-media' });
    if (n.media && n.media.kind === 'video') { const v = h('video', { muted: '', loop: '', playsinline: '', preload: 'metadata' }); v.muted = true; v.src = n.media.url; media.append(v); }
    else if (n.media) media.style.backgroundImage = `url("${n.media.url}")`;
    const dates = [shortDate(n.publishedAt || n.startsAt), n.endsAt ? `${t('until')} ${shortDate(n.endsAt)}` : ''].filter(Boolean).join(' · ');
    return h('article', { class: `slide k-${n.kind}${n.media ? '' : ' plain'}${active ? ' active' : ''}`, 'aria-hidden': active ? 'false' : 'true' }, media,
      h('div', { class: 'slide-body' },
        h('div', { class: 'slide-meta' }, h('span', { class: 'kind', text: t(`n_${n.kind}`) }), h('span', { text: dates })),
        h('h2', { text: n.title }), n.text ? h('p', { text: n.text }) : null,
        n.link && /^https?:\/\//i.test(n.link.url) ? h('a', { class: 'cta', href: n.link.url, target: '_blank', rel: 'noopener noreferrer', text: n.link.label }) : null));
  }
  function buildNews(items) {
    clearInterval(state.newsTimer);
    state.newsIndex = Math.min(state.newsIndex, items.length - 1);
    const slides = items.map((n, i) => slideEl(n, i === state.newsIndex));
    const dots = items.map((_, i) => h('button', { type: 'button', class: i === state.newsIndex ? 'active' : '', 'aria-label': String(i + 1), onclick: () => { show(i); restart(); } }));
    let paused = false;
    const root = h('section', { class: 'news glass', onmouseenter: () => { paused = true; }, onmouseleave: () => { paused = false; }, onfocusin: () => { paused = true; }, onfocusout: () => { paused = false; } },
      h('div', { class: 'slides' }, slides),
      items.length > 1 ? h('button', { class: 'arrow prev', type: 'button', 'aria-label': t('prev'), text: '‹', onclick: () => { show(state.newsIndex - 1); restart(); } }) : null,
      items.length > 1 ? h('button', { class: 'arrow next', type: 'button', 'aria-label': t('next'), text: '›', onclick: () => { show(state.newsIndex + 1); restart(); } }) : null,
      items.length > 1 ? h('div', { class: 'news-nav' }, h('div', { class: 'dots' }, dots)) : null);
    function show(i) {
      state.newsIndex = (i + items.length) % items.length;
      slides.forEach((s, k) => { const on = k === state.newsIndex; s.classList.toggle('active', on); s.setAttribute('aria-hidden', on ? 'false' : 'true'); const v = s.querySelector('video'); if (v) { if (on) v.play().catch(() => {}); else v.pause(); } });
      dots.forEach((b, k) => b.classList.toggle('active', k === state.newsIndex));
    }
    function restart() { clearInterval(state.newsTimer); if (items.length > 1 && !reduceMotion()) state.newsTimer = setInterval(() => { if (!paused && document.visibilityState === 'visible') show(state.newsIndex + 1); }, 8000); }
    setTimeout(() => { show(state.newsIndex); restart(); }, 0);
    return root;
  }
  function renderTop() {
    const d = state.data, m = d.meta, layout = m.layout || DEFAULT_LAYOUT;
    const cards = layout.cards.filter(c => c.enabled && statParts(c.id, d.counters));
    const key = JSON.stringify([state.lang, layout.top, cards.map(c => c.id), d.announcements]);
    if (key !== state.topKey) {
      state.topKey = key; state.cardEls = {};
      const blocks = [];
      for (const block of layout.top) {
        if (!block.enabled) continue;
        if (block.id === 'announcements' && d.announcements.length) blocks.push(buildNews(d.announcements));
        if (block.id === 'cards' && cards.length) blocks.push(h('section', { class: 'stats' }, cards.map(c => {
          const num = h('b', { class: 'accent' }); state.cardEls[c.id] = num;
          return h('div', { class: 'stat glass' }, h('small', { text: t(STAT_KEYS[c.id][0]) }), num);
        })));
      }
      if (!d.announcements.length || !layout.top.some(b => b.enabled && b.id === 'announcements')) clearInterval(state.newsTimer);
      $('top').replaceChildren(...blocks);
    }
    for (const c of cards) { const el = state.cardEls[c.id], p = statParts(c.id, d.counters); if (el && p) countTo(el, p.n, p.plus ? '+' : ''); }
  }
  function renderTabs() {
    const m = state.data.meta, layout = m.layout || DEFAULT_LAYOUT;
    const enabled = id => id === 'activity' ? (m.sections.feed || m.sections.trades)
      : id === 'operations' ? m.operationsAvailable === true : m.sections[id];
    const tabs = layout.tabs.filter(enabled);
    if (!tabs.includes(state.tab)) state.tab = tabs[0] || null;
    $('tabs').replaceChildren(...tabs.map(id => h('button', { class: `tab${state.tab === id ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': state.tab === id ? 'true' : 'false', text: t(`t_${id}`), onclick: () => { state.tab = id; render(); } })));
  }

  // ---- views ----------------------------------------------------------------------------------------------
  const badge = r => state.data.meta.showPmcBadge && r.kind === 'pmc' ? h('span', { class: 'badge', text: 'PMC' }) : null;
  const nameCell = r => h('span', { class: 'name' }, h('i', { class: `dot${r.online ? ' on' : ''}` }), r.name, badge(r));
  const NUM_HEADS = new Set(['listings', 'min', 'median', 'max', 'qty', 'price', 'kills_short', 'level', 'score', 'kills', 'deaths', 'kd', 'survival', 'playtime']);
  const th = k => h('th', { class: NUM_HEADS.has(k) ? 'num' : '', text: t(k) });

  function leaderboardView() {
    const d = state.data, m = d.meta, wrap = h('div');
    const kinds = m.showPmc && m.showPmcBadge ? ['all', 'player', 'pmc'] : ['all'];
    if (!kinds.includes(state.kind)) state.kind = 'all';
    wrap.append(h('div', { class: 'tools' },
      kinds.length > 1 ? kinds.map(k => h('button', { class: `chip${state.kind === k ? ' active' : ''}`, type: 'button', text: k === 'all' ? t('all') : k === 'player' ? t('players') : t('pmcs'), onclick: () => { state.kind = k; state.limit = 50; render(); } })) : null,
      h('input', { class: 'search', placeholder: t('search'), value: state.search, oninput: e => { state.search = e.target.value; state.limit = 50; render(); }, id: 'search' })));
    wrap.append(h('div', { class: 'compare' }, h('input', { class: 'me', id: 'me', placeholder: t('me_ph'), value: state.me, onchange: e => { state.me = e.target.value.trim(); try { localStorage.setItem('me', state.me); } catch (_) { /* storage blocked */ } render(); } }), h('span', { class: 'res', id: 'meRes' })));
    const all = d.leaderboard;
    let rows = all.filter(r => (state.kind === 'all' || r.kind === state.kind) && (!state.search || r.name.toLowerCase().includes(state.search.toLowerCase())));
    const key = state.sortKey, dir = state.sortDir;
    rows = rows.slice().sort((a, b) => { const av = a[key], bv = b[key]; const cmp = typeof av === 'string' ? String(av).localeCompare(bv) : (Number(av) || 0) - (Number(bv) || 0); return (cmp || a.rank - b.rank) * dir; });
    const cols = [['rank', 'rank', false], ['name', 'name', false], ['online', 'status', false], ['level', 'level', true], ['score', 'score', true], ['kills', 'kills', true], ['deaths', 'deaths', true], ['kd', 'kd', true], ['survivalRate', 'survival', true], ['playtimeHours', 'playtime', true]];
    const head = h('tr', null, cols.map(([k, label, isNum]) => h('th', { class: `sortable${isNum ? ' num' : ''}${state.sortKey === k ? ' sorted' : ''}`, text: t(label) + (state.sortKey === k ? (state.sortDir === 1 ? ' ▲' : ' ▼') : ''), onclick: () => { if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = (k === 'rank' || k === 'name') ? 1 : -1; } render(); } })));
    const body = [];
    for (const r of rows.slice(0, state.limit)) {
      const isMe = state.me && r.name.toLowerCase() === state.me.toLowerCase();
      body.push(h('tr', { class: `row${isMe ? ' me' : ''}`, onclick: () => { state.open.has(r.id) ? state.open.delete(r.id) : state.open.add(r.id); render(); } },
        h('td', null, h('span', { class: `rank${r.rank <= 3 ? ` r${r.rank}` : ''}`, text: fmt(r.rank) })), h('td', null, nameCell(r)),
        h('td', null, h('span', { class: `pill ${r.status}`, text: t(r.online ? 'st_online' : 'st_offline') })),
        h('td', { class: 'num', text: fmt(r.level) }), h('td', { class: 'num', text: fmt(r.score) }), h('td', { class: 'num', text: fmt(r.kills) }), h('td', { class: 'num', text: fmt(r.deaths) }),
        h('td', { class: 'num', text: nf1(r.kd) }), h('td', { class: 'num', text: r.kind === 'player' ? `${nf1(r.survivalRate)}%` : '—' }), h('td', { class: 'num', text: r.kind === 'player' ? `${nf1(r.playtimeHours)} ${t('hours')}` : '—' })));
      if (state.open.has(r.id)) {
        const facts = r.kind === 'player'
          ? [['headshots', r.headshots], ['pmc_kills', r.killedPmc], ['boss_kills', r.killedBoss], ['sessions', r.sessions], ['survived', r.survived], ['last_seen', r.online ? t('st_online') : r.lastSeen ? ago(r.lastSeen) : '—']]
          : [['raids_count', r.raids], ['side', r.side || '—'], ['last_map', r.map || '—'], ['last_seen', r.online ? t('st_online') : r.lastSeen ? ago(r.lastSeen) : '—']];
        body.push(h('tr', { class: 'detail' }, h('td', { colspan: cols.length }, h('div', { class: 'facts' }, facts.map(([k, v]) => h('div', { class: 'fact' }, h('small', { text: t(k) }), h('b', { text: typeof v === 'number' ? fmt(v) : v })))), r.kind === 'pmc' && m.showPmcBadge ? h('p', { text: t('tracked_note'), style: 'color:var(--muted);margin:8px 0 0' }) : null)));
      }
    }
    wrap.append(h('div', { class: 'card' }, rows.length ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, head), h('tbody', null, body))) : h('div', { class: 'empty', text: t('none') }),
      rows.length > state.limit ? h('button', { class: 'more', type: 'button', text: t('more'), onclick: () => { state.limit += 50; render(); } }) : null));
    setTimeout(() => updateCompare(all), 0);
    return wrap;
  }
  function updateCompare(all) {
    const el = $('meRes'); if (!el) return;
    el.replaceChildren();
    if (!state.me) return;
    const idx = all.findIndex(r => r.name.toLowerCase() === state.me.toLowerCase());
    if (idx < 0) { el.textContent = t('not_found'); return; }
    const me = all[idx], above = all[idx - 1], below = all[idx + 1];
    el.append(`${t('you_rank')} `, h('b', { text: `#${fmt(me.rank)}` }), ` ${t('of')} ${fmt(all.length)} · ${fmt(me.score)} ${t('pts')}`);
    if (above) el.append(` · ${tpl('cmp_behind', { n: fmt(above.score - me.score), name: above.name })}`);
    if (below) el.append(` · ${tpl('cmp_ahead', { n: fmt(me.score - below.score), name: below.name })}`);
  }

  function operationsView() {
    const rows = Array.isArray(state.data.operationsLeaderboard) ? state.data.operationsLeaderboard : [];
    const head = h('tr', null,
      h('th', { text: t('rank') }),
      h('th', { text: t('name') }),
      h('th', { text: t('op_rank') }),
      h('th', { class: 'num', text: t('op_points') }),
      h('th', { class: 'num', text: t('op_completed') }),
      h('th', { text: t('op_next') }));
    const body = rows.map(row => {
      const percent = Math.max(0, Math.min(100, Number(row.rankProgressPercent) || 0));
      const next = row.nextRank
        ? h('div', { class: 'op-next' },
            h('span', { text: row.nextRank }),
            h('div', { class: 'op-progress', role: 'presentation' }, h('i', { style: `width:${percent}%` })),
            h('small', { text: `${fmt(row.pointsToNextRank)} ${t('op_points_to_next')}` }))
        : h('span', { class: 'pill', text: t('op_max_rank') });
      return h('tr', null,
        h('td', null, h('span', { class: `rank${row.rank <= 3 ? ` r${row.rank}` : ''}`, text: fmt(row.rank) })),
        h('td', null, h('strong', { text: row.name })),
        h('td', null, h('span', { class: 'pill', text: row.militaryRank })),
        h('td', { class: 'num', text: fmt(row.points) }),
        h('td', { class: 'num', text: fmt(row.completedMissions) }),
        h('td', null, next));
    });
    return h('section', { class: 'card' },
      h('h2', null, t('op_title'), h('em', { text: fmt(rows.length) })),
      rows.length
        ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, head), h('tbody', null, body)))
        : h('div', { class: 'empty', text: t('op_empty') }));
  }

  const activityPill = a => h('span', { class: `pill ${a || ''}`, text: t(a || 'online') });
  function onlineView() {
    const o = state.data.online, m = state.data.meta, wrap = h('div');
    if (!o.available) wrap.append(h('div', { class: 'notice', text: t('online_unavailable') }));
    const group = (title, items, draw) => h('div', { class: 'card' }, h('h2', null, title, h('em', { text: fmt(items.length) })), items.length ? h('div', { class: 'cards' }, items.map(draw)) : h('div', { class: 'empty', text: t('none') }));
    const sub = p => `${t('level')} ${fmt(p.level)}${p.map ? ` · ${p.map}` : ''}`;
    wrap.append(group(t('online_players'), o.players, p => h('div', { class: 'mini' }, h('div', { class: 'top2' }, h('b', { text: p.name }), activityPill(p.activity)), h('small', { text: sub(p) }))));
    if (m.showPmc) wrap.append(group(t('online_pmc'), o.pmc, p => h('div', { class: 'mini' }, h('div', { class: 'top2' }, h('b', { text: p.name }), m.showPmcBadge ? h('span', { class: 'badge', text: 'PMC' }) : activityPill('raid')), h('small', { text: sub(p) }))));
    if (o.market.length) wrap.append(group(t('online_market'), o.market, p => h('div', { class: 'mini' }, h('div', { class: 'top2' }, h('b', { text: p.name }), activityPill('flea')), h('small', { text: `${t('rating')} ${nf1(p.rating)} · ${fmt(p.offers)} ${t('offers')}` }))));
    return wrap;
  }

  const resultPill = r => h('span', { class: `pill ${r}`, text: t(`r_${r}`) === `r_${r}` ? r : t(`r_${r}`) });
  function raidsView() {
    const d = state.data, wrap = h('div');
    wrap.append(h('div', { class: 'card' }, h('h2', null, t('t_raids'), h('em', { text: fmt(d.raids.length) })),
      d.raids.length ? h('div', { class: 'cards' }, d.raids.map(r => h('div', { class: 'mini' },
        h('div', { class: 'top2' }, h('b', { text: r.map || '—' }), h('span', { class: `pill ${r.status}`, text: t(r.status) })),
        h('small', { text: `${r.startedAt ? ago(r.startedAt) : ''} · ${t('players_in')} ${fmt(r.playerCount)} · ${t('pmc_in')} ${fmt(r.pmcCount)}` }),
        h('div', { class: 'chips' }, r.players.map(p => h('span', { class: `who${p.dead ? ' dead' : ''}`, text: p.name })))))) : h('div', { class: 'empty', text: t('none') })));
    const ends = d.events.filter(e => e.type === 'raid').slice(0, 20);
    wrap.append(h('div', { class: 'card' }, h('h2', { text: t('recent_raids') }), ends.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['time', 'player', 'map', 'result', 'kills_short', 'duration'].map(th))),
      h('tbody', null, ends.map(e => h('tr', null, h('td', { text: ago(e.at) }), h('td', { text: e.player }), h('td', { text: e.map || '—' }), h('td', null, resultPill(e.result)), h('td', { class: 'num', text: fmt(e.kills) }), h('td', { text: dur(e.durationSec) })))))) : h('div', { class: 'empty', text: t('none') })));
    return wrap;
  }

  function marketView() {
    const d = state.data, m = d.market, wrap = h('div');
    if (!m.available) { wrap.append(h('div', { class: 'notice', text: t('market_na') })); }
    else {
      wrap.append(h('section', { class: 'stats', style: 'margin-bottom:14px' }, [['m_total', m.totals.offers], ['m_players', m.totals.playerOffers], ['m_pmc', m.totals.pmcOffers], ['m_traders', m.totals.traderOffers]].map(([k, v]) => h('div', { class: 'stat glass' }, h('small', { text: t(k) }), h('b', { text: fmt(v) })))));
      const table = (title, heads, rows, cell) => h('div', { class: 'card' }, h('h2', { text: title }), rows.length ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, heads.map(th))), h('tbody', null, rows.map(cell)))) : h('div', { class: 'empty', text: t('none') }));
      wrap.append(h('div', { class: 'grid2' },
        table(t('top_items'), ['item', 'listings', 'min', 'median', 'max'], m.topItems, r => h('tr', null, h('td', { text: r.item }), h('td', { class: 'num', text: fmt(r.listings) }), h('td', { class: 'num', text: fmt(r.minPrice) }), h('td', { class: 'num', text: fmt(r.medianPrice) }), h('td', { class: 'num', text: fmt(r.maxPrice) }))),
        table(t('player_listings'), ['seller', 'item', 'qty', 'price'], m.playerListings, r => h('tr', null, h('td', { text: r.seller }), h('td', { text: r.item }), h('td', { class: 'num', text: fmt(r.qty) }), h('td', { class: 'num', text: r.barter ? t('barter') : r.price === null ? '—' : `${fmt(r.price)} ₽` })))));
    }
    if (d.meta.sections.trades) wrap.append(h('div', { class: 'card' }, h('h2', { text: t('recent_trades') }), d.trades.length ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['time', 'buyer', 'seller', 'item', 'qty', 'price'].map(th))),
      h('tbody', null, d.trades.map(r => h('tr', null, h('td', { text: ago(r.at) }), h('td', { text: r.buyer }), h('td', { text: r.seller || t('pmc_trader') }), h('td', { text: r.item }), h('td', { class: 'num', text: fmt(r.qty) }), h('td', { class: 'num', text: `${fmt(r.valueRub)} ₽` })))))) : h('div', { class: 'empty', text: t('none') })));
    return wrap;
  }

  function activityView() {
    const d = state.data, items = [];
    if (d.meta.sections.feed) for (const e of d.events) items.push({ at: e.at, ic: e.type === 'kill' ? '⚔' : e.type === 'death' ? '☠' : '⚑', text: eventText(e) });
    if (d.meta.sections.trades) for (const r of d.trades) items.push({ at: r.at, ic: '₽', text: tpl('e_trade', { a: r.buyer, q: fmt(r.qty), i: r.item, p: fmt(r.valueRub), s: r.seller || t('pmc_trader') }) });
    items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return h('div', { class: 'card' }, h('h2', { text: t('feed') }), items.length ? h('ul', { class: 'feed' }, items.slice(0, 60).map(i => h('li', null, h('time', { text: ago(i.at) }), h('span', { class: 'ic', text: i.ic }), h('span', { text: i.text })))) : h('div', { class: 'empty', text: t('none') }));
  }
  function eventText(e) {
    if (e.type === 'kill') return tpl('e_kill', { a: e.killer, b: e.victim || t(`kind_${e.victimKind}`) });
    if (e.type === 'death') return tpl('e_death', { a: e.victim, b: e.killer || t(`kind_${e.killerKind || 'unknown'}`) });
    return tpl('e_raid', { a: e.player, m: e.map || '—', r: t(`r_${e.result}`) === `r_${e.result}` ? e.result : t(`r_${e.result}`) });
  }

  // Re-rendering replaces the DOM, so keep keyboard focus and caret in the field the visitor is typing in.
  function render() {
    if (!state.data) return;
    const active = document.activeElement, focusId = active && active.id && active.tagName === 'INPUT' ? active.id : null, caret = focusId ? active.selectionStart : 0;
    renderHero(); renderTop(); renderTabs();
    const views = { leaderboard: leaderboardView, online: onlineView, raids: raidsView, market: marketView, activity: activityView, operations: operationsView };
    $('view').replaceChildren(state.tab && views[state.tab] ? views[state.tab]() : h('div', { class: 'empty', text: t('none') }));
    if (focusId) { const next = document.getElementById(focusId); if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch (_) { /* unsupported */ } } }
  }

  function applyBackground(bg, key) {
    const layer = $('bg'); if (layer.dataset.key === key) return;
    layer.dataset.key = key; layer.replaceChildren(); layer.style.backgroundImage = '';
    if (bg) {
      if (bg.kind === 'video') { const v = h('video', { muted: '', loop: '', playsinline: '', autoplay: '', preload: 'auto' }); v.muted = true; v.src = bg.url; layer.append(v); v.play().catch(() => {}); }
      else layer.style.backgroundImage = `url("${bg.url}")`;
      document.documentElement.style.setProperty('--shade', String(bg.overlay));
    } else document.documentElement.style.setProperty('--shade', '.5');
  }

  // ---- data loop ------------------------------------------------------------------------------------------
  async function load() {
    try {
      const res = await fetch('/api/state', { headers: state.etag ? { 'If-None-Match': state.etag } : {}, cache: 'no-cache' });
      if (res.status === 304) { state.lastOk = Date.now(); setLive(true); schedule(); return; }
      if (!res.ok) throw new Error(String(res.status));
      state.etag = res.headers.get('ETag'); state.data = await res.json(); state.lastOk = Date.now();
      let stored = null; try { stored = localStorage.getItem('lang'); } catch (_) { /* storage blocked */ }
      if (!stored && !state.langSet) { state.lang = state.data.meta.language === 'fa' ? 'fa' : 'en'; state.langSet = true; }
      const bg = state.data.meta.background; applyBackground(bg, bg ? bg.url : 'none');
      setLive(true); render();
    } catch (_) { setLive(false); }
    schedule();
  }
  function setLive(ok) {
    const pill = $('livePill'); pill.className = `live ${ok ? 'ok' : 'bad'}`; $('liveText').textContent = ok ? t('live') : t('offline');
    $('updatedAt').textContent = state.data && ok ? `${t('updated')}: ${new Date(state.data.meta.generatedAt).toLocaleTimeString(state.lang === 'fa' ? 'fa-IR' : 'en-GB')}` : '';
  }
  function schedule() {
    clearTimeout(state.timer);
    const sec = Math.max(5, Number(state.data && state.data.meta.refreshSeconds) || 10);
    state.timer = setTimeout(() => { if (document.visibilityState === 'visible') load(); else schedule(); }, sec * 1000);
  }

  $('langBtn').addEventListener('click', () => { state.lang = state.lang === 'fa' ? 'en' : 'fa'; try { localStorage.setItem('lang', state.lang); } catch (_) { /* storage blocked */ } state.topKey = ''; render(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - state.lastOk > 15000) load(); });
  try { state.me = localStorage.getItem('me') || ''; const l = localStorage.getItem('lang'); if (l === 'fa' || l === 'en') state.lang = l; } catch (_) { /* storage blocked */ }
  load();
})();
