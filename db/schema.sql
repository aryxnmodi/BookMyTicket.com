CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','admin')),
  created_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE IF NOT EXISTS routes(
  id SERIAL PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('flight','train','bus')),
  operator TEXT NOT NULL, price INTEGER NOT NULL CHECK (price > 0),
  dep_time TEXT NOT NULL, arr_time TEXT NOT NULL, total_seats INTEGER NOT NULL DEFAULT 24,
  active BOOLEAN DEFAULT true, UNIQUE(mode, operator, dep_time));

CREATE TABLE IF NOT EXISTS bookings(
  id SERIAL PRIMARY KEY, public_id TEXT UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id), route_id INTEGER REFERENCES routes(id),
  origin TEXT NOT NULL, destination TEXT NOT NULL, travel_date DATE NOT NULL,
  seats INTEGER[] NOT NULL, amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  razorpay_order_id TEXT UNIQUE, razorpay_payment_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now());

-- one seat can only be held once per route + date
CREATE TABLE IF NOT EXISTS seat_locks(
  route_id INTEGER, travel_date DATE, seat INTEGER,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  PRIMARY KEY(route_id, travel_date, seat));

INSERT INTO routes(mode,operator,price,dep_time,arr_time) VALUES
 ('flight','IndiGo',4200,'06:15','08:05'),('flight','Air India',5100,'09:40','11:35'),('flight','Akasa Air',3900,'14:20','16:10'),
 ('train','Vande Bharat',1450,'06:00','12:30'),('train','Rajdhani Exp',1900,'16:55','07:40'),('train','Shatabdi Exp',1100,'07:10','13:25'),
 ('bus','VRL Travels',850,'21:00','06:30'),('bus','Neeta Volvo',720,'22:15','07:10'),('bus','IntrCity SmartBus',990,'20:30','05:45')
ON CONFLICT DO NOTHING;
