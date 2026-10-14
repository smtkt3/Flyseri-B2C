import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseConnection } from '@flyseri/database';
import { DATABASE_CONNECTION } from '../tokens.js';
import { ApiException } from '../api-exception.js';
import { countedRedemptions, couponConflict, decimal, discountFor, minor, type CouponRow } from './coupon.rules.js';

export interface CouponInput {
  code:string; discountType:'PERCENT'|'FIXED'; discountValue:string; currency:string;
  minimumSpend:string; maximumDiscount?:string|null; startsAt?:string|null; expiresAt?:string|null;
  usageLimit?:number|null; perCustomerLimit:number; appliesTo:'FLIGHT'|'VISA'|'ALL'; active:boolean; version?:number;
}
@Injectable()
export class CouponService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection:DatabaseConnection|undefined) {}
  private pool() { if(!this.connection)throw new ApiException('DEPENDENCY_UNAVAILABLE','Discounts are temporarily unavailable.',503);return this.connection.pool; }
  async list(page:number) {
    const result=await this.pool().query(`SELECT c.*,count(r.order_id) FILTER(WHERE ${countedRedemptions})::int AS reserved_or_used,
      count(r.order_id) FILTER(WHERE r.state='CAPTURED' OR EXISTS(SELECT 1 FROM payments p WHERE p.order_id=r.order_id AND p.status='SUCCEEDED'))::int AS paid_uses
      FROM discount_coupons c LEFT JOIN coupon_redemptions r ON r.coupon_id=c.id GROUP BY c.id ORDER BY c.created_at DESC,c.id LIMIT 50 OFFSET $1`,[(page-1)*50]);
    return {items:result.rows,page,hasMore:result.rows.length===50};
  }
  async save(input:CouponInput,staffId:string,staffRole:string,requestId:string,id?:string) {
    const code=input.code.trim().toUpperCase();
    const value=minor(input.discountValue),minimum=minor(input.minimumSpend);
    if(value<=0n||input.discountType==='PERCENT'&&value>10000n||input.maximumDiscount!=null&&minor(input.maximumDiscount)<=0n)
      throw couponConflict('Enter a valid positive discount and maximum discount. Percentages cannot exceed 100.');
    if(input.startsAt&&input.expiresAt&&Date.parse(input.startsAt)>=Date.parse(input.expiresAt)) throw couponConflict('Expiry must be after the start date.');
    const args=[code,input.discountType,decimal(value),input.currency,decimal(minimum),input.maximumDiscount??null,input.startsAt??null,input.expiresAt??null,input.usageLimit??null,input.perCustomerLimit,input.appliesTo,input.active,staffId];
    const client=await this.pool().connect();
    try {
      await client.query('BEGIN');
      const result=id ? await client.query(`UPDATE discount_coupons SET discount_type=$2,discount_value=$3,currency=$4,minimum_spend=$5,maximum_discount=$6,starts_at=$7,expires_at=$8,usage_limit=$9,per_customer_limit=$10,applies_to=$11,active=$12,updated_by_staff_id=$13,version=version+1,updated_at=now() WHERE id=$14 AND version=$15 AND code=$1 RETURNING *`,[...args,id,input.version])
        : await client.query(`INSERT INTO discount_coupons(code,discount_type,discount_value,currency,minimum_spend,maximum_discount,starts_at,expires_at,usage_limit,per_customer_limit,applies_to,active,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,args);
      if(!result.rows[0])throw couponConflict('This coupon changed. Refresh it before saving. Coupon codes cannot be renamed.');
      await client.query('INSERT INTO admin_audit_events(staff_user_id,staff_role,event,resource_type,resource_id,request_id) VALUES($1,$2,$3,$4,$5,$6)',[staffId,staffRole,id?'coupon.updated':'coupon.created','coupon',result.rows[0].id,requestId]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch(error) {
      await client.query('ROLLBACK');
      if((error as {code?:string}).code==='23505')throw couponConflict('This coupon code already exists.');
      throw error;
    } finally {client.release();}
  }
  async apply(customerId:string,orderId:string,code:string|null,requestId:string) {
    const client=await this.pool().connect();
    try {
      await client.query('BEGIN');
      const order=(await client.query(`SELECT * FROM orders WHERE id=$1 AND customer_id=$2 FOR UPDATE`,[orderId,customerId])).rows[0];
      if(!order)throw new ApiException('NOT_FOUND','Order not found.',404);
      if(!['PENDING_PAYMENT','PAYMENT_FAILED'].includes(order.status)||order.expires_at&&order.expires_at<=new Date())throw couponConflict('Discounts cannot be changed on this order.');
      if((await client.query('SELECT id FROM payments WHERE order_id=$1 LIMIT 1',[orderId])).rowCount)throw couponConflict('Payment has already started. Discounts cannot be changed.');
      const prior=(await client.query(`SELECT * FROM coupon_redemptions WHERE order_id=$1 AND state <> 'RELEASED'`,[orderId])).rows[0];
      if(prior?.state==='CAPTURED')throw couponConflict('This coupon has already been used.');
      if(prior&&code&&prior.code!==code)throw couponConflict('Remove the current coupon before applying another.');
      if(!code&&!prior){await client.query('COMMIT');return {updated:true};}
      const coupon=(await client.query<CouponRow>('SELECT * FROM discount_coupons WHERE '+(code?'code=$1':'id=$1')+' FOR UPDATE',[code??prior.coupon_id])).rows[0];
      if(!coupon)throw couponConflict('This coupon is not available. Check the code.');
      const old=prior?minor(prior.discount_amount):0n;
      if(minor(order.discount_amount)!==old)throw couponConflict('Coupons cannot be combined with points or other discounts.');
      let amount=0n;
      if(code) {
        amount=discountFor(coupon,order,new Date());
        const counts=(await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE r.customer_id=$2)::int AS customer FROM coupon_redemptions r WHERE r.coupon_id=$1 AND r.order_id<>$3 AND ${countedRedemptions}`,[coupon.id,customerId,orderId])).rows[0];
        if(coupon.usage_limit!==null&&counts.total>=coupon.usage_limit||counts.customer>=coupon.per_customer_limit)throw couponConflict('This coupon has reached its usage limit.');
        await client.query(`INSERT INTO coupon_redemptions(order_id,coupon_id,customer_id,code,currency,discount_amount,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(order_id) DO UPDATE SET coupon_id=EXCLUDED.coupon_id,code=EXCLUDED.code,currency=EXCLUDED.currency,discount_amount=EXCLUDED.discount_amount,state='RESERVED',expires_at=EXCLUDED.expires_at,updated_at=now()`,[orderId,coupon.id,customerId,coupon.code,order.currency,decimal(amount),new Date(Math.min(order.expires_at?.getTime()??Date.now()+30*60*1000,coupon.expires_at?.getTime()??Infinity))]);
      } else await client.query("UPDATE coupon_redemptions SET state='RELEASED',updated_at=now() WHERE order_id=$1",[orderId]);
      await client.query('UPDATE orders SET discount_amount=$2,total_amount=total_amount+$3-$2,updated_at=now() WHERE id=$1',[orderId,decimal(amount),decimal(old)]);
      await client.query(`INSERT INTO commerce_audit_events(actor_type,actor_customer_id,order_id,event,request_id) VALUES('CUSTOMER',$1,$2,$3,$4)`,[customerId,orderId,code?'coupon.applied':'coupon.removed',requestId]);
      await client.query('COMMIT');return {updated:true};
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
}
