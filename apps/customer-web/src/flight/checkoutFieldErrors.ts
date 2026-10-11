import { checkoutPassengerError, checkoutPassportError } from './checkoutContinuation';

type PassengerFields = { kind: string; givenNames: string; surname: string; gender: string; nationality: string; birthDate: string; idNumber: string; idExpiryDate: string; issuingCountryCode: string };
export function passengerFieldErrors(person: PassengerFields, departure: string, lastTravel: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!person.givenNames.trim()) errors.givenNames = 'Enter the given names shown on the travel document.';
  if (!person.surname.trim()) errors.surname = 'Enter the surname shown on the travel document.';
  if (!['MALE', 'FEMALE', 'X'].includes(person.gender)) errors.gender = 'Choose the gender shown on the travel document.';
  const birthError = checkoutPassengerError({ ...person, givenNames: '_', surname: '_', gender: 'X', nationality: 'BD' }, departure, lastTravel);
  if (birthError) errors.birthDate = birthError;
  if (!/^[A-Z]{2}$/.test(person.nationality)) errors.nationality = 'Choose the traveler’s nationality.';
  const documentError = checkoutPassportError(person, lastTravel);
  if (documentError) {
    if (!/^[A-Z0-9]{3,30}$/.test(person.idNumber)) errors.idNumber = 'Enter 3–30 letters or numbers from the travel document.';
    const expiry = Date.parse(`${person.idExpiryDate}T00:00:00Z`);
    if (!Number.isFinite(expiry) || new Date(expiry).toISOString().slice(0, 10) !== person.idExpiryDate || person.idExpiryDate <= lastTravel) errors.idExpiryDate = 'Choose an expiry date after the final flight.';
    if (!/^[A-Z]{2}$/.test(person.issuingCountryCode)) errors.issuingCountryCode = 'Choose the country that issued the document.';
  }
  return errors;
}
export function contactFieldErrors(contact: { name: string; email: string; phone: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!contact.name.trim()) errors.name = 'Enter a booking contact name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) errors.email = 'Enter a valid email address, such as name@example.com.';
  if (contact.phone.replace(/\D/g, '').length < 6) errors.phone = 'Enter a mobile phone number with at least six digits.';
  return errors;
}
