# Tangtang 糖糖 – wholesale shop (multi-page, backend + admin portal)

Node 22 + Express + SQLite (built-in `node:sqlite`). No build step.

**Storefront pages:** `/` home · `/shop` · `/product?id=` · `/cart` (quota 0–100, country toggle, air/sea) · `/checkout` · `/pay?order=` (card, MTN MoMo, Orange Money, Airtel Money, "More…") · `/orders` · `/order?code=` · `/chat` · `/shipping` · `/help` · `/account`
**Admin portal:** `/admin/` — dashboard, orders, payments (reveal details → process manually), messages (live chat), products, shipping countries/rates, customers, settings.
**Languages:** English, Français, Deutsch, Español, 中文.

## Business rules (all editable in Admin → Settings / Shipping rates)
- Minimum order **50 000 FCFA of goods** = quota **100**. Checkout is blocked below it; every cart line shows the % of quota it fills.
- Shipping = total kg × per-kg rate (country × air/sea) × (1 − quantity discount). Tiers default: 10 units −5 %, 30 −10 %, 100 −15 %.
- Customs by category + 5 % service fee, as in the original site.
- 46 destination countries; "featured" ones show first, the rest are behind the **More countries** toggle.

## Payments – how it works
Customer enters card (number, name, expiry, CVV) or mobile money (number, name, secret code) or fills the free "More…" form (method, account, reference, notes, screenshot). The admin sees it in **Admin → Payments**, clicks **Reveal** (logged), starts the transaction manually, then marks it **Completed / Failed / Refused**. PIN, CVV and full card numbers are AES-256-GCM encrypted at rest and **erased automatically** when the payment is marked done.

> ⚠️ Collecting card data / mobile-money PINs yourself is outside PCI-DSS and most operators' terms. For production prefer a gateway (CinetPay, Flutterwave, Stripe, Orange Money Web Pay) where the customer approves on their own phone. Always run behind HTTPS (Railway does this).

## Run locally
```
npm install
ADMIN_PASSWORD='choose-a-strong-one' npm start      # http://localhost:3000
```
If you don't set `ADMIN_PASSWORD`, a random one is printed once in the console at first start. Admin login: `admin@tangtang.com` (or `ADMIN_EMAIL`).

## Deploy on Railway
1. Push this folder to a GitHub repo → Railway → **New Project → Deploy from GitHub** (the `Dockerfile` + `railway.json` are picked up automatically; health check `/healthz`).
2. **Add a Volume** to the service, mount path **`/data`** (keeps the database, uploaded product photos and payment proofs across deploys).
3. **Variables:** `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SECRET_KEY` (long random string – set once, never change it, or stored payment secrets become unreadable). `PORT` and `NODE_ENV` are handled for you.
4. **Settings → Networking → Generate Domain** (or attach your own). Keep **1 replica** (SQLite + in-memory chat stream).
5. Open `/admin/`, log in, change the password, review prices of items flagged **"confirm price"** (the 28 products added from the PDF use estimated prices).

## Data & images
- `tools/clean_images.py` – the cleaning pipeline used on the photos (trim borders, denoise, 2× Lanczos upscale, sharpen, white background). `public/img/p/s*.jpg` = from your site (594), `w*.jpg` = from the WhatsApp PDF (40).
- `data/seed-products.json` seeds the DB on first start only; afterwards manage products in the admin.
