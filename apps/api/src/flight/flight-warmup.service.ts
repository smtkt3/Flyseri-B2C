import {Inject,Injectable,type OnModuleInit,type OnModuleDestroy} from '@nestjs/common';
import type {AppConfig} from '@flyseri/config';
import type {RedisStore} from '@flyseri/redis';
import {APP_CONFIG,REDIS_STORE} from '../tokens.js';
import {FlightService} from './flight.service.js';
import {SabreAuthService} from './sabre-auth.service.js';
@Injectable()
export class FlightWarmupService implements OnModuleInit,OnModuleDestroy{
  private timer:ReturnType<typeof setInterval>|undefined;
  private running=false;
  private stopped=false;
  constructor(@Inject(APP_CONFIG)private readonly config:AppConfig,@Inject(REDIS_STORE)private readonly redis:RedisStore|undefined,@Inject(SabreAuthService)private readonly auth:SabreAuthService|undefined,@Inject(FlightService)private readonly flights:FlightService){}
  onModuleInit(){
    if(!this.config.SABRE_CACHE_WARMUP_ENABLED||this.config.SABRE_ENV!=='CERT'||this.config.SABRE_BASE_URL!=='https://api.cert.platform.sabre.com'||!this.auth)return;
    // A 30-second tick can miss the refresh window of a 60-second quote.
    // This only checks eligibility; supplier calls retain their existing quota.
    this.timer=setInterval(()=>void this.tick(),10000);this.timer.unref();void this.tick();
  }
  private async tick(){
    if(this.running||this.stopped)return;this.running=true;
    try{
      const redisAvailable=this.redis?await this.redis.health():false;
      if(this.config.APP_ENV==='production'&&!redisAvailable)return;
      await this.auth?.token();
      if(!this.stopped)await this.flights.warmRecentSearch(redisAvailable);
    }
    catch{/* Customer searches retain their existing fallback and error handling. */}
    finally{this.running=false;}
  }
  onModuleDestroy(){this.stopped=true;if(this.timer)clearInterval(this.timer);}
}
