import {afterEach,it,expect,vi} from 'vitest';
import nodemailer from 'nodemailer';
import {parseConfig} from '@flyseri/config';
import {sendTicketSmtp} from './ticket-email.js';
import {ticketFixture} from './ticket-document.fixture.js';
afterEach(()=>vi.restoreAllMocks());
it('sends the branded PDF and inline logo through authenticated TLS SMTP without network attachments',async()=>{
 const sendMail=vi.fn(async()=>({accepted:['client@example.com'],rejected:[]})),close=vi.fn();
 const transport=vi.spyOn(nodemailer,'createTransport').mockReturnValue({sendMail,close} as never);
 const config=parseConfig({TICKET_EMAIL_ENABLED:'true',SMTP_HOST:'smtp.example.com',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_USER:'user',SMTP_PASSWORD:'secret-fixture',SMTP_FROM_EMAIL:'tickets@example.com'}),pdf=Buffer.from('%PDF-fixture');
 await sendTicketSmtp(config,'client@example.com','a'.repeat(64),ticketFixture(),pdf);
 expect(transport).toHaveBeenCalledWith(expect.objectContaining({secure:false,requireTLS:true,disableFileAccess:true,disableUrlAccess:true,tls:{minVersion:'TLSv1.2'}}));
 expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({to:'client@example.com',subject:'[CERT TEST] Your Flyseri e-ticket | TESTBG',attachments:[expect.objectContaining({content:pdf,contentType:'application/pdf',filename:'Flyseri-e-ticket-TESTBG.pdf'}),expect.objectContaining({cid:'flyseri-logo',content:expect.any(Buffer)})]}));expect(close).toHaveBeenCalledOnce();
});
it('keeps delivery disabled without configuration',async()=>{
 const transport=vi.spyOn(nodemailer,'createTransport');await expect(sendTicketSmtp(parseConfig({}),'client@example.com','a'.repeat(64),ticketFixture(),Buffer.from(''))).rejects.toThrow('configuration');expect(transport).not.toHaveBeenCalled();
});
