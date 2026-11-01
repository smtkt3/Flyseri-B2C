import { Injectable } from '@nestjs/common';
import type { FlightAncillaryDisplayPrices } from '@flyseri/types';
import type {CheckoutFx} from '../pricing/checkout-fx.contract.js';

export interface DisplayPriceInput { amount: string | null; currency: string | null }
interface Rates { values: Record<string, number>; updatedAt: string; until: number }

/** Display conversion remains indicative. The separately approved CERT
 * checkout method freezes the same verified source as a private quoted rate. */
@Injectable()
export class FlightDisplayCurrencyService {
  /** Explicitly approved for CERT extra checkout. The exact rational rate and
   * source timestamp are frozen in the private quote; no browser rate is used. */
  async checkoutRate(from:string,to:string):Promise<CheckoutFx>{
    if(!['BDT','MYR','USD','EUR','GBP','SGD','AUD'].includes(from)||!['BDT','MYR','USD','EUR','GBP','SGD','AUD'].includes(to))throw Error('This checkout currency requires separate support.');
    const rates=await this.load(),source=rates.values[from],target=rates.values[to];
    if(!source||!target)throw Error('Checkout conversion is unavailable.');
    return {from,to,numerator:target.toFixed(10).replace('.',''),denominator:source.toFixed(10).replace('.',''),updatedAt:rates.updatedAt,validUntil:new Date(Math.min(rates.until,Date.now()+10*60000)).toISOString(),provider:'ExchangeRate-API'};
  }
  private rates: Rates | undefined;
  private pending: Promise<Rates> | undefined;
  private retryAfter = 0;
  private async load(): Promise<Rates> {
    if (this.rates && this.rates.until > Date.now()) return this.rates;
    if (this.pending) return this.pending;
    if (this.retryAfter > Date.now()) throw new Error('Display conversion temporarily unavailable');
    this.pending = (async () => {
      const response = await fetch('https://open.er-api.com/v6/latest/USD', {
        redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Exchange rates unavailable');
      const value = await response.json() as Record<string, unknown>;
      const raw = value.rates;
      const updated = Number(value.time_last_update_unix) * 1000;
      const next = Number(value.time_next_update_unix) * 1000;
      if (value.result !== 'success' || value.base_code !== 'USD' || !raw || typeof raw !== 'object' || Array.isArray(raw) ||
        !Number.isFinite(updated) || updated > Date.now() + 3600000 || Date.now() - updated > 48 * 3600000) throw new Error('Invalid exchange rates');
      const values = Object.fromEntries(Object.entries(raw).filter(([code, rate]) => /^[A-Z]{3}$/.test(code) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0)) as Record<string, number>;
      if (values.USD !== 1 || Object.keys(values).length < 30) throw new Error('Incomplete exchange rates');
      const until = Number.isFinite(next) && next > Date.now() ? Math.min(next, Date.now() + 24 * 3600000) : Date.now() + 3600000;
      this.rates = { values, updatedAt: new Date(updated).toISOString(), until };
      return this.rates;
    })();
    try { return await this.pending; }
    catch (cause) { this.retryAfter = Date.now() + 60000; throw cause; }
    finally { this.pending = undefined; }
  }
  async convert(input: DisplayPriceInput[], currency: string): Promise<FlightAncillaryDisplayPrices> {
    let rates: Rates | undefined;
    if (input.some(price => price.currency && price.currency !== currency && price.amount !== null && Number(price.amount) > 0)) {
      try { rates = await this.load(); } catch { /* Return unavailable rather than inventing or relabelling a price. */ }
    }
    const decimals = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return { currency, updatedAt: rates?.updatedAt ?? null, provider: rates ? 'ExchangeRate-API' : null,
      prices: input.map(price => {
        if (price.amount === null || !price.currency) return null;
        const amount = Number(price.amount);
        if (!Number.isFinite(amount) || amount < 0) return null;
        if (amount === 0 || price.currency === currency) return amount.toFixed(decimals);
        const from = rates?.values[price.currency], to = rates?.values[currency];
        return from && to ? (amount / from * to).toFixed(decimals) : null;
      }) };
  }
}
