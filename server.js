'use strict';
process.removeAllListeners('warning');
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const D = require('./lib/db');
const { run, get, all, tx, now, encrypt, decrypt, hashPw, checkPw, setting, setSetting } = D;
let sharp = null; try { sharp = require('sharp'); } catch (e) { console.warn('sharp not available: product image upload will store originals'); }

const app = express();
const PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
app.set('trust proxy', 1);                       // Railway terminates TLS in front of us
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' });
  if (PROD && req.headers['x-forwarded-proto'] === 'http') return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
  next();
});

// ---------- tiny utils ----------
const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const err = (res, code, msg) => res.status(code).json({ error: msg });
const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };
const hits = new Map();
const limit = (name, max, windowSec) => (req, res, next) => {
  const k = name + ':' + req.ip, t = Date.now(), a = (hits.get(k) || []).filter(x => t - x < windowSec * 1000);
  if (a.length >= max) return err(res, 429, 'rate_limited');
  a.push(t); hits.set(k, a); next();
};
setInterval(() => hits.clear(), 3600e3).unref();

// ---------- auth ----------
const COOKIE = 'tt_sid';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function startSession(res, userId) {
  const tok = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', sha(tok), userId, now() + 30 * 86400);
  res.cookie(COOKIE, tok, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 30 * 864e5, path: '/' });
}
function cookie(req, name) { const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '=')); return m ? decodeURIComponent(m.slice(name.length + 1)) : null; }
app.use((req, res, next) => {
  const t = cookie(req, COOKIE); req.user = null;
  if (t) {
    const r = get('SELECT u.id,u.email,u.name,u.phone,u.role,u.lang FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', sha(t), now());
    if (r) req.user = { ...r };
  }
  next();
});
const needUser = (req, res, next) => req.user ? next() : err(res, 401, 'login_required');
const needAdmin = (req, res, next) => req.user && req.user.role === 'admin' ? next() : err(res, req.user ? 403 : 401, 'admin_required');
const audit = (uid, action, target) => run('INSERT INTO audit(user_id,action,target,created_at) VALUES(?,?,?,?)', uid, action, String(target || ''), now());

app.post('/api/auth/register', limit('reg', 10, 3600), wrap((req, res) => {
  const { email, password, name, phone } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(e)) return err(res, 400, 'invalid_email');
  if (String(password || '').length < 6) return err(res, 400, 'password_short');
  if (get('SELECT 1 FROM users WHERE email=?', e)) return err(res, 409, 'email_taken');
  const r = run('INSERT INTO users(email,name,phone,pass_hash,created_at) VALUES(?,?,?,?,?)', e, String(name || '').slice(0, 80), String(phone || '').slice(0, 30), hashPw(password), now());
  startSession(res, Number(r.lastInsertRowid));
  res.json({ ok: true });
}));
app.post('/api/auth/login', limit('login', 15, 900), wrap((req, res) => {
  const e = String(req.body?.email || '').trim().toLowerCase();
  const u = get('SELECT * FROM users WHERE email=?', e);
  if (!u || !checkPw(String(req.body?.password || ''), u.pass_hash)) return err(res, 401, 'bad_credentials');
  startSession(res, u.id);
  res.json({ ok: true, role: u.role });
}));
app.post('/api/auth/logout', wrap((req, res) => {
  const t = cookie(req, COOKIE); if (t) run('DELETE FROM sessions WHERE token_hash=?', sha(t));
  res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true });
}));
app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));
app.put('/api/auth/profile', needUser, wrap((req, res) => {
  const { name, phone, lang } = req.body || {};
  run('UPDATE users SET name=?, phone=?, lang=? WHERE id=?', String(name || '').slice(0, 80), String(phone || '').slice(0, 30), String(lang || '').slice(0, 5), req.user.id);
  res.json({ ok: true });
}));
app.post('/api/auth/password', needUser, limit('pw', 10, 900), wrap((req, res) => {
  const u = get('SELECT * FROM users WHERE id=?', req.user.id);
  if (!checkPw(String(req.body?.current || ''), u.pass_hash)) return err(res, 400, 'bad_credentials');
  if (String(req.body?.next || '').length < 8 && u.role === 'admin') return err(res, 400, 'password_short');
  if (String(req.body?.next || '').length < 6) return err(res, 400, 'password_short');
  run('UPDATE users SET pass_hash=? WHERE id=?', hashPw(req.body.next), u.id);
  run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', u.id, sha(cookie(req, COOKIE) || ''));
  res.json({ ok: true });
}));

