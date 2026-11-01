import {describe,it,expect,vi} from 'vitest';
import type {AppConfig} from '@flyseri/config';
import {verifySabreEmptyItinerary} from './sabre-empty-itinerary-verification.js';
import {SabreBookingManagementClient,readSabreBookingView} from './sabre-booking-management.client.js';

const config={APP_ENV:'test',SABRE_ENV:'CERT',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_PCC:'TEST',SABRE_USERNAME:'123456-TEST-AA',SABRE_PASSWORD:'fixture-password',SABRE_CLIENT_ID:'fixture-id',SABRE_CLIENT_SECRET:'fixture-secret',SABRE_REQUEST_TIMEOUT_MS:12000} as AppConfig;
const signature='TEST.TEST*AWS 0257/27OCT26 ABC123 H';
const envelope=(body:string,header='')=>new Response(`<Envelope><Header>${header}</Header><Body>${body}</Body></Envelope>`,{status:200});
function fixture(options:{retrieve?:string;itinerary?:string;warning?:boolean;closeFailure?:boolean}={}){
  const requests:string[]=[];
  const http=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    const body=String(init?.body);requests.push(body);
    if(body.includes('<SessionCreateRQ'))return envelope('<SessionCreateRS><Success/></SessionCreateRS>','<Security><BinarySecurityToken>fixture-token</BinarySecurityToken></Security>');
    if(body.includes('<SessionCloseRQ'))return options.closeFailure?envelope('<Fault/>'):envelope('<SessionCloseRS version="1" status="Approved"/>');
    const screen=body.includes('<HostCommand>*I</HostCommand>')?options.itinerary??'\u0087NO ITIN\u0087':options.retrieve??signature;
    return envelope(`<SabreCommandLLSRS><ApplicationResults status="Complete">${options.warning?'<Warning/>':''}</ApplicationResults><Response>${Buffer.from(screen).toString('base64')}</Response></SabreCommandLLSRS>`);
  });
  return {http,requests};
}
describe('independent empty itinerary proof',()=>{
  it('binds the host agency signature, exact no-itinerary display and closed isolated session',async()=>{
    const {http,requests}=fixture();const proof=await verifySabreEmptyItinerary(config,'ABC123',http);
    expect(proof).toMatchObject({pnr:'ABC123',pcc:'TEST',source:'SABRE_CERT_HOST_DISPLAY',noActiveItinerary:true,sessionClosed:true});
    expect(proof.retrieveSha256).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(proof)).not.toMatch(/password|fixture-token|AWS/);
    expect(requests).toHaveLength(4);
    expect(requests.filter(body=>body.includes('<HostCommand>')).map(body=>body.match(/<HostCommand>(.*?)<\/HostCommand>/)?.[1])).toEqual(['*ABC123','*I']);
    expect(requests.join('')).not.toMatch(/<EndTransaction|<Cancel|<DesignatePrinter/);
  });
  it.each([
    {retrieve:'*ABC123\nOTHER.OTHER*AWS 0257/27OCT26 ABC123 H'},
    {retrieve:'TEST.TEST*AWS 0257/27OCT26 XYZ789 H'},
    {itinerary:'NO ITIN\n1 BG0433 HK1 DAC CXB'},
    {itinerary:'UNABLE TO RETRIEVE'},
    {warning:true},
    {closeFailure:true},
  ])('fails closed and still closes the session for ambiguous evidence %j',async(options)=>{
    const {http,requests}=fixture(options);await expect(verifySabreEmptyItinerary(config,'ABC123',http)).rejects.toThrow();
    expect(requests.at(-1)).toContain('<SessionCloseRQ');
    expect(requests.filter(body=>body.includes('<SessionCreateRQ'))).toHaveLength(1);
  });
  it('rejects commands or production without a network call',async()=>{
    const {http}=fixture();await expect(verifySabreEmptyItinerary(config,'ABC123;ET',http)).rejects.toThrow();
    await expect(verifySabreEmptyItinerary({...config,APP_ENV:'production'},'ABC123',http)).rejects.toThrow();expect(http).not.toHaveBeenCalled();
  });
});
describe('terminal booking and host evidence together',()=>{
  const number='9971234567890';
  const booking=()=>({bookingId:'ABC123',travelers:[{givenName:'Synthetic',surname:'Test'}],flightTickets:[{number,ticketingPcc:'TEST',ticketStatusName:'Refunded/Exchanged',allCoupons:[{couponStatus:'Refunded'}]}]});
  it('keeps omitted lists incomplete until independent proof is verified',async()=>{
    const raw=booking();expect(readSabreBookingView(raw).view.cancellationCheckComplete).toBe(false);
    const {http}=fixture();const client=new SabreBookingManagementClient(config,{token:async()=>'fixture-token'} as never,vi.fn(async(url,init)=>String(url).endsWith('/getBooking')?new Response(JSON.stringify(raw)):http(url,init)));
    expect(await client.verifyTerminalEmptyItinerary('ABC123','ABC123','REFUND',[number])).toMatchObject({view:{cancellationCheckComplete:true,flights:[]},proof:{noActiveItinerary:true}});
  });
  it.each(['ACTIVE','OTHER_PCC','OTHER_TICKET','OTHER_BOOKING','ACTIVE_FLIGHT','MALFORMED_FLIGHTS','UNREFUNDED_COUPON'])('rejects %s before opening a host session',async(scenario)=>{
    const raw:any=booking();
    if(scenario==='ACTIVE')raw.flightTickets[0].ticketStatusName='Issued';
    if(scenario==='OTHER_PCC')raw.flightTickets[0].ticketingPcc='OTHR';
    if(scenario==='OTHER_TICKET')raw.flightTickets[0].number='9971234567891';
    if(scenario==='OTHER_BOOKING')raw.bookingId='XYZ789';
    if(scenario==='ACTIVE_FLIGHT')raw.allSegments=[{type:'FLIGHT'}];
    if(scenario==='MALFORMED_FLIGHTS')raw.flights=null;
    if(scenario==='UNREFUNDED_COUPON')raw.flightTickets[0].allCoupons=[{couponStatus:'Okay'}];
    const http=vi.fn(async()=>new Response(JSON.stringify(raw)));const client=new SabreBookingManagementClient(config,{token:async()=>'fixture-token'} as never,http);
    await expect(client.verifyTerminalEmptyItinerary('ABC123','ABC123','REFUND',[number])).rejects.toThrow();expect(http).toHaveBeenCalledOnce();
  });
});
