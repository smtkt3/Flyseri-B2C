import 'dotenv/config';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { parseConfig } from '@flyseri/config';
import { DatabaseConnection, documentVersions } from '@flyseri/database';
import { createDocumentStorage } from './storage.js';

const config = parseConfig(process.env);
const storage = createDocumentStorage(config);
if (!config.DATABASE_URL || !storage) throw new Error('Database and private document storage must be configured');
const connection = new DatabaseConnection(config.DATABASE_URL);
try {
  const cutoff = new Date(Date.now() - 15 * 60_000);
  const stale = await connection.db.select({ id: documentVersions.id, path: documentVersions.storagePath }).from(documentVersions)
    .where(and(inArray(documentVersions.uploadState, ['PENDING', 'FAILED']), lt(documentVersions.createdAt, cutoff)));
  let cleaned = 0;
  for (const item of stale) {
    try {
      await storage.remove(item.path);
      await connection.db.update(documentVersions).set({ uploadState: 'FAILED' }).where(eq(documentVersions.id, item.id));
      cleaned++;
    } catch {
      // Version IDs are safe to use for operator follow-up; never print paths or file data.
      process.stderr.write(`Document cleanup retry needed: ${item.id}\n`);
    }
  }
  process.stdout.write(`Document cleanup complete: ${cleaned} stale reservations\n`);
} finally {
  await connection.close();
}
