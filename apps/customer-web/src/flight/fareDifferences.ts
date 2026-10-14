import type { FlightOffer } from '@flyseri/types';
import { legsOf, penaltySummary } from './flightPresentation';

export function fareDifferences(fare:FlightOffer,baseline:FlightOffer) {
  const baggage=(value:FlightOffer)=>JSON.stringify(legsOf(value).flatMap(leg=>leg.segments).map((_,index)=>(value.baggageAllowances??[])
    .filter(item=>item.availability!=='UNKNOWN'&&(!item.segmentIndexes?.length||item.segmentIndexes.includes(index)))
    .map(item=>JSON.stringify([item.type,item.availability,item.description??''])).sort()));
  const services=(value:FlightOffer)=>JSON.stringify(legsOf(value).flatMap(leg=>leg.segments).map((_,index)=>(value.amenities??[])
    .filter(item=>item.category!=='BAGGAGE'&&item.availability!=='UNKNOWN'&&(!item.segmentIndexes?.length||item.segmentIndexes.includes(index)))
    .map(item=>JSON.stringify([item.category,item.name,item.availability])).sort()));
  return {
    cabin:fare.cabin!==baseline.cabin||fare.fareBrand!==baseline.fareBrand,
    baggage:baggage(fare)!==baggage(baseline),
    flexibility:JSON.stringify(['REFUND','CHANGE'].map(type=>penaltySummary(fare,type as 'REFUND'|'CHANGE').sort()))!==JSON.stringify(['REFUND','CHANGE'].map(type=>penaltySummary(baseline,type as 'REFUND'|'CHANGE').sort())),
    services:services(fare)!==services(baseline),
  };
}
