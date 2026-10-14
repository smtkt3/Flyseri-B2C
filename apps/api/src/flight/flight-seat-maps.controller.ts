import { Controller, Get, Header, Inject, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import type { FlightSeatMapResponse } from '@flyseri/types';
import { CurrentUser, CustomerAuthGuard } from '../customer/auth.js';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { APP_CONFIG } from '../tokens.js';
import { ApiException } from '../api-exception.js';
import { BookingIntentService } from './booking-intent.service.js';
import { SabreAuthService } from './sabre-auth.service.js';
import { FlightRateGuard } from './flight-rate.guard.js';
import { readSeatMaps, seatMapPayload } from './sabre-seat-map.contract.js';

@Controller('flights/booking-intents')
@UseGuards(CustomerAuthGuard,FlightRateGuard)
export class FlightSeatMapsController {
  private readonly cache=new Map<string,{until:number;value:Promise<FlightSeatMapResponse>}>();
  constructor(@Inject(APP_CONFIG)private readonly config:AppConfig,@Inject(BookingIntentService)private readonly intents:BookingIntentService,@Inject(SabreAuthService)private readonly auth:SabreAuthService|undefined){}
  @Get(':id/seat-map') @Header('Cache-Control','no-store')
  async seatMap(@CurrentUser()user:AuthenticatedUserContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Query('segment')segment='0',@Query('passenger')passenger='0',@Req()request:ContextRequest) {
    if(!/^\d{1,2}$/.test(segment)||!/^\d$/.test(passenger))throw new ApiException('VALIDATION_ERROR','Choose a valid flight and traveler.',400);
    const intent=await this.intents.detail(user.customerId,id);
    if(intent.status!=='READY_FOR_PAYMENT'||!intent.expiresAt||Date.parse(intent.expiresAt)<=Date.now())throw new ApiException('OFFER_EXPIRED','Refresh your flight price before viewing seats.',410);
    if(!intent.travellerIds[Number(passenger)])throw new ApiException('VALIDATION_ERROR','Choose a traveler from this booking.',400);
    if(!this.auth||this.config.SABRE_ENV!=='CERT'||this.config.SABRE_BASE_URL!=='https://api.cert.platform.sabre.com')throw new ApiException('DEPENDENCY_UNAVAILABLE','Seat maps are not available for this flight right now.',503);
    if(!intent.searchRequest||intent.searchRequest.children||intent.searchRequest.infants)throw new ApiException('DEPENDENCY_UNAVAILABLE','Please contact our team for seats for this passenger combination.',503);
    const key=JSON.stringify([user.customerId,id,intent.validatedAt,segment,passenger]);
    const now=Date.now();for(const [key,entry]of this.cache)if(entry.until<=now)this.cache.delete(key);
    const previous=this.cache.get(key);
    if(previous&&previous.until>now)return {success:true,data:await previous.value,requestId:request.requestId};
    while(this.cache.size>=40)this.cache.delete(this.cache.keys().next().value!);
    const until=Math.min(now+120000,Date.parse(intent.expiresAt));
    const value=(async():Promise<FlightSeatMapResponse>=>{
      try {
        const payload=seatMapPayload(intent.selectedOffer,intent.travellerIds.length,Number(segment),Number(passenger));
        const token=await this.auth!.token();
        // Official Agency 3.1 payload operation. Read-only: no assignments, PNR mutation or charges.
        const response=await fetch(`${this.config.SABRE_BASE_URL}/v3/offers/getseats/byReservationPayload`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(Math.min(this.config.SABRE_REQUEST_TIMEOUT_MS,20000)),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});
        if(!response.ok||Number(response.headers.get('content-length'))>4000000)throw new Error('Seat provider unavailable');
        const raw=await response.text();if(raw.length>4000000)throw new Error('Seat response too large');
        const maps=readSeatMaps(JSON.parse(raw),intent.selectedOffer,Number(segment),Number(passenger),new Date(until).toISOString());
        return {maps,expiresAt:new Date(until).toISOString(),viewOnly:true,...(!maps.length?{message:'The airline has not supplied a supported seat layout for this flight.'}:{})};
      } catch {
        this.cache.delete(key);
        throw new ApiException('DEPENDENCY_UNAVAILABLE','The airline seat map is unavailable. You can continue without choosing a seat.',503);
      }
    })();
    this.cache.set(key,{until,value});
    void value.catch(()=>{if(this.cache.get(key)?.value===value)this.cache.delete(key);});
    return {success:true,data:await value,requestId:request.requestId};
  }
}
