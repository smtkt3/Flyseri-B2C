import {createHash} from 'node:crypto';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import type {AppConfig} from '@flyseri/config';

const escapeXml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const object=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const text=(value:unknown):string=>typeof value==='string'?value:typeof object(value)['#text']==='string'?object(value)['#text']:'';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export interface EmptyItineraryProof {
  source:'SABRE_CERT_HOST_DISPLAY';checkedAt:string;pnr:string;pcc:string;
  noActiveItinerary:true;sessionClosed:true;retrieveSha256:string;itinerarySha256:string;
}

/** Isolated read-only session. No caller-supplied commands, end transaction or retries. */
export async function verifySabreEmptyItinerary(config:AppConfig,pnr:string,http:typeof fetch=fetch):Promise<EmptyItineraryProof>{
  if(config.SABRE_ENV!=='CERT'||config.APP_ENV==='production'||config.SABRE_BASE_URL!=='https://api.cert.platform.sabre.com'||
    !/^[A-Z0-9]{6}$/.test(pnr)||!/^[A-Z0-9]{4}$/.test(config.SABRE_PCC??'')||
    !config.SABRE_USERNAME||!config.SABRE_PASSWORD||!config.SABRE_CLIENT_ID||!config.SABRE_CLIENT_SECRET)throw Error('CERT read-only verification unavailable');
  const parser=new XMLParser({removeNSPrefix:true,ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,processEntities:false});
  const send=async(action:'SessionCreateRQ'|'SabreCommandLLSRQ'|'SessionCloseRQ',security:string,body:string)=>{
    const envelope=`<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header><MessageHeader xmlns="http://www.ebxml.org/namespaces/messageHeader"><From><PartyId>Agency</PartyId></From><To><PartyId>Sabre_API</PartyId></To><ConversationId>Flyseri.CERT.ReadOnly.CancelVerification</ConversationId><Action>${action}</Action></MessageHeader>${security}</SOAP-ENV:Header><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    const response=await http('https://webservices.cert.platform.sabre.com',{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:action},body:envelope,signal:AbortSignal.timeout(20000),redirect:'error'});
    const xml=await response.text();
    if(!response.ok||xml.length>2_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('CERT read-only response unavailable');
    const result=object(parser.parse(xml).Envelope);
    if(object(result.Body).Fault)throw Error('CERT read-only session rejected');
    return result;
  };
  const credentials=`<Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext"><UsernameToken><Username>${escapeXml(config.SABRE_USERNAME.split('-')[0]!)}</Username><Password>${escapeXml(config.SABRE_PASSWORD)}</Password><Organization>${escapeXml(config.SABRE_PCC!)}</Organization><Domain>DEFAULT</Domain><ClientId>${escapeXml(config.SABRE_CLIENT_ID)}</ClientId><ClientSecret>${escapeXml(config.SABRE_CLIENT_SECRET)}</ClientSecret></UsernameToken></Security>`;
  const created=await send('SessionCreateRQ',credentials,'<SessionCreateRQ returnContextID="true" Version="2.0.0" xmlns="http://www.opentravel.org/OTA/2002/11"/>');
  const token=text(object(object(created.Header).Security).BinarySecurityToken);
  if(!token)throw Error('CERT read-only session unavailable');
  const security=`<Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext"><BinarySecurityToken EncodingType="Base64Binary" valueType="String">${escapeXml(token)}</BinarySecurityToken></Security>`;
  let proof:Omit<EmptyItineraryProof,'sessionClosed'>;
  try{
    const display=async(command:string)=>{
      const result=await send('SabreCommandLLSRQ',security,`<SabreCommandLLSRQ ReturnHostCommand="true" Version="2.0.0" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><Request Output="SCREEN"><HostCommand>${escapeXml(command)}</HostCommand></Request></SabreCommandLLSRQ>`);
      const data=object(object(result.Body).SabreCommandLLSRS),application=object(data.ApplicationResults);
      if(application['@_status']!=='Complete'||Object.hasOwn(application,'Error')||Object.hasOwn(application,'Warning'))throw Error('CERT host display incomplete');
      const screen=text(data.Response);
      if(!screen||screen.length>500_000)throw Error('CERT host display unavailable');
      return screen.length%4===0&&/^[A-Za-z0-9+/=]+$/.test(screen)?Buffer.from(screen,'base64').toString('utf8'):screen;
    };
    const retrieved=await display('*'+pnr);
    // The record locator must appear in the host agency signature, not just a command echo.
    const signature=new RegExp('^'+config.SABRE_PCC+'\\.'+config.SABRE_PCC+'\\*[^\\r\\n]+\\s'+pnr+'(?:\\s|$)','m');
    if(!signature.test(retrieved))throw Error('CERT host booking identity not verified');
    const itinerary=await display('*I');
    const normalized=itinerary.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim();
    if(normalized!=='NO ITIN'&&normalized!=='NO ITINERARY')throw Error('CERT host does not prove an empty itinerary');
    proof={source:'SABRE_CERT_HOST_DISPLAY',checkedAt:new Date().toISOString(),pnr,pcc:config.SABRE_PCC!,noActiveItinerary:true,retrieveSha256:hash(retrieved),itinerarySha256:hash(itinerary)};
  }finally{
    const closed=await send('SessionCloseRQ',security,'<SessionCloseRQ Version="1.0.0" xmlns="http://www.opentravel.org/OTA/2002/11"/>');
    const result=object(object(closed.Body).SessionCloseRS);
    if(result['@_status']!=='Approved'||Object.hasOwn(result,'Errors'))throw Error('CERT read-only session closure not confirmed');
  }
  return {...proof,sessionClosed:true};
}
