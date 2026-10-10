const mysql = require('mysql2');

// Aiven: download ca.pem from your service's Overview page and paste its
// full contents into a DB_CA environment variable on your host.
const ssl = process.env.DB_CA
    ? { ca: process.env.DB_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }
    : { rejectUnauthorized: false }; // works, but doesn't verify the server

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = db;