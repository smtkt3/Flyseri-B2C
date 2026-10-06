const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve('apps/api/package.json'));
const env = req('dotenv').parse(fs.readFileSync('.env'));
const { Pool } = req('pg');
const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis:5000 });
(async () => {
 const client = await pool.connect();
 try {
  const directory = path.resolve('packages/database/drizzle');
  const journal = JSON.parse(fs.readFileSync(path.join(directory,'meta/_journal.json'),'utf8'));
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(107523)");
  const previous = await client.query("SELECT to_regclass('public.visa_assistance_requests') IS NOT NULL AS ready");
  if (!previous.rows[0].ready) throw new Error('Prior visa assistance migration missing');
  for (const entry of journal.entries.filter(entry => entry.idx === 22 || entry.idx === 23)) {
   const source = fs.readFileSync(path.join(directory,entry.tag+'.sql'),'utf8');
   const hash = crypto.createHash('sha256').update(source).digest('hex');
   const existing = await client.query('SELECT id FROM drizzle.__drizzle_migrations WHERE hash=$1',[hash]);
   if (existing.rows.length) { console.log(entry.tag+': already applied'); continue; }
   for (const statement of source.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean)) await client.query(statement);
   await client.query('INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ($1,$2)',[hash,entry.when]);
   console.log(entry.tag+': prepared');
  }
  await client.query('COMMIT');
  console.log('Visa applicant and document migrations committed');
  const result=await client.query("SELECT relrowsecurity AS private, has_table_privilege('flyseri_api','public.visa_assistance_request_documents','SELECT,INSERT,DELETE') AS document_access, has_column_privilege('flyseri_api','public.visa_assistance_requests','status','UPDATE') AS submit_access FROM pg_class WHERE oid='public.visa_assistance_request_documents'::regclass");
  console.log(result.rows);
 } catch (e) { await client.query('ROLLBACK'); console.error('Migration failed: '+(e.code||e.message)); process.exitCode=1; }
 finally { client.release(); await pool.end(); }
})().catch(e=>{console.error('Database unavailable: '+(e.code||'connection failure'));process.exitCode=1;pool.end();});
