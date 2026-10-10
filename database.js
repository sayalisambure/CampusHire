const mysql = require('mysql2');

const clean = v => (v || '').trim().replace(/^["']|["']$/g, '');

const cfg = {
    host: clean(process.env.DB_HOST),
    port: Number(clean(process.env.DB_PORT)) || 27396,
    user: clean(process.env.DB_USER),
    password: clean(process.env.DB_PASSWORD),
    database: clean(process.env.DB_NAME)
};

const missing = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
    .filter(k => !clean(process.env[k]));
if (missing.length) console.error('MISSING ENV VARS ON HOST:', missing.join(', '));

console.log(`DB target: ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);

// Aiven's CA is private. Paste ca.pem into DB_CA to verify; otherwise
// the connection is encrypted but the server certificate is not verified.
const ssl = process.env.DB_CA
    ? { ca: process.env.DB_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }
    : { rejectUnauthorized: false };

const db = mysql.createPool({
    ...cfg,
    ssl,
    connectTimeout: 20000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Startup self-test: tells you in the logs exactly what's wrong
db.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()',
    (err, rows) => {
        if (err) return console.error('DB STARTUP CHECK FAILED:', err.code, err.message);
        console.log(`DB connection OK. Tables in ${cfg.database}: ${rows[0].n}`);
        if (rows[0].n === 0) console.error('DB is empty: run database/schema.sql and seed.sql');
    }
);

module.exports = db;