import {priceAmount,priceMinor} from './flight-pricing.contract.js';
export type CheckoutFx={from:string;to:string;numerator:string;denominator:string;updatedAt:string;validUntil:string;provider:'ExchangeRate-API'};
export function convertCheckoutAmount(amount:string,from:string,to:string,fx?:CheckoutFx){
 if(from===to||priceMinor(amount)===0n)return priceAmount(priceMinor(amount));
 if(!fx||fx.from!==from||fx.to!==to||fx.provider!=='ExchangeRate-API'||!/^\d{1,24}$/.test(fx.numerator)||!/^\d{1,24}$/.test(fx.denominator)||BigInt(fx.numerator)<=0n||BigInt(fx.denominator)<=0n||!Number.isFinite(Date.parse(fx.updatedAt))||!Number.isFinite(Date.parse(fx.validUntil)))throw Error('A verified checkout currency rate is required.');
 const divisor=BigInt(fx.denominator);return priceAmount((priceMinor(amount)*BigInt(fx.numerator)+divisor/2n)/divisor);
}