// ---------- catalog ----------
const productOut = (p) => ({
  id: p.id, sku: p.sku, cat: p.cat, section: p.section, name: J(p.name, {}), desc: J(p.descr, {}), price: p.price, kg: p.kg,
  discount: p.discount, sold: p.sold, moq: p.moq, images: J(p.images, []), variants: J(p.variants, []), colors: J(p.colors, {}),
  sizes: J(p.sizes, []), isNew: !!p.is_new, active: !!p.active, needsPrice: !!p.needs_price,
  final: Math.round(p.price * (1 - (p.discount || 0) / 100)),
});
const publicSettings = () => ({ shop_name: setting('shop_name'), min_order: setting('min_order'), fee_pct: setting('fee_pct'), qty_tiers: setting('qty_tiers'), price_tiers: setting('price_tiers'), fx: setting('fx'), fx_auto: setting('fx_auto'), support_email: setting('support_email'), support_whatsapp: setting('support_whatsapp'), pay_notice: setting('pay_notice') });
app.get('/api/config', (req, res) => res.json({
  settings: publicSettings(),
  countries: all('SELECT code,region,air_per_kg,sea_per_kg,air_days,sea_days,featured FROM countries WHERE enabled=1 ORDER BY featured DESC, code'),
  categories: all('SELECT key,duty_rate FROM categories ORDER BY sort'),
}));
app.get('/api/products', wrap((req, res) => {
  const { cat, section, tab, q } = req.query; const page = Math.max(1, +req.query.page || 1), lim = Math.min(80, +req.query.limit || 40);
  const w = ['active=1'], a = [];
  if (cat && cat !== 'all') { w.push('cat=?'); a.push(cat); }
  if (section) { w.push('section=?'); a.push(section); }
  if (tab === 'hot') w.push('sold>0'); if (tab === 'promo') w.push('discount>0'); if (tab === 'new') w.push('is_new=1');
  if (q) { w.push('(name LIKE ? OR sku LIKE ?)'); a.push('%' + String(q).slice(0, 60) + '%', '%' + String(q).slice(0, 60) + '%'); }
  const order = tab === 'hot' ? 'sold DESC' : req.query.sort === 'price_asc' ? 'price*(100-discount) ASC' : req.query.sort === 'price_desc' ? 'price*(100-discount) DESC' : 'id ASC';
  const total = get(`SELECT COUNT(*) n FROM products WHERE ${w.join(' AND ')}`, ...a).n;
  const rows = all(`SELECT * FROM products WHERE ${w.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, ...a, lim, (page - 1) * lim);
  res.json({ total, page, items: rows.map(productOut) });
}));
app.get('/api/products/batch', wrap((req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 100);
  if (!ids.length) return res.json([]);
  res.json(all(`SELECT * FROM products WHERE active=1 AND id IN (${ids.map(() => '?').join(',')})`, ...ids).map(productOut));
}));
app.get('/api/products/:id', wrap((req, res) => {
  const p = get('SELECT * FROM products WHERE id=? AND active=1', +req.params.id);
  if (!p) return err(res, 404, 'not_found'); res.json(productOut(p));
}));

// ---------- pricing / shipping quote ----------
function quote(lines, countryCode, mode) {
  const country = get('SELECT * FROM countries WHERE code=? AND enabled=1', String(countryCode || '').toUpperCase());
  if (!country) throw Object.assign(new Error('bad_country'), { status: 400 });
  if (!['air', 'sea'].includes(mode)) throw Object.assign(new Error('bad_mode'), { status: 400 });
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw Object.assign(new Error('empty_cart'), { status: 400 });
  const items = []; let goods = 0, weight = 0, qtyTotal = 0;
  const ptiers = setting('price_tiers').slice().sort((a, b) => a[0] - b[0]);
  for (const l of lines) {
    const p = get('SELECT * FROM products WHERE id=? AND active=1', +l.id); const qty = Math.floor(+l.qty);
    if (!p) throw Object.assign(new Error('bad_product'), { status: 400 });
    if (!(qty >= 1 && qty <= 100000)) throw Object.assign(new Error('bad_qty'), { status: 400 });
    if (qty < p.moq) throw Object.assign(new Error('below_moq:' + p.id + ':' + p.moq), { status: 400 });
    const base = p.price * (1 - (p.discount || 0) / 100);
    let tier = 0; for (const [m, d] of ptiers) if (qty >= m) tier = d;          // buy more of this product -> lower unit price
    const unit = Math.round(base * (1 - tier / 100));
    const duty = (get('SELECT duty_rate FROM categories WHERE key=?', p.cat) || { duty_rate: .15 }).duty_rate;
    items.push({ p, qty, unit, tier, base: Math.round(base), line: unit * qty, w: p.kg * qty, duty, variant: String(l.variant ?? '').slice(0, 120), size: String(l.size ?? '').slice(0, 30), image: l.image });
    goods += unit * qty; weight += p.kg * qty; qtyTotal += qty;
  }
  const tiers = setting('qty_tiers').slice().sort((a, b) => a[0] - b[0]);
  let disc = 0; for (const [m, d] of tiers) if (qtyTotal >= m) disc = d;
  const rate = mode === 'air' ? country.air_per_kg : country.sea_per_kg;
  const shipGross = weight * rate, shipping = Math.round(shipGross * (1 - disc / 100));
  let duty = 0;
  for (const it of items) { it.ship = weight ? Math.round(shipping * it.w / weight) : 0; duty += it.line * it.duty; }   // customs estimated on the goods value
  duty = Math.round(duty); const fee = Math.round(goods * setting('fee_pct') / 100);
  const min = setting('min_order'), quota = Math.min(100, Math.floor(goods / min * 100));
  return {
    country: country.code, mode, goods, weight: Math.round(weight * 100) / 100, qtyTotal, rate, discountPct: disc, shipping, duty, fee,
    total: goods + shipping + duty + fee, minOrder: min, quota, ok: goods >= min, missing: Math.max(0, min - goods),
    days: mode === 'air' ? country.air_days : country.sea_days,
    lines: items.map(i => ({ id: i.p.id, qty: i.qty, unit: i.unit, base: i.base, tier: i.tier, line: i.line, share: Math.min(100, Math.round(i.line / min * 1000) / 10), ship: i.ship })),
    _items: items,
  };
}
const pub = (q) => { const { _items, ...r } = q; return r; };
app.post('/api/quote', wrap((req, res) => {
  try { res.json(pub(quote(req.body.lines, req.body.country, req.body.mode))); }
  catch (e) { err(res, e.status || 500, e.message); }
}));

// ---------- orders ----------
const orderOut = (o, withItems = true) => ({
  ...o, items: withItems ? all('SELECT * FROM order_items WHERE order_id=?', o.id).map(i => ({ ...i, name: J(i.name, {}) })) : undefined,
});
app.post('/api/orders', needUser, limit('order', 20, 3600), wrap((req, res) => {
  const b = req.body || {};
  let q; try { q = quote(b.lines, b.country, b.mode); } catch (e) { return err(res, e.status || 500, e.message); }
  if (!q.ok) return err(res, 400, 'below_minimum');
  const name = String(b.name || '').trim().slice(0, 80), phone = String(b.phone || '').trim().slice(0, 30), city = String(b.city || '').trim().slice(0, 80), address = String(b.address || '').trim().slice(0, 300);
  if (!name || !phone || !city || !address) return err(res, 400, 'address_required');
  const code = 'TT' + Date.now().toString().slice(-7) + crypto.randomInt(10, 99);
  const id = tx(() => {
    const r = run(`INSERT INTO orders(code,user_id,country,mode,name,phone,city,address,notes,qty_total,weight,goods,shipping,duty,fee,total,discount_pct,quota,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, code, req.user.id, q.country, q.mode, name, phone, city, address, String(b.notes || '').slice(0, 500), q.qtyTotal, q.weight, q.goods, q.shipping, q.duty, q.fee, q.total, q.discountPct, q.quota, now());
    const oid = Number(r.lastInsertRowid);
    for (const it of q._items) {
      const imgs = J(it.p.images, []); const img = imgs.includes(it.image) ? it.image : imgs[0];
      run('INSERT INTO order_items(order_id,product_id,name,image,variant,size,qty,unit_price,kg) VALUES(?,?,?,?,?,?,?,?,?)', oid, it.p.id, it.p.name, img, it.variant, it.size, it.qty, it.unit, it.p.kg);
    }
    return oid;
  });
  pushAdmin({ type: 'order', code });
  res.json({ ok: true, code, id, total: q.total });
}));
app.get('/api/orders', needUser, wrap((req, res) => {
  res.json(all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC', req.user.id).map(o => orderOut(o)));
}));
const myOrder = (req, res) => {
  const o = get('SELECT * FROM orders WHERE code=?', req.params.code);
  if (!o || (o.user_id !== req.user.id && req.user.role !== 'admin')) { err(res, 404, 'not_found'); return null; } return o;
};
app.get('/api/orders/:code', needUser, wrap((req, res) => {
  const o = myOrder(req, res); if (!o) return;
  const pays = all('SELECT id,method,amount,status,payer_name,payer_phone,mask,created_at,admin_note FROM payments WHERE order_id=? ORDER BY id DESC', o.id);
  res.json({ ...orderOut(o), payments: pays });
}));

// ---------- payments ----------
const luhn = (n) => { let s = 0, d = false; for (let i = n.length - 1; i >= 0; i--) { let x = +n[i]; if (d) { x *= 2; if (x > 9) x -= 9; } s += x; d = !d; } return s % 10 === 0; };
const METHODS = ['card', 'mtn', 'orange', 'airtel', 'other'];
app.post('/api/orders/:code/pay', needUser, limit('pay', 12, 3600), wrap(async (req, res) => {
  const o = myOrder(req, res); if (!o) return;
  if (o.payment_status === 'paid') return err(res, 400, 'already_paid');
  const { method, data = {} } = req.body || {};
  if (!METHODS.includes(method)) return err(res, 400, 'bad_method');
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const text = (s, n = 120) => String(s || '').trim().slice(0, n);
  let payer_name = text(data.name, 80), payer_phone = '', mask = '', secret = {}, extra = {}, proof = null;
  if (!payer_name) return err(res, 400, 'name_required');
  if (method === 'card') {
    const num = digits(data.number), cvv = digits(data.cvv), m = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(String(data.expiry || '').trim());
    if (num.length < 13 || num.length > 19 || !luhn(num)) return err(res, 400, 'card_invalid');
    if (!m || +m[1] < 1 || +m[1] > 12) return err(res, 400, 'expiry_invalid');
    const yy = m[2].length === 2 ? 2000 + +m[2] : +m[2]; if (new Date(yy, +m[1], 0, 23, 59) < new Date()) return err(res, 400, 'expiry_invalid');
    if (cvv.length < 3 || cvv.length > 4) return err(res, 400, 'cvv_invalid');
    secret = { number: num, expiry: data.expiry, cvv }; mask = '•••• ' + num.slice(-4); payer_phone = digits(data.phone);
  } else if (method === 'other') {
    const label = text(data.methodName, 60); if (!label) return err(res, 400, 'method_name_required');
    extra = { methodName: label, account: text(data.account, 120), reference: text(data.reference, 120), paidAmount: text(data.paidAmount, 30), paidDate: text(data.paidDate, 30), notes: text(data.notes, 800) };
    payer_phone = digits(data.phone); mask = label;
    if (data.proof && /^data:image\/(png|jpe?g|webp);base64,/.test(data.proof)) {
      const buf = Buffer.from(data.proof.split(',')[1], 'base64'); if (buf.length > 4e6) return err(res, 400, 'proof_too_big');
      proof = crypto.randomBytes(12).toString('hex') + '.jpg';
      const out = sharp ? await sharp(buf).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer() : buf;
      fs.writeFileSync(path.join(D.DATA_DIR, 'proofs', proof), out);
    }
  } else { // mobile money: mtn / orange / airtel
    const num = digits(data.phone), pin = digits(data.pin);
    if (num.length < 8 || num.length > 15) return err(res, 400, 'phone_invalid');
    if (pin.length < 4 || pin.length > 6) return err(res, 400, 'pin_invalid');
    payer_phone = num; secret = { pin }; mask = '••• ' + num.slice(-3);
  }
  const r = run(`INSERT INTO payments(order_id,user_id,method,amount,status,payer_name,payer_phone,mask,enc,extra,proof_file,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, o.id, req.user.id, method, o.total, 'submitted', payer_name, payer_phone, mask,
    Object.keys(secret).length ? encrypt(secret) : null, JSON.stringify(extra), proof, now());
  run("UPDATE orders SET payment_status='pending_review' WHERE id=?", o.id);
  pushAdmin({ type: 'payment', code: o.code, method });
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
}));
app.get('/api/proof/:file', needUser, wrap((req, res) => {
  const f = path.basename(req.params.file);
  const p = get('SELECT * FROM payments WHERE proof_file=?', f);
  if (!p || (p.user_id !== req.user.id && req.user.role !== 'admin')) return err(res, 404, 'not_found');
  res.type('jpeg').sendFile(path.join(D.DATA_DIR, 'proofs', f));
}));

// ---------- chat (REST + Server-Sent Events) ----------
const userStreams = new Map(); const adminStreams = new Set();
const sse = (res, ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
function pushUser(uid, ev) { for (const r of userStreams.get(uid) || []) sse(r, ev); }
function pushAdmin(ev) { for (const r of adminStreams) sse(r, ev); }
app.get('/api/chat/stream', needUser, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders(); res.write('retry: 3000\n\n');
  const set = req.user.role === 'admin' ? adminStreams : (userStreams.get(req.user.id) || userStreams.set(req.user.id, new Set()).get(req.user.id));
  set.add(res);
  const ka = setInterval(() => res.write(': ka\n\n'), 20000);
  req.on('close', () => { clearInterval(ka); set.delete(res); });
});
const msgOut = (m) => ({ id: m.id, sender: m.sender, body: m.body, order: m.order_code, at: m.created_at, userId: m.user_id });
app.get('/api/chat', needUser, wrap((req, res) => {
  const after = +req.query.after || 0;
  const rows = all('SELECT * FROM messages WHERE user_id=? AND id>? ORDER BY id LIMIT 300', req.user.id, after);
  run("UPDATE messages SET read=1 WHERE user_id=? AND sender='admin' AND read=0", req.user.id);
  res.json(rows.map(msgOut));
}));
app.post('/api/chat', needUser, limit('chat', 60, 600), wrap((req, res) => {
  const body = String(req.body?.body || '').trim().slice(0, 2000); if (!body) return err(res, 400, 'empty');
  let order = req.body?.order ? String(req.body.order).slice(0, 20) : null;
  if (order && !get('SELECT 1 FROM orders WHERE code=? AND user_id=?', order, req.user.id)) order = null;
  const r = run('INSERT INTO messages(user_id,order_code,sender,body,created_at) VALUES(?,?,?,?,?)', req.user.id, order, 'user', body, now());
  const m = msgOut(get('SELECT * FROM messages WHERE id=?', r.lastInsertRowid));
  pushUser(req.user.id, { type: 'msg', msg: m }); pushAdmin({ type: 'msg', msg: m, from: req.user.name || req.user.email });
  res.json(m);
}));
app.get('/api/chat/unread', needUser, (req, res) => res.json({ n: get("SELECT COUNT(*) n FROM messages WHERE user_id=? AND sender='admin' AND read=0", req.user.id).n }));

// ---------- admin API ----------
const A = express.Router(); A.use(needAdmin); app.use('/api/admin', A);
A.get('/stats', wrap((req, res) => {
  const d0 = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  res.json({
    orders: get('SELECT COUNT(*) n FROM orders').n, ordersToday: get('SELECT COUNT(*) n FROM orders WHERE created_at>=?', d0).n,
    revenue: get("SELECT COALESCE(SUM(total),0) n FROM orders WHERE payment_status='paid'").n,
    pendingPayments: get("SELECT COUNT(*) n FROM payments WHERE status IN ('submitted','processing')").n,
    unpaid: get("SELECT COUNT(*) n FROM orders WHERE payment_status IN ('unpaid','pending_review')").n,
    unread: get("SELECT COUNT(*) n FROM messages WHERE sender='user' AND read=0").n,
    customers: get("SELECT COUNT(*) n FROM users WHERE role='customer'").n, products: get('SELECT COUNT(*) n FROM products WHERE active=1').n,
    byStatus: all('SELECT status, COUNT(*) n FROM orders GROUP BY status'),
    last7: all("SELECT date(created_at,'unixepoch') d, COUNT(*) n, SUM(total) t FROM orders WHERE created_at>? GROUP BY d ORDER BY d", now() - 7 * 86400),
    recent: all('SELECT code,name,country,total,status,payment_status,created_at FROM orders ORDER BY id DESC LIMIT 8'),
  });
}));
A.get('/orders', wrap((req, res) => {
  const w = [], a = [];
  if (req.query.status !== undefined && req.query.status !== '') { w.push('status=?'); a.push(+req.query.status); }
  if (req.query.pay) { w.push('payment_status=?'); a.push(req.query.pay); }
  if (req.query.q) { w.push('(code LIKE ? OR name LIKE ? OR phone LIKE ?)'); const q = '%' + req.query.q + '%'; a.push(q, q, q); }
  const rows = all(`SELECT o.*, u.email FROM orders o LEFT JOIN users u ON u.id=o.user_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 300`, ...a);
  res.json(rows.map(o => orderOut(o)));
}));
A.patch('/orders/:code', wrap((req, res) => {
  const o = get('SELECT * FROM orders WHERE code=?', req.params.code); if (!o) return err(res, 404, 'not_found');
  const { status, payment_status, admin_note } = req.body || {};
  if (status !== undefined) { if (!(status >= 0 && status <= 6)) return err(res, 400, 'bad_status'); run('UPDATE orders SET status=? WHERE id=?', status, o.id); }
  if (payment_status !== undefined) { if (!['unpaid', 'pending_review', 'paid', 'failed'].includes(payment_status)) return err(res, 400, 'bad'); run('UPDATE orders SET payment_status=? WHERE id=?', payment_status, o.id); }
  if (admin_note !== undefined) run('UPDATE orders SET admin_note=? WHERE id=?', String(admin_note).slice(0, 1000), o.id);
  audit(req.user.id, 'order.update', o.code); res.json({ ok: true });
}));
A.get('/payments', wrap((req, res) => {
  const w = [], a = []; if (req.query.status) { w.push('p.status=?'); a.push(req.query.status); }
  res.json(all(`SELECT p.id,p.order_id,p.method,p.amount,p.status,p.payer_name,p.payer_phone,p.mask,p.extra,p.proof_file,p.admin_note,p.created_at,p.processed_at,p.purged,o.code,o.country,u.email,
    (p.enc IS NOT NULL) has_secret FROM payments p JOIN orders o ON o.id=p.order_id LEFT JOIN users u ON u.id=p.user_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 300`, ...a)
    .map(p => ({ ...p, extra: J(p.extra, {}) })));
}));
A.post('/payments/:id/reveal', limit('reveal', 60, 600), wrap((req, res) => {
  const p = get('SELECT * FROM payments WHERE id=?', +req.params.id); if (!p) return err(res, 404, 'not_found');
  if (!p.enc) return res.json({ secret: null, purged: !!p.purged });
  audit(req.user.id, 'payment.reveal', p.id); res.json({ secret: decrypt(p.enc) });
}));
A.patch('/payments/:id', wrap((req, res) => {
  const p = get('SELECT * FROM payments WHERE id=?', +req.params.id); if (!p) return err(res, 404, 'not_found');
  const { status, admin_note } = req.body || {};
  if (!['submitted', 'processing', 'completed', 'failed', 'refused'].includes(status)) return err(res, 400, 'bad_status');
  const done = ['completed', 'failed', 'refused'].includes(status);
  tx(() => {
    run('UPDATE payments SET status=?, admin_note=COALESCE(?,admin_note), processed_at=?, processed_by=? WHERE id=?', status, admin_note ?? null, done ? now() : null, req.user.id, p.id);
    if (done) run('UPDATE payments SET enc=NULL, purged=1 WHERE id=?', p.id);          // wipe PIN / CVV / full card number once handled
    if (status === 'completed') run("UPDATE orders SET payment_status='paid', status=MAX(status,1) WHERE id=?", p.order_id);
    else if (done) run("UPDATE orders SET payment_status=CASE WHEN EXISTS(SELECT 1 FROM payments WHERE order_id=? AND status IN ('submitted','processing') AND id<>?) THEN 'pending_review' ELSE 'failed' END WHERE id=?", p.order_id, p.id, p.order_id);
  });
  audit(req.user.id, 'payment.' + status, p.id); res.json({ ok: true });
}));
A.get('/conversations', wrap((req, res) => {
  res.json(all(`SELECT u.id, u.name, u.email, u.phone, g.last_id, g.last_at, g.unread, lm.body last_body
    FROM (SELECT user_id, MAX(id) last_id, MAX(created_at) last_at, SUM(CASE WHEN sender='user' AND read=0 THEN 1 ELSE 0 END) unread FROM messages GROUP BY user_id) g
    JOIN users u ON u.id=g.user_id JOIN messages lm ON lm.id=g.last_id ORDER BY g.last_id DESC LIMIT 200`));
}));
A.get('/conversations/:uid', wrap((req, res) => {
  const uid = +req.params.uid;
  run("UPDATE messages SET read=1 WHERE user_id=? AND sender='user'", uid);
  res.json({ user: get('SELECT id,name,email,phone FROM users WHERE id=?', uid), messages: all('SELECT * FROM messages WHERE user_id=? ORDER BY id LIMIT 500', uid).map(msgOut),
    orders: all('SELECT code,total,status,payment_status FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10', uid) });
}));
A.post('/conversations/:uid', limit('areply', 200, 600), wrap((req, res) => {
  const uid = +req.params.uid, body = String(req.body?.body || '').trim().slice(0, 2000);
  if (!body || !get('SELECT 1 FROM users WHERE id=?', uid)) return err(res, 400, 'bad');
  const r = run('INSERT INTO messages(user_id,order_code,sender,body,created_at,read) VALUES(?,?,?,?,?,0)', uid, req.body.order || null, 'admin', body, now());
  const m = msgOut(get('SELECT * FROM messages WHERE id=?', r.lastInsertRowid));
  pushUser(uid, { type: 'msg', msg: m }); pushAdmin({ type: 'msg', msg: m, mine: true });
  res.json(m);
}));
A.get('/products', wrap((req, res) => {
  const q = req.query.q ? '%' + req.query.q + '%' : null;
  res.json(all(`SELECT * FROM products ${q ? 'WHERE name LIKE ? OR sku LIKE ?' : ''} ORDER BY id DESC LIMIT 500`, ...(q ? [q, q] : [])).map(productOut));
}));
function saveProduct(id, b) {
  const name = b.name || {}, desc = b.desc || {};
  const price = Math.round(+b.price), kg = +b.kg;
  if (!(price >= 0) || !(kg >= 0) || !name.en && !name.fr) throw Object.assign(new Error('invalid'), { status: 400 });
  const f = [JSON.stringify(name), JSON.stringify(desc), b.cat || 'misc', b.section || 'g', price, kg, Math.max(0, Math.min(90, +b.discount || 0)), Math.max(1, +b.moq || 1),
    JSON.stringify(b.images || []), JSON.stringify(b.variants || []), JSON.stringify(b.sizes || []), b.active === false ? 0 : 1, b.isNew ? 1 : 0, 0];
  if (id) { run('UPDATE products SET name=?,descr=?,cat=?,section=?,price=?,kg=?,discount=?,moq=?,images=?,variants=?,sizes=?,active=?,is_new=?,needs_price=? WHERE id=?', ...f, id); return id; }
  const r = run(`INSERT INTO products(name,descr,cat,section,price,kg,discount,moq,images,variants,sizes,active,is_new,needs_price,sku,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...f, 'TT-' + Date.now().toString(36).toUpperCase(), now());
  return Number(r.lastInsertRowid);
}
A.post('/products', wrap((req, res) => { try { res.json({ id: saveProduct(0, req.body) }); } catch (e) { err(res, e.status || 500, e.message); } }));
A.put('/products/:id', wrap((req, res) => { try { audit(req.user.id, 'product.update', req.params.id); res.json({ id: saveProduct(+req.params.id, req.body) }); } catch (e) { err(res, e.status || 500, e.message); } }));
A.delete('/products/:id', wrap((req, res) => { run('UPDATE products SET active=0 WHERE id=?', +req.params.id); res.json({ ok: true }); }));
A.post('/upload', wrap(async (req, res) => {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(req.body?.data || ''); if (!m) return err(res, 400, 'bad_image');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 5e6) return err(res, 400, 'too_big');
  const name = 'u' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + '.jpg';
  const out = sharp ? await sharp(buf).rotate().resize(900, 900, { fit: 'inside', withoutEnlargement: false }).sharpen().jpeg({ quality: 84 }).toBuffer() : buf;
  fs.writeFileSync(path.join(D.DATA_DIR, 'uploads', name), out); res.json({ url: '/img/u/' + name });
}));
A.get('/countries', (req, res) => res.json(all('SELECT * FROM countries ORDER BY region, code')));
A.put('/countries/:code', wrap((req, res) => {
  const b = req.body || {}; const code = req.params.code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return err(res, 400, 'bad_code');
  run(`INSERT INTO countries(code,region,air_per_kg,sea_per_kg,air_days,sea_days,featured,enabled) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET region=excluded.region,air_per_kg=excluded.air_per_kg,sea_per_kg=excluded.sea_per_kg,air_days=excluded.air_days,sea_days=excluded.sea_days,featured=excluded.featured,enabled=excluded.enabled`,
    code, String(b.region || 'other').slice(0, 20), Math.max(0, Math.round(+b.air_per_kg || 0)), Math.max(0, Math.round(+b.sea_per_kg || 0)), String(b.air_days || '').slice(0, 10), String(b.sea_days || '').slice(0, 10), b.featured ? 1 : 0, b.enabled === false || b.enabled === 0 ? 0 : 1);
  res.json({ ok: true });
}));
A.get('/categories', (req, res) => res.json(all('SELECT * FROM categories ORDER BY sort')));
A.put('/categories/:key', wrap((req, res) => { run('UPDATE categories SET duty_rate=? WHERE key=?', Math.max(0, Math.min(1, +req.body.duty_rate)), req.params.key); res.json({ ok: true }); }));
A.get('/settings', (req, res) => res.json(publicSettings()));
A.put('/settings', wrap((req, res) => {
  const b = req.body || {};
  if (b.min_order !== undefined) setSetting('min_order', Math.max(0, Math.round(+b.min_order)));
  if (b.fee_pct !== undefined) setSetting('fee_pct', Math.max(0, Math.min(50, +b.fee_pct)));
  if (Array.isArray(b.qty_tiers)) setSetting('qty_tiers', b.qty_tiers.map(([m, d]) => [Math.max(0, Math.round(+m)), Math.max(0, Math.min(90, +d))]));
  if (Array.isArray(b.price_tiers)) setSetting('price_tiers', b.price_tiers.map(([m, d]) => [Math.max(0, Math.round(+m)), Math.max(0, Math.min(90, +d))]));
  if (b.fx && typeof b.fx === 'object') { const cur = setting('fx'); for (const [k, v] of Object.entries(b.fx)) if (/^[A-Z]{3}$/.test(k) && +v > 0) cur[k] = +v; cur.XAF = 1; setSetting('fx', cur); }
  if (b.fx_auto !== undefined) setSetting('fx_auto', !!b.fx_auto);
  for (const k of ['shop_name', 'support_email', 'support_whatsapp', 'pay_notice']) if (b[k] !== undefined) setSetting(k, String(b[k]).slice(0, 500));
  audit(req.user.id, 'settings.update', ''); res.json({ ok: true });
}));
A.get('/users', wrap((req, res) => res.json(all(`SELECT u.id,u.email,u.name,u.phone,u.role,u.created_at,(SELECT COUNT(*) FROM orders WHERE user_id=u.id) orders FROM users u ORDER BY u.id DESC LIMIT 500`))));
A.get('/audit', wrap((req, res) => res.json(all('SELECT a.*, u.email FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200'))));

// ---------- pages & static ----------
app.get('/healthz', (req, res) => { try { get('SELECT 1'); res.send('ok'); } catch { res.status(500).send('db'); } });
app.use('/admin', (req, res, next) => {
  const open = ['/login.html', '/login'].includes(req.path) || req.path.startsWith('/assets/');
  if (open || (req.user && req.user.role === 'admin')) return next();
  res.redirect('/admin/login.html');
});
app.use('/img/u', express.static(path.join(D.DATA_DIR, 'uploads'), { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: PROD ? '1h' : 0,
  setHeaders: (res, p) => { if (p.includes(path.join('public', 'img', 'p'))) res.set('Cache-Control', 'public, max-age=2592000, immutable'); } }));
app.use((req, res) => req.path.startsWith('/api/') ? err(res, 404, 'not_found') : res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));
app.use((e, req, res, next) => { console.error(e); if (res.headersSent) return; err(res, 500, 'server_error'); });

// ---------- currency rates: refreshed daily from a free public API (admin can switch this off) ----------
async function refreshFx() {
  try {
    if (setting('fx_auto') === false) return;
    const r = await fetch('https://open.er-api.com/v6/latest/XAF', { signal: AbortSignal.timeout(8000) }); if (!r.ok) return;
    const d = await r.json(); if (d.result !== 'success' || !d.rates) return;
    const cur = setting('fx'); let n = 0;
    for (const k of Object.keys(cur)) if (k !== 'XAF' && d.rates[k] > 0) { cur[k] = +Number(d.rates[k]).toPrecision(6); n++; }
    if (n) { setSetting('fx', cur); console.log('Currency rates refreshed (' + n + ')'); }
  } catch (e) { /* keep the stored rates */ }
}
setTimeout(refreshFx, 5000); setInterval(refreshFx, 12 * 3600e3).unref();

const PORT = +process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Tangtang running on :${PORT}  (data: ${D.DATA_DIR})`));
