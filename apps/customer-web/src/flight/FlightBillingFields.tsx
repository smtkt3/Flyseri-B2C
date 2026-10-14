import type { Dispatch, SetStateAction } from 'react';
import type { FlightReservationInput } from '@flyseri/types';
import { BoundedSelect } from '../components/BoundedSelect';
import { countries } from '../trip/tripPresentation';

const autocomplete = {name:'billing name',street:'billing address-line1',city:'billing address-level2',stateProvince:'billing address-level1',postalCode:'billing postal-code'};

export function FlightBillingFields({ value, onChange, disabled, includeBilling = true }: {
  value: FlightReservationInput; onChange: Dispatch<SetStateAction<FlightReservationInput>>; disabled?: boolean; includeBilling?: boolean;
}) {
  return <div className="account-form-grid">
    <label>Booking email<input type="email" required disabled={disabled} maxLength={254} autoComplete="email" value={value.contactEmail} onChange={event=>onChange(previous=>({...previous,contactEmail:event.target.value}))}/></label>
    <label>Booking phone<input type="tel" required disabled={disabled} pattern="\+?[0-9]{7,20}" maxLength={21} autoComplete="tel" placeholder="+60123456789" value={value.contactPhone} onChange={event=>onChange(previous=>({...previous,contactPhone:event.target.value}))}/></label>
    {includeBilling && <>
      {([['name','Billing name',120],['street','Billing street address',240],['city','Billing city',120],['stateProvince','Billing state / region',120],['postalCode','Billing postcode',24]] as const).map(([key,label,maxLength])=><label key={key}>{label}<input required disabled={disabled} autoComplete={autocomplete[key]} pattern=".*\S.*" maxLength={maxLength} value={value.billingAddress[key]} onChange={event=>onChange(previous=>({...previous,billingAddress:{...previous.billingAddress,[key]:event.target.value}}))}/></label>)}
      <label>Billing country<BoundedSelect required disabled={disabled} searchable searchPlaceholder="Search countries" ariaLabel="Billing country" value={value.billingAddress.countryCode} placeholder="Select country" options={countries.map(country=>({value:country.code,label:country.name}))} onChange={countryCode=>onChange(previous=>({...previous,billingAddress:{...previous.billingAddress,countryCode}}))}/></label>
    </>}
  </div>;
}
