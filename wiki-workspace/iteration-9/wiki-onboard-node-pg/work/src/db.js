const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://wikiuser@db.local:5432/appdb',
});

module.exports = pool;
