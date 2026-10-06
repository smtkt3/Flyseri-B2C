export type BookingPassengerCode = 'ADT' | 'CNN' | 'INF';
export function passengerCodeAt(birthDate: string, travelDate: string): BookingPassengerCode {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(birthDate) || !validDate(travelDate) || birthDate > travelDate) throw new Error('Invalid passenger age');
  const age = Number(travelDate.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (travelDate.slice(5) < birthDate.slice(5) ? 1 : 0);
  return age < 2 ? 'INF' : age < 12 ? 'CNN' : 'ADT';
}
