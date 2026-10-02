// Connect travel.html to the real backend.
// 1) Add this to the page <head>:  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
// 2) Set API to your deployed backend URL (e.g. https://bookmyticket-api.onrender.com)
const API = 'https://api.yourdomain.com';
let token = localStorage.getItem('sr_token');

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

// LOGIN / SIGNUP (replace the demo handler on #authGo)
async function realLogin(email, password) {
  const d = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  token = d.token; localStorage.setItem('sr_token', token);
  return d.user;                       // { id, name, role }  -> show admin dashboard when role === 'admin'
}
async function realSignup(name, email, password) {
  const d = await api('/api/auth/signup', { method: 'POST', body: { name, email, password } });
  token = d.token; localStorage.setItem('sr_token', token);
  return d.user;
}

// SEARCH: replace the local routes array with live data
//   const list = await api('/api/routes?mode=flight');
// TAKEN SEATS for the seat map:
//   const { taken } = await api(`/api/routes/${routeId}/seats?date=${date}`);

// PAYMENT: call this instead of the demo payStep/done logic
async function payReal(routeId, origin, destination, date, seats, onTicket) {
  const o = await api('/api/bookings', { method: 'POST', body: { routeId, origin, destination, date, seats } });
  new Razorpay({
    key: o.key, amount: o.amount, currency: o.currency, order_id: o.orderId, name: 'BookMyTicket.com',
    handler: async r => {
      const v = await api('/api/bookings/verify', {
        method: 'POST',
        body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }
      });
      onTicket(v.ticket);              // render the e-ticket with v.ticket
    }
  }).open();
}
