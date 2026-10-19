import type { FlightConnection } from './flightTransfers';

// Transfer policies are separate from baggage allowance. Never infer ticketing from a fare or PNR.
const checkedAt='2026-10-18';
const reviewUntil='2027-01-16';
type Source={name:string;url:string};
const sources:Record<string,Source>={
  SQ:{name:'Singapore Airlines',url:'https://www.singaporeair.com/sg/en/plan-travel/destinations/'},
  QR:{name:'Qatar Airways',url:'https://www.qatarairways.com/en-sg/offers/qatar-stopover.html'},
  CZ:{name:'China Southern',url:'https://www.csair.com/mcms/mcms/MY/en/2025/20250103_1/index.html'},
  CX:{name:'Cathay Pacific',url:'https://www.cathaypacific.com/cx/en_ID/check-in/check-in-for-connecting-flight.html'},
  EK:{name:'Emirates',url:'https://www.emirates.com/english/before-you-fly/dubai-international-airport/transferring-between-terminals/'},
  FZ:{name:'flydubai',url:'https://www.flydubai.com/en/flying-with-us/baggage/check-in-baggage/'},
  TK:{name:'Turkish Airlines',url:'https://www.turkishairlines.com/en-es/any-questions/transfer-transit-passengers/'},
  MH:{name:'Malaysia Airlines',url:'https://www.malaysiaairlines.com/us/en/travel-info/check-in.html'},
  TG:{name:'Thai Airways',url:'https://www.thaiairways.com/en-th/content/baggage/special-baggage/'},
  AI:{name:'Air India',url:'https://www.airindia.com/in/en/destinations/alliances-and-partnerships.html'},
  '6E':{name:'IndiGo',url:'https://www.goindigo.in/baggage/baggage-transfer.html'},
  ID:{name:'Batik Air Indonesia',url:'https://help.batikair.com/article/741'},
  AK:{name:'AirAsia',url:'https://www.airasia.com/blog/fly-thru/'},
  AA_CUSTOMS:{name:'AirAsia',url:'https://support.airasia.com/s/article/What-happens-to-my-baggage-if-I-have-an-onward-flight-en'},
  LH:{name:'Lufthansa',url:'https://www.lufthansa.com/ro/en/freigepaeck-regeln.solo_continue'},
  KL:{name:'KLM',url:'https://www.klm.com/information/airport/transfers'},
  BA:{name:'British Airways',url:'https://www.britishairways.com/content/information/help/faq/baggage/stop-overs-and-connections'},
  PG:{name:'Bangkok Airways',url:'https://www.bangkokair.com/through-check-in'},
  VN:{name:'Vietnam Airlines',url:'https://www.vietnamairlines.com/us/en/help-desk/common-topics/Baggage/support-baggage-for-connecting-flights'},
  AUH:{name:'Zayed International Airport',url:'https://www.zayedinternationalairport.ae/en/flights-and-check-in/connecting-at-auh/baggage-transfer'},
};
const airAsia=new Set(['AK','FD','D7','QZ','Z2','XJ','KT']);
export interface ConnectionTransferAdvice {
  kind:'CONFIRMED'|'NORMAL'|'AVAILABLE'|'RECHECK'|'SELF_TRANSFER'|'CHECK';
  title:string;condition:string;detail:string;
  requiresCollection:boolean;
  source?:Source;checkedAt?:string;
}
type Directory=ReadonlyMap<string,string>|null;

