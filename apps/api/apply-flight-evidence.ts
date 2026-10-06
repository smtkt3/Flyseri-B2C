import { config as dotenv } from 'dotenv';
import { DatabaseConnection } from '@flyseri/database';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

dotenv({ path: '../../.env', quiet: true });
if (!process.env.DATABASE_URL) throw new Error('Database configuration missing');
const connection = new DatabaseConnection(process.env.DATABASE_URL);
try {
  await migrate(connection.db, { migrationsFolder: '../../packages/database/drizzle' });
  console.log('Database migrations applied.');
  const evidence = await connection.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'flight_bookings' AND column_name IN ('booked_passenger_names', 'provider_view_snapshot')");
  console.log('Flight evidence columns:', evidence.rowCount);
} catch (error) { const failure = error as { code?: string; cause?: { code?: string; table?: string; constraint?: string } };
  console.log('Migration failure details:', { code: failure.code ?? failure.cause?.code, table: failure.cause?.table, constraint: failure.cause?.constraint }); process.exitCode = 1; }
finally { await connection.close(); }
