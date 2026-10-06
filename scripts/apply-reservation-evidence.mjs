import { DatabaseConnection } from '../packages/database/dist/index.js';
process.loadEnvFile('.env');
const connection=new DatabaseConnection(process.env.DATABASE_URL);
try {
 await connection.pool.query('BEGIN');
 await connection.pool.query(`INSERT INTO audit_events (actor_customer_id,trip_id,event) SELECT customer_id,trip_id,'flight.booking.rejected:' || id::text || ':AGENCY_CONFIGURATION' FROM flight_bookings b WHERE id=$1 AND status='BOOKING_FAILED' AND pnr_locator IS NULL AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.actor_customer_id=b.customer_id AND a.event='flight.booking.rejected:' || b.id::text || ':AGENCY_CONFIGURATION')`,['7d70c153-9f28-4c8c-9caf-1a0bb5b62c51']);
 await connection.pool.query('COMMIT');
 console.log('Diagnosed failure classified in the existing audit table. Reservation status unchanged.');
} catch(error) {await connection.pool.query('ROLLBACK');throw error;} finally {await connection.close();}
