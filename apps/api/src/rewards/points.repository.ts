import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { randomUUID } from 'node:crypto';
import type { FlightOffer, PointsQuote, PointsWallet } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { earnedPoints, eligibleFare, lastArrival, minor, money, POINTS_RULES } from './points-rules.js';

type Client = Pick<PoolClient, 'query'>;
type Source = QueryResultRow & { id: string; customer_id: string; order_number: string; status: string;
  currency: string; discount_amount: string; total_amount: string; expires_at: Date | null;
  validated_total_amount: string | null; offer: FlightOffer; booking_status: string | null;
  payment_status: string | null; payment_amount: string | null; payment_currency: string | null; provider: string | null; tickets: Array<{ status: string; number: string }> | null };
type Lot = QueryResultRow & { id: string; points: number; remaining: number; expired_points: number; eligible_minor: string; refunded_minor: string;
  state: string; completed_at: Date | null; expires_at: Date | null };
type Redemption = QueryResultRow & { points: number; restored: number; refunded_minor: string; state: string;
  allocations: Array<{ id: string; points: number; expiresAt: string }> };
const conflict = (message: string) => new ApiException('CONFLICT', message, 409);
const sourceSql = `SELECT o.*, i.validated_total_amount, i.selected_offer_snapshot AS offer,
  b.status AS booking_status, b.provider_view_snapshot->'tickets' AS tickets,
  p.status AS payment_status, p.amount AS payment_amount, p.currency AS payment_currency, p.provider FROM orders o
  LEFT JOIN flight_booking_intents i ON i.id=o.booking_intent_id AND i.customer_id=o.customer_id
  LEFT JOIN flight_bookings b ON b.booking_intent_id=i.id AND b.customer_id=o.customer_id
  LEFT JOIN payments p ON p.order_id=o.id AND p.customer_id=o.customer_id`;
const realPayment = (s: Source) => s.payment_status === 'SUCCEEDED' && s.payment_amount === s.total_amount && s.payment_currency === s.currency && !!s.provider && !/TEST|DEMO|SANDBOX|MOCK|CERT/i.test(s.provider);