/** Runs for every carrier. Only reviewed route/operator combinations get policy guidance. */
export function connectionTransferAdvice(connection:FlightConnection,directory:Directory,now=new Date()):ConnectionTransferAdvice {
  const c=connection;
  const make=(kind:ConnectionTransferAdvice['kind'],title:string,condition:string,detail:string,sourceKey?:string):ConnectionTransferAdvice=>({
    kind,title,condition,detail,requiresCollection:kind==='RECHECK'||kind==='SELF_TRANSFER',
    ...(sourceKey?{source:sources[sourceKey],checkedAt}:{}),
  });
  if(c.airportChange)return make('SELF_TRANSFER','Self-transfer · change airports','Collect bags & check in again',`Travel from ${c.arrivalAirport} to ${c.departureAirport} yourself. Arrange baggage collection, transport and the entry permission needed for both airports before booking.`);
  if(c.selfTransfer)return make('SELF_TRANSFER','Self-transfer','Separate connection arrangements','The supplier identifies this as a self-transfer. Arrange the next check-in yourself and confirm baggage collection and entry permission before booking.');
  if(c.baggageTransfer==='RECHECK_REQUIRED')return make('RECHECK','Collect & recheck baggage','Supplier instruction','The supplier requires you to collect your checked bags and check them in again for the next flight. Allow time for immigration, customs and check-in.');

  const today=now.toISOString().slice(0,10);
  const fresh=today>=checkedAt&&today<=reviewUntil&&Number.isFinite(Date.parse(c.arrivalAt))&&/^\d{4}-\d{2}-\d{2}T/.test(c.arrivalAt)&&c.arrivalAt.slice(0,10)>=checkedAt&&c.arrivalAt.slice(0,10)<=reviewUntil;
  const via=directory?.get(c.arrivalAirport),from=directory?.get(c.originAirport),to=directory?.get(c.destinationAirport);
  const internationalArrival=Boolean(via&&from&&from!==via);
  const internationalDeparture=Boolean(via&&to&&to!==via);
  const domesticOnward=Boolean(via&&to===via);
  const sameOperator=c.incomingOperator===c.outgoingOperator;
  // Local customs collection can still apply when bags have been tagged to the final destination.
  if(fresh&&internationalArrival&&domesticOnward) {
    if(via==='IN'&&c.incomingOperator==='6E')return make('RECHECK','Collect & recheck baggage','Customs at the first Indian airport','On arrival from abroad, collect your bags for Indian customs and drop them at the domestic check-in counter, including when your onward flight is with IndiGo.','6E');
    if(via==='ID'&&c.incomingOperator==='ID')return make('RECHECK','Collect & recheck baggage','Customs before the domestic connection','Batik Air Indonesia requires baggage collection and customs clearance when connecting from an international arrival to a domestic flight.','ID');
    if(['IN','ID','PH'].includes(via!)&&airAsia.has(c.incomingOperator))return make('RECHECK','Collect & recheck baggage','Customs before the domestic connection','Collect your bags for customs on this international-to-domestic connection. With Fly-Thru, follow the airline’s instructions for handing bags back after customs.','AA_CUSTOMS');
  }
  if(c.baggageTransfer==='THROUGH_CHECKED')return make('CONFIRMED','Baggage transferred','Confirmed by supplier','The supplier confirms baggage transfer for this connection. Follow any local customs instructions; through-checking does not establish transit-visa eligibility.');

  const wait=Date.parse(c.departureAt)-Date.parse(c.arrivalAt);
  const shortConnection=Number.isFinite(wait)&&wait>0&&wait<86400000;
  const internationalConnection=internationalArrival&&internationalDeparture;
  const normal=(key:string,detail:string,condition='With one through-ticket')=>make('NORMAL','Baggage normally transferred',condition,`${detail} Confirm that this fare qualifies before booking. At departure, check that your baggage tag shows the final destination.`,key);
  const available=(key:string,detail:string,condition='On an eligible through-ticket')=>make('AVAILABLE','Through-check available',condition,`${detail} Confirm that this booking qualifies before purchase; the supplier has not confirmed the baggage handoff.`,key);
  if(fresh&&shortConnection&&internationalConnection) {
    if(sameOperator) {
      switch(c.incomingOperator) {
        case 'SQ':if(c.arrivalAirport==='SIN')return normal('SQ','Singapore Airlines normally transfers checked bags on a single Singapore Airlines itinerary through Singapore.');break;
        case 'QR':if(c.arrivalAirport==='DOH')return normal('QR','Qatar Airways advises that checked bags cannot be collected during Doha transits under 24 hours. Keep the items you need during transit in your cabin bag.');break;
        case 'CZ':if(c.arrivalAirport==='CAN')return available('CZ','China Southern provides through-ticket connection procedures for international transfers in Guangzhou. Confirm through-tagging for your booking.');break;
        case 'CX':if(c.arrivalAirport==='HKG')return normal('CX','Cathay Pacific provides through-checking for connecting flights on one ticket.');break;
        case 'EK':if(c.arrivalAirport==='DXB')return normal('EK','Emirates transfers bags on a through-ticket connection in Dubai of less than 24 hours.');break;
        case 'FZ':if(c.arrivalAirport==='DXB')return normal('FZ','flydubai transfers bags to the final destination when both connecting flights are under one booking.','With one flydubai booking');break;
        case 'TK':if(c.arrivalAirport==='IST')return normal('TK','Turkish Airlines transfers bags to the final destination on a qualifying single-ticket international connection in Istanbul.');break;
        case 'TG':if(c.arrivalAirport==='BKK')return available('TG','Thai Airways publishes through-check services for connected THAI-operated flights without an intermediate stopover. Its policy does not confirm this fare’s individual transfer arrangements.');break;
        case 'MH':if(c.arrivalAirport==='KUL')return available('MH','Malaysia Airlines offers through-checking, including certain partner itineraries. Eligibility depends on the ticketing and participating carriers.');break;
        case 'AI':if(via==='IN')return available('AI','Air India offers baggage transfer on qualifying through-ticket journeys. Separate tickets and virtual interline journeys can require collection and recheck.');break;
        case 'LH':if(['FRA','MUC'].includes(c.arrivalAirport))return normal('LH','Lufthansa normally checks bags to the final destination on connecting journeys, subject to local and operational restrictions.');break;
        case 'KL':if(c.arrivalAirport==='AMS')return normal('KL','KLM normally transfers checked bags to your onward flight through Amsterdam.');break;
        case 'BA':if(['LHR','LGW'].includes(c.arrivalAirport))return normal('BA','British Airways normally checks bags through when the flights share a booking reference and ticket number.');break;
        case 'VN':if(['HAN','SGN'].includes(c.arrivalAirport))return available('VN','Vietnam Airlines provides connection baggage assistance for Vietnam Airlines-operated journeys. Confirm the through-check arrangement for your ticket.');break;
        case 'PG':if(['BKK','HKT'].includes(c.arrivalAirport))return available('PG','Bangkok Airways provides through-checking on eligible connecting tickets; its published restrictions determine eligibility.');break;
        case 'EY':if(c.arrivalAirport==='AUH')return normal('AUH','Abu Dhabi airport advises that baggage is normally transferred between flights on one ticket.');break;
      }
    }
    // An explicitly reviewed partnership, not an inferred agreement between any two airlines.
    if(['EK','FZ'].includes(c.incomingOperator)&&['EK','FZ'].includes(c.outgoingOperator)&&c.arrivalAirport==='DXB')return normal('FZ','Emirates and flydubai transfer bags to the final destination when the flights are under one booking.','With one Emirates / flydubai booking');
    if(airAsia.has(c.incomingOperator)&&airAsia.has(c.outgoingOperator)&&['KUL','DMK','BKK','CGK','DPS','MNL'].includes(c.arrivalAirport))return available('AK','AirAsia’s Fly-Thru service includes baggage transfer on eligible connections. Ordinary point-to-point bookings do not establish Fly-Thru eligibility.','Fly-Thru booking required');
  }
  return make('CHECK','Baggage transfer to confirm','Check before booking',
    !fresh?'Confirm baggage transfer for your travel date before booking. The published policy review does not cover this date.':
    'Confirm whether this ticket includes baggage transfer. Airline changes alone do not mean self-transfer: partner airlines may through-check bags, while separate tickets or customs rules may require collection and recheck.');
}
