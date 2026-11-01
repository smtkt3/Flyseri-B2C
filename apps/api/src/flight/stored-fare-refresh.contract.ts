/** Bounded native-price computation/retention, independent of ticket issuance. */
export function buildStoredFarePriceRequest(carrier:string,retain=false){
 if(!/^[A-Z0-9]{2}$/.test(carrier))throw Error('Invalid issuing carrier');
 return `<OTA_AirPriceRQ ReturnHostCommand="false" Version="2.17.0" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><PriceRequestInformation Retain="${retain}"><OptionalQualifiers><FlightQualifiers><VendorPrefs><Airline Code="${carrier}"/></VendorPrefs></FlightQualifiers><PricingQualifiers><PassengerType Code="ADT" Quantity="1"/></PricingQualifiers></OptionalQualifiers></PriceRequestInformation></OTA_AirPriceRQ>`;
}
export function verifyStoredFarePrice(raw:any,expected:{amount:string;currency:string}){
 if(raw?.ApplicationResults?.['@_status']!=='Complete'||raw.ApplicationResults.Error)throw Error('Price computation did not complete');
 const totals:any[]=[];
 function walk(value:any){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(key==='TotalFare')totals.push(item);else walk(item);}}
 walk(raw);
 const cents=(amount:unknown)=>{if(typeof amount!=='string'||!/^\d{1,8}(?:\.\d{1,2})?$/.test(amount))throw Error('Invalid quote amount');const [whole,fraction='']=amount.split('.');return BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));};
 if(totals.length!==1||totals[0]?.['@_CurrencyCode']!==expected.currency||cents(totals[0]?.['@_Amount'])!==cents(expected.amount))throw Error('Current price differs from the approved paid amount; no commit or ticket is permitted');
 return {amount:expected.amount,currency:expected.currency};
}
