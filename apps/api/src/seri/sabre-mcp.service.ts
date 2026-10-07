import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '@flyseri/config';
import { APP_CONFIG } from '../tokens.js';
import { SabreAuthService } from '../flight/sabre-auth.service.js';

type ObjectValue = Record<string, unknown>;
const record = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
// The model never receives the generic executor, arbitrary API paths, or credentials.
const tools = new Set(['SearchAndBookHotelWorkflow', 'HotelsSearchAPI_OpenAPISpec', 'callSabreAPI']);

@Injectable()
export class SabreMcpService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(SabreAuthService) private readonly auth?: SabreAuthService) {}

  get enabled() { return this.config.SERI_SABRE_MCP_ENABLED && this.config.SABRE_ENV === 'CERT' && !!this.auth; }

  private async rpc(method: string, params: ObjectValue, correlation: string): Promise<ObjectValue> {
    if (!this.enabled) throw new Error('Sabre travel search is unavailable');
    const id = randomUUID();
    const notification = method === 'notifications/initialized';
    const response = await fetch('https://mcp.cert.sabre.com/mcp', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.SABRE_REQUEST_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${await this.auth!.token()}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26', 'Conversation-Id': correlation },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
    });
    if (!response.ok) throw new Error(`Sabre MCP unavailable (${response.status})`);
    if (notification) { await response.body?.cancel(); return {}; }
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error('Sabre response exceeds limit');
    const messages = response.headers.get('content-type')?.includes('text/event-stream')
      ? body.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean).map(line => JSON.parse(line) as unknown)
      : [JSON.parse(body) as unknown];
    const message = messages.find(value => record(value) && value.id === id);
    if (!record(message) || message.error || !record(message.result)) throw new Error('Invalid Sabre MCP response');
    return message.result;
  }

  private async call(name: string, args: ObjectValue, correlation: string) {
    if (!tools.has(name) || (name === 'callSabreAPI' && args.fullPath !== '/v1/hotels/hotelSearch')) throw new Error('Unsupported Sabre operation');
    const result = await this.rpc('tools/call', { name, arguments: args }, correlation);
    if (result.isError) throw new Error('Sabre travel search failed');
    return result;
  }

  async searchHotels(args: ObjectValue, currency: string) {
    const allowed = ['airport', 'checkInDate', 'checkOutDate', 'adults', 'childAges'];
    if (Object.keys(args).some(key => !allowed.includes(key)) || typeof args.airport !== 'string' || !/^[A-Z]{3}$/.test(args.airport) ||
        !Number.isInteger(args.adults) || Number(args.adults) < 1 || Number(args.adults) > 9 || !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid hotel search');
    const dates = [args.checkInDate, args.checkOutDate];
    if (dates.some(date => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('Invalid stay dates');
    const [start, end] = dates as [string, string];
    if (start < new Date().toISOString().slice(0, 10) || end <= start || Date.parse(end) - Date.parse(start) > 30 * 86400000) throw new Error('Choose a future stay of up to 30 nights');
    const ages = args.childAges ?? [];
    if (!Array.isArray(ages) || ages.length > 6 || ages.some(age => !Number.isInteger(age) || age < 0 || age > 17)) throw new Error('Invalid child ages');
    const correlation = randomUUID();
    await this.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'flyseri-seri', version: '1.0.0' } }, correlation);
    await this.rpc('notifications/initialized', {}, correlation);
    // Follow the documented workflow and obtain the contract before executing its search step.
    await this.call('SearchAndBookHotelWorkflow', {}, correlation);
    await this.call('HotelsSearchAPI_OpenAPISpec', {}, correlation);
    const result = await this.call('callSabreAPI', { fullPath: '/v1/hotels/hotelSearch', requestPayload: JSON.stringify({
      pos: { source: { pseudoCityCode: this.config.SABRE_PCC } }, currencyCode: currency, radiusInMiles: 20,
      checkInDate: start, checkOutDate: end, numberOfAdults: args.adults, numberOfChildren: ages.length,
      ...(ages.length ? { childAges: ages } : {}), maxResults: 5, referencePoint: { type: 'Airport', value: args.airport },
    }) }, correlation);
    const blocks = Array.isArray(result.content) ? result.content : [];
    const text = blocks.filter(record).filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
    let data: unknown = text;
    // Sabre sometimes returns a JSON string containing another JSON document.
    for (let depth = 0; depth < 3 && typeof data === 'string'; depth++) {
      try { data = JSON.parse(data); } catch { break; }
    }
    if (!record(data) || !Array.isArray(data.hotels) || (Array.isArray(data.errors) && data.errors.length)) throw new Error('Hotel availability could not be retrieved');
    return { environment: 'CERT', bookable: false, checkInDate: start, checkOutDate: end, requestedCurrency: currency,
      hotels: data.hotels.slice(0, 5).filter(record).map(item => {
        const hotel = record(item.hotel) ? item.hotel : {};
        const rate = record(item.rateDetails) ? item.rateDetails : {};
        // Keep opaque supplier rate keys and unrelated fields out of the model and persisted chat.
        return { hotel: { hotelName: hotel.hotelName, address: record(hotel.address) ? {
          cityName: hotel.address.cityName, countryName: hotel.address.countryName,
        } : undefined, amenities: Array.isArray(hotel.amenities) ? hotel.amenities.slice(0, 12).filter(value => typeof value === 'string') : [] },
        rateDetails: { currencyCode: rate.currencyCode, approxTotalPrice: rate.approxTotalPrice,
          averageNightlyRate: rate.averageNightlyRate, isTaxInclusive: rate.isTaxInclusive } };
      }),
      notice: 'Test environment hotel availability. Hotel reservations are not available in Flyseri yet. Use the currency returned with each rate; never relabel or convert an amount without a verified rate.' };
  }
}
