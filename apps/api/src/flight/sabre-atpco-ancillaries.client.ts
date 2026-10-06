import { randomUUID } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { AppConfig } from '@flyseri/config';
import type { FlightAncillaryResponse, FlightOffer } from '@flyseri/types';
import type { SabreAuthService } from './sabre-auth.service.js';
import { cents, fromCents, type AtpcoPurchaseOption } from './ancillary-purchase.contract.js';

const escapeXml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
type Node = Record<string, unknown>;
const object = (value: unknown): Node => value && typeof value === 'object' && !Array.isArray(value) ? value as Node : {};
const text = (value: unknown): string => typeof value === 'string' ? value : typeof object(value)['#text'] === 'string' ? object(value)['#text'] as string : '';
const rows = (value: unknown): Node[] => value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(object);
const segmentsOf = (offer: FlightOffer) => (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])]).flatMap(leg => leg.segments);

/** Agency 3.2.0 booking-payload example. Display lookup only: no PNR mutation or EMD issuance. */
export function buildAtpcoAncillaryPayload(offer: FlightOffer, adultCount: number) {
  const segments = segmentsOf(offer);
  if (!segments.length || segments.length > 60 || !Number.isInteger(adultCount) || adultCount < 1 || adultCount > 9) throw new Error('Invalid ancillary itinerary');
  const associations = segments.map((_, index) => `<gao:PassengerSegment segmentRef="seg_${index + 1}"/>`).join('');
  const passengers = Array.from({ length: adultCount }, (_, index) => `<gao:QueryPassengerItinerary><gao:Passenger id="p${index + 1}" type="ADT" excludeFromOffer="false"/><gao:PassengerItinerary>${associations}</gao:PassengerItinerary></gao:QueryPassengerItinerary>`).join('');
  const flights = segments.map((segment, index) => {
    // Shopping currently does not retain codeshare operating flight numbers.
    if (segment.operatingCarrier && segment.operatingCarrier !== segment.marketingCarrier) throw new Error('Operating flight reference unavailable');
    if (!segment.bookingClass || !/^\d{1,4}$/.test(segment.flightNumber)) throw new Error('Booking class unavailable');
    const fields = { Airline: segment.marketingCarrier, FlightNumber: segment.flightNumber, DepartureAirport: segment.origin,
      DepartureDate: segment.departureAt.slice(0, 10), DepartureTime: segment.departureAt.slice(11, 19), ArrivalAirport: segment.destination,
      ArrivalDate: segment.arrivalAt.slice(0, 10), ArrivalTime: segment.arrivalAt.slice(11, 19), OperatingAirline: segment.marketingCarrier,
      OperatingFlightNumber: segment.flightNumber, ClassOfService: segment.bookingClass };
    return `<gao:Segment id="seg_${index + 1}"><itin:FlightDetail id="flight_${index + 1}">${Object.entries(fields).map(([key, value]) => `<flt:${key}>${escapeXml(value)}</flt:${key}>`).join('')}</itin:FlightDetail></gao:Segment>`;
  }).join('');
  return `<gao:GetAncillaryOffersRQ version="3.2.0" xmlns:gao="http://services.sabre.com/merch/ancillary/offer/v03" xmlns:itin="http://services.sabre.com/merch/itinerary/v03" xmlns:flt="http://services.sabre.com/merch/flight/v03"><gao:RequestType>payload</gao:RequestType><gao:RequestMode>booking</gao:RequestMode><gao:QueryByItinerary>${passengers}${flights}</gao:QueryByItinerary><gao:Extensions/></gao:GetAncillaryOffersRQ>`;
}

