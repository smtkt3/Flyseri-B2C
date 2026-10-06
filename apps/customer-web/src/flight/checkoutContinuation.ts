import type { FlightOffer, TravellerProfile } from '@flyseri/types';
export function checkoutPassportError(person:{idNumber:string;idExpiryDate:string;issuingCountryCode:string;idType?:string},lastTravelDate:string):string|null{
 if(!person.idNumber&&!person.idExpiryDate&&!person.issuingCountryCode)return null;
 const expiry=Date.parse(`${person.idExpiryDate}T00:00:00Z`);
 if(!/^[A-Z0-9]{3,30}$/.test(person.idNumber)||!Number.isFinite(expiry)||new Date(expiry).toISOString().slice(0,10)!==person.idExpiryDate||!/^[A-Z]{2}$/.test(person.issuingCountryCode))return 'Complete the document number, expiry date and issuing country, or leave the document fields empty.';
 if(person.idExpiryDate<=lastTravelDate)return 'The document must be valid through your final flight.';
 return null;
}

export function checkoutPassengerError(person: { kind: string; givenNames: string; surname: string; gender: string; birthDate: string; nationality: string }, departureDate: string, lastTravelDate: string): string | null {
  if (!person.givenNames.trim() || !person.surname.trim() || !['MALE', 'FEMALE', 'X'].includes(person.gender) || !/^[A-Z]{2}$/.test(person.nationality)) return 'Complete each traveler’s name, gender and nationality.';
  const birth = Date.parse(person.birthDate + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(person.birthDate) || !Number.isFinite(birth) || new Date(birth).toISOString().slice(0, 10) !== person.birthDate || birth > Date.now()) return 'Enter a valid date of birth.';
  const kindAt = (date: string) => {
    const years = Number(date.slice(0, 4)) - Number(person.birthDate.slice(0, 4)) - (date.slice(5) < person.birthDate.slice(5) ? 1 : 0);
    return years < 2 ? 'Infant' : years < 12 ? 'Child' : 'Adult';
  };
  if (kindAt(departureDate) !== person.kind) return `This date of birth does not match the selected ${person.kind.toLowerCase()} passenger. Update the traveler or change your search.`;
  if (kindAt(lastTravelDate) !== person.kind) return 'This traveler changes age category during the trip. Contact Flyseri to arrange the correct fare.';
  return null;
}

/** Match the selected flight and fare class, never the cheapest replacement. */
export function sameCheckoutFare(left: FlightOffer, right: FlightOffer): boolean {
  const signature = (offer: FlightOffer) => JSON.stringify({
    ndc: Boolean(offer.ndcContext), cabin: offer.cabin ?? null,
    brand: offer.fareBrandCode ?? offer.fareBrand ?? null,
    legs: (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])]).map(leg =>
      leg.segments.map(segment => [segment.origin, segment.destination, segment.departureAt, segment.arrivalAt,
        segment.marketingCarrier, segment.flightNumber, segment.operatingCarrier ?? segment.marketingCarrier, segment.bookingClass ?? null])),
  });
  return signature(left) === signature(right);
}

export function matchingCheckoutTraveller(person: TravellerProfile, input: {
  givenNames: string; surname: string; birthDate: string; gender: string; nationality: string;
}): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
  return normalize([person.legalFirstName, person.legalMiddleName].filter(Boolean).join(' ')) === normalize(input.givenNames) &&
    normalize(person.legalLastName) === normalize(input.surname) && person.dateOfBirth === input.birthDate &&
    person.gender === input.gender && person.nationalityCountryCode === input.nationality;
}
