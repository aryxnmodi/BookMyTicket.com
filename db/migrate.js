require('dotenv').config();
const fs = require('fs'), { Pool } = require('pg'), bcrypt = require('bcryptjs');

(async () => {
  const url = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
  await pool.query(fs.readFileSync(__dirname + '/schema.sql', 'utf8'));
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  await pool.query(
    `INSERT INTO users(name,email,password_hash,role) VALUES('Admin',$1,$2,'admin') ON CONFLICT(email) DO NOTHING`,
    [process.env.ADMIN_EMAIL.toLowerCase(), hash]
  );
  console.log('Database ready. Admin account created.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
