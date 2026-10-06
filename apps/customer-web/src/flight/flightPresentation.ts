import type { FlightCabin, FlightOffer } from '@flyseri/types';

export const cabinOptions: { value: FlightCabin; label: string }[] = [
  { value: 'ECONOMY', label: 'Economy' }, { value: 'PREMIUM_ECONOMY', label: 'Premium economy' },
  { value: 'BUSINESS', label: 'Business' }, { value: 'FIRST', label: 'First' },
];
const localDateFormatter = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const currencyFormatters = new Map<string, Intl.NumberFormat>();
const travelDateFormatter = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeZone: 'UTC' });
export const travelDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? travelDateFormatter.format(new Date(`${value}T00:00:00Z`)) : 'Choose dates';
export const dateTime = (value: string) => {
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!local) return value;
  const wallTime = new Date(`${local[1]}T${local[2]}:00Z`);
  if (Number.isNaN(wallTime.valueOf())) return value;
  const displayed = localDateFormatter.format(wallTime);
  return `${displayed} ${local[3] === 'Z' ? 'UTC' : `UTC${local[3]}`}`;
};
export const money = (amount: string, currency: string) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currency} ${amount}`;
  let formatter = currencyFormatters.get(currency);
  if (!formatter) { formatter = new Intl.NumberFormat('en-MY', { style: 'currency', currency }); currencyFormatters.set(currency, formatter); if (currencyFormatters.size > 32) currencyFormatters.delete(currencyFormatters.keys().next().value!); }
  return formatter.format(value);
};
export const minutes = (value: number | null) => value === null ? '' : `${Math.floor(value / 60)}h ${value % 60}m`;
export const legsOf = (offer: FlightOffer) => offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])];
export const cabinLabel = (cabin: FlightOffer['cabin']) => cabin === 'MIXED' ? 'Mixed cabins' :
  cabinOptions.find((option) => option.value === cabin)?.label ?? 'Cabin not specified';
export const penaltySummary = (fare: FlightOffer, type: 'REFUND' | 'CHANGE') => {
  const rules = (fare.penalties ?? []).filter((rule) => rule.type === type);
  if (!rules.length) return type === 'REFUND' && fare.nonRefundable === true
    ? ['Non-refundable'] : [];
  const value = (rule: NonNullable<FlightOffer['penalties']>[number]) => !rule.allowed
    ? type === 'REFUND' ? 'Non-refundable' : 'Changes not permitted'
    : rule.amount !== null && Number(rule.amount) === 0 ? type === 'REFUND' ? 'No cancellation fee' : 'No change fee'
      : rule.amount && rule.currency ? `${type === 'REFUND' ? 'Cancellation fee' : 'Change fee'}: ${money(rule.amount, rule.currency)}`
        : type === 'REFUND' ? 'Cancellation permitted' : 'Changes permitted';
  const before = rules.find((rule) => rule.applicability === 'BEFORE');
  const after = rules.find((rule) => rule.applicability === 'AFTER');
  if (rules.length === 1) return [`${value(rules[0]!)} · ${rules[0]!.applicability === 'BEFORE' ? 'before departure' : 'after departure'}`];
  if (rules.length === 2 && before && after && before.allowed === after.allowed && before.amount === after.amount && before.currency === after.currency) return [type === 'REFUND' && !before.allowed ? 'Non-refundable'
    : type === 'CHANGE' && !before.allowed ? 'Changes not permitted' : value(before)];
  return rules.map((rule) => `${value(rule)} · ${rule.applicability === 'BEFORE' ? 'before departure' : 'after departure'}`);
};
