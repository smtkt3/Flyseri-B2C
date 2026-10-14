import type { AircraftCabinLayout, AircraftSeat, AircraftSeatMapData, FlightOffer } from '@flyseri/types';
type Row=Record<string,unknown>;
const object=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const list=(value:unknown,max=1000):Row[]=>Array.isArray(value)&&value.length<=max?value.map(object):[];
const text=(value:unknown,max=120)=>typeof value==='string'&&value.length<=max?value:'';
const strings=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&item.length<=120).slice(0,100):[];
const segmentsOf=(offer:FlightOffer)=>(offer.multiCityLegs??[offer.outbound,...(offer.inbound?[offer.inbound]:[])]).flatMap(leg=>leg.segments);

/** Sabre Get Seats Agency 3.1 schema, /v3/offers/getseats/byReservationPayload. */
export function seatMapPayload(offer:FlightOffer,count:number,segmentIndex:number,passengerIndex:number) {
  const segments=segmentsOf(offer);
  if(!segments[segmentIndex]||count<1||count>9||passengerIndex<0||passengerIndex>=count||segments.length>60)throw new Error('Invalid seat map context');
  return {
    returnSeatMapsOnlyForSegmentRefs:[`segment-${segmentIndex+1}`],returnSeatOffersOnlyForPassengerRefs:[`passenger-${passengerIndex+1}`],
    currencyCode:offer.currency,isCheckinMode:false,
    segments:segments.map((segment,index)=>{
      if(!segment.bookingClass||segment.operatingCarrier&&segment.operatingCarrier!==segment.marketingCarrier)throw new Error('Operating flight or booking class unavailable');
      return {id:`segment-${index+1}`,bookingAirlineCode:segment.marketingCarrier,bookingFlightNumber:segment.flightNumber,bookingClassCode:segment.bookingClass,
        departureAirportCode:segment.origin,arrivalAirportCode:segment.destination,departureDate:segment.departureAt.slice(0,10),departureTime:segment.departureAt.slice(11,16),
        arrivalDate:segment.arrivalAt.slice(0,10),arrivalTime:segment.arrivalAt.slice(11,16),...(segment.aircraftTypeCode?{aircraftCode:segment.aircraftTypeCode}:{})};
    }),passengers:Array.from({length:count},(_,index)=>({id:`passenger-${index+1}`,passengerType:'ADT'})),
  };
}

