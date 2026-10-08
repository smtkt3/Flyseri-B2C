type Leg = { origin: string; destination: string; departureDate: string };
type Search = { mode: string; origin: string; destination: string; departure: string; returnDate: string; multiLegs: Leg[] };
const airportCode = (value: string) => value.trim().toUpperCase().match(/\(([A-Z]{3})\)$/)?.[1] ?? value.trim().toUpperCase();
const validAirport = (value: string) => /^[A-Z]{3}$/.test(airportCode(value));
function validDate(value: string, minimum: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < minimum) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function homeSearchValidation(search: Search, today: string) {
  const errors: Record<string, string> = {};
  function validateLeg(origin: string, destination: string, date: string, prefix = '', minimum = today) {
    if (!validAirport(origin)) errors[`${prefix}origin`] = 'Choose a departure airport.';
    if (!validAirport(destination)) errors[`${prefix}destination`] = 'Choose a destination airport.';
    else if (airportCode(origin) === airportCode(destination)) errors[`${prefix}destination`] = 'Choose a different destination.';
    if (!validDate(date, minimum)) errors[`${prefix}departure`] = date ? 'Choose a valid date from ' + minimum + '.' : 'Choose a departure date.';
  }
  if (search.mode === 'MULTI_CITY') {
    search.multiLegs.forEach((leg, index) => {
      const previous = search.multiLegs[index - 1];
      const prefix = `leg-${index}-`;
      validateLeg(leg.origin, leg.destination, leg.departureDate, prefix, previous?.departureDate && previous.departureDate > today ? previous.departureDate : today);
      if (previous && validAirport(leg.origin) && airportCode(previous.destination) !== airportCode(leg.origin)) errors[`${prefix}origin`] = 'Start from the previous flight’s destination.';
    });
  } else {
    validateLeg(search.origin, search.destination, search.departure);
    if (search.mode === 'ROUND_TRIP' && !validDate(search.returnDate, search.departure > today ? search.departure : today)) errors.returnDate = search.returnDate ? 'Return must be on or after departure.' : 'Choose a return date.';
  }
  return errors;
}
