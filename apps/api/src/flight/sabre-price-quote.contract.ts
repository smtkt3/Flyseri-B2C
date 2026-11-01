import { createHash } from 'node:crypto';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value === undefined ? [] : [value];
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : typeof record(value)['#text'] === 'string' ? record(value)['#text'] as string : undefined;
const code = (value: unknown, pattern: RegExp): string | undefined => {
  const result = text(value);
  return result !== undefined && pattern.test(result) ? result : undefined;
};
const date = (value: unknown) => code(value, /^\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?$/);
const money = (value: unknown) => {
  const amount = code(value, /^\d+(?:\.\d{1,3})?$/);
  const currency = code(record(value)['@_currencyCode'], /^[A-Z]{3}$/);
  return amount && currency ? { amount, currency } : undefined;
};

/** PriceQuoteServices 4.3.0 XSD: Type is a sibling, NOT a PriceQuote attribute.
 * This is stateless retrieval only. It cannot update, retain or issue a quote. */
export function buildGetPriceQuoteRequest(pnr: string): string {
  if (!/^[A-Z0-9]{6}$/.test(pnr)) throw new Error('Invalid price quote reservation');
  return `<GetPriceQuoteRQ version="4.3.0" xmlns="http://www.sabre.com/ns/Ticketing/pqs/1.0"><SearchParameters resultType="D" stateful="false"><PriceQuoteInfo><Reservation>${pnr}</Reservation><Status>A</Status><Type>PQ</Type><PriceQuote/></PriceQuoteInfo></SearchParameters></GetPriceQuoteRQ>`;
}

/** Recognize documented pricing qualifiers, not a currency mentioned in free text.
 * No match is not proof that an arbitrary host command has no override. */
export function readPricingInstruction(input: unknown) {
  const entry = text(input);
  const qualifiers = [...(entry ?? '').matchAll(/(?:^WP|[¥‡$])(?:M([A-Z]{3})|D\*([A-Z]{3}))(?=$|[¥‡$])/g)]
    .map(match => ({ type: match[1] ? 'SPECIFIC_CURRENCY' as const : 'ALTERNATE_CURRENCY' as const, currency: (match[1] ?? match[2])! }));
  return {
    inputEntryPresent: !!entry,
    inputEntrySha256: entry ? createHash('sha256').update(entry).digest('hex') : undefined,
    currencyInstruction: qualifiers.length ? 'EXPLICIT_CURRENCY_FOUND' as const : entry === 'WP' || entry === 'WPRQ' ? 'NATIVE_PRICING_ENTRY' as const : 'NOT_ESTABLISHED' as const,
    currencyQualifiers: qualifiers,
  };
}

/** Consumes namespace-stripped XML with string values and @_ attributes.
 * Allowlist deliberately excludes names, payment details, update tokens and raw commands. */
export function readPriceQuoteEvidence(value: unknown, expectedPnr: string) {
  if (!/^[A-Z0-9]{6}$/.test(expectedPnr)) throw new Error('Invalid price quote reservation');
  const data = record(value), header = record(data.Header), results = record(header.Results);
  if (!Object.hasOwn(results, 'Success') || Object.hasOwn(results, 'Error') || Object.hasOwn(results, 'Warning')) {
    throw new Error('Price quote retrieval is incomplete');
  }
  const reservations = list(data.PriceQuoteInfo).map(record);
  if (reservations.length !== 1 || text(reservations[0]!.Reservation) !== expectedPnr) {
    throw new Error('Price quote reservation mismatch');
  }
  const details = list(reservations[0]!.Details).map(record);
  if (!details.length || details.length > 35) throw new Error('Active price quote details are unavailable');
  const quotes = details.map(detail => {
    const number = code(detail['@_number'], /^\d{1,3}$/);
    const type = code(detail['@_type'], /^PQ$/);
    const status = code(detail['@_status'], /^A$/);
    if (!number || !type || !status) throw new Error('Active price quote identity is incomplete');
    const agent = record(detail.AgentInfo), transaction = record(detail.TransactionInfo), fare = record(detail.FareInfo);
    return {
      number, type, status,
      pricingType: code(detail['@_pricingType'], /^[A-Z]$/),
      displayOnly: detail['@_displayOnly'] === 'true' ? true : detail['@_displayOnly'] === 'false' ? false : undefined,
      homePcc: code(agent.HomeLocation, /^[A-Z0-9]{3,4}$/), workPcc: code(agent.WorkLocation, /^[A-Z0-9]{3,4}$/),
      creationDate: date(transaction.CreateDateTime), localCreationDate: date(transaction.LocalCreateDateTime),
      purchaseDeadline: date(transaction.LastDateToPurchase),
      ...readPricingInstruction(transaction.InputEntry),
      base: money(fare.BaseFare), equivalent: money(fare.EquivalentFare), total: money(fare.TotalFare),
      validatingCarrier: code(record(detail.MiscellaneousInfo).ValidatingCarrier, /^[A-Z0-9]{2}$/),
    };
  });
  if (new Set(quotes.map(quote => quote.number)).size !== quotes.length) throw new Error('Duplicate price quote identity');
  return {
    supplierMessageId: code(header['@_messageID'], /^[A-Za-z0-9_.:-]{1,180}$/),
    supplierTimestamp: date(header['@_timeStamp']),
    details: quotes,
  };
}
