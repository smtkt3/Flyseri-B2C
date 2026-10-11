const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve('apps/api/package.json'));
process.loadEnvFile('.env');
const { Pool } = req('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
(async () => {
  console.log((await pool.query("SELECT relname,relrowsecurity,has_table_privilege(current_user,oid,'SELECT') AS readable,has_table_privilege(current_user,oid,'INSERT') AS writable FROM pg_class WHERE oid IN (to_regclass('public.fare_watches'),to_regclass('public.travel_support_requests'))")).rows);
  await pool.query('SELECT id FROM fare_watches LIMIT 0');
  await pool.query('SELECT id FROM travel_support_requests LIMIT 0');
  console.log('Both tables accessible with the restricted API login.');
})().catch(error => { console.error('Verification failed:', error.code || 'database error'); process.exitCode = 1; }).finally(() => pool.end());
