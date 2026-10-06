import type { FlightOffer } from '@flyseri/types';
import './flight-meals.css';

type Meal = NonNullable<FlightOffer['amenities']>[number];
const labels = { INCLUDED: 'Included in this fare', FOR_FEE: 'Available for purchase', NOT_INCLUDED: 'Not included in this fare', UNKNOWN: 'Availability not confirmed' };
export function mealOptionName(name: string): string {
  const clean = name.trim().replace(/^(?:chargeable|complimentary|free of charge)\s+/i, '').replace(/\s+meals?$/i, '').trim();
  const names: Record<string, string> = { VEG: 'Vegetarian', 'NON VEG': 'Non-vegetarian', 'NON-VEG': 'Non-vegetarian', VEGETARIAN: 'Vegetarian', VEGAN: 'Vegan', DIABETIC: 'Diabetic', JAIN: 'Jain', HALAL: 'Halal', 'GLUTEN FREE': 'Gluten-free', 'GLUTEN-FREE': 'Gluten-free' };
  return names[clean.toUpperCase()] ?? (clean || name).toLowerCase().replace(/\b[a-z]/g, character => character.toUpperCase());
}

function mealSummary(meals: Meal[]): string {
  if (!meals.length) return 'Meal information not provided';
  const availability = new Set(meals.map(meal => meal.availability));
  if (availability.size !== 1) return 'Meal options reported by airline';
  return labels[meals[0]!.availability];
}

export function FlightMealDetails({ offer, knownOnly = false }: { offer: FlightOffer; knownOnly?: boolean }) {
  const segments = (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])]).flatMap(leg => leg.segments);
  return <div className="flight-meal-list">{segments.map((segment, index) => {
    const meals = (offer.amenities ?? []).filter(item => item.category === 'MEALS' && (!item.segmentIndexes?.length || item.segmentIndexes.includes(index)) && (!knownOnly || item.availability !== 'UNKNOWN'));
    if (knownOnly && !meals.length) return null;
    const options = [...new Map(meals.map(meal => [`${meal.availability}:${mealOptionName(meal.name)}`, meal])).values()];
    const availability = [...new Set(options.map(meal => meal.availability))];
    return <section className="flight-meal-leg" key={index} aria-label={`Meals for ${segment.marketingCarrier} ${segment.flightNumber}`}>
      <span className="flight-meal-route">{segment.origin} → {segment.destination} · {segment.marketingCarrier} {segment.flightNumber}</span>
      <p className="flight-meal-summary">{mealSummary(options)}</p>
      {options.length > 0 && <details className="flight-meal-options"><summary><span>View meal options</span><span className="flight-meal-count">{options.length}</span></summary>
        {availability.map(value => <div className="flight-meal-group" key={value}>
          {availability.length > 1 && <p>{labels[value]}</p>}
          <ul>{options.filter(meal => meal.availability === value).map(meal => <li key={`${value}:${mealOptionName(meal.name)}`} title={meal.name}>{mealOptionName(meal.name)}</li>)}</ul>
        </div>)}
      </details>}
    </section>;
  })}</div>;
}
