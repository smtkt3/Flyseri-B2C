import type { FlightAncillaryResponse } from '@flyseri/types';
export type AirlineServiceCategory = 'FOOD' | 'BAGGAGE' | 'SEATS' | 'OTHER';
export const airlineServiceCategories: { id: AirlineServiceCategory; label: string; description: string }[] = [
  { id: 'FOOD', label: 'Food & drinks', description: 'Meals, snacks and beverages' },
  { id: 'BAGGAGE', label: 'Baggage', description: 'Extra bags and baggage services' },
  { id: 'SEATS', label: 'Seats', description: 'Pre-reserved seats and seat options' },
  { id: 'OTHER', label: 'Other extras', description: 'Lounge access, comfort, assistance and more' },
];
/** Airline-neutral: supplier group first; conservative name fallback for older responses. */
export function airlineServiceCategory(service: FlightAncillaryResponse['services'][number]): AirlineServiceCategory {
  const group = service.groupCode?.trim().toUpperCase();
  if (group === 'ML') return 'FOOD';
  if (group === 'BG') return 'BAGGAGE';
  if (group === 'SA') return 'SEATS';
  if (group) return 'OTHER';
  const name = service.name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
  if (/\b(BAGGAGE|LUGGAGE|BAG|BAGS|EXCESS WEIGHT|EXTRA WEIGHT|SPORTS EQUIPMENT)\b/.test(name)) return 'BAGGAGE';
  if (/\b(SEAT|SEATS|SEATING|LEGROOM|LEG ROOM|PRE RESERVED SEAT ASSIGNMENT)\b/.test(name)) return 'SEATS';
  if (/\b(MEAL|MEALS|FOOD|DRINK|DRINKS|BEVERAGE|BEVERAGES|SNACK|SNACKS|COFFEE|TEA|JUICE|WATER|COCONUTWATER|SODA|COLA|WINE|BEER|SANDWICH|CHICKEN|RICE|NOODLES|PASTA|BREAKFAST|LUNCH|DINNER|VEGETARIAN|VEGAN)\b/.test(name)) return 'FOOD';
  return 'OTHER';
}
