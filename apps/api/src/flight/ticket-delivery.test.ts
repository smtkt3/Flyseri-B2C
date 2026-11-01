import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import * as schema from '@flyseri/database';
import {parseConfig} from '@flyseri/config';
import {TicketDocumentsService} from './ticket-documents.service.js';
import {ticketFixture} from './ticket-document.fixture.js';
import {queueTicketEmail} from './ticket-document.contract.js';
import {sendTicketSmtp} from './ticket-email.js';
vi.mock('./ticket-email.js',async original=>({...await original<typeof import('./ticket-email.js')>(),sendTicketSmtp:vi.fn()}));
it('claims one email, preserves its receipt, and does not retry an uncertain SMTP outcome',async()=>{
 const database=new PGlite();try{
  await database.exec('CREATE ROLE flyseri_api; CREATE ROLE anon; CREATE ROLE authenticated;');
  const journal=JSON.parse(readFileSync(resolve('../../packages/database/drizzle/meta/_journal.json'),'utf8'));
  for(const {tag} of journal.entries)for(const statement of readFileSync(resolve('../../packages/database/drizzle/'+tag+'.sql'),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await database.exec(statement);
  const db=drizzle(database,{schema}),connection={db} as unknown as schema.DatabaseConnection,customerId=randomUUID(),booking=ticketFixture();
  await db.insert(schema.customers).values({id:customerId,authUserId:randomUUID()});
  let snapshot=queueTicketEmail({checkoutContactEmail:'booking@example.com'},booking.id,booking.providerView!);
  await db.insert(schema.flightBookingIntents).values({id:booking.bookingIntentId,customerId,searchId:randomUUID(),selectedOfferId:randomUUID(),idempotencyKey:randomUUID(),status:'READY_FOR_PAYMENT',currency:'BDT',searchTotalAmount:'6049',validatedTotalAmount:'6049',selectedOfferSnapshot:booking.selectedOffer,searchRequestSnapshot:snapshot});
  await db.insert(schema.flightBookings).values({id:booking.id,bookingIntentId:booking.bookingIntentId,customerId,status:'TICKETED',pnrLocator:booking.pnr,updatedAt:new Date(booking.updatedAt)});
  const config=parseConfig({APP_ENV:'test',TICKET_EMAIL_ENABLED:'true',SMTP_HOST:'smtp.example.com',SMTP_USER:'sender',SMTP_PASSWORD:'fixture',SMTP_FROM_EMAIL:'tickets@example.com'});
  const detail=vi.fn(async(owner:string)=>{if(owner!==customerId)throw Error('Not owned');return booking;});
  const service=new TicketDocumentsService(config,connection,{detail} as never),send=vi.mocked(sendTicketSmtp);send.mockResolvedValue();
  await service.runOnce();await service.runOnce();expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0]?.[1]).toBe('booking@example.com');expect(send.mock.calls[0]?.[4].subarray(0,5).toString()).toBe('%PDF-');
  expect(await service.deliveryStatus(customerId,booking.id)).toMatchObject({emailStatus:'SENT',available:true});
  await expect(service.pdf('another-customer',booking.id)).rejects.toThrow('Not owned');
  booking.providerView!.tickets[0]!.number='9970000000002';snapshot=queueTicketEmail(snapshot,booking.id,booking.providerView!);await db.update(schema.flightBookingIntents).set({searchRequestSnapshot:snapshot}).where(eq(schema.flightBookingIntents.id,booking.bookingIntentId));
  send.mockRejectedValueOnce(Error('Lost SMTP acknowledgement'));await service.runOnce();await service.runOnce();expect(send).toHaveBeenCalledTimes(2);expect(await service.deliveryStatus(customerId,booking.id)).toMatchObject({emailStatus:'REVIEW_REQUIRED'});
  const disabled=new TicketDocumentsService({...config,TICKET_EMAIL_ENABLED:false},connection,{detail} as never);await disabled.runOnce();expect(send).toHaveBeenCalledTimes(2);
 }finally{await database.close();}
},30000);