/** All mutations lock order -> account. The account lock serializes different checkouts using the same wallet. */
export class PointsRepository {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await run(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async source(c: Client, customerId: string, orderId: string): Promise<Source> {
    const { rows } = await c.query<Source>(`${sourceSql} WHERE o.id=$1 AND o.customer_id=$2 FOR UPDATE OF o`, [orderId, customerId]);
    if (!rows[0]) throw new ApiException('NOT_FOUND', 'We could not find that order.', 404);
    return rows[0];
  }
  private async lock(c: Client, customerId: string) {
    if(!(await c.query('SELECT id FROM customers WHERE id=$1',[customerId])).rows.length) throw new ApiException('NOT_FOUND','We could not find that customer.',404);
    await c.query('INSERT INTO points_accounts(customer_id) VALUES ($1) ON CONFLICT DO NOTHING', [customerId]);
    await c.query('SELECT customer_id FROM points_accounts WHERE customer_id=$1 FOR UPDATE', [customerId]);
  }
  private async log(c: Client, customerId: string, orderId: string | null, key: string, kind: string,
    points: number, description: string, staffId?: string, evidence?: string) {
    await c.query(`INSERT INTO points_ledger(customer_id,order_id,event_key,kind,points,description,staff_id,evidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_key) DO NOTHING`,
    [customerId, orderId, key, kind, points, description, staffId ?? null, evidence ?? null]);
  }
  private async expire(c: Client, customerId: string) {
    const { rows } = await c.query<Lot>(`SELECT * FROM points_lots WHERE customer_id=$1 AND state='AVAILABLE'
      AND expires_at<=now() AND remaining>0 FOR UPDATE`, [customerId]);
    for (const lot of rows) {
      await c.query('UPDATE points_lots SET expired_points=expired_points+remaining,remaining=0 WHERE id=$1', [lot.id]);
      await this.log(c, customerId, null, `expiry:${lot.id}:${randomUUID()}`, 'EXPIRED', -lot.remaining, 'Points expired');
    }
  }
  private async available(c: Client, customerId: string): Promise<number> {
    const { rows } = await c.query(`SELECT COALESCE(SUM(remaining),0)::int AS available FROM points_lots
      WHERE customer_id=$1 AND state='AVAILABLE' AND expires_at>now()`, [customerId]);
    const account = await c.query('SELECT adjustment_due FROM points_accounts WHERE customer_id=$1', [customerId]);
    return Math.max(0, Number(rows[0].available) - Number(account.rows[0].adjustment_due));
  }
  private async redemption(c: Client, id: string): Promise<Redemption | undefined> {
    return (await c.query<Redemption>('SELECT * FROM points_redemptions WHERE order_id=$1', [id])).rows[0];
  }
  private async returnAllocation(c: Client, customerId: string, redemption: Redemption) {
    for (const allocation of redemption.allocations) {
      // An abandoned checkout cannot extend a point's lifetime. Paid refunds use a separate grace-period lot.
      await c.query('UPDATE points_lots SET remaining=remaining+$2 WHERE id=$1', [allocation.id, allocation.points]);
    }
  }
  async reconcile(customerId: string, orderId: string): Promise<void> {
    await this.transaction(async c => {
      const s = await this.source(c, customerId, orderId);
      await this.lock(c, customerId);
      const redemption = await this.redemption(c, orderId);
      if (redemption?.state === 'RESERVED') {
        if (s.status === 'PAID' && realPayment(s)) {
          await c.query("UPDATE points_redemptions SET state='CAPTURED' WHERE order_id=$1", [orderId]);
          await this.log(c, customerId, orderId, `redeemed:${orderId}`, 'REDEEMED', 0, `${redemption.points} points used on ${s.order_number}`);
        } else if (!s.payment_status && (['CANCELLED','EXPIRED'].includes(s.status) || s.expires_at && s.expires_at <= new Date())) {
          await this.returnAllocation(c, customerId, redemption);
          await c.query("UPDATE points_redemptions SET state='RELEASED' WHERE order_id=$1", [orderId]);
          await c.query('UPDATE orders SET total_amount=total_amount+$2,discount_amount=discount_amount-$2 WHERE id=$1', [orderId, redemption.points]);
          await this.log(c, customerId, orderId, `released:${orderId}`, 'RELEASED', redemption.points, 'Unused checkout points returned');
        }
      }
      // Sandbox payments and unsupported currencies cannot fund real rewards.
      if (s.status !== 'PAID' || !realPayment(s) || !s.offer) return;
      const eligible = eligibleFare(s.offer, s.validated_total_amount, s.currency, s.discount_amount);
      const inserted = await c.query(`INSERT INTO points_lots(customer_id,order_id,eligible_minor,points,state,rules_version)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id) DO NOTHING RETURNING id`,
      [customerId, orderId, eligible.toString(), earnedPoints(eligible), eligible>0n?'PENDING':'REVERSED',POINTS_RULES.version]);
      if (inserted.rows.length && earnedPoints(eligible)>0) await this.log(c, customerId, orderId, `pending:${orderId}`, 'PENDING', earnedPoints(eligible), `Points pending for ${s.order_number}`);
      const lot = (await c.query<Lot>('SELECT * FROM points_lots WHERE order_id=$1', [orderId])).rows[0];
      if (!lot || lot.state !== 'PENDING' || !lot.completed_at || s.booking_status !== 'TICKETED') return;
      if (lot.completed_at.getTime() + POINTS_RULES.releaseDays * 86_400_000 > Date.now()) return;
      const points = earnedPoints(BigInt(lot.eligible_minor) - BigInt(lot.refunded_minor));
      const debt = Number((await c.query('SELECT adjustment_due FROM points_accounts WHERE customer_id=$1', [customerId])).rows[0].adjustment_due);
      const offset = Math.min(debt, points);
      await c.query(`UPDATE points_lots SET state='AVAILABLE',points=$2,remaining=$3,available_at=now(),expires_at=now()+interval '12 months' WHERE id=$1`, [lot.id, points, points-offset]);
      await c.query('UPDATE points_accounts SET adjustment_due=adjustment_due-$2 WHERE customer_id=$1', [customerId, offset]);
      await this.log(c, customerId, orderId, `earned:${orderId}`, 'EARNED', points, `Points available from ${s.order_number}`);
      if (offset) await this.log(c, customerId, orderId, `offset:${orderId}`, 'ADJUSTMENT', -offset, 'Previous refund adjustment settled');
    });
  }
  async reconcileCustomer(customerId: string) {
    const { rows } = await this.pool.query(`SELECT o.id FROM orders o LEFT JOIN points_lots l ON l.order_id=o.id
      LEFT JOIN payments p ON p.order_id=o.id WHERE o.customer_id=$1 AND o.booking_intent_id IS NOT NULL AND
      ((o.status='PAID' AND o.currency='BDT' AND p.status='SUCCEEDED' AND p.provider !~* 'TEST|DEMO|SANDBOX|MOCK|CERT'
        AND (l.id IS NULL OR (l.state='PENDING' AND l.completed_at IS NOT NULL AND l.completed_at<=now()-interval '7 days')))
      OR o.id IN (SELECT order_id FROM points_redemptions WHERE customer_id=$1 AND state='RESERVED'))`, [customerId]);
    for (const row of rows) await this.reconcile(customerId, row.id);
  }
  async wallet(customerId: string, page = 1): Promise<PointsWallet> {
    await this.reconcileCustomer(customerId);
    return this.transaction(async c => {
      await this.lock(c, customerId); await this.expire(c, customerId);
      const pending = await c.query("SELECT COALESCE(SUM(points),0)::int AS n FROM points_lots WHERE customer_id=$1 AND state='PENDING'", [customerId]);
      const reserved = await c.query("SELECT COALESCE(SUM(points),0)::int AS n FROM points_redemptions WHERE customer_id=$1 AND state='RESERVED'", [customerId]);
      const debt = await c.query('SELECT adjustment_due FROM points_accounts WHERE customer_id=$1', [customerId]);
      const next = await c.query(`SELECT SUM(remaining)::int AS points,expires_at FROM points_lots WHERE customer_id=$1 AND state='AVAILABLE'
        AND remaining>0 AND expires_at>now() AND expires_at<=now()+interval '30 days' GROUP BY expires_at ORDER BY expires_at LIMIT 1`, [customerId]);
      const activity = await c.query(`SELECT id,kind,points,description,created_at,order_id FROM points_ledger WHERE customer_id=$1
        ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $2`, [customerId, (page-1)*20]);
      return { rules: POINTS_RULES, available: await this.available(c, customerId), pending: Number(pending.rows[0].n),
        reserved: Number(reserved.rows[0].n), adjustmentDue: Number(debt.rows[0].adjustment_due),
        expiring: next.rows[0] ? { points: Number(next.rows[0].points), expiresAt: next.rows[0].expires_at.toISOString() } : null,
        activity: activity.rows.slice(0,20).map(r=>({ id:r.id,kind:r.kind,points:r.points,description:r.description,createdAt:r.created_at.toISOString(),orderId:r.order_id })), page, hasMore:activity.rows.length>20 };
    });
  }
  private async quoteFor(c: Client, s: Source, enabled: boolean): Promise<PointsQuote> {
    const redemption = await this.redemption(c, s.id);
    const applied = redemption && redemption.state !== 'RELEASED' ? redemption.points : 0;
    const fare = s.offer ? eligibleFare(s.offer,s.validated_total_amount,s.currency,money((minor(s.discount_amount) ?? 0n) - BigInt(applied)*100n)) : 0n;
    const available = await this.available(c,s.customer_id);
    const maximum = Math.min(available + applied, Number(fare / 1000n));
    const eligible = enabled && fare>0n && !s.payment_status && ['PENDING_PAYMENT','PAYMENT_FAILED'].includes(s.status) && !!s.expires_at && s.expires_at>new Date();
    return { orderId:s.id,eligible,available,maximum,applied,eligibleAmount:money(fare),estimatedEarn:earnedPoints(fare>BigInt(applied)*100n ? fare-BigInt(applied)*100n:0n),rules:POINTS_RULES,
      message: !enabled ? 'Test bookings do not earn or spend real points.' : !fare ? 'Points require a verified BDT base fare. Taxes and extras are excluded.' : s.payment_status ? 'Points cannot change after payment has started.' : 'Earn 1 point per BDT 1,000 of eligible fare after discounts.' };
  }
  async quote(customerId: string, orderId: string, enabled: boolean): Promise<PointsQuote> {
    await this.reconcile(customerId,orderId);
    return this.transaction(async c=>{const s=await this.source(c,customerId,orderId);await this.lock(c,customerId);await this.expire(c,customerId);return this.quoteFor(c,s,enabled);});
  }
  async apply(customerId: string, orderId: string, points: number, enabled: boolean): Promise<void> {
    if (!Number.isSafeInteger(points) || points<0) throw conflict('Choose a whole number of points.');
    await this.transaction(async c=>{
      const s=await this.source(c,customerId,orderId);await this.lock(c,customerId);await this.expire(c,customerId);
      const quote=await this.quoteFor(c,s,enabled);
      if (!quote.eligible) throw conflict(quote.message);
      if (points && (points<POINTS_RULES.minimumRedemption || points>quote.maximum)) throw conflict('Use at least 100 points, within your balance and the 10% fare limit.');
      if(points && Number((await c.query('SELECT adjustment_due FROM points_accounts WHERE customer_id=$1',[customerId])).rows[0].adjustment_due)>0) throw conflict('A refund adjustment must be settled before using points.');
      const prior=await this.redemption(c,orderId);
      if (prior?.state==='RESERVED' && prior.points===points) return;
      if (prior?.state==='CAPTURED') throw conflict('Points have already been used on this order.');
      if (prior?.state==='RESERVED') {
        await this.returnAllocation(c,customerId,prior);
        await this.log(c,customerId,orderId,`release:${orderId}:${randomUUID()}`,'RELEASED',prior.points,'Checkout points returned');
      }
      const allocations: Redemption['allocations']=[];
      let left=points;
      if (left) {
        const lots=await c.query<Lot>(`SELECT * FROM points_lots WHERE customer_id=$1 AND state='AVAILABLE' AND expires_at>now() AND remaining>0 ORDER BY expires_at,id FOR UPDATE`,[customerId]);
        for (const lot of lots.rows) {const used=Math.min(left,lot.remaining);if(!used)break;allocations.push({id:lot.id,points:used,expiresAt:lot.expires_at!.toISOString()});await c.query('UPDATE points_lots SET remaining=remaining-$2 WHERE id=$1',[lot.id,used]);left-=used;}
        if(left)throw conflict('Your points balance changed. Refresh and try again.');
      }
      await c.query('UPDATE orders SET discount_amount=discount_amount-$2+$3,total_amount=total_amount+$2-$3,updated_at=now() WHERE id=$1',[orderId,quote.applied,points]);
      if(points) {
        await c.query(`INSERT INTO points_redemptions(order_id,customer_id,points,state,allocations,expires_at) VALUES($1,$2,$3,'RESERVED',$4,$5)
          ON CONFLICT(order_id) DO UPDATE SET points=EXCLUDED.points,state='RESERVED',allocations=EXCLUDED.allocations,expires_at=EXCLUDED.expires_at`,[orderId,customerId,points,JSON.stringify(allocations),s.expires_at]);
        await this.log(c,customerId,orderId,`reserve:${orderId}:${randomUUID()}`,'RESERVED',-points,`Points reserved for ${s.order_number}`);
      } else if(prior) await c.query("UPDATE points_redemptions SET state='RELEASED' WHERE order_id=$1",[orderId]);
    });
  }
  async verifyJourney(customerId:string,orderId:string,completedAt:string,staffId:string,evidence:string) {
    await this.reconcile(customerId,orderId);
    await this.transaction(async c=>{
      const s=await this.source(c,customerId,orderId);await this.lock(c,customerId);
      const at=Date.parse(completedAt),arrival=s.offer ? lastArrival(s.offer):null;
      if(!realPayment(s)||s.status!=='PAID'||s.booking_status!=='TICKETED'||!s.tickets?.length||s.tickets.some(t=>t.status!=='Issued'||!/^\d{13}$/.test(t.number))||arrival===null||!Number.isFinite(at)||at<arrival||at>Date.now()) throw conflict('Verify the paid ticket and completed final flight before releasing points.');
      const lot=(await c.query<Lot>('SELECT * FROM points_lots WHERE order_id=$1',[orderId])).rows[0];
      if(!lot)throw conflict('This booking has no eligible rewards.');
      if(lot.completed_at)return;
      await c.query('UPDATE points_lots SET completed_at=$2 WHERE id=$1',[lot.id,new Date(at)]);
      await this.log(c,customerId,orderId,`journey:${orderId}`,'ADJUSTMENT',0,'Journey verified; points release after 7 days',staffId,evidence);
    });
    await this.reconcile(customerId,orderId);
  }
  /** Cumulative eligible cash refund, verified by staff. Monotonic totals make retries idempotent. */
  async refund(customerId:string,orderId:string,refundedAmount:string,staffId:string,evidence:string) {
    const amount=minor(refundedAmount);if(amount===null)throw conflict('Check the eligible refund amount.');
    await this.reconcileCustomer(customerId);
    await this.reconcile(customerId,orderId);
    await this.transaction(async c=>{
      const s=await this.source(c,customerId,orderId);await this.lock(c,customerId);
      await this.expire(c,customerId);
      const lot=(await c.query<Lot>('SELECT * FROM points_lots WHERE order_id=$1 FOR UPDATE',[orderId])).rows[0];
      if(!lot||!realPayment(s))throw conflict('No eligible paid rewards exist for this order.');
      const original=BigInt(lot.eligible_minor), prior=BigInt(lot.refunded_minor);
      if(amount<prior||amount>original)throw conflict('The cumulative eligible refund must not decrease or exceed the eligible paid fare.');
      if(amount===prior)return;
      const holds=await c.query("SELECT order_id FROM points_redemptions WHERE customer_id=$1 AND state='RESERVED' AND allocations @> $2::jsonb LIMIT 1",[customerId,JSON.stringify([{id:lot.id}])]);
      if(holds.rows.length)throw conflict('Some points from this ticket are reserved in another checkout. Reconcile that checkout before adjusting the rewards refund.');
      const reversed=earnedPoints(original-prior)-earnedPoints(original-amount);
      if(lot.state==='AVAILABLE') {
        const removed=Math.min(lot.remaining,reversed);
        await c.query('UPDATE points_lots SET remaining=remaining-$2 WHERE id=$1',[lot.id,removed]);
        // Only actually expired unused points are waived; spent points still require an adjustment after expiry.
        const expiredOffset=Math.min(lot.expired_points,reversed-removed);
        await c.query('UPDATE points_lots SET expired_points=expired_points-$2 WHERE id=$1',[lot.id,expiredOffset]);
        const debt=reversed-removed-expiredOffset;
        if(debt)await c.query('UPDATE points_accounts SET adjustment_due=adjustment_due+$2 WHERE customer_id=$1',[customerId,debt]);
      }
      await c.query("UPDATE points_lots SET refunded_minor=$2,points=CASE WHEN state='PENDING' THEN $3 ELSE points END,state=CASE WHEN $3=0 AND state='PENDING' THEN 'REVERSED' ELSE state END WHERE id=$1",[lot.id,amount.toString(),earnedPoints(original-amount)]);
      await this.log(c,customerId,orderId,`refund:${orderId}:${amount}`,'REFUND',-reversed,'Earned points adjusted after refund',staffId,evidence);
      const redemption=await this.redemption(c,orderId);
      if(redemption?.state==='CAPTURED'&&original>0n) {
        const restored=Number(BigInt(redemption.points)*amount/original),delta=restored-redemption.restored;
        if(delta>0) {
          const earliestExpiry=redemption.allocations.map(a=>Date.parse(a.expiresAt)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
          const restoredExpiry=new Date(Math.max(earliestExpiry??0,Date.now()+30*86_400_000));
          await c.query(`INSERT INTO points_lots(customer_id,points,remaining,state,rules_version,available_at,expires_at)
            VALUES($1,$2,$2,'AVAILABLE',$3,now(),$4)`,[customerId,delta,POINTS_RULES.version,restoredExpiry]);
          await c.query('UPDATE points_redemptions SET restored=$2,refunded_minor=$3 WHERE order_id=$1',[orderId,restored,amount.toString()]);
          await this.log(c,customerId,orderId,`restore:${orderId}:${amount}`,'REFUND',delta,'Redeemed points restored after refund',staffId,evidence);
        }
      }
    });
  }
  async adjust(customerId:string,points:number,key:string,staffId:string,evidence:string) {
    await this.transaction(async c=>{
      await this.lock(c,customerId);await this.expire(c,customerId);
      const eventKey=`staff:${key}`;
      const claimed=await c.query(`INSERT INTO points_ledger(customer_id,event_key,kind,points,description,staff_id,evidence)
        VALUES($1,$2,'ADJUSTMENT',$3,'Points balance adjusted by Flyseri',$4,$5) ON CONFLICT(event_key) DO NOTHING RETURNING id`,[customerId,eventKey,points,staffId,evidence]);
      if(!claimed.rows.length){const existing=(await c.query('SELECT customer_id,points,staff_id,evidence FROM points_ledger WHERE event_key=$1',[eventKey])).rows[0];if(existing.customer_id!==customerId||existing.points!==points||existing.staff_id!==staffId||existing.evidence!==evidence)throw conflict('This adjustment reference was already used.');return;}
      if(points>0) {
        const debt=Number((await c.query('SELECT adjustment_due FROM points_accounts WHERE customer_id=$1',[customerId])).rows[0].adjustment_due),offset=Math.min(debt,points);
        await c.query('UPDATE points_accounts SET adjustment_due=adjustment_due-$2 WHERE customer_id=$1',[customerId,offset]);
        await c.query(`INSERT INTO points_lots(customer_id,points,remaining,state,rules_version,available_at,expires_at)
          VALUES($1,$2,$3,'AVAILABLE',$4,now(),now()+interval '12 months')`,[customerId,points,points-offset,POINTS_RULES.version]);
      } else {
        let left=-points;
        const lots=await c.query<Lot>(`SELECT * FROM points_lots WHERE customer_id=$1 AND state='AVAILABLE' AND expires_at>now() AND remaining>0 ORDER BY expires_at,id FOR UPDATE`,[customerId]);
        for(const lot of lots.rows){const n=Math.min(left,lot.remaining);await c.query('UPDATE points_lots SET remaining=remaining-$2 WHERE id=$1',[lot.id,n]);left-=n;if(!left)break;}
        if(left)await c.query('UPDATE points_accounts SET adjustment_due=adjustment_due+$2 WHERE customer_id=$1',[customerId,left]);
      }
    });
  }
}
