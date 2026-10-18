/* Admin portal shell */
(function () {
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const lang = (LS.get('tt_lang', 'en') === 'fr') ? 'fr' : 'en';
  const A = { lang };
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  A.$ = $; A.$$ = $$; A.esc = esc; A.T = (en, fr) => lang === 'fr' ? fr : en;
  A.api = async (url, opt = {}) => {
    const o = { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
    if (opt.body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
    const r = await fetch(url, o); let d = null; try { d = await r.json(); } catch {}
    if (r.status === 401 || r.status === 403) { if (!location.pathname.endsWith('login.html')) location.href = '/admin/login.html'; throw new Error('auth'); }
    if (!r.ok) throw new Error((d && d.error) || 'error'); return d;
  };
  A.fcfa = (v) => Math.round(v || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') + ' FCFA';
  A.date = (ts) => ts ? new Date(ts * 1000).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  A.toast = (m) => { let e = $('#toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; document.body.appendChild(e); } e.textContent = m; e.classList.add('show'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('show'), 2800); };
  A.flag = (c) => String.fromCodePoint(...[...c.toUpperCase()].map(x => 127397 + x.charCodeAt(0)));
  A.country = (c) => { try { return new Intl.DisplayNames([lang], { type: 'region' }).of(c) } catch { return c } };
  A.STATUS = [A.T('Ordered', 'Commandée'), A.T('Confirmed', 'Confirmée'), A.T('In production', 'Production'), A.T('Shipped', 'Expédiée'), A.T('Customs', 'Douane'), A.T('Delivered', 'Livrée'), A.T('Cancelled', 'Annulée')];
  A.PAY = { unpaid: [A.T('Unpaid', 'Non payée'), ''], pending_review: [A.T('To process', 'À traiter'), 'warn'], paid: [A.T('Paid', 'Payée'), 'ok'], failed: [A.T('Failed', 'Échouée'), 'bad'] };
  A.METHOD = { card: '💳 ' + A.T('Card', 'Carte'), mtn: '📲 MTN MoMo', orange: '🟠 Orange Money', airtel: '🔴 Airtel Money', other: '➕ ' + A.T('Other', 'Autre') };
  A.modal = (html) => { let m = $('#modal'); if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal'; m.onclick = (e) => { if (e.target === m) m.classList.remove('open'); }; document.body.appendChild(m); } m.innerHTML = '<div class="in">' + html + '</div>'; m.classList.add('open'); return m; };
  A.closeModal = () => $('#modal') && $('#modal').classList.remove('open');

  const NAV = [['index.html', '📊', 'Dashboard', 'Tableau de bord'], ['orders.html', '📦', 'Orders', 'Commandes'], ['payments.html', '💳', 'Payments', 'Paiements', 'pay'], ['messages.html', '💬', 'Messages', 'Messages', 'msg'],
    ['products.html', '🛍️', 'Products', 'Produits'], ['countries.html', '🌍', 'Shipping rates', 'Tarifs & pays'], ['users.html', '👥', 'Customers', 'Clients'], ['settings.html', '⚙️', 'Settings', 'Réglages']];
  A.shell = async (title) => {
    let me; try { me = (await A.api('/api/auth/me')).user; } catch { return null; }
    if (!me || me.role !== 'admin') { location.href = '/admin/login.html'; return null; }
    const cur = location.pathname.split('/').pop() || 'index.html';
    const side = document.createElement('aside'); side.className = 'side';
    side.innerHTML = `<div class="brand"><img src="/img/brand/logo-48.png" width="28" height="28" style="border-radius:8px;vertical-align:middle;margin-right:6px" alt=""> Tangtang <small style="font-weight:500;opacity:.7">Admin</small></div>` +
      NAV.map(([f, i, en, fr, b]) => `<a href="/admin/${f}" class="${(cur === f || (cur === '' && f === 'index.html')) ? 'on' : ''}"><span>${i} ${A.T(en, fr)}</span>${b ? `<span class="n hide" id="b-${b}"></span>` : ''}</a>`).join('') +
      `<div class="sp"></div><a href="/" target="_blank">🛒 ${A.T('View shop', 'Voir la boutique')}</a><a href="#" id="lo">⎋ ${A.T('Log out', 'Déconnexion')}</a>
       <select id="al"><option value="en" ${lang === 'en' ? 'selected' : ''}>English</option><option value="fr" ${lang === 'fr' ? 'selected' : ''}>Français</option></select>`;
    const c = document.createElement('div'); c.className = 'cont'; const main = $('#page'); main.parentNode.insertBefore(c, main); c.appendChild(main);
    document.body.prepend(side); document.title = title + ' · Tangtang Admin';
    $('#lo').onclick = async (e) => { e.preventDefault(); await A.api('/api/auth/logout', { method: 'POST', body: {} }); location.href = '/admin/login.html'; };
    $('#al').onchange = (e) => { LS.set('tt_lang', e.target.value); location.reload(); };
    const badges = async () => { try { const s = await A.api('/api/admin/stats'); const set = (id, n) => { const e = $(id); if (e) { e.textContent = n; e.classList.toggle('hide', !n); } }; set('#b-pay', s.pendingPayments); set('#b-msg', s.unread); } catch {} };
    badges(); setInterval(badges, 20000);
    try { const es = new EventSource('/api/chat/stream'); es.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'msg' && !d.mine && d.msg.sender === 'user') { A.toast('💬 ' + (d.from || '') + ': ' + d.msg.body.slice(0, 50)); badges(); } if (d.type === 'payment') { A.toast('💳 ' + A.T('New payment to process', 'Nouveau paiement à traiter') + ' #' + d.code); badges(); } if (d.type === 'order') { A.toast('📦 ' + A.T('New order', 'Nouvelle commande') + ' #' + d.code); badges(); } A.onEvent && A.onEvent(d); }; } catch {}
    return me;
  };
  window.$$ = $$; window.A = A;
})();
