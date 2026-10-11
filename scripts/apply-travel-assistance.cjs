const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve('apps/api/package.json'));
const env = req('dotenv').parse(fs.readFileSync('.env'));
const { Pool } = req('pg');
const pool = new Pool({ connectionString: env.DATABASE_MIGRATION_URL || env.DATABASE_URL, connectionTimeoutMillis: 5000 });
(async () => {
  const client = await pool.connect();
  try {
    const directory = path.resolve('packages/database/drizzle');
    const entry = JSON.parse(fs.readFileSync(path.join(directory, 'meta/_journal.json'), 'utf8')).entries.find(item => item.tag === '0029_travel_assistance');
    const source = fs.readFileSync(path.join(directory, entry.tag + '.sql'), 'utf8');
    const hash = crypto.createHash('sha256').update(source).digest('hex');
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(107523)');
    const exists = await client.query('SELECT id FROM drizzle.__drizzle_migrations WHERE hash=$1', [hash]);
    if (!exists.rows.length) {
      for (const statement of source.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) await client.query(statement);
      await client.query('INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)', [hash, entry.when]);
    }
    await client.query('COMMIT');
    const result = await client.query("SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('public.fare_watches'::regclass,'public.travel_support_requests'::regclass)");
    console.log('Travel assistance migration applied. Privacy:', result.rows);
  } catch (error) { await client.query('ROLLBACK'); console.error('Migration failed:', error.code || 'database error'); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})().catch(error => { console.error('Database unavailable:', error.code || 'connection failure'); process.exitCode = 1; pool.end(); });
