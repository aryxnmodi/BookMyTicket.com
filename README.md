# BookMyTicket.com — Full Setup Guide

This project has two parts:
- **frontend/index.html** — the site itself (search, booking, seat maps, tickets, admin dashboard). Works standalone as a demo with no setup.
- **Backend (src/, db/)** — Node.js + Express + PostgreSQL + Razorpay API that gives you real accounts, real seat locking, and real payments.

The frontend runs in **demo mode** by default (fake login, fake payments, nothing saved permanently). Follow this guide to turn on **live mode** — real signups, a real database, and real money through Razorpay.

---

## Part 1 — Try it instantly (no setup)

Just open `frontend/index.html` in a browser, or host it on any static site service (Netlify, Vercel, GitHub Pages). Demo client login: any email + password of 4+ characters. Demo admin login: `admin@bookmyticket.com` / `admin123`. Nothing is charged and nothing is saved beyond the browser tab.

This is enough to show people the product. It is **not** enough to take real bookings or real money — for that, do Parts 2–5.

---

## Part 2 — Run the backend locally

**Requirements:** Node.js 18+, a PostgreSQL database (local or free cloud), a Razorpay account.

1. Open a terminal in this folder and install dependencies:
   ```
   npm install
   ```
2. Copy the environment template and fill it in:
   ```
   cp .env.example .env
   ```
   Open `.env` and set:
   - `DATABASE_URL` — your Postgres connection string
   - `JWT_SECRET` — any long random string (used to sign login tokens)
   - `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from your Razorpay dashboard, **use Test mode keys first**
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the real admin account that gets created for you
   - `FRONTEND_ORIGIN` — where your frontend will be hosted (use `http://localhost:5500` or similar while testing locally)
3. Create the database tables and your admin account:
   ```
   npm run migrate
   ```
4. Start the server:
   ```
   npm run dev
   ```
   Visit `http://localhost:4000/health` — you should see `{"ok":true}`.

If you don't have Postgres installed locally, skip straight to Part 3 and use a free cloud database instead — it's simpler than installing Postgres yourself.

---

## Part 3 — Get a free cloud database (Neon)

1. Go to neon.tech and create a free account and project.
2. Copy the connection string it gives you (starts with `postgres://`).
3. Paste it into `DATABASE_URL` in your `.env`.
4. Run `npm run migrate` again against this new database.

Neon's free tier is enough to launch and test with real users.

---

## Part 4 — Get Razorpay working

1. Create an account at razorpay.com and complete business KYC (PAN, bank account; GST if you have one). KYC approval is required before you can accept **real** money — you can build and test everything before it's approved using **Test mode**.
2. In the dashboard, switch to **Test Mode** and copy your Test Key ID and Key Secret into `.env`.
3. Test cards/UPI IDs for Test Mode are listed in Razorpay's own docs inside the dashboard — use those to run through a full booking without spending real money.
4. Once KYC is approved, switch the dashboard to **Live Mode**, generate Live keys, and swap them into your **production** environment variables (never commit them to code).
5. **Webhook (recommended):** In the Razorpay dashboard, add a webhook pointing to `https://YOUR-DEPLOYED-API/api/webhooks/razorpay`, event `payment.captured`. Copy the webhook secret it gives you into `RAZORPAY_WEBHOOK_SECRET` in your `.env`. This confirms a booking even if the customer closes their browser right after paying — the same reason real ticketing sites use webhooks.

---

## Part 5 — Connect the frontend to the real backend

Open `frontend/index.html` and find this near the top of the `<script>` section:

```js
const LIVE_API = null; // e.g. 'https://bookmyticket-api.onrender.com'
```

Change `null` to your backend's URL once it's deployed (Part 6), for example:

```js
const LIVE_API = 'https://bookmyticket-api.onrender.com';
```

With this set, the page automatically:
- Sends real signups/logins to `/api/auth/signup` and `/api/auth/login`
- Stores the login token in the browser so the person stays logged in
- Opens a real Razorpay checkout window and verifies the payment signature before confirming the booking

