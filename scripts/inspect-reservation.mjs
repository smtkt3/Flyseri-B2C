import { DatabaseConnection } from '../packages/database/dist/index.js';
import '../apps/api/node_modules/reflect-metadata/Reflect.js';
import {parseConfig} from '../packages/config/dist/index.js';
import {FlightBookingsService} from '../apps/api/dist/flight/flight-bookings.service.js';
process.loadEnvFile('.env');
const connection = new DatabaseConnection(process.env.DATABASE_URL);
try {
 const result = await connection.pool.query(`SELECT id,customer_id FROM flight_bookings ORDER BY created_at DESC LIMIT 1`);
 const service=new FlightBookingsService(parseConfig({...process.env,APP_ENV:'test'}),connection,{},undefined,undefined);
 const row=await service.detail(result.rows[0].customer_id,result.rows[0].id);
 console.log(JSON.stringify({bookingId:row.id,status:row.status,pnr:row.pnr,failureMessage:row.failureMessage,reconciliation:row.reconciliation,capabilities:service.capabilities()}));
 const diagnostics=await connection.pool.query(`SELECT event FROM audit_events WHERE actor_customer_id=$1 AND (event LIKE $2 OR event LIKE $3) ORDER BY created_at DESC LIMIT 1`,[result.rows[0].customer_id,`flight.booking.rejection-diagnostic:${row.id}:%`,`flight.booking.unknown-diagnostic:${row.id}:%`]);
 console.log(JSON.stringify({diagnostics:diagnostics.rows.map(row=>JSON.parse(row.event.split(':').slice(2).join(':')))}));
 const columns=await connection.pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='flight_bookings'`);
 console.log(JSON.stringify({columns:columns.rows.map(row=>row.column_name)}));
} finally { await connection.close(); }
