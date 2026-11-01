import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import { parseConfig } from '@flyseri/config';
import type { FlightOffer, FlightSearchRequest, FlightBookingProviderView } from '@flyseri/types';
import { DrizzleBookingIntentStore } from './booking-intent.repository.js';
import { BookingIntentService } from './booking-intent.service.js';
import { FlightBookingsService } from './flight-bookings.service.js';
import { FlightOfferValidationService } from './flight-offer-validation.service.js';
import { FlightTelemetry } from './flight.telemetry.js';
import type { FlightService } from './flight.service.js';
import { SabreBookingUnknownError, SabreBookingManagementClient } from './sabre-booking-management.client.js';
import { TicketingValidationError } from './ticketing-currency.contract.js';
import { CommerceRepository } from '../commerce/commerce.repository.js';
import { CommerceController } from '../commerce/commerce.controller.js';
import { CommerceService } from '../commerce/commerce.service.js';
import { PaymentEngineService } from '../commerce/payment-engine.service.js';
import { FlightTicketingService } from './flight-ticketing.service.js';
import { AdminFlightOperationsService } from '../admin/admin-flight-operations.service.js';
import { AdminFlightRefundsService } from '../admin/admin-flight-refunds.service.js';
import {AdminFlightExchangesService} from '../admin/admin-flight-exchanges.service.js';
import {StripeTestPaymentProvider} from '../commerce/stripe-test-payment.provider.js';
import { AdminFlightsService } from '../admin/admin-flights.service.js';
import { StripeTestRefundProvider } from '../commerce/stripe-test-refund.provider.js';
import {calculateFlightPrice,type FlightPricingRule} from '../pricing/flight-pricing.contract.js';
import {FlightPricingService} from '../pricing/flight-pricing.service.js';

