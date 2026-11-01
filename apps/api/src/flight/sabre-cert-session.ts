import {XMLParser} from 'fast-xml-parser';
import type {AppConfig} from '@flyseri/config';

export interface CertServicingSession {token:string;close():Promise<void>}
export type CertServicingSessionFactory=()=>Promise<CertServicingSession>;
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');

/** Dedicated CERT session per servicing request. Never share or cache ATH tokens. */
export async function openCertServicingSession(config:AppConfig,http:typeof fetch=fetch):Promise<CertServicingSession>{
 if(config.SABRE_ENV!=='CERT'||config.APP_ENV==='production'||config.SABRE_BASE_URL!=='https://api.cert.platform.sabre.com'||!config.SABRE_USERNAME||!config.SABRE_PASSWORD||!config.SABRE_PCC||!config.SABRE_CLIENT_ID||!config.SABRE_CLIENT_SECRET)throw Error('Approved CERT session configuration is required');
 const parser=new XMLParser({removeNSPrefix:true,ignoreAttributes:false,parseTagValue:false});
 async function send(action:'SessionCreateRQ'|'SessionCloseRQ',security:string,body:string){
  const envelope=`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header><MessageHeader xmlns="http://www.ebxml.org/namespaces/messageHeader"><From><PartyId>Agency</PartyId></From><To><PartyId>Sabre_API</PartyId></To><ConversationId>Flyseri.CERT.Servicing</ConversationId><Action>${action}</Action></MessageHeader>${security}</soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`;
  const response=await http('https://webservices.cert.platform.sabre.com',{method:'POST',redirect:'error',signal:AbortSignal.timeout(config.SABRE_REQUEST_TIMEOUT_MS),headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:action},body:envelope});
  if(!response.ok)throw Error('CERT session management is unavailable');
  const raw=parser.parse(await response.text());
  if(!raw?.Envelope?.Body||raw.Envelope.Body.Fault)throw Error('CERT session management was rejected');
  return raw;
 }
 const credentials=`<Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext"><UsernameToken><Username>${escape(config.SABRE_USERNAME.split('-')[0]!)}</Username><Password>${escape(config.SABRE_PASSWORD)}</Password><Organization>${escape(config.SABRE_PCC)}</Organization><Domain>DEFAULT</Domain><ClientId>${escape(config.SABRE_CLIENT_ID)}</ClientId><ClientSecret>${escape(config.SABRE_CLIENT_SECRET)}</ClientSecret></UsernameToken></Security>`;
 const created=await send('SessionCreateRQ',credentials,'<SessionCreateRQ returnContextID="true" Version="2.0.0" xmlns="http://www.opentravel.org/OTA/2002/11"/>');
 const value=created?.Envelope?.Header?.Security?.BinarySecurityToken,token=typeof value==='string'?value:value?.['#text'];
 if(typeof token!=='string'||!token||token.length>16000)throw Error('CERT session token is unavailable');
 let closed=false;
 return {token,close:async()=>{
  if(closed)return;closed=true;
  await send('SessionCloseRQ',`<Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext"><BinarySecurityToken EncodingType="Base64Binary" valueType="String">${escape(token)}</BinarySecurityToken></Security>`,'<SessionCloseRQ Version="1.0.0" xmlns="http://www.opentravel.org/OTA/2002/11"/>');
 }};
}
