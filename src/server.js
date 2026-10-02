require('dotenv').config();
const express = require('express'), cors = require('cors'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), crypto = require('crypto');
const { Pool } = require('pg'), Razorpay = require('razorpay'), { z } = require('zod');

const dbUrl = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: dbUrl, ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false } });
const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN }));

/* Razorpay webhook needs the RAW body, so it is registered BEFORE express.json().
   It is a safety net: it confirms the booking even if the user closes the tab after paying. */
app.post('/api/webhooks/razorpay', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const sig = req.headers['x-razorpay-signature'];
    const exp = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '').update(req.body).digest('hex');
    if (sig !== exp) return res.status(400).end();
    const ev = JSON.parse(req.body.toString());
    if (ev.event === 'payment.captured') {
      const p = ev.payload.payment.entity;
      await pool.query(`UPDATE bookings SET status='confirmed', razorpay_payment_id=$1 WHERE razorpay_order_id=$2`, [p.id, p.order_id]);
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).end(); }
});

app.use(express.json({ limit: '100kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));

/* ---------- helpers ---------- */
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const sign = u => jwt.sign({ id: u.id, role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please login' }); }
};
const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const dateRe = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* ---------- auth ---------- */
app.post('/api/auth/signup', wrap(async (req, res) => {
  const b = z.object({ name: z.string().min(2).max(60), email: z.string().email(), password: z.string().min(8).max(100) }).parse(req.body);
  const hash = await bcrypt.hash(b.password, 12);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,role`,
      [b.name, b.email.toLowerCase(), hash]);
    res.json({ token: sign(rows[0]), user: rows[0] });
  } catch (e) { if (e.code === '23505') throw httpErr(409, 'Email already registered'); throw e; }
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const b = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [b.email.toLowerCase()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(b.password, u.password_hash))) throw httpErr(401, 'Wrong email or password');
  res.json({ token: sign(u), user: { id: u.id, name: u.name, role: u.role } });
}));

/* ---------- search & seats ---------- */
app.get('/api/routes', wrap(async (req, res) => {
  const mode = z.enum(['flight', 'train', 'bus']).parse(req.query.mode);
  const { rows } = await pool.query(
    'SELECT id,mode,operator,price,dep_time,arr_time,total_seats FROM routes WHERE mode=$1 AND active', [mode]);
  res.json(rows);
}));

app.get('/api/routes/:id/seats', wrap(async (req, res) => {
  const date = dateRe.parse(req.query.date);
  const { rows } = await pool.query('SELECT seat FROM seat_locks WHERE route_id=$1 AND travel_date=$2', [req.params.id, date]);
  res.json({ taken: rows.map(r => r.seat) });
}));

/* ---------- booking: create Razorpay order and lock seats atomically ---------- */
app.post('/api/bookings', auth, wrap(async (req, res) => {
  const b = z.object({
    routeId: z.number().int(), origin: z.string().min(2).max(60), destination: z.string().min(2).max(60),
    date: dateRe, seats: z.array(z.number().int().min(0).max(199)).min(1).max(6)
  }).parse(req.body);

  if (b.origin === b.destination) throw httpErr(400, 'Origin and destination must differ');
  if (new Date(b.date) < new Date(new Date().toDateString())) throw httpErr(400, 'Date is in the past');
  if (new Set(b.seats).size !== b.seats.length) throw httpErr(400, 'Duplicate seats');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = (await client.query('SELECT price,total_seats FROM routes WHERE id=$1 AND active', [b.routeId])).rows[0];
    if (!r) throw httpErr(404, 'Route not found');
    if (b.seats.some(s => s >= r.total_seats)) throw httpErr(400, 'Invalid seat');

    const amount = r.price * b.seats.length;               // price ALWAYS comes from the database, never the browser
    const pub = 'SR' + crypto.randomBytes(4).toString('hex').toUpperCase();

    const bk = (await client.query(
      `INSERT INTO bookings(public_id,user_id,route_id,origin,destination,travel_date,seats,amount)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [pub, req.user.id, b.routeId, b.origin, b.destination, b.date, b.seats, amount])).rows[0];

    for (const s of b.seats) {                              // primary-key conflict means seat already taken
      try { await client.query('INSERT INTO seat_locks VALUES($1,$2,$3,$4)', [b.routeId, b.date, s, bk.id]); }
      catch (e) { if (e.code === '23505') throw httpErr(409, `Seat ${s + 1} was just taken`); throw e; }
    }

    const order = await rzp.orders.create({ amount: amount * 100, currency: 'INR', receipt: pub });
    await client.query('UPDATE bookings SET razorpay_order_id=$1 WHERE id=$2', [order.id, bk.id]);
    await client.query('COMMIT');
    res.json({ bookingId: pub, orderId: order.id, amount: order.amount, currency: 'INR', key: process.env.RAZORPAY_KEY_ID });
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}));

/* ---------- booking: verify payment signature ---------- */
app.post('/api/bookings/verify', auth, wrap(async (req, res) => {
  const b = z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() }).parse(req.body);
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(b.orderId + '|' + b.paymentId).digest('hex');
  if (expected !== b.signature) throw httpErr(400, 'Payment verification failed');
  const { rows } = await pool.query(
    `UPDATE bookings SET status='confirmed', razorpay_payment_id=$1
     WHERE razorpay_order_id=$2 AND user_id=$3
     RETURNING public_id,origin,destination,travel_date,seats,amount`,
    [b.paymentId, b.orderId, req.user.id]);
  if (!rows[0]) throw httpErr(404, 'Booking not found');
  res.json({ ok: true, ticket: rows[0] });
}));

