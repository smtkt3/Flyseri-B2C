import type { FlightSearchRequest } from '@flyseri/types';
import { flightPlanningDraft } from './travel-intent.js';

/** Stored in owned conversation messages, independent of the model's context window. */
export type FlightPlan = {
  version: 1; origin?: string; destination?: string; departureDate?: string; dayMonth?: string;
  returnDate?: string; returnDayMonth?: string; tripType?: 'ONE_WAY' | 'ROUND_TRIP'; adults?: number; children?: number; infants?: number;
  cabin?: FlightSearchRequest['cabin']; currency?: string; status: 'PLANNING' | 'SEARCHED';
  awaitingAirport?: 'origin' | 'destination';
};
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const monthPattern = months.join('|');
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
const number = (value: string) => ({one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,no:0,zero:0} as Record<string,number>)[value.toLowerCase()] ?? Number(value);
export function readFlightPlan(value: unknown): FlightPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as FlightPlan;
  if (p.version !== 1 || !['PLANNING','SEARCHED'].includes(p.status)) return null;
  return p;
}
export function updateFlightPlan(text: string, previous: FlightPlan | null): { plan: FlightPlan; changed: boolean } | null {
  if (/\b(hotels?|accommodation|refund|cancel|payment|visa)\b/i.test(text)) return null;
  const route = flightPlanningDraft(text) ?? (previous && !/\b(change|destination|origin|instead|please|want|like)\b/i.test(text) && /^[\p{L} .'-]{2,60}\s+to\s+[\p{L} .'-]{2,60}$/iu.test(text.trim()) ? flightPlanningDraft(`from ${text}`) : null);
  // A mention of a flight alone is not a request to start a new search. Keep
  // booking-status questions (for example, "is this flight still reserved?")
  // on the normal booking-intent tool path.
  if (!route && !previous && !/\b(?:find|search|look for|show|compare|book)\b.*\b(?:flights?|airfares?)\b|\b(?:want|would like|wish|plan(?:ning)?)\b.{0,35}\b(?:visit|travel|fly|go)\b|\b(?:fly|travel|visit)\b.*\b(?:from|to)\b/i.test(text)) return null;
  const reset = !!route && (!previous || /\b(new trip|start over|new search)\b/i.test(text));
  const plan: FlightPlan = reset || !previous ? { version:1,status:'PLANNING' } : { ...previous,version:1 };
  const before = JSON.stringify(plan);
  if (route) { plan.origin=route.origin; plan.destination=route.destination; }
  else if (/^[\p{L} .'-]{2,60}$/u.test(text.trim()) && text.trim().split(/\s+/).length<=4 && !/\b(economy|business|first|one|return|adults?|thanks|hello|help|flights?|fly|search|continue|what|how|why|can|tell|please|you|I)\b/i.test(text)) {
    if (plan.awaitingAirport) { plan[plan.awaitingAirport]=text.trim(); delete plan.awaitingAirport; }
    else if (!plan.origin) plan.origin=text.trim();
    else if (!plan.destination) plan.destination=text.trim();
  }
  const destination = /\b(?:change (?:the )?destination to|(?:go|fly) to|to instead)\s+([\p{L} .'-]{2,60}?)(?=[,.!?]|$)/iu.exec(text);
  if (!route && destination) plan.destination=destination[1]!.trim();
  const datedParts = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(match=>({index:match.index!,date:match[0]}));
  const returnOnly = /\breturn(?:ing)? (?:on|date|is)\b/i.test(text);
  const natural = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?:\\s+(\\d{4}))?\\b`,'ig');
  for (const match of text.matchAll(natural)) {
    const dayMonth = `${match[1]!.padStart(2,'0')}-${String(months.indexOf(match[2]!.toLowerCase())+1).padStart(2,'0')}`;
    if (match[3]) datedParts.push({index:match.index!,date:`${match[3]}-${dayMonth.slice(3)}-${dayMonth.slice(0,2)}`});
    else if (returnOnly) { plan.returnDayMonth=dayMonth; delete plan.returnDate; }
    else { plan.dayMonth=dayMonth; delete plan.departureDate; }
  }
  const dates = datedParts.sort((a,b)=>a.index-b.index).map(part=>part.date);
  const pendingDayMonth = plan.dayMonth ?? plan.returnDayMonth;
  if (!dates.length && pendingDayMonth) {
    const year = /\b(20\d{2})\b/.exec(text)?.[1];
    if (year) dates.push(`${year}-${pendingDayMonth.slice(3)}-${pendingDayMonth.slice(0,2)}`);
  }
  if (!dates.length && !pendingDayMonth && plan.departureDate) {
    const year = /\b(20\d{2})\b/.exec(text)?.[1];
    if (year) dates.push(`${year}${plan.departureDate.slice(4)}`);
  }
  if (dates[0]) {
    if ((returnOnly || (!plan.dayMonth && plan.returnDayMonth)) && dates.length===1) { plan.returnDate=dates[0]; delete plan.returnDayMonth; }
    else { plan.departureDate=dates[0]; delete plan.dayMonth; if(dates[1])plan.returnDate=dates[1]; }
  }
  if (/\b(one[ -]?way)\b/i.test(text)) { plan.tripType='ONE_WAY'; delete plan.returnDate; delete plan.returnDayMonth; }
  else if (/\b(return|round[ -]?trip)\b/i.test(text)) plan.tripType='ROUND_TRIP';
  for (const [key, label] of [['adults','adults?|passengers?|travell?ers?'],['children','children|child|kids?'],['infants','infants?|babies|baby']] as const) {
    const count = new RegExp(`\\b(\\d+|one|two|three|four|five|six|seven|eight|nine|no|zero)\\s+(?:${label})\\b`,'i').exec(text);
    if(count) plan[key]=number(count[1]!);
  }
  if(plan.adults===undefined && /^[1-9]$/.test(text.trim()))plan.adults=Number(text.trim());
  if (/\b(alone|just me|only me)\b/i.test(text)) {plan.adults=1;plan.children=0;plan.infants=0;}
  if (/\bno children or infants\b/i.test(text)) { plan.children=0;plan.infants=0; }
  if (/\bpremium economy\b/i.test(text))plan.cabin='PREMIUM_ECONOMY';
  else if (/\beconomy\b/i.test(text))plan.cabin='ECONOMY';
  else if (/\bbusiness\b/i.test(text))plan.cabin='BUSINESS';
  else if (/\bfirst(?: class)?\b/i.test(text))plan.cabin='FIRST';
  const currency=/\b(MYR|BDT|USD|SGD|EUR|GBP|AUD|INR|THB|AED|SAR)\b/i.exec(text)?.[1];
  if(currency)plan.currency=currency.toUpperCase();
  const changed=!previous || reset || before!==JSON.stringify(plan);
  if(changed)plan.status='PLANNING';
  return {plan,changed};
}
export function flightPlanQuestion(p: FlightPlan): string | null {
  const questions:string[]=[];
  if(!p.origin)questions.push('Which city or airport are you departing from?');
  else if(!p.destination)questions.push('Which city or airport are you flying to?');
  if(!p.departureDate)questions.push(p.dayMonth ? `Which year would you like to travel on ${Number(p.dayMonth.slice(0,2))} ${months[Number(p.dayMonth.slice(3))-1]}?` : 'What date would you like to depart, including the year?');
  else if(!validDate(p.departureDate) || p.departureDate<new Date().toISOString().slice(0,10))questions.push('Please choose a valid future departure date.');
  if(!p.tripType)questions.push('Is it one-way or return?');
  if(p.tripType==='ROUND_TRIP' && (!p.returnDate || !validDate(p.returnDate) || (p.departureDate && p.returnDate<p.departureDate)))questions.push('What is your return date, including the year?');
  if(p.adults===undefined)questions.push('How many adults, children and infants are travelling?');
  else if(p.adults<1 || p.adults>9 || (p.children??0)<0 || (p.infants??0)<0 || p.adults+(p.children??0)+(p.infants??0)>9 || (p.infants??0)>p.adults)questions.push('Please confirm a valid passenger count (up to 9 travellers, with at least one adult).');
  return questions.length ? `${p.origin ?? '?'} → ${p.destination ?? '?'}. ${questions.join(' ')}` : null;
}
