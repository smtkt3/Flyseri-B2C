import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '@flyseri/config';
import { DatabaseConnection } from '@flyseri/database';
import { CrmSyncWorker, crmSyncConfigured } from './worker.js';

loadDotEnv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });
const config = parseConfig(process.env);
if (!config.DATABASE_URL || !crmSyncConfigured(config)) throw new Error('CRM sync worker requires database and CRM service configuration');
const database = new DatabaseConnection(config.DATABASE_URL);
const worker = new CrmSyncWorker(database, config.CRM_SYNC_URL, config.CRM_SYNC_SHARED_SECRET);
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
try {
  while (running) {
    try {
      const result = await worker.runOne();
      if (result === 'DEAD') process.stderr.write('CRM sync event reached dead letter state\n');
      if (result === 'IDLE') await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch { await new Promise((resolve) => setTimeout(resolve, 5000)); }
  }
} finally { await database.close(); }
