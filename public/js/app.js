/* Tangtang storefront core: api, i18n helpers, cart, header/footer, country picker, quota meter, chat */
(function () {
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LANGS = { fr: 'Français', en: 'English', de: 'Deutsch', es: 'Español', zh: '中文' };
  let lang = LS.get('tt_lang', null);
  if (!LANGS[lang]) { const n = (navigator.language || 'fr').slice(0, 2); lang = LANGS[n] ? n : 'fr'; }
  let cur = LS.get('tt_cur', 'XAF'); let country = LS.get('tt_country', 'CM'); let mode = LS.get('tt_mode', 'air');

  const TT = { $, $$, esc, LS, LANGS, cfg: null, user: null, chatOpen: false };
  TT.lang = () => lang; TT.cur = () => cur; TT.country = () => country; TT.mode = () => mode;
  TT.t = (k, v) => { let s = (window.DICT[lang] && window.DICT[lang][k]) ?? window.DICT.en[k] ?? k; if (v) for (const x in v) s = s.replaceAll('{' + x + '}', v[x]); return s; };
  const t = TT.t;
  TT.i18n = (root = document) => {
    $$('[data-i18n]', root).forEach(e => e.textContent = t(e.dataset.i18n));
    $$('[data-i18n-html]', root).forEach(e => e.innerHTML = t(e.dataset.i18nHtml));
    $$('[data-i18n-ph]', root).forEach(e => e.placeholder = t(e.dataset.i18nPh));
    $$('[data-i18n-title]', root).forEach(e => e.title = t(e.dataset.i18nTitle));
    document.documentElement.lang = lang;
  };
  // money (all prices are stored in FCFA, other currencies use the admin / daily-refreshed rates)
  TT.currencies = () => { const fx = (TT.cfg && TT.cfg.settings.fx) || { XAF: 1 }; return ['XAF', ...Object.keys(fx).filter(k => k !== 'XAF')]; };
  TT.money = (v) => {
    const fx = (TT.cfg && TT.cfg.settings.fx) || {};
    if (cur === 'XAF' || !fx[cur]) return Math.round(v).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ') + ' FCFA';
    const x = v * fx[cur]; const big = ['NGN', 'KES'].includes(cur);
    try { return new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : lang, { style: 'currency', currency: cur, minimumFractionDigits: big ? 0 : 2, maximumFractionDigits: big ? 0 : 2 }).format(x); }
    catch { return x.toFixed(2) + ' ' + cur; }
  };
  TT.curName = (k) => { if (k === 'XAF') return 'FCFA — ' + (lang === 'fr' ? 'Franc CFA' : lang === 'zh' ? '中非法郎' : 'CFA franc'); try { return k + ' — ' + new Intl.DisplayNames([lang === 'zh' ? 'zh-CN' : lang], { type: 'currency' }).of(k); } catch { return k; } };
  TT.curOptions = (sel) => TT.currencies().map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(TT.curName(k))}</option>`).join('');
  TT.langOptions = (sel) => Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  TT.setPrefs = async (p, reload = true) => {
    if (p.lang && LANGS[p.lang]) { lang = p.lang; LS.set('tt_lang', lang); } if (p.cur) { cur = p.cur; LS.set('tt_cur', cur); }
    if (TT.user) { try { await TT.api('/api/auth/prefs', { method: 'PUT', body: { lang, cur } }); } catch {} }
    if (reload) location.reload();
  };
  TT.fcfa = (v) => Math.round(v).toLocaleString('fr-FR').replace(/ | /g, ' ') + ' FCFA';
  TT.pname = (p) => (p.name && (p.name[lang] || p.name.en || p.name.fr)) || '';
  TT.pdesc = (p) => (p.desc && (p.desc[lang] || p.desc.en)) || '';
  TT.catName = (k) => t('cat_' + k);
  TT.flag = (code) => String.fromCodePoint(...[...code.toUpperCase()].map(c => 127397 + c.charCodeAt(0)));
  TT.countryName = (code) => { try { return new Intl.DisplayNames([lang === 'zh' ? 'zh-CN' : lang], { type: 'region' }).of(code); } catch { return code; } };
  TT.date = (ts) => new Date(ts * 1000).toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang, { day: '2-digit', month: 'short', year: 'numeric' });
  TT.time = (ts) => new Date(ts * 1000).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : lang, { hour: '2-digit', minute: '2-digit' });
  TT.EMOJI = { bag: '👜', phone: '📱', case: '🛡️', tech: '🎧', watch: '⌚', shoe: '👟', cloth: '👕', wig: '💇', toy: '🧸', hat: '🧢', jewel: '💍', light: '💡', beauty: '💄', misc: '🎁', appl: '🍳', bike: '🚲', tent: '⛺' };

  TT.api = async (url, opt = {}) => {
    const o = { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
    if (opt.body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
    const r = await fetch(url, o); let d = null; try { d = await r.json(); } catch {}
    if (!r.ok) { const e = new Error((d && d.error) || 'error'); e.status = r.status; throw e; }
    return d;
  };
  TT.errMsg = (e) => { const k = 'err_' + String(e.message || e).split(':')[0]; const m = t(k); return m === k ? t('err_generic') : m.replace('{moq}', String(e.message).split(':')[2] || ''); };
  TT.toast = (msg) => { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = msg; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600); };
  TT.pill = (el, text, kind) => { el.className = 'badge ' + (kind || ''); el.textContent = text; };

  // ---------- cart ----------
  const CK = 'tt_cart';
  TT.cart = {
    all: () => LS.get(CK, []),
    save(c) { LS.set(CK, c); TT.cart.badge(); },
    add(item) {
      const c = TT.cart.all(); const k = c.find(x => x.id === item.id && x.image === item.image && x.size === item.size && x.variant === item.variant);
      if (k) k.qty += item.qty; else c.push(item); TT.cart.save(c);
    },
    set(i, qty) { const c = TT.cart.all(); if (c[i]) { c[i].qty = qty; TT.cart.save(c); } },
    del(i) { const c = TT.cart.all(); c.splice(i, 1); TT.cart.save(c); },
    clear() { TT.cart.save([]); },
    count: () => TT.cart.all().reduce((a, x) => a + x.qty, 0),
    badge() { const n = $('#cartn'); if (n) { n.textContent = TT.cart.all().length; n.classList.toggle('hide', !TT.cart.all().length); } },
  };
  TT.setCountry = (c) => { country = c; LS.set('tt_country', c); }; TT.setMode = (m) => { mode = m; LS.set('tt_mode', m); };

  // ---------- quota meter ----------
  TT.quotaHTML = (q) => {
    const full = q.ok;
    return `<div class="quota ${full ? 'full' : ''}"><div class="row"><div><div class="qnum">${q.quota}<small> / 100</small></div><div class="sm mu">${esc(t('quota_title'))}</div></div>
      <div class="c"><span class="badge ${full ? 'ok' : 'warn'}">${full ? '✓ ' + esc(t('quota_ok')) : esc(t('quota_missing', { n: TT.fcfa(q.missing) }))}</span></div></div>
      <div class="qbar" style="margin:10px 0 2px"><i style="width:${q.quota}%"></i></div>
      <div class="qticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100 = ${TT.fcfa(q.minOrder)}</span></div></div>`;
  };

  // ---------- country picker ----------
  TT.countryPicker = (root, onChange) => {
    const list = TT.cfg.countries; let more = false, filter = '';
    const chip = (c, sel) => `<div class="chip ${sel ? 'sel' : ''}" data-c="${c.code}">${TT.flag(c.code)} ${esc(TT.countryName(c.code))}</div>`;
    const grid = () => {
      const feat = list.filter(c => c.featured || c.code === country);
      const rest = list.filter(c => !feat.includes(c) && (!filter || (TT.countryName(c.code) + ' ' + c.code).toLowerCase().includes(filter.toLowerCase())));
      return rest.map(c => chip(c, false)).join('') || '<span class="mu sm">—</span>';
    };
    const bind = () => $$('[data-c]', root).forEach(e => e.onclick = () => { TT.setCountry(e.dataset.c); more = false; filter = ''; draw(); onChange && onChange(e.dataset.c); });
    const draw = () => {
      const feat = list.filter(c => c.featured || c.code === country);
      root.innerHTML = `<div class="cp"><div class="row" style="margin-bottom:6px"><b>${esc(t('ship_to'))}</b>
        <span class="sw ${more ? 'on' : ''}" id="cpsw"><span>${esc(t('more_countries'))} (${list.length})</span><i></i></span></div>
        <div class="chips">${feat.map(c => chip(c, c.code === country)).join('')}</div>
        ${more ? `<input id="cpq" placeholder="${esc(t('search_country'))}" value="${esc(filter)}"><div class="cgrid" id="cpg">${grid()}</div>` : ''}</div>`;
      $('#cpsw', root).onclick = () => { more = !more; draw(); };
      const q = $('#cpq', root);
      if (q) q.oninput = () => { filter = q.value; $('#cpg', root).innerHTML = grid(); bind(); };   // only the grid is re-rendered, the input keeps focus
      bind();
    };
    draw(); return { redraw: draw };
  };
  TT.modeSwitch = (root, onChange) => {
    const c = () => TT.cfg.countries.find(x => x.code === country) || {};
    const draw = () => {
      root.innerHTML = `<div class="seg"><button data-m="air" class="${mode === 'air' ? 'on' : ''}">✈️ ${esc(t('air'))} <small>(${c().air_days || '-'} ${esc(t('days'))})</small></button>
        <button data-m="sea" class="${mode === 'sea' ? 'on' : ''}">🚢 ${esc(t('sea'))} <small>(${c().sea_days || '-'} ${esc(t('days'))})</small></button></div>`;
      $$('[data-m]', root).forEach(b => b.onclick = () => { TT.setMode(b.dataset.m); draw(); onChange && onChange(b.dataset.m); });
    };
    draw(); return { redraw: draw };
  };
  TT.breakdownHTML = (q) => `<div class="sum"><div class="row"><span>${esc(t('goods'))}</span><b>${TT.money(q.goods)}</b></div>
    <div class="row"><span>${esc(t('shipping'))} <small class="mu">(${q.weight} kg${q.discountPct ? ' · −' + q.discountPct + '%' : ''})</small></span><b>${TT.money(q.shipping)}</b></div>
    <div class="row"><span>${esc(t('duty'))}</span><b>${TT.money(q.duty)}</b></div>
    <div class="row"><span>${esc(t('fee', { n: TT.cfg.settings.fee_pct }))}</span><b>${TT.money(q.fee)}</b></div>
    <div class="row tot price"><span>${esc(t('total'))}</span><b>${TT.money(q.total)}</b></div></div>`;

  // ---------- layout ----------
  const NAV = [['/', 'nav_home'], ['/shop', 'nav_shop'], ['/shipping', 'nav_shipping'], ['/orders', 'nav_orders'], ['/wallet', 'nav_wallet'], ['/help', 'nav_help']];
  function layout() {
    const path = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '') || '/';
    const h = document.createElement('header'); h.className = 'hdr';
    h.innerHTML = `<div class="wrap"><a class="logo" href="/"><img src="/img/brand/logo-96.png" alt="Tangtang"><span>Tangtang<small>糖糖</small></span></a>
      <nav class="nav" id="nav">${NAV.map(([u, k]) => `<a href="${u}" class="${path === u ? 'on' : ''}" data-i18n="${k}"></a>`).join('')}</nav>
      <div class="tools"><button class="lcb" id="lcb" aria-haspopup="true" aria-expanded="false" title="${esc(t('pref_title'))}">🌐 <b>${lang === 'zh' ? '中文' : lang.toUpperCase()}</b><i>${cur === 'XAF' ? 'FCFA' : cur}</i></button>
      <a class="ib wal hide" href="/wallet" id="walb" title="${esc(t('wallet_title'))}">💰<span id="walv"></span></a>
      <a class="ib" href="/cart" title="Cart">🛒<span class="n hide" id="cartn"></span></a>
      <a class="ib" href="/account" id="acc" title="Account">👤</a>
      <button class="ib burger" id="burger" aria-label="Menu">☰</button></div></div>`;
    document.body.prepend(h);
    const f = document.createElement('footer');
    f.innerHTML = `<div class="wrap"><div class="cols"><div><h4 class="fl"><img src="/img/brand/logo-96.png" alt="">Tangtang 糖糖</h4><div data-i18n="foot_tag"></div><div class="payicons"><img class="w" src="/img/brand/visa.png" alt="Visa"><img class="w" src="/img/brand/mastercard.png" alt="Mastercard" style="padding:2px 6px"><img src="/img/brand/mtn.png" alt="MTN MoMo"><img src="/img/brand/orange.png" alt="Orange Money"><img src="/img/brand/airtel.png" alt="Airtel Money"></div></div>
      <div><h4 data-i18n="foot_shop"></h4><a href="/shop" data-i18n="nav_shop"></a><br><a href="/shipping" data-i18n="nav_shipping"></a><br><a href="/help" data-i18n="nav_help"></a></div>
      <div><h4 data-i18n="foot_acc"></h4><a href="/account" data-i18n="nav_account"></a><br><a href="/orders" data-i18n="nav_orders"></a><br><a href="/wallet" data-i18n="nav_wallet"></a><br><a href="/chat" data-i18n="nav_chat"></a></div>
      <div><h4 data-i18n="foot_min_t"></h4><div data-i18n="foot_min"></div><br><a href="/admin/" class="sm" style="opacity:.55">Admin</a></div></div></div>`;
    document.body.appendChild(f);
    // language + currency popover (full names, easy to read on a phone)
    const pop = document.createElement('div'); pop.id = 'lcp'; pop.className = 'lcp hide';
    pop.innerHTML = `<label>🌐 ${esc(t('pref_lang'))}</label><select id="lgsel">${TT.langOptions(lang)}</select><label>💱 ${esc(t('pref_cur'))}</label><select id="cusel">${TT.curOptions(cur)}</select>`;
    h.appendChild(pop);
    $('#lcb').onclick = (e) => { e.stopPropagation(); const o = pop.classList.toggle('hide'); $('#lcb').setAttribute('aria-expanded', String(!o)); };
    document.addEventListener('click', (e) => { if (!pop.contains(e.target) && e.target !== $('#lcb')) pop.classList.add('hide'); });
    $('#lgsel').onchange = (e) => TT.setPrefs({ lang: e.target.value });
    $('#cusel').onchange = (e) => TT.setPrefs({ cur: e.target.value });
    $('#burger').onclick = () => $('#nav').classList.toggle('open');
    TT.cart.badge();
  }

  // ---------- chat ----------
  TT.chatBox = (root, opts = {}) => {
    let last = 0, es = null; const orderCode = opts.order || '';
    root.innerHTML = `<div class="chat">${opts.header === false ? '' : `<div class="hd"><div>💬 ${esc(t('chat_title'))}<small>${esc(t('chat_sub'))}</small></div>${opts.close ? '<button id="chx">×</button>' : ''}</div>`}
      <div class="ms" id="cms"></div>
      <div class="in"><input id="cin" maxlength="2000" placeholder="${esc(t('chat_ph'))}" autocomplete="off"><button class="btn" id="csend">➤</button></div></div>`;
    const ms = $('#cms', root);
    const add = (m) => {
      if (m.id <= last) return; last = m.id;
      const d = document.createElement('div'); d.className = 'bub ' + (m.sender === 'user' ? 'me' : '');
      d.innerHTML = `${m.order ? `<div class="o">#${esc(m.order)}</div>` : ''}${esc(m.body)}<small>${m.sender === 'admin' ? esc(t('chat_admin')) + ' · ' : ''}${TT.time(m.at)}</small>`;
      ms.appendChild(d); ms.scrollTop = ms.scrollHeight;
    };
    const load = async () => { try { (await TT.api('/api/chat?after=' + last)).forEach(add); TT.refreshChatBadge(); } catch {} };
    const send = async () => {
      const i = $('#cin', root), v = i.value.trim(); if (!v) return; i.value = '';
      try { add(await TT.api('/api/chat', { body: { body: v, order: orderCode } })); } catch (e) { TT.toast(TT.errMsg(e)); i.value = v; }
    };
    $('#csend', root).onclick = send; $('#cin', root).onkeydown = (e) => { if (e.key === 'Enter') send(); };
    if ($('#chx', root)) $('#chx', root).onclick = opts.close;
    if (!ms.children.length) { const w = document.createElement('div'); w.className = 'bub'; w.textContent = t('chat_welcome'); ms.appendChild(w); }
    load();
    try { es = new EventSource('/api/chat/stream'); es.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'msg') { add(d.msg); if (d.msg.sender === 'admin') TT.api('/api/chat?after=' + last).catch(() => {}); } }; } catch {}
    const poll = setInterval(load, 15000);
    return { destroy() { es && es.close(); clearInterval(poll); } };
  };
  TT.refreshChatBadge = async () => {
    if (!TT.user) return; try { const { n } = await TT.api('/api/chat/unread'); const b = $('#chatn'); if (b) { b.textContent = n; b.classList.toggle('hide', !n || TT.chatOpen); } } catch {}
  };
  function chatWidget() {
    if (location.pathname.startsWith('/chat') || location.pathname.startsWith('/admin')) return;
    const b = document.createElement('button'); b.id = 'chatfab'; b.innerHTML = `💬 <span data-i18n="chat_btn"></span><span class="n hide" id="chatn"></span>`;
    const p = document.createElement('div'); p.id = 'chatpanel'; document.body.append(b, p); let box = null;
    b.onclick = () => {
      if (!TT.user) { TT.toast(t('need_login')); setTimeout(() => location.href = '/account?next=' + encodeURIComponent(location.pathname + location.search), 700); return; }
      TT.chatOpen = !TT.chatOpen; p.classList.toggle('open', TT.chatOpen); $('#chatn').classList.add('hide');
      if (TT.chatOpen && !box) box = TT.chatBox(p, { close: () => b.click(), order: new URLSearchParams(location.search).get('code') || new URLSearchParams(location.search).get('order') || '' });
    };
    if (TT.user) { TT.refreshChatBadge(); setInterval(TT.refreshChatBadge, 30000); }
  }

  // ---------- boot ----------
  TT.ready = (async () => {
    try { [TT.cfg, { user: TT.user }] = await Promise.all([TT.api('/api/config'), TT.api('/api/auth/me')]); } catch (e) { console.error(e); TT.cfg = { settings: { min_order: 50000, fee_pct: 5, qty_tiers: [], fx: {} }, countries: [], categories: [] }; }
    if (TT.user) {   // once per browser session: apply the language / currency saved in the account
      let ch = false;
      try { if (!sessionStorage.getItem('tt_sync')) { sessionStorage.setItem('tt_sync', '1');
        if (TT.user.lang && LANGS[TT.user.lang] && TT.user.lang !== lang) { LS.set('tt_lang', TT.user.lang); ch = true; }
        if (TT.user.cur && TT.user.cur !== cur) { LS.set('tt_cur', TT.user.cur); ch = true; } } } catch {}
      if (ch) { location.reload(); return TT; }
    }
    if (!TT.cfg.countries.find(c => c.code === country)) country = 'CM';
    if (!TT.currencies().includes(cur)) cur = 'XAF';
    layout(); chatWidget();
    if (TT.user) { const a = $('#acc'); a.title = TT.user.email; a.style.background = '#fff'; a.style.color = 'var(--pk-d)';
      const w = $('#walb'); w.classList.remove('hide'); $('#walv').textContent = TT.money(TT.user.balance || 0); w.title = t('wallet_title') + ': ' + TT.money(TT.user.balance || 0); }
    TT.i18n(); return TT;
  })();
  TT.requireLogin = () => { if (!TT.user) { location.href = '/account?next=' + encodeURIComponent(location.pathname + location.search); return false; } return true; };
  TT.card = (p) => `<a class="card" href="/product?id=${p.id}">${p.discount ? `<span class="tag">-${p.discount}%</span>` : p.isNew ? `<span class="tag new">NEW</span>` : ''}
    <div class="im"><img loading="lazy" src="${p.images[0]}" alt=""></div><div class="bd"><div class="nm">${esc(TT.pname(p))}</div>
    <span class="price">${TT.money(p.final)}</span>${p.discount ? ` <span class="old">${TT.money(p.price)}</span>` : ''}${p.sold ? `<div class="mu sm">🔥 ${p.sold}+ ${esc(t('sold'))}</div>` : ''}</div></a>`;
  window.TT = TT;
})();
