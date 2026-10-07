export type FlightPlanningDraft = { origin: string; destination: string; departureDate: string | null; dayMonth?: string };
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const place = (value: string) => value.trim().replace(/\s+/g, ' ');

/** Parse only explicit English route/date statements; never guess ambiguous dates or locations. */
export function flightPlanningDraft(text: string): FlightPlanningDraft | null {
  if (/\b(hotels?|accommodation|refund|cancel|payment|visa)\b/i.test(text)) return null;
  const forward = /\b(?:from|(?:go|fly|travel)\s+(?:from|to))\s+([\p{L}\p{M} .'-]{2,70}?)\s+to\s+([\p{L}\p{M} .'-]{2,70}?)(?=\s+(?:on|departing|for|with|in)\b|[,!?]|$)/iu.exec(text)
    ?? /^\s*([A-Z]{3})\s*(?:to|→|-)\s*([A-Z]{3})(?=\s|[,!?]|$)/i.exec(text);
  const reverse = /\b(?:visit|(?:fly|travel|go)\s+to)\s+([\p{L}\p{M} .'-]{2,70}?)\s+from\s+([\p{L}\p{M} .'-]{2,70}?)(?=\s+(?:on|departing|for|with|in)\b|[!?]|$)/iu.exec(text);
  if (!forward && !reverse) return null;
  let departureDate: string | null = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
  const natural = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?\b/i.exec(text);
  if (!departureDate && natural?.[3]) departureDate = `${natural[3]}-${String(months.indexOf(natural[2]!.toLowerCase()) + 1).padStart(2, '0')}-${natural[1]!.padStart(2, '0')}`;
  if (departureDate && (!Number.isFinite(Date.parse(departureDate)) || new Date(departureDate).toISOString().slice(0, 10) !== departureDate)) return null;
  return { origin: place(forward?.[1] ?? reverse![2]!), destination: place(forward?.[2] ?? reverse![1]!), departureDate,
    ...(!departureDate && natural && { dayMonth: `${Number(natural[1])} ${natural[2]!.toLowerCase()}` }) };
}

export function planningQuestion(text: string, draft: FlightPlanningDraft): string | null {
  const tripTypeKnown = /\b(one[ -]?way|return|round[ -]?trip)\b/i.test(text);
  const travellersKnown = /\b\d\s*(?:adult|travell?er|passenger)|\b(?:alone|just me|only me)\b/i.test(text);
  if (draft.departureDate && tripTypeKnown && travellersKnown) return null;
  const date = draft.departureDate ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(draft.departureDate)) : '';
  const title = (value: string) => value.replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase('en'));
  const route = `${title(draft.origin)} → ${title(draft.destination)}${date ? ` on ${date}` : ''}`;
  if (draft.departureDate && draft.departureDate < new Date().toISOString().slice(0, 10)) return `${route}. That date has already passed. What departure date would you like instead?`;
  const questions = [!draft.departureDate && (draft.dayMonth ? `which year is ${draft.dayMonth}` : 'what date would you like to depart'), !tripTypeKnown && 'is it one-way or return', !travellersKnown && 'how many adults, children and infants are travelling'].filter(Boolean);
  return `I can help with flights from ${route}. To find suitable options, ${questions.join(', and ')}?`;
}
