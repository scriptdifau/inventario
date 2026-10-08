const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const query = (text, params) => pool.query(text, params);

// stringhe vuote dei form -> NULL
const nul = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

module.exports = { pool, query, nul };