/** References and price blocks follow the official Booking Management 2026.08 agency examples. */
export function readAtpcoAncillaries(xml: string, offer: FlightOffer, adultCount: number, purchaseOptions?: (AtpcoPurchaseOption | null)[]): FlightAncillaryResponse {
  if (xml.length > 4_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid ancillary XML');
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, processEntities: false }).parse(xml);
  const body = object(object(parsed.Envelope).Body);
  const response = object(body.GetAncillaryOffersRS);
  if (body.Fault || object(response.ApplicationResults)['@_status'] !== 'Complete' || !text(response.OfferId)) throw new Error('Ancillary response incomplete');
  const definitions = new Map(rows(response.AncillaryDefinition).map(row => [text(row['@_id']), row]));
  const ancillaries = new Map(rows(response.Ancillary).map(row => [text(row['@_ancillaryId']), row]));
  const passengerOffers = rows(response.PassengerOffers);
  const segments = segmentsOf(offer);
  const allOffers = rows(response.Offers);
  if (allOffers.length > 1000) throw new Error('Too many ancillary offers');
  const services: FlightAncillaryResponse['services'] = [];
  for (const item of allOffers) {
    const definition = definitions.get(text(ancillaries.get(text(item['@_ancillaryRef']))?.['@_ancillaryDefinitionRef']));
    const fee = object(item.AncillaryFee);
    if (!definition || text(fee.Unavailable) === 'true') continue;
    const name = text(definition.CommercialName), serviceCode = text(definition.SubCode);
    const passengerIndexes = passengerOffers.flatMap(passenger => {
      if (!text(passenger.OfferRefs).split(/\s+/).includes(text(item['@_offerId']))) return [];
      const id = text(object(passenger.PassengerReference)['@_passengerId']);
      const match = /^p([1-9])$/.exec(id);
      return match && Number(match[1]) <= adultCount ? [Number(match[1]) - 1] : [];
    });
    const segmentRefs = rows(item.Segment).map(segment => text(segment['@_segmentId']));
    const associatedSegments = segmentRefs.map(ref => /^seg_([1-9]\d*)$/.exec(ref)).map(match => match ? segments[Number(match[1]) - 1] : undefined);
    // Omit items we cannot associate safely rather than assigning them to every traveler/flight.
    if (!name || name.length > 160 || !serviceCode || !passengerIndexes.length || !associatedSegments.length || associatedSegments.some(segment => !segment)) continue;
    const total = object(fee.TTL_Price);
    const sale = total.TotalEquivalentAmount ?? total.Amount;
    const rawAmount = text(sale), rawCurrency = text(object(sale)['@_currency']);
    const priced = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(rawAmount) && /^[A-Z]{3}$/.test(rawCurrency);
    const groupCode = text(definition.GroupCode) || text(definition.Group);
    let purchase: AtpcoPurchaseOption | null = null;
    const base = object(fee.Base);
    const equivalent = [base.TotalEquivalentAmount, base.EquivAmount, base.Amount].find(value => text(object(value)['@_currency']) === rawCurrency);
    const basePrice = text(equivalent), airlineCode = text(definition.Airline);
    const reasonForIssuanceName = text(definition.ReasonForIssuance), emd = text(definition.ElectronicMiscDocType);
    // Do not split a supplier bundle or invent a tax/SSR/codeshare association.
    const needsSsr = !!text(definition.SpecialService) || text(object(definition.BookingMethod)['@_code']) === 'SSR';
    if (priced && passengerIndexes.length === 1 && (!text(item.Quantity) || text(item.Quantity) === '1') &&
      text(fee.DisplayOnly) !== 'true' && text(item.PaperTicketRequired) !== 'true' && !needsSsr &&
      /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(basePrice) && cents(rawAmount) >= cents(basePrice) &&
      /^[A-Z0-9]{2,3}$/.test(airlineCode) && /^[A-Z0-9]{2}$/.test(groupCode) &&
      reasonForIssuanceName.length > 0 && reasonForIssuanceName.length <= 60 && /^[A-Z_]{1,60}$/.test(emd)) {
      purchase = { commercialName: name, subcode: serviceCode, airlineCode, groupCode, reasonForIssuanceName,
        electronicMiscellaneousDocumentType: emd, basePrice, currencyCode: rawCurrency,
        totals: { subtotal: basePrice, taxes: fromCents(cents(rawAmount) - cents(basePrice)), total: rawAmount, currencyCode: rawCurrency },
        segmentIndexes: segmentRefs.map(ref => Number(/^seg_([1-9]\d*)$/.exec(ref)![1]) - 1) };
    }
    purchaseOptions?.push(purchase);
    services.push({ offerItemId: text(item.OfferItemId) || null, sellable: false, serviceCode, name,
      ...(/^[A-Z0-9]{2}$/.test(groupCode) ? { groupCode } : {}),
      amount: priced ? rawAmount : null, currency: priced ? rawCurrency : null,
      segmentLabels: associatedSegments.map(segment => `${segment!.origin} → ${segment!.destination} · ${segment!.marketingCarrier} ${segment!.flightNumber}`), passengerIndexes });
  }
  if (allOffers.length && !services.length) throw new Error('Ancillary associations could not be verified');
  return { retrievedAt: new Date().toISOString(), context: 'ATPCO_SHOPPING', bookingAvailable: false, services };
}

export class SabreAtpcoAncillariesClient {
  constructor(private readonly config: AppConfig, private readonly auth: SabreAuthService, private readonly http: typeof fetch = fetch) {}
  async lookup(offer: FlightOffer, adultCount: number, purchaseOptions?: (AtpcoPurchaseOption | null)[]) {
    if (this.config.SABRE_ENV !== 'CERT' || this.config.SABRE_BASE_URL !== 'https://api.cert.platform.sabre.com') throw new Error('CERT required');
    const payload = buildAtpcoAncillaryPayload(offer, adultCount);
    const token = await this.auth.token();
    const id = randomUUID();
    const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header><wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext"><wsse:BinarySecurityToken>${escapeXml(token)}</wsse:BinarySecurityToken></wsse:Security><eb:MessageHeader xmlns:eb="http://www.ebxml.org/namespaces/messageHeader"><eb:From><eb:PartyId>${escapeXml(this.config.SABRE_PCC!)}</eb:PartyId></eb:From><eb:To><eb:PartyId>GetAncillaryOffersRQ</eb:PartyId></eb:To><eb:ConversationId>${id}</eb:ConversationId><eb:Service>GetAncillaryOffersRQ</eb:Service><eb:Action>GetAncillaryOffersRQ</eb:Action></eb:MessageHeader></soap:Header><soap:Body>${payload}</soap:Body></soap:Envelope>`;
    const response = await this.http('https://webservices.cert.platform.sabre.com', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.SABRE_REQUEST_TIMEOUT_MS),
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'GetAncillaryOffersRQ', Accept: 'text/xml' }, body: xml });
    if (!response.ok || Number(response.headers.get('content-length')) > 4_000_000) throw new Error('Ancillary service unavailable');
    return readAtpcoAncillaries(await response.text(), offer, adultCount, purchaseOptions);
  }
  async lookupForPurchase(offer: FlightOffer, adultCount: number) {
    const options: (AtpcoPurchaseOption | null)[] = [];
    const quote = await this.lookup(offer, adultCount, options);
    return { quote, options };
  }
}
