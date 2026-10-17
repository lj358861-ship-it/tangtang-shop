'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// Railway: attach a Volume and Railway exposes its mount path in RAILWAY_VOLUME_MOUNT_PATH.
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const d of ['uploads', 'proofs']) fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'tangtang.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, phone TEXT, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer', lang TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS categories(key TEXT PRIMARY KEY, duty_rate REAL NOT NULL, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, sku TEXT UNIQUE, cat TEXT, section TEXT, name TEXT, descr TEXT,
  price INTEGER NOT NULL, kg REAL NOT NULL, discount INTEGER DEFAULT 0, sold INTEGER DEFAULT 0, moq INTEGER DEFAULT 1,
  images TEXT, variants TEXT, colors TEXT, sizes TEXT, is_new INTEGER DEFAULT 0, needs_price INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1, created_at INTEGER);
CREATE TABLE IF NOT EXISTS countries(
  code TEXT PRIMARY KEY, region TEXT, air_per_kg INTEGER, sea_per_kg INTEGER, air_days TEXT, sea_days TEXT,
  featured INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, user_id INTEGER REFERENCES users(id), country TEXT, mode TEXT,
  name TEXT, phone TEXT, city TEXT, address TEXT, notes TEXT,
  qty_total INTEGER, weight REAL, goods INTEGER, shipping INTEGER, duty INTEGER, fee INTEGER, total INTEGER,
  discount_pct INTEGER DEFAULT 0, quota INTEGER, status INTEGER DEFAULT 0, payment_status TEXT DEFAULT 'unpaid',
  admin_note TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER,
  name TEXT, image TEXT, variant TEXT, size TEXT, qty INTEGER, unit_price INTEGER, kg REAL);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), user_id INTEGER, method TEXT, amount INTEGER,
  status TEXT DEFAULT 'submitted', payer_name TEXT, payer_phone TEXT, mask TEXT, enc TEXT, extra TEXT, proof_file TEXT,
  admin_note TEXT, created_at INTEGER, processed_at INTEGER, processed_by INTEGER, purged INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, order_code TEXT, sender TEXT NOT NULL, body TEXT NOT NULL,
  created_at INTEGER NOT NULL, read INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, target TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_msg_user ON messages(user_id, id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_pay_order ON payments(order_id);
`);

// ---------- helpers ----------
const run = (sql, ...p) => db.prepare(sql).run(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const now = () => Math.floor(Date.now() / 1000);

// ---------- secrets ----------
function loadSecret() {
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  const f = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const k = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, k, { mode: 0o600 });
  return k;
}
const SECRET = loadSecret();
const KEY = crypto.createHash('sha256').update(SECRET).digest();
const encrypt = (obj) => {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
};
const decrypt = (b64) => {
  const b = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
};

// ---------- passwords ----------
const hashPw = (pw) => { const salt = crypto.randomBytes(16); return 's1$' + salt.toString('hex') + '$' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
const checkPw = (pw, h) => {
  const [v, s, x] = String(h).split('$'); if (v !== 's1') return false;
  const t = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64); const e = Buffer.from(x, 'hex');
  return t.length === e.length && crypto.timingSafeEqual(t, e);
};

// ---------- seed ----------
const DUTY = { bag: .2, phone: .1, case: .15, tech: .1, watch: .15, shoe: .2, cloth: .25, wig: .15, toy: .2, hat: .2, jewel: .15, light: .15, beauty: .2, misc: .15, appl: .15, bike: .2, tent: .2 };
const COUNTRIES = [
 // code, region, air/kg, sea/kg, air days, sea days, featured
 ['CM','central',5900,1500,'7-10','35-45',1],['GA','central',6200,1600,'7-10','35-45',1],['CG','central',6200,1600,'7-10','35-45',1],
 ['CD','central',6500,1700,'8-12','40-50',1],['CF','central',6800,1800,'9-14','45-60',0],['TD','central',6800,1800,'9-14','45-60',0],
 ['GQ','central',6200,1600,'7-10','35-45',0],['AO','central',6800,1700,'8-12','40-50',0],
 ['CI','west',6300,1600,'8-12','35-50',1],['SN','west',6500,1650,'8-12','35-50',1],['ML','west',7000,1850,'9-14','45-60',0],
 ['BF','west',7000,1850,'9-14','45-60',0],['BJ','west',6300,1600,'8-12','35-50',0],['TG','west',6300,1600,'8-12','35-50',0],
 ['NE','west',7200,1900,'9-14','45-60',0],['GN','west',6700,1700,'8-12','40-50',0],['NG','west',6200,1550,'8-12','35-50',1],
 ['GH','west',6300,1600,'8-12','35-50',0],['SL','west',6800,1750,'9-14','40-55',0],['LR','west',6800,1750,'9-14','40-55',0],
 ['GM','west',6800,1750,'9-14','40-55',0],['MR','west',7000,1800,'9-14','40-55',0],
 ['MA','north',6800,1700,'8-12','30-45',0],['DZ','north',7000,1750,'8-12','30-45',0],['TN','north',7000,1750,'8-12','30-45',0],['EG','north',7000,1700,'8-12','30-45',0],
 ['KE','east',7200,1800,'9-14','40-55',0],['TZ','east',7200,1800,'9-14','40-55',0],['UG','east',7500,1950,'9-14','45-60',0],
 ['RW','east',7500,1950,'9-14','45-60',0],['ET','east',7500,1900,'9-14','45-60',0],['DJ','east',7400,1850,'9-14','40-55',0],
 ['MG','east',7500,1850,'9-14','40-55',0],['MU','east',7500,1850,'9-14','40-55',0],['ZA','east',7500,1850,'9-14','40-55',0],
 ['FR','europe',7500,1900,'6-10','35-45',1],['BE','europe',7500,1900,'6-10','35-45',1],['DE','europe',7500,1900,'6-10','35-45',1],
 ['ES','europe',7500,1900,'6-10','35-45',1],['IT','europe',7500,1900,'6-10','35-45',0],['PT','europe',7500,1900,'6-10','35-45',0],
 ['NL','europe',7500,1900,'6-10','35-45',0],['CH','europe',8000,2100,'6-10','35-45',0],['GB','europe',7800,2000,'6-10','35-45',0],
 ['US','america',8500,2200,'8-12','40-55',0],['CA','america',8800,2300,'8-12','40-55',0],
];
const DEFAULT_SETTINGS = {
  shop_name: 'Tangtang 糖糖',
  min_order: 50000,                 // minimum goods value per order, FCFA
  fee_pct: 5,                       // service fee on goods
  qty_tiers: [[0, 0], [10, 5], [30, 10], [100, 15]],   // [min total units, shipping discount %]
  fx: { XAF: 1, EUR: 0.001524, USD: 0.0017, CNY: 0.0119 },  // indicative display rates (1 FCFA = x)
  support_email: '',
  support_whatsapp: '',
  pay_notice: '',
};
function seed() {
  if (!get('SELECT 1 FROM categories LIMIT 1')) tx(() => { let i = 0; for (const [k, v] of Object.entries(DUTY)) run('INSERT INTO categories(key,duty_rate,sort) VALUES(?,?,?)', k, v, i++); });
  if (!get('SELECT 1 FROM countries LIMIT 1')) tx(() => { for (const c of COUNTRIES) run('INSERT INTO countries(code,region,air_per_kg,sea_per_kg,air_days,sea_days,featured) VALUES(?,?,?,?,?,?,?)', ...c); });
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', k, JSON.stringify(v));
  if (!get('SELECT 1 FROM products LIMIT 1')) {
    const f = path.join(__dirname, '..', 'data', 'seed-products.json');
    const items = JSON.parse(fs.readFileSync(f, 'utf8'));
    tx(() => { for (const p of items) run(`INSERT INTO products(sku,cat,section,name,descr,price,kg,discount,sold,moq,images,variants,colors,sizes,is_new,needs_price,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, p.sku, p.cat, p.section, JSON.stringify(p.name), JSON.stringify(p.desc), p.price, p.kg, p.discount, p.sold, p.moq,
      JSON.stringify(p.images), JSON.stringify(p.variants), JSON.stringify(p.colors), JSON.stringify(p.sizes), p.is_new, p.needs_price, now()); });
  }
  // admin account: ADMIN_EMAIL / ADMIN_PASSWORD (when set) always win, so the login follows your Railway variables
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.trim().toLowerCase(); const h = hashPw(process.env.ADMIN_PASSWORD);
    const cur = get('SELECT * FROM users WHERE email=?', email);
    if (cur) { if (cur.role !== 'admin' || !checkPw(process.env.ADMIN_PASSWORD, cur.pass_hash)) { run("UPDATE users SET role='admin', pass_hash=? WHERE id=?", h, cur.id); console.log('Admin account synced from ADMIN_EMAIL / ADMIN_PASSWORD:', email); } }
    else { run("INSERT INTO users(email,name,pass_hash,role,created_at) VALUES(?,?,?,?,?)", email, 'Admin', h, 'admin', now()); console.log('Admin account created:', email); }
    run("UPDATE users SET role='customer' WHERE role='admin' AND email<>?", email);   // only one admin: the one from the variables
  }
  if (!get("SELECT 1 FROM users WHERE role='admin'")) {
    const email = (process.env.ADMIN_EMAIL || 'admin@tangtang.com').toLowerCase();
    let pw = process.env.ADMIN_PASSWORD, generated = false;
    if (!pw) { pw = crypto.randomBytes(9).toString('base64url'); generated = true; }
    run("INSERT INTO users(email,name,pass_hash,role,created_at) VALUES(?,?,?,?,?)", email, 'Admin', hashPw(pw), 'admin', now());
    console.log('\n================ ADMIN ACCOUNT CREATED ================');
    console.log(' email   :', email);
    if (generated) { console.log(' password:', pw, ' (generated - change it in Admin > Settings)'); }
    else console.log(' password: (taken from ADMIN_PASSWORD)');
    console.log('=======================================================\n');
  }
}
seed();

const setting = (k) => { const r = get('SELECT value FROM settings WHERE key=?', k); return r ? JSON.parse(r.value) : DEFAULT_SETTINGS[k]; };
const setSetting = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v));

module.exports = { db, run, get, all, tx, now, DATA_DIR, encrypt, decrypt, hashPw, checkPw, setting, setSetting, DEFAULT_SETTINGS };