describe('flight reservation and payment lifecycle with isolated provider fixtures', () => {
  it('preserves ownership, one reservation, one order and verified payment; blocks repeat sends after uncertainty', async () => {
    const database = new PGlite();
    try {
      await database.exec('CREATE ROLE flyseri_api; CREATE ROLE anon; CREATE ROLE authenticated;');
      const journal = JSON.parse(readFileSync(resolve('../../packages/database/drizzle/meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
      for (const { tag } of journal.entries) for (const statement of readFileSync(resolve(`../../packages/database/drizzle/${tag}.sql`), 'utf8').split('--> statement-breakpoint').filter(value => value.trim())) await database.exec(statement);
      const customerId = randomUUID(), travelerId = randomUUID();
      await database.query('INSERT INTO customers (id,auth_user_id) VALUES ($1,$2)', [customerId, randomUUID()]);
      await database.query("INSERT INTO travellers (id,legal_first_name,legal_last_name,date_of_birth,gender,nationality_country_code) VALUES ($1,'Test','Traveler','1990-01-01','MALE','MY')", [travelerId]);
      await database.query("INSERT INTO customer_travellers (customer_id,traveller_id,relationship_type) VALUES ($1,$2,'SELF')", [customerId, travelerId]);
      const connection = { db: drizzle(database, { schema }),pool:{query:(query:string,params:unknown[])=>database.query(query,params)} } as unknown as DatabaseConnection;
      const store = new DrizzleBookingIntentStore(connection);
      const offer: FlightOffer = { offerId: randomUUID(), currency: 'MYR', totalAmount: '100.00', airlineCodes: ['MH'], baggageSummary: null, inbound: null,
        outbound: { stops: 0, durationMinutes: 60, segments: [{ origin: 'KUL', destination: 'PEN', departureAt: '2027-02-18T09:00:00+08:00', arrivalAt: '2027-02-18T10:00:00+08:00', marketingCarrier: 'MH', flightNumber: '1148', bookingClass: 'Q', durationMinutes: 60 }] } };
      const search: FlightSearchRequest = { origin: 'KUL', destination: 'PEN', departureDate: '2027-02-18', tripType: 'ONE_WAY', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'MYR' };
      const agency = { ticketingPolicy: 'TODAY', address: { name: 'Test Agency', street: 'Test Street', city: 'Test City', stateProvince: 'Test Region', postalCode: '00000', countryCode: 'MY', freeText: 'Test Agency' } };
      const config = { ...parseConfig({ APP_ENV: 'test' }), FLIGHT_BOOKING_EXECUTION_ENABLED: 'true' as const, SABRE_PCC: 'TEST', SABRE_BOOKING_AGENCY: JSON.stringify(agency), SABRE_TICKETING_PROFILE: JSON.stringify({hardcopyPrinterAddress:'ABC123',formOfPayment:'CASH'}) };
      const telemetry = new FlightTelemetry({ info: vi.fn() } as never);
      const intents = new BookingIntentService(config, store, undefined, {} as FlightService, telemetry, new FlightOfferValidationService(undefined));
      const createBooking = vi.fn(async () => ({ confirmationId: 'TEST01', sabreBookingId: 'provider-1' }));
      const provider = { createBooking, flightCheck: vi.fn(async () => ({ offers: [{ id: 'fare-1', source: { distributionModel: 'ATPCO' }, applicableToPseudoCityCodes: ['TEST'], validUntil: new Date(Date.now() + 600000).toISOString(), totalPrice: { amount: '100.00', currencyCode: 'MYR' }, items: [{ fares: [{ fareComponents: [{ segmentDetails: [{ bookingClassCode: 'Q' }] }] }] }] }] })) };
      const bookings = new FlightBookingsService(config, connection, provider as unknown as SabreBookingManagementClient, intents, telemetry);
      const airlineView:FlightBookingProviderView = {retrievedAt:new Date().toISOString(),cancellationCheckComplete:true,tickets:[],travellers:[{givenName:'Test',surname:'Traveler'}],flights:[{origin:'KUL',destination:'PEN',airlineCode:'MH',flightNumber:'1148',departureDate:'2027-02-18',departureTime:'09:00',arrivalDate:'2027-02-18',arrivalTime:'10:00',status:'Confirmed'}]};
      const getBookingView=vi.fn(async()=>({bookingId:'provider-1',view:airlineView}));
      Object.assign(provider,{getBookingView,getTicketingContext:vi.fn(async()=>({...await getBookingView(),selection:{priceQuoteRecordIds:['1'],validatingAirlineCode:'MH',currency:'MYR',totalAmount:'100.00'}})),getIssuedTicketContext:vi.fn(async()=>{const current=await getBookingView();return {...current,documents:{complete:true,warnings:[],flightItemIds:['1'],tickets:current.view.tickets.map(t=>({number:t.number,travelerIndex:t.travellerIndex,airlineCode:'MH',ticketingPcc:'TEST',status:t.status,payment:{total:'100.00',currencyCode:'MYR'},coupons:[{itemId:'1',status:'Okay'}]}))}};}),fulfillFlightTickets:vi.fn()});
      const input = { namesConfirmed: true, contactEmail: 'test@example.com', contactPhone: '+12025550100', billingAddress: agency.address,
        passports: [{ travellerId: travelerId, documentType: 'PASSPORT' as const, documentNumber: 'TEST00001', expiryDate: '2030-01-01', issuingCountryCode: 'MY', residenceCountryCode: 'MY' }] };
      async function selection() {
        const { intent } = await store.create({ customerId, tripId: null, searchId: randomUUID(), offerId: offer.offerId, idempotencyKey: randomUUID(), travellerIds: [travelerId], offer, search });
        await store.saveValidation(customerId, intent.id, { result: 'AVAILABLE', currentTotalAmount: offer.totalAmount, currency: offer.currency, itinerary: offer, validatedAt: new Date().toISOString() }, 600);
        return intent.id;
      }
      const intentId = await selection();
      expect(await bookings.forIntent(customerId, intentId)).toBeNull();
      await expect(bookings.forIntent(randomUUID(), intentId)).rejects.toMatchObject({ status: 404 });
      const booking = await bookings.reserve(customerId, intentId, input);
      expect(booking).toMatchObject({ status: 'PNR_CREATED', pnr: 'TEST01', passengerNamesSource: 'BOOKED_SNAPSHOT', passengerNames: ['Test Traveler'] });
      expect((await bookings.reserve(customerId, intentId, input)).id).toBe(booking.id);
      expect(createBooking).toHaveBeenCalledOnce();
      const storedQuote=(provider as typeof provider & {getTicketingContext:ReturnType<typeof vi.fn>}).getTicketingContext;
      storedQuote.mockRejectedValueOnce(new TicketingValidationError('PRICE_QUOTE_REPRICE_REQUIRED','Stored quote invalid'));
      await expect(bookings.refreshCheckout(customerId,booking.id)).rejects.toMatchObject({status:409});
      storedQuote.mockResolvedValueOnce({bookingId:'provider-1',view:airlineView,selection:{priceQuoteRecordIds:['1'],validatingAirlineCode:'MH',currency:'MYR',totalAmount:'120.00'}});
      await expect(bookings.refreshCheckout(customerId,booking.id)).rejects.toMatchObject({status:409});
      expect((await connection.db.select().from(schema.orders)).length).toBe(0);
      getBookingView.mockResolvedValueOnce({bookingId:'provider-1',view:{...airlineView,flights:[{...airlineView.flights[0]!,status:'Cancelled'}]}});
      await expect(bookings.refreshCheckout(customerId,booking.id)).rejects.toMatchObject({status:409});
      getBookingView.mockResolvedValueOnce({bookingId:'provider-1',view:{...airlineView,flights:[{...airlineView.flights[0]!,departureTime:'11:00'}]}});
      await expect(bookings.refreshCheckout(customerId,booking.id)).rejects.toMatchObject({status:409});
      const checksBefore=provider.flightCheck.mock.calls.length;
      const originalCheck=provider.flightCheck.getMockImplementation()!;
      provider.flightCheck.mockRejectedValue(new Error('No more seats to sell in the held class'));
      await expect(bookings.refreshCheckout(customerId,booking.id)).resolves.toMatchObject({id:booking.id,pnr:'TEST01'});
      expect(provider.flightCheck.mock.calls.length).toBe(checksBefore);
      provider.flightCheck.mockReset().mockImplementation(originalCheck);
      const commerce = new CommerceRepository(connection);
      const order = await commerce.createFlightOrder(customerId, intentId, 'test');
      expect((await commerce.createFlightOrder(customerId, intentId, 'repeat')).id).toBe(order.id);
      expect((await bookings.forIntent(customerId, intentId))?.order).toMatchObject({ id: order.id, status: 'PENDING_PAYMENT' });
      await expect(bookings.cancelUnticketed(customerId, booking.id, 'TEST01')).rejects.toMatchObject({ status: 409 });
      const paymentProvider = { id: 'STRIPE_TEST', createCheckout: vi.fn(async () => ({ providerPaymentId: 'cs_test_fixture', redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_fixture' })), isAllowedCheckoutUrl: (url: URL) => url.hostname === 'checkout.stripe.com', verifyWebhook: vi.fn(), getStatus: vi.fn() };
      const engine = new PaymentEngineService(commerce, paymentProvider);
      const ticketDelivery={deliverAfterVerification:vi.fn(async()=>undefined)};
      const ticketing=new FlightTicketingService(config,connection,provider as unknown as SabreBookingManagementClient,bookings,ticketDelivery as never);
      const ticketingCapabilities=vi.spyOn(ticketing,'capabilities').mockResolvedValue({ticketIssuanceAvailable:true,automaticTicketingEnabled:false,customerTicketingEnabled:false,environment:'CERT',ticketingMessage:'Fixture'});
      const paymentController = new CommerceController(new CommerceService(commerce),engine,bookings,ticketing);
      ticketingCapabilities.mockResolvedValueOnce({ticketIssuanceAvailable:false,automaticTicketingEnabled:false,customerTicketingEnabled:false,environment:'CERT',ticketingMessage:'Unavailable'});
      await expect(paymentController.startPayment({customerId} as never,order.id,{idempotencyKey:randomUUID()},{requestId:'ticketing-unavailable'} as never)).rejects.toMatchObject({status:409});
      const ndcReadiness=vi.spyOn(bookings,'verifyPaymentReady').mockResolvedValueOnce({...booking,order:{...order,status:'PENDING_PAYMENT'},selectedOffer:{...booking.selectedOffer,ndcContext:{}}} as never);
      await expect(paymentController.startPayment({customerId} as never,order.id,{idempotencyKey:randomUUID()},{requestId:'ndc-cash-unavailable'} as never)).rejects.toMatchObject({status:409});
      ndcReadiness.mockRestore();
      storedQuote.mockRejectedValueOnce(new TicketingValidationError('PRICE_QUOTE_REPRICE_REQUIRED','Stored quote invalid after order creation'));
      await expect(paymentController.startPayment({customerId} as never,order.id,{idempotencyKey:randomUUID()},{requestId:'stale-quote'} as never)).rejects.toMatchObject({status:409});
      expect(paymentProvider.createCheckout).not.toHaveBeenCalled();
      expect((await connection.db.select().from(schema.payments)).length).toBe(0);
      // A stale local shopping window is not a cancelled PNR. Only fresh,
      // unchanged supplier evidence can renew the existing order before Stripe.
      const oldExpiry=new Date(Date.now()-60000);
      await connection.db.update(schema.orders).set({expiresAt:oldExpiry}).where(eq(schema.orders.id,order.id));
      getBookingView.mockResolvedValueOnce({bookingId:'provider-1',view:{...airlineView,flights:[{...airlineView.flights[0]!,status:'Cancelled'}]}});
      await expect(bookings.verifyPaymentReady(customerId,intentId,order.id)).rejects.toMatchObject({status:409});
      expect((await connection.db.select().from(schema.orders).where(eq(schema.orders.id,order.id)))[0]!.expiresAt!.getTime()).toBe(oldExpiry.getTime());
      storedQuote.mockResolvedValueOnce({bookingId:'provider-1',view:airlineView,selection:{priceQuoteRecordIds:['1'],validatingAirlineCode:'MH',currency:'MYR',totalAmount:'120.00'}});
      await expect(bookings.verifyPaymentReady(customerId,intentId,order.id)).rejects.toMatchObject({status:409});
      await expect(bookings.verifyPaymentReady(customerId,intentId,order.id)).resolves.toMatchObject({id:booking.id,pnr:'TEST01'});
      expect((await connection.db.select().from(schema.orders).where(eq(schema.orders.id,order.id)))[0]!.expiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(createBooking).toHaveBeenCalledOnce();
      const payment = await engine.start(customerId, order.id, randomUUID());
      await engine.start(customerId, order.id, randomUUID());
      expect(paymentProvider.createCheckout).toHaveBeenCalledOnce();
      await connection.db.update(schema.orders).set({expiresAt:oldExpiry,status:'CANCELLED'}).where(eq(schema.orders.id,order.id));
      await expect(bookings.verifyPaymentReady(customerId,intentId,order.id)).rejects.toMatchObject({status:409});
      await connection.db.update(schema.orders).set({status:'PAYMENT_PROCESSING'}).where(eq(schema.orders.id,order.id));
      await connection.db.update(schema.payments).set({status:'UNKNOWN'}).where(eq(schema.payments.id,payment.payment.id));
      await expect(bookings.verifyPaymentReady(customerId,intentId,order.id)).rejects.toMatchObject({status:409});
      await connection.db.update(schema.payments).set({status:'PENDING'}).where(eq(schema.payments.id,payment.payment.id));
      await expect(bookings.verifyPaymentReady(customerId,intentId,order.id)).resolves.toMatchObject({id:booking.id});
      const event = { providerEventId: 'evt_fixture', providerPaymentId: 'cs_test_fixture', status: 'SUCCEEDED' as const, amount: '100.00', currency: 'MYR' };
      await expect(commerce.applyVerifiedEvent('STRIPE_TEST', payment.payment.id, { ...event, amount: '1.00' }, 'wrong-amount')).rejects.toThrow();
      await commerce.applyVerifiedEvent('STRIPE_TEST', payment.payment.id, event, 'verified-fixture');
      await commerce.applyVerifiedEvent('STRIPE_TEST', payment.payment.id, event, 'duplicate-event');
      expect(await bookings.detail(customerId, booking.id)).toMatchObject({ status: 'AWAITING_STAFF_TICKETING', ticketStatus: 'NOT_VERIFIED', order: { id: order.id, status: 'PAID' } });
      getBookingView.mockResolvedValueOnce({bookingId:'provider-1',view:{...airlineView,flights:[{...airlineView.flights[0]!,status:'Waitlisted'}]}});
      await expect(ticketing.issue(customerId,booking.id,'TEST01')).rejects.toMatchObject({status:409});
      expect((provider as typeof provider & {fulfillFlightTickets:ReturnType<typeof vi.fn>}).fulfillFlightTickets).not.toHaveBeenCalled();
      getBookingView.mockReset().mockResolvedValue({bookingId:'provider-1',view:airlineView});
      // Staff can cancel the held PNR after payment, but cannot claim that
      // the customer's money has been returned until Stripe confirms it.
      const servicingConfig={...config,FLIGHT_REFUND_SETTLEMENT_ENABLED:'true' as const,PAYMENT_PROVIDER:'STRIPE_TEST' as const,STRIPE_SECRET_KEY:'sk_test_fixture'};
      const records=new AdminFlightsService(telemetry,connection,provider as unknown as SabreBookingManagementClient);
      const refunds=new AdminFlightRefundsService(connection,servicingConfig);
      const exchanges=new AdminFlightExchangesService(connection,servicingConfig,provider as unknown as SabreBookingManagementClient,ticketing);
      vi.spyOn(exchanges,'available').mockResolvedValue(true);
      const operations=new AdminFlightOperationsService(connection,servicingConfig,ticketing,provider as unknown as SabreBookingManagementClient,refunds,bookings,records,exchanges);
      vi.spyOn(operations,'capabilities').mockResolvedValue({environment:'CERT',sandbox:true,caseManagementAvailable:true,supportEvidenceRecordingAvailable:true,contactModificationAvailable:true,ticketIssuanceAvailable:true,defaultAtpcoTicketingApi:'ENHANCED_AIR_TICKET',automaticTicketingEnabled:false,customerTicketingEnabled:false,unticketedCancellationAvailable:true,airlineEligibilityAvailable:true,exchangeShoppingAvailable:true,customerRefundSettlementAvailable:true,voidExecutionAvailable:true,refundExecutionAvailable:true,exchangeExecutionAvailable:false,ticketingMessage:'Fixture',servicingMessage:'Fixture'});
      const staff={staffUserId:randomUUID(),role:'manager' as const};
      const cancelledView={...airlineView,flights:[]};
      const cancelUnticketedBooking=vi.fn(async()=>({}));
      Object.assign(provider,{cancelUnticketedBooking,getTicketServicingContext:vi.fn(async()=>({bookingId:'provider-1',view:airlineView,atpcoFlightOnly:false,atpcoUnticketedFlightOnly:true,ticketingPccs:[],ticketNumbers:[]}))});
      let cancellation=await operations.create(booking.id,'CANCEL','Customer requested cancellation',staff,'cancel-open');
      const cancellationQuote={currency:'MYR',amount:'100.00',airlinePenalty:'0',serviceFee:'0',fareDifference:'0',refundAmount:'100.00',evidenceReference:'Customer cancellation of unticketed hold',expiresAt:new Date(Date.now()+600000).toISOString()};
      await expect(operations.action(cancellation.id,{action:'QUOTE',version:cancellation.version,quote:{...cancellationQuote,refundAmount:'101.00'}},staff,'over-refund')).rejects.toMatchObject({status:409});
      cancellation=await operations.action(cancellation.id,{action:'QUOTE',version:cancellation.version,quote:cancellationQuote},staff,'cancel-quote');
      await expect(operations.action(cancellation.id,{action:'APPROVE',version:cancellation.version,confirmedPnr:'TEST01',consentReference:'fixture-consent'},{...staff,role:'ticketing_staff'},'staff-approval')).rejects.toMatchObject({status:403});
      cancellation=await operations.action(cancellation.id,{action:'APPROVE',version:cancellation.version,confirmedPnr:'TEST01',consentReference:'fixture-consent'},staff,'cancel-approve');
      getBookingView.mockResolvedValueOnce({bookingId:'provider-1',view:cancelledView});
      cancellation=await operations.action(cancellation.id,{action:'EXECUTE',version:cancellation.version,confirmedPnr:'TEST01'},staff,'cancel-execute');
      expect(cancellation).toMatchObject({status:'EXECUTING',result:{airlineCompleted:true,stage:'CUSTOMER_REFUND_PENDING'}});
      expect(await bookings.detail(customerId,booking.id)).toMatchObject({status:'REFUND_REQUIRED'});
      await expect(operations.action(cancellation.id,{action:'EXECUTE',version:cancellation.version,confirmedPnr:'TEST01'},staff,'duplicate-cancel')).rejects.toMatchObject({status:409});
      expect(cancelUnticketedBooking).toHaveBeenCalledOnce();
      const createRefund=vi.spyOn(StripeTestRefundProvider.prototype,'create').mockResolvedValue({id:'re_fixture',status:'succeeded'});
      await refunds.settle(cancellation.id,cancellation.version,'TEST01',staff,'customer-refund');
      expect(await operations.detail(cancellation.id)).toMatchObject({status:'COMPLETED',result:{refundStatus:'SUCCEEDED'}});
      expect(await bookings.detail(customerId,booking.id)).toMatchObject({status:'CANCELLED',order:{status:'PAID'}});
      const refundedOrder=await commerce.detail(customerId,order.id);
      expect(refundedOrder?.refunds).toEqual([expect.objectContaining({status:'SUCCEEDED',amount:'100.00',currency:'MYR',completedAt:expect.any(String)})]);
      expect(Object.keys(refundedOrder!.refunds![0]!)).toEqual(['status','amount','currency','completedAt']);
      expect(await commerce.detail(randomUUID(),order.id)).toBeNull();
      await expect(refunds.settle(cancellation.id,cancellation.version,'TEST01',staff,'duplicate-refund')).rejects.toMatchObject({status:409});
      expect(createRefund).toHaveBeenCalledOnce();
      createRefund.mockRestore();
      const unknownIntent = await selection();
      createBooking.mockRejectedValueOnce(new SabreBookingUnknownError('NETWORK_OR_TIMEOUT'));
      const unknown = await bookings.reserve(customerId, unknownIntent, input);
      expect(unknown.status).toBe('BOOKING_UNKNOWN');
      expect((await bookings.reserve(customerId, unknownIntent, input)).id).toBe(unknown.id);
      expect(createBooking).toHaveBeenCalledTimes(2);
      await expect(commerce.createFlightOrder(customerId, unknownIntent, 'unknown')).rejects.toThrow();
      const unexpectedIntent = await selection();
      createBooking.mockRejectedValueOnce(new Error('Unexpected adapter failure after submission'));
      const unexpected = await bookings.reserve(customerId, unexpectedIntent, input);
      expect(unexpected.status).toBe('BOOKING_UNKNOWN');
      expect((await bookings.reserve(customerId, unexpectedIntent, input)).id).toBe(unexpected.id);
      expect(createBooking).toHaveBeenCalledTimes(3);
      await expect(commerce.createFlightOrder(customerId, unexpectedIntent, 'unexpected')).rejects.toThrow();
      const unconfirmedIntent=await selection();
      createBooking.mockRejectedValueOnce(new SabreBookingUnknownError('UNREADABLE_CONFIRMATION',200,{errors:[{category:'APPLICATION_ERROR',type:'UNABLE_TO_BOOK_FLIGHTS_WRONG_STATUS_CODE',description:'Flight number: MH1148 returned status code: UC.'}]}));
      const unconfirmed=await bookings.reserve(customerId,unconfirmedIntent,input);
      expect(unconfirmed).toMatchObject({status:'BOOKING_UNKNOWN',pnr:null});
      expect(unconfirmed.failureMessage).toContain('The airline did not confirm the requested seats for MH1148');
      const creationCount=createBooking.mock.calls.length;
      expect((await bookings.reserve(customerId,unconfirmedIntent,input)).id).toBe(unconfirmed.id);
      expect(createBooking.mock.calls.length).toBe(creationCount);
      await expect(commerce.createFlightOrder(customerId,unconfirmedIntent,'airline-unconfirmed')).rejects.toThrow();
      // A contact POST with a lost response stays locked until a read-only
      // check proves the exact new contact and unchanged flight/ticket scope.
      createBooking.mockResolvedValueOnce({confirmationId:'TEST02',sabreBookingId:'provider-2'});
      const contactIntent=await selection();
      const contactBooking=await bookings.reserve(customerId,contactIntent,input);
      const oldContext={bookingId:'provider-2',signature:'original-signature',view:airlineView,travelers:[{givenName:'Test',surname:'Traveler',emails:['old@example.com'],phones:[{number:'+12025550100',label:'M'}]}]};
      const getContactContext=vi.fn(async()=>oldContext);
      const modifyTravelerContact=vi.fn(async()=>{throw new Error('Lost contact response');});
      Object.assign(provider,{getContactContext,modifyTravelerContact});
      let contactCase=await operations.create(contactBooking.id,'MODIFY','Customer requested contact correction',staff,'contact-open');
      contactCase=await operations.action(contactCase.id,{action:'PREPARE_CONTACT',version:contactCase.version,contact:{travelerIndex:0,email:'new@example.com',phone:'+60123456789'}},staff,'contact-prepare');
      contactCase=await operations.action(contactCase.id,{action:'APPROVE',version:contactCase.version,confirmedPnr:'TEST02',consentReference:'fixture-contact-consent'},staff,'contact-approve');
      contactCase=await operations.action(contactCase.id,{action:'EXECUTE',version:contactCase.version,confirmedPnr:'TEST02'},staff,'contact-execute');
      expect(contactCase.status).toBe('OUTCOME_UNKNOWN');
      expect(await bookings.detail(customerId,contactBooking.id)).toMatchObject({status:'MANUAL_REVIEW_REQUIRED'});
      await expect(operations.action(contactCase.id,{action:'EXECUTE',version:contactCase.version,confirmedPnr:'TEST02'},staff,'contact-repeat')).rejects.toMatchObject({status:409});
      getContactContext.mockResolvedValue({...oldContext,signature:'new-signature',travelers:[{...oldContext.travelers[0]!,emails:['new@example.com'],phones:[{number:'+60123456789',label:'M'}]}]});
      contactCase=await operations.action(contactCase.id,{action:'RECONCILE',version:contactCase.version,confirmedPnr:'TEST02'},staff,'contact-reconcile');
      expect(contactCase.status).toBe('COMPLETED');
      expect(await bookings.detail(customerId,contactBooking.id)).toMatchObject({status:'PNR_CREATED'});
      expect(modifyTravelerContact).toHaveBeenCalledOnce();
      // Late verified payments recover only through exact read-only fare checks.
      for(const fixedAmount of [null,'5','10']){
      const lateRule:FlightPricingRule={id:'late-mh',name:'Late-payment retail fixture',enabled:true,priority:10,currency:'MYR',airlines:['MH'],flightNumbers:[],origins:[],destinations:[],cabin:'ANY',travelFrom:null,travelTo:null,incentiveBps:700,fixedAmount:fixedAmount??'0',chargeBps:0,chargeBasis:'DISCOUNTED_BASE',fixedUnit:'PASSENGER'};
      const latePricing=fixedAmount===null?null:calculateFlightPrice({baseFare:'80',taxes:'20',passengers:1,currency:'MYR'},lateRule,1);
      createBooking.mockResolvedValueOnce({confirmationId:'LATE'+(fixedAmount??'00').padStart(2,'0'),sabreBookingId:'provider-late'});
      const lateIntent=await selection(),lateBooking=await bookings.reserve(customerId,lateIntent,input);
      if(latePricing)await database.query("UPDATE flight_booking_intents SET search_request_snapshot=jsonb_set(search_request_snapshot,'{retailPricing}',$2::jsonb) WHERE id=$1",[lateIntent,JSON.stringify(latePricing)]);
      const lateOrder=await commerce.createFlightOrder(customerId,lateIntent,'late-order');
      expect(lateOrder.totalAmount).toBe(latePricing?.sellingTotal??'100.00');
      const lateSession='cs_test_late_'+(fixedAmount??'legacy');
      paymentProvider.createCheckout.mockResolvedValueOnce({providerPaymentId:lateSession,redirectUrl:'https://checkout.stripe.com/c/pay/'+lateSession});
      const latePayment=await engine.start(customerId,lateOrder.id,randomUUID());
      await database.query("UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1",[lateOrder.id]);
      await commerce.applyVerifiedEvent('STRIPE_TEST',latePayment.payment.id,{...event,amount:lateOrder.totalAmount,providerPaymentId:lateSession,providerEventId:'evt_late_'+(fixedAmount??'legacy')},'late-payment');
      expect(await records.booking(lateBooking.id)).toMatchObject({status:'MANUAL_REVIEW_REQUIRED',fulfillmentStatus:'REVALIDATION_REQUIRED'});
      getBookingView.mockResolvedValue({bookingId:'provider-late',view:airlineView});
      (provider as typeof provider & {getTicketServicingContext:ReturnType<typeof vi.fn>}).getTicketServicingContext.mockResolvedValue({bookingId:'provider-late',view:airlineView,atpcoFlightOnly:false,atpcoUnticketedFlightOnly:true,ticketingPccs:[],ticketNumbers:[]});
      await expect(operations.revalidatePaidBooking(lateBooking.id,{...staff,role:'ticketing_staff'},'late-forbidden')).rejects.toMatchObject({status:409});
      const contextMock=(provider as typeof provider & {getTicketingContext:ReturnType<typeof vi.fn>}).getTicketingContext;
      contextMock.mockResolvedValueOnce({bookingId:'provider-late',view:airlineView,selection:{priceQuoteRecordIds:['1'],validatingAirlineCode:'MH',currency:'MYR',totalAmount:'101.00'}});
      await expect(operations.revalidatePaidBooking(lateBooking.id,staff,'late-price-change')).rejects.toMatchObject({status:409});
      expect(await bookings.detail(customerId,lateBooking.id)).toMatchObject({status:'MANUAL_REVIEW_REQUIRED'});
      if(latePricing){
        // Even a valid, same-total replacement snapshot cannot change while
        // the provider's read-only checks are in flight.
        provider.flightCheck.mockImplementationOnce(async(...args)=>{
          await database.query("UPDATE flight_booking_intents SET search_request_snapshot=jsonb_set(search_request_snapshot,'{retailPricing}',$2::jsonb) WHERE id=$1",[lateIntent,JSON.stringify({...latePricing,revision:2})]);
          return originalCheck(...args);
        });
        await expect(operations.revalidatePaidBooking(lateBooking.id,staff,'late-snapshot-race')).rejects.toMatchObject({status:409});
        expect(await records.booking(lateBooking.id)).toMatchObject({status:'MANUAL_REVIEW_REQUIRED',fulfillmentStatus:'REVALIDATION_REQUIRED'});
        await database.query("UPDATE flight_booking_intents SET search_request_snapshot=jsonb_set(search_request_snapshot,'{retailPricing}',$2::jsonb) WHERE id=$1",[lateIntent,JSON.stringify(latePricing)]);
      }
      await expect(operations.revalidatePaidBooking(lateBooking.id,staff,'late-revalidated')).resolves.toMatchObject({status:'AWAITING_STAFF_TICKETING',fulfillmentStatus:'NOT_STARTED'});
      await expect(operations.revalidatePaidBooking(lateBooking.id,staff,'late-repeat')).rejects.toMatchObject({status:409});
      await operations.create(lateBooking.id,'ISSUE','Late payment verified',staff,'late-case');
      await database.query("UPDATE flight_bookings SET status='MANUAL_REVIEW_REQUIRED' WHERE id=$1",[lateBooking.id]);
      await database.query("UPDATE orders SET fulfillment_status='REVALIDATION_REQUIRED' WHERE id=$1",[lateOrder.id]);
      await expect(operations.revalidatePaidBooking(lateBooking.id,staff,'late-history')).rejects.toMatchObject({status:409});
      }
      getBookingView.mockResolvedValue({bookingId:'provider-1',view:airlineView});
      for(const kind of ['VOID','REFUND','EXCHANGE'] as const){
        const pnr=kind==='VOID'?'TEST03':kind==='REFUND'?'TEST04':'TEST05',supplierId='provider-'+kind;
        const ticketNumber=kind==='VOID'?'2321234567890':'2321234567891';
        createBooking.mockResolvedValueOnce({confirmationId:pnr,sabreBookingId:supplierId});
        const issuedIntent=await selection(),held=await bookings.reserve(customerId,issuedIntent,input);
        const paidOrder=await commerce.createFlightOrder(customerId,issuedIntent,'issue-order-'+kind);
        const sessionId='cs_test_'+kind;
        paymentProvider.createCheckout.mockResolvedValueOnce({providerPaymentId:sessionId,redirectUrl:'https://checkout.stripe.com/c/pay/'+sessionId});
        const paid=await engine.start(customerId,paidOrder.id,randomUUID());
        await commerce.applyVerifiedEvent('STRIPE_TEST',paid.payment.id,{...event,providerPaymentId:sessionId,providerEventId:'evt_'+kind},'issue-payment-'+kind);
        let issueCase=await operations.create(held.id,'ISSUE','Issue verified paid flight',staff,'issue-open');
        const paidQuote={...cancellationQuote,refundAmount:'0',evidenceReference:'Verified paid order '+paidOrder.id};
        issueCase=await operations.action(issueCase.id,{action:'QUOTE',version:issueCase.version,quote:paidQuote},staff,'issue-quote');
        issueCase=await operations.action(issueCase.id,{action:'APPROVE',version:issueCase.version,confirmedPnr:pnr,consentReference:'fixture-issuance-consent'},staff,'issue-approve');
        const issuedView={...airlineView,tickets:[{number:ticketNumber,status:'Issued',travellerIndex:1,couponStatuses:['Open']}]};
        getBookingView.mockResolvedValueOnce({bookingId:supplierId,view:airlineView}).mockResolvedValueOnce({bookingId:supplierId,view:issuedView});
        (provider as typeof provider & {fulfillFlightTickets:ReturnType<typeof vi.fn>}).fulfillFlightTickets.mockResolvedValueOnce({tickets:[{number:ticketNumber,payment:{total:'100.00',currencyCode:'MYR'}}]});
        issueCase=await operations.action(issueCase.id,{action:'EXECUTE',version:issueCase.version,confirmedPnr:pnr},staff,'issue-execute');
        expect(issueCase.status).toBe('COMPLETED');
        expect(await bookings.detail(customerId,held.id)).toMatchObject({status:'TICKETED'});
        const delivery=await database.query<{search_request_snapshot:{ticketEmail:unknown}}>('SELECT search_request_snapshot FROM flight_booking_intents WHERE id=$1',[issuedIntent]);
        expect(delivery.rows[0]?.search_request_snapshot.ticketEmail).toMatchObject({status:'QUEUED',recipient:'test@example.com',ticketNumbers:[ticketNumber]});
        expect(ticketDelivery.deliverAfterVerification).toHaveBeenCalledWith(held.id);
        await expect(operations.action(issueCase.id,{action:'EXECUTE',version:issueCase.version,confirmedPnr:pnr},staff,'repeat-issue')).rejects.toMatchObject({status:409});
        const eligibility={bookingId:supplierId,checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),reference:'SABRE-FIXTURE-'+kind,fingerprint:'fixture-fingerprint-'+kind,atpcoFlightOnly:true,tickets:[{number:ticketNumber,voidable:true,refundable:true,automatedRefundEligible:true,changeable:true,refundTotal:{amount:'80.00',currency:'MYR'},refundFee:{amount:'20.00',currency:'MYR'}}]};
        const cancelTicketedBooking=vi.fn(async()=>kind==='VOID'?{voidedTickets:[ticketNumber]}:{refundedTickets:[ticketNumber]});
        Object.assign(provider,{responseReference:vi.fn(()=>undefined),getTicketServicingContext:vi.fn(async()=>({bookingId:supplierId,view:issuedView,atpcoFlightOnly:true,atpcoUnticketedFlightOnly:false,ticketingPccs:['TEST'],ticketNumbers:[ticketNumber]})),checkFlightTickets:vi.fn(async()=>eligibility),cancelTicketedBooking});
        if(kind==='EXCHANGE'){
          const replacement={...issuedView,flights:issuedView.flights.map(flight=>({...flight,departureDate:'2027-02-19',arrivalDate:'2027-02-19'}))};
          const before={bookingId:supplierId,fingerprint:'before',segmentIds:[1],travelers:[{nameAssociationId:1,givenName:'Test',surname:'Traveler'}],tickets:[{number:ticketNumber,travelerIndex:1,validatingAirlineCode:'MH'}],pqrIds:[],pqrRecords:[],view:issuedView};
          const prepared={...before,fingerprint:'prepared',view:replacement,pqrIds:['2'],pqrRecords:[{id:'2',active:true,travelerIndices:[1],pricingHash:'verified',validatingAirlineCode:'MH'}]};
          let committed=false;
          const exchangeOffer={id:'exchange-offer',reference:'RESHOP-TEST:0',airlineExpiresAt:null,priceGuaranteed:true,splitBooking:false,mixedCabins:false,chargeType:'Add collect' as const,amount:'10.00',currency:'MYR',airlineFee:'2.00',flights:[{airline:'MH',number:'1148',origin:'KUL',destination:'PEN',departureDate:'2027-02-19',departureTime:'09:00',arrivalDate:'2027-02-19',arrivalTime:'10:00',bookingClasses:['Q'],cabins:['Economy']}],ticketPrices:[{number:ticketNumber,amount:'10.00',currency:'MYR',chargeType:'Add collect' as const,bookingClasses:['Q']}]};
          const search={searchedAt:new Date().toISOString(),reviewExpiresAt:eligibility.expiresAt,reference:'RESHOP-TEST',bookingId:supplierId,eligibilityFingerprint:eligibility.fingerprint,ticketNumbers:[ticketNumber],journeys:[{origin:'KUL',destination:'PEN',departureDate:'2027-02-19'}],offers:[exchangeOffer],warningsPresent:false};
          const exchangeBooking=vi.fn(async()=>{committed=true;return [{id:'2',ticketNumber,amount:'10.00'}];}),fulfillExchange=vi.fn(async()=>{throw Error('Lost supplier reissue reply');});
          Object.assign(provider,{getExchangeContext:vi.fn(async()=>committed?prepared:before),reshopFlightTickets:vi.fn(async()=>search),exchangeBooking,fulfillExchange});
          let exchangeCase=await operations.create(held.id,'EXCHANGE','Customer requested new date',staff,'exchange-open');
          exchangeCase=await operations.action(exchangeCase.id,{action:'RESHOP',version:exchangeCase.version,journeys:search.journeys},staff,'exchange-shop');
          const quote={...cancellationQuote,amount:'10.00',airlinePenalty:'2.00',fareDifference:'10.00',refundAmount:'0',evidenceReference:exchangeOffer.reference,expiresAt:eligibility.expiresAt,itinerary:'MH 1148 KUL-PEN 2027-02-19 09:00 / Q'};
          exchangeCase=await operations.action(exchangeCase.id,{action:'QUOTE',version:exchangeCase.version,quote},staff,'exchange-quote');
          exchangeCase=await operations.action(exchangeCase.id,{action:'APPROVE',version:exchangeCase.version,confirmedPnr:pnr,consentReference:'fixture-exchange-consent'},staff,'exchange-approve');
          exchangeCase=await operations.action(exchangeCase.id,{action:'EXECUTE',version:exchangeCase.version,confirmedPnr:pnr},staff,'exchange-commit');
          expect(exchangeCase).toMatchObject({status:'EXECUTING',result:{stage:'EXCHANGE_PAYMENT_PENDING'}});
          expect(exchangeBooking).toHaveBeenCalledOnce();
          const additionalId=(exchangeCase.result as {collectionOrderId:string}).collectionOrderId;
          expect(await commerce.detail(customerId,additionalId)).toBeNull();
          await expect(engine.start(customerId,additionalId,randomUUID())).rejects.toMatchObject({status:409});
          expect((await commerce.list(customerId)).some(order=>order.id===additionalId)).toBe(false);
          await expect(operations.action(exchangeCase.id,{action:'SEND_EXCHANGE_QUOTATION',version:exchangeCase.version,confirmedPnr:pnr},{...staff,role:'ticketing_staff'},'quote-not-manager')).rejects.toMatchObject({status:403});
          exchangeCase=await operations.action(exchangeCase.id,{action:'SEND_EXCHANGE_QUOTATION',version:exchangeCase.version,confirmedPnr:pnr},staff,'send-client-quote');
          const sentVersion=exchangeCase.version;
          exchangeCase=await operations.action(exchangeCase.id,{action:'SEND_EXCHANGE_QUOTATION',version:exchangeCase.version,confirmedPnr:pnr},staff,'same-client-quote');
          expect(exchangeCase.version).toBe(sentVersion);
          expect((await database.query("SELECT id FROM flight_servicing_events WHERE case_id=$1 AND event='CUSTOMER_QUOTATION_SENT'",[exchangeCase.id])).rows).toHaveLength(1);
          expect(await bookings.detail(customerId,held.id)).toMatchObject({exchangeQuotations:[{bookingId:held.id,orderId:additionalId,amount:'10.00',status:'PAYMENT_REQUIRED',flights:[{airline:'MH',departureDate:'2027-02-19'}]}]});
          expect((await commerce.list(customerId)).some(order=>order.id===additionalId)).toBe(true);
          expect(await commerce.detail(customerId,additionalId)).toMatchObject({flightServicingCaseId:exchangeCase.id,bookingIntentId:null,totalAmount:'10.00'});
          expect(await commerce.detail(randomUUID(),additionalId)).toBeNull();
          await expect(operations.action(exchangeCase.id,{action:'FULFILL_EXCHANGE',version:exchangeCase.version,confirmedPnr:pnr},staff,'exchange-unpaid')).rejects.toMatchObject({status:409});
          expect(fulfillExchange).not.toHaveBeenCalled();
          paymentProvider.createCheckout.mockResolvedValueOnce({providerPaymentId:'cs_test_additional',redirectUrl:'https://checkout.stripe.com/c/pay/cs_test_additional'});
          const additionalPayment=await engine.start(customerId,additionalId,randomUUID());
          const resumedAdditional=await engine.start(customerId,additionalId,randomUUID());
          expect(resumedAdditional.payment.id).toBe(additionalPayment.payment.id);
          expect((await database.query('SELECT id FROM payments WHERE order_id=$1',[additionalId])).rows).toHaveLength(1);
          const additionalEvent={...event,providerPaymentId:'cs_test_additional',providerEventId:'evt_additional',orderId:additionalId,amount:'10.00'};
          await commerce.applyVerifiedEvent('STRIPE_TEST',additionalPayment.payment.id,additionalEvent,'exchange-payment');
          expect(await bookings.detail(customerId,held.id)).toMatchObject({status:'MANUAL_REVIEW_REQUIRED'});
          const getStripeStatus=vi.spyOn(StripeTestPaymentProvider.prototype,'getStatus').mockResolvedValue(additionalEvent);
          getBookingView.mockResolvedValueOnce({bookingId:supplierId,view:{...replacement,tickets:[{number:ticketNumber,status:'Refunded/Exchanged',travellerIndex:1,couponStatuses:['Exchanged']},{number:'2321234567898',status:'Issued',travellerIndex:1,couponStatuses:['Open']}]}});
          exchangeCase=await operations.action(exchangeCase.id,{action:'FULFILL_EXCHANGE',version:exchangeCase.version,confirmedPnr:pnr},staff,'exchange-reissue');
          expect(exchangeCase.status).toBe('OUTCOME_UNKNOWN');
          exchangeCase=await operations.action(exchangeCase.id,{action:'RECONCILE',version:exchangeCase.version,confirmedPnr:pnr},staff,'exchange-reconcile-no-resend');
          getStripeStatus.mockRestore();
          expect(exchangeCase).toMatchObject({status:'COMPLETED',result:{stage:'COMPLETED'}});
          expect(fulfillExchange).toHaveBeenCalledOnce();
          expect((await commerce.detail(customerId,additionalId))?.fulfillmentStatus).toBe('COMPLETED');
          expect(await bookings.detail(customerId,held.id)).toMatchObject({status:'TICKETED',ticketStatus:'ISSUED',selectedOffer:{outbound:{segments:[{departureAt:'2027-02-19T09:00'}]}}});
          expect(await records.booking(held.id)).toMatchObject({ticketStatus:'ISSUED',selectedOffer:{outbound:{segments:[{departureAt:'2027-02-19T09:00'}]}}});
          const originalSelection=await database.query<{selected_offer_snapshot:FlightOffer}>('SELECT selected_offer_snapshot FROM flight_booking_intents WHERE id=$1',[issuedIntent]);
          expect((originalSelection.rows[0]!.selected_offer_snapshot as FlightOffer).outbound.segments[0]!.departureAt).toBe('2027-02-18T09:00:00+08:00');
          await expect(operations.action(exchangeCase.id,{action:'FULFILL_EXCHANGE',version:exchangeCase.version,confirmedPnr:pnr},staff,'repeat-reissue')).rejects.toMatchObject({status:409});
          continue;
        }
        let ticketCase=await operations.create(held.id,kind,'Customer requested '+kind.toLowerCase(),staff,'ticket-cancel-open');
        ticketCase=await operations.action(ticketCase.id,{action:'CHECK',version:ticketCase.version},staff,'ticket-check');
        const ticketQuote={...cancellationQuote,amount:kind==='VOID'?'100.00':'80.00',refundAmount:kind==='VOID'?'100.00':'80.00',airlinePenalty:kind==='VOID'?'0':'20.00',evidenceReference:eligibility.reference,expiresAt:eligibility.expiresAt};
        ticketCase=await operations.action(ticketCase.id,{action:'QUOTE',version:ticketCase.version,quote:ticketQuote},staff,'ticket-cancel-quote');
        ticketCase=await operations.action(ticketCase.id,{action:'APPROVE',version:ticketCase.version,confirmedPnr:pnr,consentReference:'fixture-ticket-cancel-consent'},staff,'ticket-cancel-approve');
        const cancelledTickets=[{number:ticketNumber,status:kind==='VOID'?'Voided':'Refunded/Exchanged',travellerIndex:1,couponStatuses:[kind==='VOID'?'Voided':'Refunded']}];
        getBookingView.mockResolvedValueOnce({bookingId:supplierId,view:{...(kind==='VOID'?issuedView:cancelledView),...(kind==='REFUND'?{cancellationCheckComplete:false}:{}),tickets:cancelledTickets}});
        ticketCase=await operations.action(ticketCase.id,{action:'EXECUTE',version:ticketCase.version,confirmedPnr:pnr},staff,'ticket-cancel-execute');
        if(kind==='VOID'){
          expect(ticketCase.status).toBe('OUTCOME_UNKNOWN');
          getBookingView.mockResolvedValueOnce({bookingId:supplierId,view:{...issuedView,tickets:cancelledTickets}});
          ticketCase=await operations.action(ticketCase.id,{action:'RECONCILE',version:ticketCase.version,confirmedPnr:pnr},staff,'partial-ticket-cancel-read');
          expect(ticketCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{stage:'AIRLINE_PARTIAL',partialTicketOperationVerified:true,remainingFlightCount:1}});
          await expect(refunds.settle(ticketCase.id,ticketCase.version,pnr,staff,'partial-refund-blocked')).rejects.toMatchObject({status:409});
          const remainingContext={bookingId:supplierId,view:{...issuedView,tickets:cancelledTickets},flightIds:['12'],fingerprint:'remaining-fixture'};
          const getRemainingCancellationContext=vi.fn(async()=>remainingContext),cancelRemainingFlightSegments=vi.fn(async()=>({booking:{bookingId:supplierId}}));
          Object.assign(provider,{getRemainingCancellationContext,cancelRemainingFlightSegments});
          await expect(operations.action(ticketCase.id,{action:'PREPARE_REMAINING_CANCEL',version:ticketCase.version,confirmedPnr:pnr},{...staff,role:'ticketing_staff'},'non-manager-remainder')).rejects.toMatchObject({status:403});
          ticketCase=await operations.action(ticketCase.id,{action:'PREPARE_REMAINING_CANCEL',version:ticketCase.version,confirmedPnr:pnr},staff,'prepare-remainder');
          expect(ticketCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{remainderCancellation:{flightIds:['12']}}});
          getRemainingCancellationContext.mockResolvedValueOnce({...remainingContext,fingerprint:'changed-scope'});
          await expect(operations.action(ticketCase.id,{action:'EXECUTE_REMAINING_CANCEL',version:ticketCase.version,confirmedPnr:pnr,consentReference:'Approved cancellation-only fixture'},staff,'changed-remainder')).rejects.toMatchObject({status:409});
          expect(cancelRemainingFlightSegments).not.toHaveBeenCalled();
          getBookingView.mockResolvedValueOnce({bookingId:supplierId,view:{...cancelledView,tickets:cancelledTickets}});
          ticketCase=await operations.action(ticketCase.id,{action:'EXECUTE_REMAINING_CANCEL',version:ticketCase.version,confirmedPnr:pnr,consentReference:'Approved cancellation-only fixture'},staff,'execute-remainder');
          expect(cancelRemainingFlightSegments).toHaveBeenCalledExactlyOnceWith(pnr,['12']);
          await expect(operations.action(ticketCase.id,{action:'EXECUTE_REMAINING_CANCEL',version:ticketCase.version,confirmedPnr:pnr,consentReference:'Duplicate forbidden'},staff,'repeat-remainder')).rejects.toMatchObject({status:409});
          expect(cancelRemainingFlightSegments).toHaveBeenCalledOnce();
        }
        if(kind==='REFUND'){
          expect(ticketCase.status).toBe('OUTCOME_UNKNOWN');
          const omittedView={...cancelledView,cancellationCheckComplete:false,tickets:cancelledTickets};
          const verifyTerminalEmptyItinerary=vi.fn().mockRejectedValueOnce(new Error('Host identity unverified')).mockResolvedValueOnce({bookingId:supplierId,view:{...omittedView,cancellationCheckComplete:true},proof:{source:'SABRE_CERT_HOST_DISPLAY',pnr,pcc:'TEST',sessionClosed:true,noActiveItinerary:true}});
          Object.assign(provider,{verifyTerminalEmptyItinerary});
          getBookingView.mockResolvedValueOnce({bookingId:supplierId,view:omittedView});
          await expect(operations.action(ticketCase.id,{action:'RECONCILE',version:ticketCase.version,confirmedPnr:pnr},staff,'unverified-empty-itinerary')).rejects.toMatchObject({status:409});
          await expect(refunds.settle(ticketCase.id,ticketCase.version,pnr,staff,'unverified-refund-blocked')).rejects.toMatchObject({status:409});
          getBookingView.mockResolvedValueOnce({bookingId:supplierId,view:omittedView});
          ticketCase=await operations.action(ticketCase.id,{action:'RECONCILE',version:ticketCase.version,confirmedPnr:pnr},staff,'verified-empty-itinerary');
          expect(ticketCase).toMatchObject({result:{emptyItineraryProof:{noActiveItinerary:true,sessionClosed:true}}});
          expect(verifyTerminalEmptyItinerary).toHaveBeenLastCalledWith(pnr,supplierId,'REFUND',[ticketNumber]);
        }
        expect(ticketCase).toMatchObject({status:'EXECUTING',result:{stage:'CUSTOMER_REFUND_PENDING'}});
        expect(cancelTicketedBooking).toHaveBeenCalledOnce();
        const settleRefund=vi.spyOn(StripeTestRefundProvider.prototype,'create').mockResolvedValue({id:'re_fixture'+kind,status:'succeeded'});
        await refunds.settle(ticketCase.id,ticketCase.version,pnr,staff,'ticket-refund');
        expect(await operations.detail(ticketCase.id)).toMatchObject({status:'COMPLETED'});
        expect(await bookings.detail(customerId,held.id)).toMatchObject({status:'CANCELLED'});
        settleRefund.mockRestore();
      }
      expect((provider as typeof provider & {fulfillFlightTickets:ReturnType<typeof vi.fn>}).fulfillFlightTickets).toHaveBeenCalledTimes(3);
      // A supplier currency rejection may accompany partial issuance. Read only,
      // retain the case lock and publish an actionable classification, never retry.
      createBooking.mockResolvedValueOnce({confirmationId:'CURR01',sabreBookingId:'provider-currency'});
      const currencyIntent=await selection(),currencyBooking=await bookings.reserve(customerId,currencyIntent,input);
      const currencyOrder=await commerce.createFlightOrder(customerId,currencyIntent,'currency-order');
      paymentProvider.createCheckout.mockResolvedValueOnce({providerPaymentId:'cs_test_currency',redirectUrl:'https://checkout.stripe.com/c/pay/cs_test_currency'});
      const currencyPayment=await engine.start(customerId,currencyOrder.id,randomUUID());
      await commerce.applyVerifiedEvent('STRIPE_TEST',currencyPayment.payment.id,{...event,providerPaymentId:'cs_test_currency',providerEventId:'evt_currency'},'currency-payment');
      let currencyCase=await operations.create(currencyBooking.id,'ISSUE','Currency regression fixture',staff,'currency-open');
      currencyCase=await operations.action(currencyCase.id,{action:'QUOTE',version:currencyCase.version,quote:{...cancellationQuote,refundAmount:'0'}},staff,'currency-quote');
      currencyCase=await operations.action(currencyCase.id,{action:'APPROVE',version:currencyCase.version,confirmedPnr:'CURR01',consentReference:'Synthetic regression test'},staff,'currency-approve');
      getBookingView.mockResolvedValue({bookingId:'provider-currency',view:airlineView});
      const fulfillment=(provider as typeof provider & {fulfillFlightTickets:ReturnType<typeof vi.fn>}).fulfillFlightTickets;
      fulfillment.mockRejectedValueOnce(new SabreBookingUnknownError('UNREADABLE_CONFIRMATION',200,{errors:[{category:'APPLICATION_ERROR',type:'DOWNLINE_SERVICE_ERROR',description:'Private Passenger passport123456789 email@example.com TICKETING IN ALTERNATE CURRENCY NOT ALLOWED-2101'}]}));
      currencyCase=await operations.action(currencyCase.id,{action:'EXECUTE',version:currencyCase.version,confirmedPnr:'CURR01'},staff,'currency-execute');
      expect(currencyCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{stage:'MANUAL_SUPPORT_REQUIRED',ticketingDiagnostic:{code:'2101',classification:'SABRE_CURRENCY_RESTRICTION',priceQuoteRecordIds:['1'],ticketCheck:'NO_TICKETS_REPORTED',automaticRetry:false}}});
      const diagnostics=await database.query<{event:string}>("SELECT event FROM audit_events WHERE event LIKE 'flight.ticketing.%' AND event LIKE $1",['%'+currencyBooking.id+'%']);
      expect(JSON.stringify(diagnostics.rows)).not.toMatch(/Private Passenger|passport123456789|email@example.com/);
      await expect(operations.action(currencyCase.id,{action:'EXECUTE',version:currencyCase.version,confirmedPnr:'CURR01'},staff,'currency-repeat')).rejects.toMatchObject({status:409});
      getBookingView.mockResolvedValue({bookingId:'provider-currency',view:{...airlineView,tickets:[{number:'2321234567888',status:'Issued',travellerIndex:2}]}});
      currencyCase=await operations.action(currencyCase.id,{action:'RECONCILE',version:currencyCase.version,confirmedPnr:'CURR01'},staff,'currency-partial');
      expect(currencyCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{ticketingDiagnostic:{automaticRetry:false}}});
      expect((await operations.detail(currencyCase.id)).status).toBe('OUTCOME_UNKNOWN');
      getBookingView.mockResolvedValue({bookingId:'provider-currency',view:airlineView});
      currencyCase=await operations.action(currencyCase.id,{action:'RECONCILE',version:currencyCase.version,confirmedPnr:'CURR01'},staff,'currency-readonly-classification');
      expect(currencyCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{stage:'MANUAL_SUPPORT_REQUIRED',ticketingDiagnostic:{code:'2101',ticketCheck:'NO_TICKETS_REPORTED'}}});
      expect(fulfillment).toHaveBeenCalledTimes(4);
      // The normal admin service, real supplier serializer and isolated HTTP transport
      // exercise the same approved path, including warning-only and changed-price holds.
      config.SABRE_TICKETING_PROFILE=JSON.stringify({hardcopyPrinterAddress:'ABC123',ticketCountryCode:'BD',formOfPayment:'CASH'});
      for(const scenario of ['SUCCESS','PENDING','PRICE','CONFIG','PARTIAL','RECOVERED','RECOVERY_PRICE','RECOVERY_PAYMENT','ENHANCED_SUCCESS','ENHANCED_PENDING','ENHANCED_PRICE','ENHANCED_PREFLIGHT'] as const){
        const pnr={SUCCESS:'WIRE01',PENDING:'WIRE02',PRICE:'WIRE03',CONFIG:'WIRE04',PARTIAL:'WIRE05',RECOVERED:'WIRE06',RECOVERY_PRICE:'WIRE07',RECOVERY_PAYMENT:'WIRE08',ENHANCED_SUCCESS:'WIRE09',ENHANCED_PENDING:'WIRE10',ENHANCED_PRICE:'WIRE11',ENHANCED_PREFLIGHT:'WIRE12'}[scenario];
        const enhanced=scenario.startsWith('ENHANCED');
        const executionPolicy=enhanced?{ticketingApi:'ENHANCED_AIR_TICKET' as const,quoteHandling:'Quit' as const,commitWaitMs:0,commissionPercent:7}:{quoteHandling:'Reprice' as const,commitWaitMs:3000};
        createBooking.mockResolvedValueOnce({confirmationId:pnr,sabreBookingId:pnr});
        const wireIntent=await selection();
        if(scenario==='SUCCESS'){
          const retailRule:FlightPricingRule={id:'fixture-mh',name:'Isolated incentive and markup',enabled:true,priority:10,currency:'MYR',airlines:['MH'],flightNumbers:[],origins:[],destinations:[],cabin:'ANY',travelFrom:null,travelTo:null,incentiveBps:700,fixedAmount:'5',chargeBps:0,chargeBasis:'DISCOUNTED_BASE',fixedUnit:'PASSENGER'};
          const pricing=calculateFlightPrice({baseFare:'80',taxes:'20',passengers:1,currency:'MYR'},retailRule,1);
          await database.query("UPDATE flight_booking_intents SET search_request_snapshot=jsonb_set(search_request_snapshot,'{retailPricing}',$2::jsonb) WHERE id=$1",[wireIntent,JSON.stringify(pricing)]);
          const internal=await intents.detail(customerId,wireIntent);expect(internal.validatedTotalAmount).toBe('100.00');expect(internal.searchRequest).not.toHaveProperty('retailPricing');
          expect(await new FlightPricingService(connection).intent(customerId,internal)).toMatchObject({validatedTotalAmount:'99.40',selectedOffer:{totalAmount:'99.40'}});
        }
        const wireBooking=await bookings.reserve(customerId,wireIntent,input);
        const wireOrder=await commerce.createFlightOrder(customerId,wireIntent,'wire-order-'+scenario);
        if(scenario==='SUCCESS')expect(wireOrder.totalAmount).toBe('99.40');
        const session='cs_test_wire_'+scenario;
        paymentProvider.createCheckout.mockResolvedValueOnce({providerPaymentId:session,redirectUrl:'https://checkout.stripe.com/c/pay/'+session});
        const paid=await engine.start(customerId,wireOrder.id,randomUUID());
        await commerce.applyVerifiedEvent('STRIPE_TEST',paid.payment.id,{...event,amount:wireOrder.totalAmount,providerPaymentId:session,providerEventId:'evt_wire_'+scenario},'wire-payment');
        let issued=false,dispatched=false,recoveryReads=0,documentAmount=['PRICE','RECOVERY_PRICE','ENHANCED_PRICE'].includes(scenario)?'101.00':'100.00',documentTravelerIndex=scenario==='PARTIAL'?2:1;
        const ticketNumber='2321234567890';
        const http=vi.fn(async(url:string,options?:RequestInit)=>{
          if(url.endsWith('/getBooking')){
            if(dispatched&&scenario==='RECOVERED'){recoveryReads++;if(recoveryReads>=2)issued=true;}
            return new Response(JSON.stringify({bookingId:pnr,isTicketed:issued,travelers:[{givenName:'Test',surname:'Traveler'}],allSegments:[{type:'FLIGHT'}],flights:[{itemId:'1',airlineCode:'MH',flightNumber:1148,fromAirportCode:'KUL',toAirportCode:'PEN',departureDate:'2027-02-18',departureTime:'09:00',arrivalDate:'2027-02-18',arrivalTime:'10:00',flightStatusName:'Confirmed'}],flightTickets:issued?[{number:ticketNumber,ticketStatusName:'Issued',travelerIndex:documentTravelerIndex,airlineCode:'MH',ticketingPcc:'TEST',flightCoupons:[{itemId:'1',couponStatus:'Okay'}],payment:{total:documentAmount,currencyCode:'MYR'}}]:[],fares:[{recordId:'1',recordTypeCode:'PQ',pricingStatusName:'Active',airlineCode:'MH',travelerIndices:[1],totals:{total:'100.00',currencyCode:'MYR'}}]}),{status:200});
          }
          if(enhanced){
            expect(url).toBe('https://api.cert.platform.sabre.com/v1.3.0/air/ticket');
            expect(JSON.parse(String(options?.body))).toMatchObject({AirTicketRQ:{version:'1.3.0',targetCity:'TEST',Itinerary:{ID:pnr},Ticketing:[{FOP_Qualifiers:{BasicFOP:{Type:'CA'}},MiscQualifiers:{Commission:{Percent:7}},PricingQualifiers:{PriceQuote:[{Record:[{Number:1,Reissue:false}]}]}}],PostProcessing:{EndTransaction:{Source:{ReceivedFrom:'TEST WEB'}}}}});
            dispatched=true;
            if(scenario==='ENHANCED_PENDING')return new Response(JSON.stringify({AirTicketRS:{ApplicationResults:{status:'Incomplete',Error:[{type:'Application',SystemSpecificResults:[{Message:[{code:'0316',content:'AirTicketLLSRQ: Private Passenger-0316; TicketingDocumentServicesRQ: No new tickets have been issued'}]}]}]}}}),{status:200,headers:{'x-request-id':'trace-'+pnr}});
            issued=true;
            return new Response(JSON.stringify({AirTicketRS:{ApplicationResults:{status:'Complete',Success:[{timeStamp:new Date().toISOString()}]},Summary:[{DocumentNumber:ticketNumber,DocumentType:'TKT',IssuingLocation:'TEST',Reservation:{content:pnr},committed:true,TotalAmount:{content:documentAmount,currencyCode:'MYR'}}]}}),{status:200,headers:{'x-request-id':'trace-'+pnr}});
          }
          if(!url.endsWith('/fulfillFlightTickets'))throw Error('Unexpected fixture endpoint');
          expect(JSON.parse(String(options?.body))).toMatchObject({confirmationId:pnr,backDatePriceQuoteMethod:'Reprice',priceQuoteExpirationMethod:'Reprice',commitTicketToBookingWaitTime:3000,acceptPriceChanges:false,acceptNegotiatedFare:false,formsOfPayment:[{type:'CASH'}],fulfillments:[{ticketingQualifiers:{priceQuoteRecordIds:['1'],validatingAirlineCode:'MH'}}]});
          if(scenario==='CONFIG')return new Response(JSON.stringify({errors:[{category:'APPLICATION_ERROR',type:'PRINTER_NOT_ASSIGNED',fieldName:'ticket',fieldPath:'FulfillTicketsRequest.designatePrinters'}]}),{status:200,headers:{'x-request-id':'trace-'+pnr}});
          if(['PENDING','RECOVERED','RECOVERY_PRICE','RECOVERY_PAYMENT'].includes(scenario)){
            dispatched=true;if(['RECOVERY_PRICE','RECOVERY_PAYMENT'].includes(scenario))issued=true;
            if(scenario==='RECOVERY_PAYMENT')await database.query('UPDATE orders SET paid_at=null WHERE id=$1',[wireOrder.id]);
            const diagnostic={category:scenario==='RECOVERY_PRICE'?'APPLICATION_ERROR':'PROCESSING_WARNING',type:'UNABLE_TO_RETRIEVE_TICKETS',description:'Private passenger details not for audit'};
            return new Response(JSON.stringify(scenario==='RECOVERY_PRICE'?{errors:[diagnostic]}:{warnings:[diagnostic]}),{status:200,headers:{'x-request-id':'trace-'+pnr}});
          }
          issued=true;
          return new Response(JSON.stringify({tickets:[{number:ticketNumber,payment:{total:documentAmount,currencyCode:'MYR'}}]}),{status:200,headers:{'x-request-id':'trace-'+pnr}});
        });
        const wireClient=new SabreBookingManagementClient({...config,SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000},{token:vi.fn(async()=>'fixture-token')} as never,http as typeof fetch);
        Object.assign(provider,{getBookingView:wireClient.getBookingView.bind(wireClient),getTicketingContext:wireClient.getTicketingContext.bind(wireClient),getIssuedTicketContext:wireClient.getIssuedTicketContext.bind(wireClient),fulfillFlightTickets:wireClient.fulfillFlightTickets.bind(wireClient),issueEnhancedAirTicket:wireClient.issueEnhancedAirTicket.bind(wireClient),responseReference:wireClient.responseReference.bind(wireClient),dispatchReference:wireClient.dispatchReference.bind(wireClient)});
        if(scenario==='ENHANCED_PREFLIGHT')Object.assign(provider,{getTicketingContext:vi.fn(async()=>{throw Object.assign(new Error('Private database values must not escape'),{cause:{code:'55P03'}});})});
        await expect(ticketing.issue(customerId,wireBooking.id,pnr,'worker-without-case',{quoteHandling:'Reprice',commitWaitMs:3000})).rejects.toMatchObject({status:409});
        expect(http).not.toHaveBeenCalled();
        let wireCase=await operations.create(wireBooking.id,'ISSUE','Admin wire regression '+scenario,staff,'wire-open');
        await expect(operations.action(wireCase.id,{action:'QUOTE',version:wireCase.version,quote:{...cancellationQuote,refundAmount:'0',ticketing:{quoteHandling:'Override',commitWaitMs:3000}} as never},staff,'invalid-policy')).rejects.toMatchObject({status:400});
        wireCase=await operations.action(wireCase.id,{action:'QUOTE',version:wireCase.version,quote:{...cancellationQuote,amount:wireOrder.totalAmount,refundAmount:'0',ticketing:executionPolicy}},staff,'wire-quote');
        wireCase=await operations.action(wireCase.id,{action:'APPROVE',version:wireCase.version,confirmedPnr:pnr,consentReference:'Fixture consent'},staff,'wire-approve');
        expect(wireCase.approval).toMatchObject({ticketing:executionPolicy});
        if(scenario==='ENHANCED_SUCCESS'){
          await database.query("UPDATE flight_servicing_cases SET approval=jsonb_set(approval,'{ticketing,commissionPercent}','6'::jsonb) WHERE id=$1",[wireCase.id]);
          await expect(operations.action(wireCase.id,{action:'EXECUTE',version:wireCase.version,confirmedPnr:pnr},staff,'block-changed-commission')).rejects.toMatchObject({status:409});
          expect(http).not.toHaveBeenCalled();
          await database.query("UPDATE flight_servicing_cases SET approval=jsonb_set(approval,'{ticketing,commissionPercent}','7'::jsonb) WHERE id=$1",[wireCase.id]);
        }
        await expect(operations.action(wireCase.id,{action:'EXECUTE',version:wireCase.version,confirmedPnr:pnr},{...staff,role:'ticketing_staff'},'unauthorized-execute')).rejects.toMatchObject({status:403});
        expect(http).not.toHaveBeenCalled();
        if(scenario==='SUCCESS'){
          const sends=await Promise.allSettled([operations.action(wireCase.id,{action:'EXECUTE',version:wireCase.version,confirmedPnr:pnr},staff,'wire-execute'),operations.action(wireCase.id,{action:'EXECUTE',version:wireCase.version,confirmedPnr:pnr},staff,'duplicate-concurrent-execute')]);
          expect(sends.filter(result=>result.status==='fulfilled')).toHaveLength(1);
          expect(sends.filter(result=>result.status==='rejected')).toHaveLength(1);
          wireCase=(sends.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<typeof wireCase>).value;
        }else wireCase=await operations.action(wireCase.id,{action:'EXECUTE',version:wireCase.version,confirmedPnr:pnr},staff,'wire-execute');
        const claimed=await database.query('SELECT event,created_at FROM audit_events WHERE event LIKE $1 ORDER BY created_at',['flight.ticketing.dispatch-claim:'+wireCase.id+':%']);
        if(scenario==='ENHANCED_PREFLIGHT'){
          expect(claimed.rows).toHaveLength(0);expect(http).not.toHaveBeenCalled();
          expect(wireCase).toMatchObject({status:'FAILED',result:{preSubmissionDiagnostic:{classification:'NOT_SUBMITTED',databaseCode:'55P03',supplierMutationAttempted:false,automaticRetry:false}}});
          expect(JSON.stringify(wireCase.result)).not.toContain('Private database');
          // Legacy generic failure before dispatch must be distinguishable from
          // a dispatched uncertain result, without relying on missing tickets.
          await database.query("UPDATE flight_servicing_cases SET status='OUTCOME_UNKNOWN',result='{}'::jsonb WHERE id=$1",[wireCase.id]);
          wireCase=await operations.action(wireCase.id,{action:'RECONCILE',version:wireCase.version,confirmedPnr:pnr},staff,'verify-not-submitted');
          expect(wireCase).toMatchObject({status:'FAILED',approval:null,result:{stage:'NOT_SUBMITTED',preSubmissionDiagnostic:{reason:'DISPATCH_CLAIM_NOT_CREATED',supplierMutationAttempted:false,automaticRetry:false}}});
          expect(http).not.toHaveBeenCalled();
          await expect(operations.action(wireCase.id,{action:'EXECUTE',version:wireCase.version,confirmedPnr:pnr},staff,'no-automatic-retry')).rejects.toMatchObject({status:409});
          continue;
        }
        expect(claimed.rows).toHaveLength(1);

        if(scenario==='RECOVERY_PAYMENT'){
          expect(wireCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{stage:'TICKET_DOCUMENT_REVIEW',ticketingDiagnostic:{supplierRequestId:'trace-'+pnr,reason:'RECOVERED_DOCUMENTS_NOT_COMMITTED',ticketCheck:'VERIFIED',automaticRetry:false}}});
          expect(await bookings.detail(customerId,wireBooking.id)).toMatchObject({status:'MANUAL_REVIEW_REQUIRED'});
          await expect(operations.action(wireCase.id,{action:'EXECUTE',version:wireCase.version,confirmedPnr:pnr},staff,'no-reissue-after-payment-change')).rejects.toMatchObject({status:409});
          await expect(operations.action(wireCase.id,{action:'RECONCILE',version:wireCase.version,confirmedPnr:pnr},staff,'no-recovery-without-paid-at')).rejects.toMatchObject({status:409});
          await database.query('UPDATE orders SET paid_at=now() WHERE id=$1',[wireOrder.id]);
          wireCase=await operations.action(wireCase.id,{action:'RECONCILE',version:wireCase.version,confirmedPnr:pnr},staff,'recover-after-payment-verification');
          expect(wireCase.status).toBe('COMPLETED');
        }else if(scenario==='SUCCESS'||scenario==='RECOVERED'||scenario==='ENHANCED_SUCCESS'){
          expect(wireCase.status).toBe('COMPLETED');
          if(scenario==='RECOVERED')expect(wireCase.result).toMatchObject({ticketRecovery:{verification:'VERIFIED',lookupCount:2,originalSupplierRequestId:'trace-'+pnr,warnings:[{type:'UNABLE_TO_RETRIEVE_TICKETS'}],automaticRetry:false}});
        }
        else {
          expect(wireCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{stage:['PRICE','PARTIAL','RECOVERY_PRICE','ENHANCED_PRICE'].includes(scenario)?'TICKET_DOCUMENT_REVIEW':'TICKET_CONFIRMATION_PENDING',ticketingDiagnostic:{supplierRequestId:'trace-'+pnr,automaticRetry:false}}});
          if(scenario==='ENHANCED_PENDING')expect(wireCase.result).toMatchObject({ticketingDiagnostic:{operation:'enhancedAirTicket',endpoint:'/v1.3.0/air/ticket',recovery:{lookupCount:3},ticketCheck:'NO_TICKETS_REPORTED',errors:[{providerCodes:['0316']}],automaticRetry:false}});
          if(scenario==='PENDING')expect(wireCase.result).toMatchObject({ticketingDiagnostic:{recovery:{lookupCount:3},ticketCheck:'NO_TICKETS_REPORTED',warnings:[{type:'UNABLE_TO_RETRIEVE_TICKETS'}]}});
          if(scenario==='RECOVERY_PRICE')expect(wireCase.result).toMatchObject({ticketingDiagnostic:{recovery:{lookupCount:1},ticketCheck:'DOCUMENTS_INCOMPLETE',errors:[{type:'UNABLE_TO_RETRIEVE_TICKETS'}]}});
          expect(await bookings.detail(customerId,wireBooking.id)).toMatchObject({status:'MANUAL_REVIEW_REQUIRED'});
          await expect(operations.action(wireCase.id,{action:'EXECUTE',version:wireCase.version,confirmedPnr:pnr},staff,'blocked-retry')).rejects.toMatchObject({status:409});
          await expect(operations.create(wireBooking.id,'ISSUE','No duplicate trial',staff,'duplicate-case')).rejects.toMatchObject({status:409});
          if(!['PRICE','PARTIAL','RECOVERY_PRICE','ENHANCED_PRICE'].includes(scenario)){
            wireCase=await operations.action(wireCase.id,{action:'RECONCILE',version:wireCase.version,confirmedPnr:pnr},staff,'unverified-documents');
            expect(wireCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{stage:'TICKET_CONFIRMATION_PENDING',ticketingDiagnostic:{ticketCheck:'NO_TICKETS_REPORTED',automaticRetry:false}}});
          }else {wireCase=await operations.action(wireCase.id,{action:'RECONCILE',version:wireCase.version,confirmedPnr:pnr},staff,'unverified-documents');expect(wireCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{stage:'TICKET_DOCUMENT_REVIEW'}});}
          if(scenario==='PENDING'){
            const supportEvidence={source:'SABRE_SUPPORT_PORTAL' as const,reference:'CASE-FIXTURE-123',confirmedPnr:pnr,confirmedPcc:'TEST',validatingCarrier:'MH',outcome:'NO_TICKETS_REPORTED' as const,ticketNumbers:[],channelAuthenticated:true as const,salesReportScope:'PCC_NOT_CONFIRMED' as const};
            await expect(operations.action(wireCase.id,{action:'RECORD_SUPPORT_EVIDENCE',version:wireCase.version,supportEvidence},{...staff,role:'ticketing_staff'},'unauthorized-support')).rejects.toMatchObject({status:403});
            await expect(operations.action(wireCase.id,{action:'RECORD_SUPPORT_EVIDENCE',version:wireCase.version,supportEvidence:{...supportEvidence,confirmedPnr:'BAD123'}},staff,'wrong-support-pnr')).rejects.toMatchObject({status:409});
            wireCase=await operations.action(wireCase.id,{action:'RECORD_SUPPORT_EVIDENCE',version:wireCase.version,supportEvidence},staff,'verified-support-reference');
            expect(wireCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{supportEvidence:{sourceVerification:'OPERATOR_ATTESTATION',automaticallyVerified:false,salesReportScope:'PCC_NOT_CONFIRMED'}}});
            const restarted=new AdminFlightOperationsService(connection,servicingConfig,new FlightTicketingService(config,connection,provider as unknown as SabreBookingManagementClient,bookings),provider as unknown as SabreBookingManagementClient,refunds,bookings,records,exchanges);
            await database.query("UPDATE flight_servicing_cases SET status='EXECUTING', updated_at=now()-interval '6 minutes' WHERE id=$1",[wireCase.id]);
            wireCase=await restarted.action(wireCase.id,{action:'RECONCILE',version:wireCase.version,confirmedPnr:pnr},staff,'restarted-read-only-check');
            expect(wireCase).toMatchObject({status:'OUTCOME_UNKNOWN',result:{ticketingDiagnostic:{salesReportReason:'PCC_NOT_CONFIRMED',automaticRetry:false}}});
          }
          issued=true;documentAmount='100.00';documentTravelerIndex=1;

          wireCase=await operations.action(wireCase.id,{action:'RECONCILE',version:wireCase.version,confirmedPnr:pnr},staff,'delayed-documents');
          expect(wireCase.status).toBe('COMPLETED');
        }
        expect(await bookings.detail(customerId,wireBooking.id)).toMatchObject({status:'TICKETED'});
        expect(await records.booking(wireBooking.id)).toMatchObject({fulfillmentStatus:'COMPLETED'});
        expect(http.mock.calls.filter(([url])=>url.endsWith('/fulfillFlightTickets')||url.endsWith('/air/ticket'))).toHaveLength(1);
        expect(http.mock.calls.filter(([url])=>enhanced?url.endsWith('/fulfillFlightTickets'):url.endsWith('/air/ticket'))).toHaveLength(0);
        expect((await database.query('SELECT event,created_at FROM audit_events WHERE event LIKE $1 ORDER BY created_at',['flight.ticketing.dispatch-claim:'+wireCase.id+':%'])).rows).toEqual(claimed.rows);
      }

    } finally { await database.close(); }
  }, 60000);
});
