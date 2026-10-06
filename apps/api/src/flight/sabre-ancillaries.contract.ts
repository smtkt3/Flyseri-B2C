/** Get Ancillaries NDC request variants supplied by the user on 2026-10-03. */
export interface AncillaryPassenger {
  passengerId: string;
  passengerTypeCode: 'ADT' | 'CNN' | 'INF';
  givenName: string;
  surname: string;
}
export type SabreAncillaryRequest =
  | { requestType: 'offerId'; request: { offerId: string; passengers: AncillaryPassenger[] } }
  | { requestType: 'orderId'; request: { orderId: string; requestedSegmentRefs?: string[]; requestedPaxRefs?: string[] } };

const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/\s/.test(value);
const name = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 120 && !/[\x00-\x1f\x7f]/.test(value);
function refs(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 60 || !value.every(identifier) || new Set(value).size !== value.length) {
    throw new Error('Ancillary passenger and segment references are invalid');
  }
  return [...value];
}

/** Rebuild the supplier request. IDs and passenger references must be supplied
 * by the server's selected NDC offer/order context, never the local offer UUID.
 */
export function buildSabreAncillaryRequest(input: SabreAncillaryRequest): SabreAncillaryRequest {
  if (!input || !input.request) throw new Error('An NDC offer or order context is required');
  if (input.requestType === 'offerId') {
    const { offerId, passengers } = input.request;
    if (!identifier(offerId) || !Array.isArray(passengers) || passengers.length < 1 || passengers.length > 9 ||
      passengers.some((person) => !person || !identifier(person.passengerId) ||
        !['ADT', 'CNN', 'INF'].includes(person.passengerTypeCode) || !name(person.givenName) || !name(person.surname)) ||
      new Set(passengers.map((person) => person.passengerId)).size !== passengers.length) {
      throw new Error('A confirmed NDC offer and its passenger details are required');
    }
    return { requestType: 'offerId', request: { offerId, passengers: passengers.map((person) => ({
      passengerId: person.passengerId, passengerTypeCode: person.passengerTypeCode,
      givenName: person.givenName.trim(), surname: person.surname.trim(),
    })) } };
  }
  if (input.requestType === 'orderId' && identifier(input.request.orderId)) {
    const requestedSegmentRefs = refs(input.request.requestedSegmentRefs);
    const requestedPaxRefs = refs(input.request.requestedPaxRefs);
    return { requestType: 'orderId', request: { orderId: input.request.orderId,
      ...(requestedSegmentRefs ? { requestedSegmentRefs } : {}), ...(requestedPaxRefs ? { requestedPaxRefs } : {}),
    } };
  }
  throw new Error('A confirmed NDC offer or order identifier is required');
}
