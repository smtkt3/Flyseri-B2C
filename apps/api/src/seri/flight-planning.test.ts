import { expect, it } from 'vitest';
import { flightPlanningDraft } from './travel-intent.js';
import { flightPlanQuestion, updateFlightPlan } from './flight-planning.js';

it.each(["dac to cox's bazar", 'DAC to Cox’s Bazar', "Dhaka to Cox's Bazar", "find flights DAC to Cox's Bazar"])(
  'starts flight planning from a code-to-city or city-to-city request: %s', text => {
    const update = updateFlightPlan(text, null)!;
    expect(update.plan.origin?.toLowerCase()).toMatch(/^(dac|dhaka)$/);
    expect(update.plan.destination?.toLowerCase()).toBe("cox's bazar");
    expect(flightPlanQuestion(update.plan)).toContain('What date');
  },
);
it('retains the requested route through dates and passenger follow-ups, ignoring unrelated form defaults', () => {
  const suffix = '\n\nCurrent search (use only where relevant; user instructions take priority): {"origin":"DAC","destination":"KUL","departure":"2026-10-13"}';
  let plan = updateFlightPlan("dac to cox's bazar" + suffix, null)!.plan;
  expect(plan.departureDate).toBeUndefined();
  plan = updateFlightPlan('22 January 2027' + suffix, plan)!.plan;
  plan = updateFlightPlan('one way, 2 adults, no children or infants' + suffix, plan)!.plan;
  expect(plan).toMatchObject({origin:'dac',destination:"cox's bazar",departureDate:'2027-01-22',tripType:'ONE_WAY',adults:2,children:0,infants:0});
  expect(flightPlanQuestion(plan)).toBeNull();
});
it('does not mistake help and booking-status questions for a new route', () => {
  expect(flightPlanningDraft('how to book')).toBeNull();
  expect(updateFlightPlan('is this flight still reserved?', null)).toBeNull();
});
it.each([
  ['Dhaka to Bangkok', 'Dhaka', 'Bangkok'],
  ['KUL to Singapore', 'KUL', 'Singapore'],
  ['São Paulo to Málaga', 'São Paulo', 'Málaga'],
  ['New York to London', 'New York', 'London'],
  ['DAC→CXB', 'DAC', 'CXB'],
  ['please find flights from Dubai to Kuala Lumpur.', 'Dubai', 'Kuala Lumpur'],
])('parses worldwide routes without guessing travel dates: %s', (text, origin, destination) => {
  expect(flightPlanningDraft(text)).toMatchObject({origin, destination, departureDate:null});
});