**One thing you still need to wire up yourself:** the page currently generates sample flight/train/bus listings in the browser (so it looks and feels complete without a backend). To sell real inventory, replace the `genRoutes(...)` call in `index.html` with a fetch to your own `/api/routes?mode=...` endpoint, and give each route a real database `id` — the payment code looks for `pick.id` when creating a booking. Until you do that, keep `LIVE_API` as `null`, or only enable it once you've connected real routes, so customers aren't charged for a route that has no real seat inventory behind it.

Leave `LIVE_API` as `null` if you just want the free-standing demo.

---

## Part 6 — Deploy it so it's live on the internet

**Backend (Render.com, has a free tier):**
1. Push this whole folder to a GitHub repository.
2. On Render: New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add every variable from your `.env` in Render's Environment settings (use your **Live** Razorpay keys only once KYC is approved; use Test keys until then).
5. Deploy, then open Render's Shell tab and run `npm run migrate` once.
6. Confirm `https://your-service.onrender.com/health` returns `{"ok":true}`.

**Frontend (Netlify or Vercel, both free):**
1. Set `LIVE_API` in `frontend/index.html` to your Render URL (Part 5).
2. Drag-and-drop the `frontend` folder into Netlify, or connect the repo — either works, since it's a single static HTML file.
3. Note the URL Netlify/Vercel gives you.

**Connect the two:**
- Go back to your backend's environment variables on Render and set `FRONTEND_ORIGIN` to the exact frontend URL from the step above. This is a security setting (CORS) that only allows your site to call your API.
- Redeploy the backend so the new setting takes effect.

**Custom domain (bookmyticket.com or similar):**
1. Buy the domain (Namecheap, GoDaddy, Google Domains).
2. In Netlify/Vercel, add it as a custom domain — they'll give you DNS records to add at your domain registrar. HTTPS is issued automatically.
3. Optionally point a subdomain like `api.yourdomain.com` at your Render backend the same way, and update `LIVE_API` and `FRONTEND_ORIGIN` to use the real domain instead of the `.onrender.com`/`.netlify.app` addresses.

---

## Part 7 — Before you take real payments

- Add Privacy Policy, Terms of Service, and a Refund/Cancellation policy page — Razorpay requires these for Live Mode approval, and customers expect them.
- Change `ADMIN_PASSWORD` in your production `.env` to something real; never use `admin123` outside of the demo.
- Do a full test booking with Test Mode keys end-to-end (search → book → pay → e-ticket) before switching to Live keys.
- Real train, flight and bus inventory (as opposed to the sample data this project ships with) requires licensed access: IRCTC's authorized partner program for trains, an aggregator like Amadeus or Duffel for flights, and direct operator contracts or a bus-API provider for buses. This project's data engine is realistic-looking sample data, not a live feed — see the notice on the site itself.

---

## What's already built and tested in this backend

- Signup/login with bcrypt password hashing and JWT sessions
- Rate-limited auth endpoints (30 requests / 15 min) to slow down brute-force attempts
- Seat locking inside a database transaction, so two people can never book the same seat
- Prices always read from the database — never trusted from the browser
- Razorpay order creation + signature verification before a booking is marked confirmed
- A webhook safety net for payments that complete after the browser closes
- Admin-only endpoints for stats, all bookings, adding routes, and cancellations
- Input validation (zod) on every endpoint, with generic error messages so internals are never leaked

## Project structure

```
bookmyticket-backend/
├── frontend/
│   └── index.html        # the whole site — demo mode by default, set LIVE_API to go live
├── src/
│   └── server.js         # Express API — auth, bookings, payments, admin
├── db/
│   ├── schema.sql        # tables + sample routes
│   └── migrate.js        # creates tables + your admin account
├── public/
│   └── checkout-snippet.js  # reference only — same logic is already in frontend/index.html
├── package.json
└── .env.example           # copy to .env and fill in
```
