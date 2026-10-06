import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
export * from './schema.js';

export class DatabaseConnection {
  readonly pool: Pool;
  readonly db: ReturnType<typeof drizzle<typeof schema>>;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 2000, idleTimeoutMillis: 30000 });
    this.db = drizzle(this.pool, { schema });
  }

  async health(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
