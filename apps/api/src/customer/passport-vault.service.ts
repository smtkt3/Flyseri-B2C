import {Inject,Injectable} from '@nestjs/common';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import type {AppConfig} from '@flyseri/config';
import type {TravellerPassport} from '@flyseri/types';
import {APP_CONFIG} from '../tokens.js';
import {ApiException} from '../api-exception.js';
import {CustomerService} from './customer.service.js';

const bucket='traveller-private-data';
@Injectable()
export class PassportVaultService {
 constructor(@Inject(APP_CONFIG) private readonly config:AppConfig,@Inject(CustomerService) private readonly customers:CustomerService) {}
 private async storage(){
  if(!this.config.SUPABASE_URL||!this.config.SUPABASE_STORAGE_SECRET_KEY||!this.config.TRAVELLER_DATA_ENCRYPTION_KEY)throw new ApiException('DEPENDENCY_UNAVAILABLE','Saved passport storage is unavailable.',503);
  const client=createClient(this.config.SUPABASE_URL,this.config.SUPABASE_STORAGE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const result=await client.storage.getBucket(bucket);
  if(result.error||!result.data||result.data.public)throw new ApiException('DEPENDENCY_UNAVAILABLE','Saved passport storage is unavailable.',503);
  return client.storage.from(bucket);
 }
 private path(customerId:string,travellerId:string){return `${customerId}/${travellerId}/passport.bin`;}
 private valid(value:TravellerPassport){const date=Date.parse(`${value.expiryDate}T00:00:00Z`);return /^[A-Z0-9]{3,30}$/.test(value.documentNumber)&&/^[A-Z]{2}$/.test(value.issuingCountryCode)&&/^\d{4}-\d{2}-\d{2}$/.test(value.expiryDate)&&Number.isFinite(date)&&new Date(date).toISOString().slice(0,10)===value.expiryDate;}
 async get(customerId:string,travellerId:string):Promise<TravellerPassport|null>{
  await this.customers.getTraveller(customerId,travellerId);
  const storage=await this.storage();const {data,error}=await storage.download(this.path(customerId,travellerId));
  if(error){if(String((error as {statusCode?:string}).statusCode)==='404'||String((error as {statusCode?:string}).statusCode)==='400'&&/not found|does not exist/i.test(error.message))return null;throw new ApiException('DEPENDENCY_UNAVAILABLE','Saved passport could not be loaded.',503);}
  try{const bytes=Buffer.from(await data.arrayBuffer());if(bytes.length<29||bytes.length>4096)throw new Error('Invalid saved passport');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(this.config.TRAVELLER_DATA_ENCRYPTION_KEY!,'hex'),bytes.subarray(0,12));decipher.setAAD(Buffer.from(this.path(customerId,travellerId)));decipher.setAuthTag(bytes.subarray(12,28));const value=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')) as TravellerPassport;if(!this.valid(value))throw new Error('Invalid passport');return value;}catch{throw new ApiException('DEPENDENCY_UNAVAILABLE','Saved passport could not be loaded.',503);}
 }
 async save(customerId:string,travellerId:string,value:TravellerPassport){
  await this.customers.getTraveller(customerId,travellerId);if(!this.valid(value)||value.expiryDate<=new Date().toISOString().slice(0,10))throw new ApiException('VALIDATION_ERROR','Enter a valid, unexpired passport.',400);
  const storage=await this.storage();const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',Buffer.from(this.config.TRAVELLER_DATA_ENCRYPTION_KEY!,'hex'),iv);cipher.setAAD(Buffer.from(this.path(customerId,travellerId)));const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  const {error}=await storage.upload(this.path(customerId,travellerId),Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{contentType:'application/octet-stream',upsert:true,cacheControl:'0'});if(error)throw new ApiException('DEPENDENCY_UNAVAILABLE','Passport details could not be saved. Please try again.',503);return {saved:true as const};
 }
 async remove(customerId:string,travellerId:string){await this.customers.getTraveller(customerId,travellerId);const storage=await this.storage();const {error}=await storage.remove([this.path(customerId,travellerId)]);if(error)throw new ApiException('DEPENDENCY_UNAVAILABLE','Saved passport could not be removed.',503);return {removed:true as const};}
 async removeOnArchive(customerId:string,travellerId:string){
  if(this.config.SUPABASE_URL&&this.config.SUPABASE_STORAGE_SECRET_KEY&&this.config.TRAVELLER_DATA_ENCRYPTION_KEY)await this.remove(customerId,travellerId);
 }
}
