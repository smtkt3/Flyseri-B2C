import type { GroupFare } from '../../components/home/groupFares';
const travelDates = [14, 21, 28].map(days => {
  const date = new Date(); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
});
// Illustrative prices and conditions, explicitly authorised for the demo experience.
export const demoSpecialFlightOffers: Partial<Record<string, GroupFare>> = Object.fromEntries(
  Object.entries({ BKK: 18900, KUL: 22500, DPS: 34900, DXB: 42900, SIN: 27500 }).map(([code, amountPerPerson]) => [code, {
    amountPerPerson, currency: 'BDT', tripType: 'ONE_WAY', travelDates,
    minimumTravellers: 1, availableSeats: 9, baggage: '20 kg checked + 7 kg cabin (demo)',
    taxesIncluded: true, demo: true,
  }]),
);
