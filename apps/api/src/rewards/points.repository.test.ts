import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FlightOffer } from '@flyseri/types';
import { PointsRepository } from './points.repository.js';
import { earnedPoints, eligibleFare, minor } from './points-rules.js';

const oldDate=new Date(Date.now()-20*86400000).toISOString();
const offer={currency:'BDT',totalAmount:'25500.00',priceBreakdown:{baseFareAmount:'25000.00',taxesAndFeesAmount:'500.00',currency:'BDT'},outbound:{segments:[{arrivalAt:oldDate}]},inbound:null} as FlightOffer;
describe('points money rules',()=>{
  it('earns only whole points for each BDT 1,000 without floating-point rounding',()=>{
    expect(earnedPoints(minor('999.99')!)).toBe(0);expect(earnedPoints(minor('1000.00')!)).toBe(1);expect(earnedPoints(minor('25999.99')!)).toBe(25);
    expect(eligibleFare(offer,'25500.00','BDT','500.00')).toBe(2450000n);
    expect(eligibleFare(offer,'26000.00','BDT','0.00')).toBe(0n);
    expect(eligibleFare(offer,'25500.00','MYR','0.00')).toBe(0n);
    expect(minor('NaN')).toBeNull();expect(minor('-1')).toBeNull();expect(minor('1.001')).toBeNull();
  });
});
describe('Flyseri Points PostgreSQL lifecycle',()=>{
  let db:PGlite,repo:PointsRepository;
  const staff=randomUUID();
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec('CREATE ROLE flyseri_api');
    const directory=resolve(process.cwd(),'../../packages/database/drizzle');
    for(const file of readdirSync(directory).filter(f=>/^\d+.*\.sql$/.test(f)).sort()) {
      for(const statement of readFileSync(resolve(directory,file),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.exec(statement);
    }
    const client={query:(text:string,values?:unknown[])=>db.query(text,values),release:()=>undefined};
    repo=new PointsRepository({connect:async()=>client,query:client.query} as unknown as Pool);
  },30000);
  afterAll(async()=>{await db?.close();});
  async function customer(){const id=randomUUID();await db.query('INSERT INTO customers(id,auth_user_id) VALUES($1,$2)',[id,randomUUID()]);return id;}
  async function order(customerId:string,paid=false,provider='LIVE_PROVIDER'){
    const id=randomUUID(),intent=randomUUID();
    await db.query(`INSERT INTO flight_booking_intents(id,customer_id,search_id,selected_offer_id,idempotency_key,currency,search_total_amount,validated_total_amount,selected_offer_snapshot,search_request_snapshot)
      VALUES($1,$2,$3,$4,$5,'BDT','25500.00','25500.00',$6,'{}')`,[intent,customerId,randomUUID(),randomUUID(),randomUUID(),JSON.stringify(offer)]);
    await db.query(`INSERT INTO orders(id,customer_id,booking_intent_id,order_number,status,currency,subtotal_amount,total_amount,expires_at)
      VALUES($1,$2,$3,$4,$5,'BDT',25500,25500,now()+interval '1 hour')`,[id,customerId,intent,randomUUID().slice(0,30),paid?'PAID':'PENDING_PAYMENT']);
    await db.query(`INSERT INTO flight_bookings(booking_intent_id,customer_id,status,provider_view_snapshot) VALUES($1,$2,'TICKETED',$3)`,[intent,customerId,JSON.stringify({tickets:[{number:'1234567890123',status:'Issued'}]})]);
    if(paid)await db.query(`INSERT INTO payments(order_id,customer_id,provider,status,amount,currency) VALUES($1,$2,$3,'SUCCEEDED',25500,'BDT')`,[id,customerId,provider]);
    return id;
  }
  it('applies migration, RLS and constraints; excludes sandbox payment from real earning',async()=>{
    const tables=await db.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE relname IN ('points_accounts','points_lots','points_redemptions','points_ledger')");
    expect(tables.rows).toHaveLength(4);expect(tables.rows.every(t=>t.relrowsecurity)).toBe(true);
    const id=await customer();await order(id,true,'STRIPE_TEST');
    expect((await repo.wallet(id)).pending).toBe(0);
    await expect(db.query('UPDATE points_accounts SET adjustment_due=-1 WHERE customer_id=$1',[id])).rejects.toThrow();
  });
  it('creates one pending award on repeated reconciliation and releases only verified completed travel',async()=>{
    const id=await customer(),booking=await order(id,true);
    await repo.reconcile(id,booking);await repo.reconcile(id,booking);
    let wallet=await repo.wallet(id);expect(wallet.pending).toBe(25);expect(wallet.available).toBe(0);
    await expect(repo.verifyJourney(id,booking,new Date(Date.now()+86400000).toISOString(),staff,'Verified airline journey')).rejects.toThrow();
    await repo.verifyJourney(id,booking,new Date(Date.now()-10*86400000).toISOString(),staff,'Verified airline journey');
    await repo.verifyJourney(id,booking,new Date(Date.now()-10*86400000).toISOString(),staff,'Verified airline journey');
    wallet=await repo.wallet(id);expect(wallet.pending).toBe(0);expect(wallet.available).toBe(25);expect(wallet.activity.filter(a=>a.kind==='EARNED')).toHaveLength(1);
  });
  it('isolates ownership and prevents over-redemption, repeat spending, and payment-time changes',async()=>{
    const id=await customer(),other=await customer(),booking=await order(id),next=await order(id);
    await repo.adjust(id,150,randomUUID(),staff,'Seed approved test adjustment');
    await expect(repo.quote(other,booking,true)).rejects.toThrow();
    await expect(repo.apply(id,booking,99,true)).rejects.toThrow();
    await expect(repo.apply(id,booking,151,true)).rejects.toThrow();
    await expect(repo.apply(id,booking,100,false)).rejects.toThrow();
    await repo.apply(id,booking,100,true);await repo.apply(id,booking,100,true);
    expect((await repo.wallet(id)).available).toBe(50);expect((await repo.wallet(id)).reserved).toBe(100);
    await expect(repo.apply(id,next,100,true)).rejects.toThrow();
    expect((await db.query<{total_amount:string}>('SELECT total_amount FROM orders WHERE id=$1',[booking])).rows[0]!.total_amount).toBe('25400.00');
    await repo.apply(id,booking,0,true);expect((await repo.wallet(id)).available).toBe(150);
    await db.query(`INSERT INTO payments(order_id,customer_id,provider,status,amount,currency) VALUES($1,$2,'LIVE_PROVIDER','UNKNOWN',25500,'BDT')`,[booking,id]);
    await expect(repo.apply(id,booking,100,true)).rejects.toThrow();
  });
  it('returns abandoned points but preserves an uncertain payment reservation',async()=>{
    const id=await customer(),booking=await order(id);await repo.adjust(id,200,randomUUID(),staff,'Approved test adjustment');
    await repo.apply(id,booking,100,true);await db.query("UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1",[booking]);
    expect((await repo.wallet(id)).available).toBe(200);expect((await repo.wallet(id)).reserved).toBe(0);
    const pending=await order(id);await repo.apply(id,pending,100,true);
    await db.query(`INSERT INTO payments(order_id,customer_id,provider,status,amount,currency) VALUES($1,$2,'LIVE_PROVIDER','UNKNOWN',25400,'BDT')`,[pending,id]);
    await db.query("UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1",[pending]);
    expect((await repo.wallet(id)).reserved).toBe(100);
  });
  it('captures redemption, reconciles cumulative partial/full refunds, and never repeats restoration',async()=>{
    const id=await customer(),booking=await order(id);await repo.adjust(id,500,randomUUID(),staff,'Approved test adjustment');
    await repo.apply(id,booking,100,true);
    await db.query("UPDATE orders SET status='PAID' WHERE id=$1",[booking]);
    await db.query(`INSERT INTO payments(order_id,customer_id,provider,status,amount,currency) VALUES($1,$2,'LIVE_PROVIDER','SUCCEEDED',25400,'BDT')`,[booking,id]);
    await repo.verifyJourney(id,booking,new Date(Date.now()-10*86400000).toISOString(),staff,'Verified airline journey');
    expect((await repo.wallet(id)).available).toBe(424);expect((await repo.wallet(id)).reserved).toBe(0);
    await repo.refund(id,booking,'12450.00',staff,'Verified refund reference');
    expect((await repo.wallet(id)).available).toBe(462);
    await repo.refund(id,booking,'24900.00',staff,'Verified refund reference');
    await repo.refund(id,booking,'24900.00',staff,'Verified refund reference');
    expect((await repo.wallet(id)).available).toBe(500);
    await expect(repo.refund(id,booking,'100.00',staff,'Verified refund reference')).rejects.toThrow();
    await expect(repo.refund(id,booking,'25000.00',staff,'Verified refund reference')).rejects.toThrow();
  });
  it('refunds pending awards without releasing them; checks expiry and idempotent staff adjustments',async()=>{
    const id=await customer(),booking=await order(id,true),key=randomUUID();
    await repo.refund(id,booking,'25000.00',staff,'Verified full refund reference');
    expect((await repo.wallet(id)).pending).toBe(0);
    await repo.adjust(id,200,key,staff,'Approved test adjustment');await repo.adjust(id,200,key,staff,'Approved test adjustment');
    expect((await repo.wallet(id)).available).toBe(200);
    await expect(repo.adjust(id,201,key,staff,'Approved test adjustment')).rejects.toThrow();
    await db.query("UPDATE points_lots SET expires_at=now()-interval '1 second' WHERE customer_id=$1 AND state='AVAILABLE'",[id]);
    const wallet=await repo.wallet(id);expect(wallet.available).toBe(0);expect(wallet.activity.some(a=>a.kind==='EXPIRED')).toBe(true);
    await repo.wallet(id);expect((await repo.wallet(id)).activity.filter(a=>a.kind==='EXPIRED')).toHaveLength(1);
  });
  it('offsets spent earned points after refund without taking customer money',async()=>{
    const id=await customer(),booking=await order(id,true);
    await repo.verifyJourney(id,booking,new Date(Date.now()-10*86400000).toISOString(),staff,'Verified completed journey');
    await repo.adjust(id,-25,randomUUID(),staff,'Simulate previously used points');
    await repo.refund(id,booking,'25000.00',staff,'Verified full refund reference');
    let wallet=await repo.wallet(id);expect(wallet.available).toBe(0);expect(wallet.adjustmentDue).toBe(25);
    await repo.adjust(id,30,randomUUID(),staff,'Approved adjustment settles debt');
    wallet=await repo.wallet(id);expect(wallet.available).toBe(5);expect(wallet.adjustmentDue).toBe(0);
  });
  it('does not let an unpaid checkout extend expiry; only expired unused rewards are waived on refund',async()=>{
    const id=await customer(),booking=await order(id);await repo.adjust(id,200,randomUUID(),staff,'Approved test adjustment');
    await repo.apply(id,booking,100,true);
    await db.query("UPDATE points_lots SET expires_at=now()-interval '1 second' WHERE customer_id=$1",[id]);
    await repo.apply(id,booking,0,true);
    expect((await repo.wallet(id)).available).toBe(0);
    const person=await customer(),paid=await order(person,true);
    await repo.verifyJourney(person,paid,new Date(Date.now()-10*86400000).toISOString(),staff,'Verified completed journey');
    await repo.adjust(person,-10,randomUUID(),staff,'Simulate previously used points');
    await db.query("UPDATE points_lots SET expires_at=now()-interval '1 second' WHERE customer_id=$1",[person]);
    await repo.refund(person,paid,'25000.00',staff,'Verified full refund reference');
    expect((await repo.wallet(person)).adjustmentDue).toBe(10);
  });
  it('requires active checkout allocations to reconcile before reversing their source earning',async()=>{
    const id=await customer(),paid=await order(id,true),checkout=await order(id);
    await repo.verifyJourney(id,paid,new Date(Date.now()-10*86400000).toISOString(),staff,'Verified completed journey');
    await repo.adjust(id,75,randomUUID(),staff,'Approved additional test balance');
    await repo.apply(id,checkout,100,true);
    await expect(repo.refund(id,paid,'25000.00',staff,'Verified full refund reference')).rejects.toThrow('reserved in another checkout');
    await repo.apply(id,checkout,0,true);await repo.refund(id,paid,'25000.00',staff,'Verified full refund reference');
    const wallet=await repo.wallet(id);expect(wallet.available).toBe(75);expect(wallet.adjustmentDue).toBe(0);
  });
});