export function readSeatMaps(raw:unknown,offer:FlightOffer,segmentIndex:number,passengerIndex:number,expiresAt:string):AircraftSeatMapData[] {
  const envelope=object(raw),response=object(envelope.response);
  if(list(envelope.errors,30).length||!Array.isArray(response.seatMaps))throw new Error('Seat maps unavailable');
  const segment=segmentsOf(offer)[segmentIndex];if(!segment)throw new Error('Flight missing');
  const segmentRef=`segment-${segmentIndex+1}`,passengerRef=`passenger-${passengerIndex+1}`;
  const prices=new Map(list(response.priceDefinitions).map(value=>[text(value.id),value]));
  const items=new Map([...list(response.offerItems),...list(response.displayOnlyItems)].map(value=>[text(value.id),value]));
  const supplierExpiry=Date.parse(text(response.offerExpirationDateTime));
  const until=new Date(Math.min(Date.parse(expiresAt),Number.isFinite(supplierExpiry)?supplierExpiry:Infinity)).toISOString();
  return list(response.seatMaps,60).filter(map=>map.segmentRef===segmentRef).flatMap((map,mapIndex)=>{
    const decks=new Map<string,AircraftCabinLayout[]>();
    list(map.cabinCompartments,20).forEach((compartment,cabinIndex)=>{
      const layout=object(compartment.cabinLayout),providerColumns=list(layout.columns,20);
      const columnIds=providerColumns.map(column=>text(column.id,2));
      if(!columnIds.length||columnIds.some(column=>! /^[A-Z0-9]{1,2}$/.test(column))||new Set(columnIds).size!==columnIds.length)return;
      const aislePairs=providerColumns.flatMap((column,index)=>index<providerColumns.length-1&&strings(column.position).includes('A')&&strings(providerColumns[index+1]!.position).includes('A')?[index]:[]);
      // Adjacent aisle pairs overlap in some premium configurations: do not fabricate their geometry.
      if(aislePairs.some((index,position)=>position>0&&index===aislePairs[position-1]!+1))return;
      if(columnIds.length>3&&!aislePairs.length)return;
      const columns:(string|null)[]=columnIds.flatMap((column,index)=>aislePairs.includes(index)?[column,null]:[column]);
      const missing=new Set(strings(layout.missingSeats));
      const missingRows=new Set(Array.isArray(layout.missingRowNumbers)?layout.missingRowNumbers:[]);
      const inRanges=(value:unknown,row:number)=>list(value,30).some(range=>typeof range.firstRow==='number'&&typeof range.lastRow==='number'&&row>=range.firstRow&&row<=range.lastRow);
      const rows=list(compartment.seatRows,200).filter(row=>Number.isInteger(row.row)&&Number(row.row)>0&&!missingRows.has(row.row)).map(row=>{
        const number=String(row.row),seats:Record<string,AircraftSeat>={};
        list(row.seats,20).forEach(seat=>{
          const column=text(seat.column,2),label=number+column;
          if(!columnIds.includes(column)||missing.has(label)||seat.occupationStatusCode==='Q')return;
          const references=[...strings(seat.offerItemRefIds),...strings(seat.displayOnlyItemRefIds)];
          const quoted=references.flatMap(ref=>{
            const item=items.get(ref);if(!item||strings(item.passengerRefs).length!==1||strings(item.passengerRefs)[0]!==passengerRef||strings(item.segmentRefs).length!==1||strings(item.segmentRefs)[0]!==segmentRef)return [];
            const definition=prices.get(text(item.priceDefinitionRef)),amount=text(object(definition?.totalPrice).amount,32),currency=text(definition?.currencyCode,3);
            return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)&&/^[A-Z]{3}$/.test(currency)&&currency===offer.currency?[{amount,currency}]:[];
          }).sort((a,b)=>Number(a.amount)-Number(b.amount));
          const status:AircraftSeat['status']=seat.isOperative===false?'BLOCKED':seat.occupationStatusCode==='F'?'AVAILABLE':seat.occupationStatusCode==='O'?'OCCUPIED':seat.occupationStatusCode?'BLOCKED':'UNKNOWN';
          seats[column]={id:`${segmentRef}:${mapIndex}:${cabinIndex}:${label}`,label,status,characteristics:list(seat.characteristics,40).map(value=>text(value.description)).filter(Boolean),...(quoted[0]?{price:quoted[0]}:{})};
        });
        return {number,wing:inRanges(layout.wingRowPosition,Number(row.row)),facilities:[...new Set([...list(row.characteristics,20).map(value=>text(value.description)).filter(Boolean),...(inRanges(layout.exitRowPosition,Number(row.row))?['Exit row']:[])])],seats};
      }).sort((a,b)=>Number(a.number)-Number(b.number));
      if(!rows.length)return;
      const deck=text(layout.deckCode,10)||'main';
      decks.set(deck,[...(decks.get(deck)??[]),{id:`cabin-${mapIndex}-${cabinIndex}`,name:text(compartment.cabinName)||`Cabin ${text(compartment.cabinCode,3)||cabinIndex+1}`,columns,rows}]);
    });
    const returnedSegment=list(response.segments,60).find(value=>value.id===segmentRef);
    const returnedLegs=list(returnedSegment?.flightLegs,10);
    const returnedLeg=returnedLegs.find(value=>value.id===map.flightLegRef)??(returnedLegs.length===1?returnedLegs[0]:undefined);
    const aircraft=text(returnedLeg?.aircraftCode,6);
    return decks.size?[{flightLabel:`${segment.marketingCarrier} ${segment.flightNumber} · ${segment.origin} → ${segment.destination}`,aircraftName:aircraft?`Aircraft ${aircraft}`:undefined,expiresAt:until,viewOnly:true,decks:[...decks].map(([id,cabins])=>({id,name:id==='main'?'Cabin':`Deck ${id}`,cabins}))}]:[];
  });
}
