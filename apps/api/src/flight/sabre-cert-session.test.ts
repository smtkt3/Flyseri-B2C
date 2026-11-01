import {describe,it,expect,vi} from 'vitest';
import {parseConfig} from '@flyseri/config';
import {openCertServicingSession} from './sabre-cert-session.js';
const config={...parseConfig({APP_ENV:'test'}),SABRE_ENV:'CERT' as const,SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_USERNAME:'123456-TEST-AA',SABRE_PASSWORD:'private<&',SABRE_CLIENT_ID:'client',SABRE_CLIENT_SECRET:'secret',SABRE_PCC:'TEST'};
describe('isolated CERT servicing sessions',()=>{
 it('escapes credentials, uses the CERT endpoint, and closes only its own token once',async()=>{
  const http=vi.fn(async(_url:unknown,options?:RequestInit)=>new Response(String(options?.body).includes('<Action>SessionCreateRQ</Action>')?'<Envelope><Header><Security><BinarySecurityToken>ath-fixture</BinarySecurityToken></Security></Header><Body><SessionCreateRS/></Body></Envelope>':'<Envelope><Body><SessionCloseRS/></Body></Envelope>'));
  const session=await openCertServicingSession(config,http);expect(session.token).toBe('ath-fixture');await session.close();await session.close();
  expect(http).toHaveBeenCalledTimes(2);expect(http.mock.calls[0]?.[0]).toBe('https://webservices.cert.platform.sabre.com');
  expect(String(http.mock.calls[0]?.[1]?.body)).toContain('private&lt;&amp;');expect(String(http.mock.calls[1]?.[1]?.body)).toContain('ath-fixture');expect(String(http.mock.calls[1]?.[1]?.body)).not.toContain('private');
 });
 it('rejects production and SOAP faults without exposing the response or credentials',async()=>{
  const http=vi.fn(async()=>new Response('<Envelope><Body><Fault><faultstring>private failure</faultstring></Fault></Body></Envelope>'));
  await expect(openCertServicingSession({...config,APP_ENV:'production'},http)).rejects.toThrow('Approved CERT');expect(http).not.toHaveBeenCalled();
  await expect(openCertServicingSession(config,http)).rejects.toThrow('CERT session management was rejected');expect(http).toHaveBeenCalledOnce();
 });
});
