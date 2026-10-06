import type { FlightServicePreferences } from '@flyseri/types';
import { BoundedSelect } from '../components/BoundedSelect';

export const emptyServicePreferences = (): FlightServicePreferences => ({ meal: 'NONE', baggage: 'NONE', wheelchair: 'NONE', assistance: 'NONE', note: '' });
export const hasServiceRequest = (value: FlightServicePreferences) => value.meal !== 'NONE' || value.baggage !== 'NONE' || value.wheelchair !== 'NONE' || value.assistance !== 'NONE' || !!value.note.trim();
const options = {
  meal: { NONE: 'No meal preference', VEGETARIAN: 'Vegetarian meal', VEGAN: 'Vegan meal', HALAL: 'Halal meal', GLUTEN_FREE: 'Gluten-free meal' },
  baggage: { NONE: 'Keep included allowance', EXTRA_CHECKED: 'Request extra checked baggage' },
  wheelchair: { NONE: 'No wheelchair assistance', AIRPORT: 'Wheelchair for airport distances', STAIRS: 'Assistance with distances and stairs', TO_SEAT: 'Assistance to the aircraft seat' },
  assistance: { NONE: 'No additional assistance', HEARING: 'Hearing assistance', VISION: 'Vision assistance' },
};
const labels = { meal: 'Meal preference', baggage: 'Baggage request', wheelchair: 'Wheelchair assistance', assistance: 'Other assistance' };
type OptionKey = keyof typeof options;
export function serviceRequestSummary(value: FlightServicePreferences) {
  return [...(Object.keys(options) as OptionKey[]).flatMap(key => value[key] === 'NONE' ? [] : [(options[key] as Record<string, string>)[value[key]]]), value.note.trim()].filter(Boolean).join(' · ');
}
export function FlightServiceRequestFields({ value, onChange, disabled, label }: {
  value: FlightServicePreferences; onChange: (update: Partial<FlightServicePreferences>) => void; disabled: boolean; label: string;
}) {
  return <fieldset className="flight-service-request-person" disabled={disabled}>
    <legend>{label}</legend><div className="guest-checkout-fields two">
      {(Object.keys(options) as OptionKey[]).map(key => <label key={key}>{labels[key]}<BoundedSelect disabled={disabled} ariaLabel={labels[key]} value={value[key]} placeholder={`Select ${labels[key].toLocaleLowerCase()}`} options={Object.entries(options[key]).map(([code,name])=>({value:code,label:name}))} onChange={selection=>onChange({[key]:selection} as Partial<FlightServicePreferences>)}/></label>)}
      <label className="flight-service-request-note">Additional request (optional)<textarea value={value.note} maxLength={300} rows={2}
        placeholder="Describe the service you would like us to arrange" onChange={event => onChange({ note: event.target.value })} /><small>{value.note.length}/300</small></label>
    </div>
  </fieldset>;
}
