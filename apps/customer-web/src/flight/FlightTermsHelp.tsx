import type {FlightOffer} from '@flyseri/types';
import {legsOf} from './flightPresentation';
import {airlineName} from './AirlineIdentity';
export function FlightTermsHelp({offer,airports}:{offer:FlightOffer;airports:Record<string,{city:string;name:string}>}) {
  const segments=legsOf(offer).flatMap(leg=>leg.segments);
  const codes=[...new Set(segments.flatMap(segment=>[segment.origin,segment.destination]))];
  const codeshares=segments.filter(segment=>segment.operatingCarrier&&segment.operatingCarrier!==segment.marketingCarrier);
  return <details className="flight-terms-help"><summary>Airports &amp; flight terms explained</summary><dl>
    {codes.map(code=><div key={code}><dt>{code}</dt><dd>{airports[code]?`${airports[code]!.name} · ${airports[code]!.city}`:'Three-letter airport code. Full airport information is not available for this result.'}</dd></div>)}
    <div><dt>Codeshare</dt><dd>Your ticket may show one airline’s flight number while another airline operates the aircraft. Follow the operating airline’s check-in instructions.{codeshares.map((segment,index)=><p key={index}>{segment.marketingCarrier} {segment.flightNumber}: operated by {airlineName(segment.operatingCarrier!)??segment.operatingCarrier}.</p>)}</dd></div>
    <div><dt>Terminal change</dt><dd>Moving between terminals at the same airport can take time and may require transport or security checks. Verified terminal assignments are not supplied in these results; confirm them with the airline before travel.</dd></div>
    <div><dt>Airport transfer</dt><dd>An airport change means traveling to a different airport between flights. Check transport time, entry requirements and baggage arrangements with the airline. A connection alone does not confirm whether bags are checked through.</dd></div>
  </dl></details>;
}