app.get('/api/my/bookings', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT public_id,origin,destination,travel_date,seats,amount,status FROM bookings WHERE user_id=$1 ORDER BY id DESC', [req.user.id]);
  res.json(rows);
}));

/* ---------- admin ---------- */
app.get('/api/admin/stats', auth, adminOnly, wrap(async (req, res) => {
  const s = (await pool.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status='confirmed'),0)::int AS revenue, COUNT(*)::int AS bookings FROM bookings`)).rows[0];
  const u = (await pool.query('SELECT COUNT(*)::int AS users FROM users')).rows[0];
  const r = (await pool.query('SELECT COUNT(*)::int AS routes FROM routes WHERE active')).rows[0];
  res.json({ ...s, ...u, ...r });
}));

app.get('/api/admin/bookings', auth, adminOnly, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.public_id,u.name,b.origin,b.destination,r.mode,b.amount,b.status
     FROM bookings b JOIN users u ON u.id=b.user_id JOIN routes r ON r.id=b.route_id
     ORDER BY b.id DESC LIMIT 100`);
  res.json(rows);
}));

app.post('/api/admin/routes', auth, adminOnly, wrap(async (req, res) => {
  const b = z.object({
    mode: z.enum(['flight', 'train', 'bus']), operator: z.string().min(2).max(60),
    price: z.number().int().positive(), dep: z.string(), arr: z.string()
  }).parse(req.body);
  const { rows } = await pool.query(
    'INSERT INTO routes(mode,operator,price,dep_time,arr_time) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [b.mode, b.operator, b.price, b.dep, b.arr]);
  res.json(rows[0]);
}));

app.post('/api/admin/bookings/:pid/cancel', auth, adminOnly, wrap(async (req, res) => {
  await pool.query(`DELETE FROM seat_locks WHERE booking_id=(SELECT id FROM bookings WHERE public_id=$1)`, [req.params.pid]);
  await pool.query(`UPDATE bookings SET status='cancelled' WHERE public_id=$1`, [req.params.pid]);
  res.json({ ok: true });
}));

app.get('/health', (req, res) => res.json({ ok: true }));

/* error handler: known errors keep their message, everything else stays generic */
app.use((e, req, res, next) => {
  if (e.name === 'ZodError') return res.status(400).json({ error: 'Invalid input' });
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: 'Server error' });
});

app.listen(process.env.PORT || 4000, () => console.log('BookMyTicket API running'));
