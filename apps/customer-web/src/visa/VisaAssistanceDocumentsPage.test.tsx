// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VisaAssistanceDocumentsPage } from './VisaAssistanceDocumentsPage';
const api=vi.hoisted(()=>({detail:vi.fn(),link:vi.fn(),policy:vi.fn(),list:vi.fn(),create:vi.fn(),upload:vi.fn(),access:vi.fn(),unlink:vi.fn(),saveNote:vi.fn(),submit:vi.fn(),documentDetail:vi.fn()}));
vi.mock('../services/visaService',()=>({visaService:{assistanceDetail:api.detail,assistanceLink:api.link,assistanceUnlink:api.unlink,assistanceSaveNote:api.saveNote,assistanceSubmit:api.submit}}));
vi.mock('../services/documentService',()=>({documentService:{policy:api.policy,list:api.list,create:api.create,upload:api.upload,access:api.access,detail:api.documentDetail}}));
const request={id:'request-1',requestReference:'FVA-TEST',status:'NEW',purpose:'Tourism',destinationCountryCode:'MY',expectedTravelDate:'2099-01-01',documents:[],applicants:[{travellerId:'person-1',details:{firstName:'Test',lastName:'Applicant',documentType:'PASSPORT',documentNumber:'TEST'}}]};
async function open(name='Test Applicant',query=''){render(<MemoryRouter initialEntries={['/app/visa/assistance/request-1/documents'+query]}><Routes><Route path="/app/visa/assistance/:requestId/documents" element={<VisaAssistanceDocumentsPage/>}/><Route path="/app/visa/assistance/:requestId/payment" element={<h1>Payment destination</h1>}/></Routes></MemoryRouter>);await screen.findByRole('heading',{name});}
beforeEach(()=>{sessionStorage.clear();vi.spyOn(window,'scrollTo').mockImplementation(()=>{});api.detail.mockResolvedValue(request);api.policy.mockResolvedValue({maxUploadMb:1,acceptedTypes:['application/pdf','image/jpeg','image/png']});api.list.mockResolvedValue([]);api.link.mockResolvedValue(request);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.resetAllMocks();});
describe('visa document categories',()=>{
 it('opens saved applicant details when the document vault fails and can retry',async()=>{
  api.list.mockRejectedValueOnce(new Error('Vault unavailable'));
  await open();
  expect(screen.getByRole('alert').textContent).toContain('saved document library is temporarily unavailable');
  fireEvent.click(screen.getByRole('button',{name:'Continue to review →'}));
  expect(await screen.findByRole('heading',{name:'Personal information'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Retry document services'}));
  await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 });
 it('disables uploads without a policy but retains the saved application',async()=>{
  api.policy.mockRejectedValueOnce(new Error('Policy unavailable'));
  await open();
  expect(screen.getByLabelText('Attach Passport for applicant 1').hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('New uploads are temporarily unavailable');
  expect(screen.queryByText(/Up to MB/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Tell us about your documents or anything we should know.'),{target:{value:'Keep this note'}});
  expect(screen.getByRole('button',{name:'Retry document services'}).hasAttribute('disabled')).toBe(true);
 });
 it('retains a supporting document category after retrying a failed attachment',async()=>{
  const attachment={id:'insurance-link',travellerId:'person-1',documentId:'insurance-doc',documentVersionId:'insurance-version',filename:'insurance.pdf',fileSize:1024,documentType:'OTHER',scanStatus:'UNAVAILABLE'};
  api.create.mockResolvedValue({id:'insurance-doc'});
  api.upload.mockResolvedValue({id:'insurance-doc',travellerId:'person-1',documentType:'OTHER',displayName:'Travel insurance · insurance.pdf',currentVersion:{id:'insurance-version'}});
  api.link.mockRejectedValueOnce(new Error('Attachment temporarily unavailable')).mockResolvedValueOnce({...request,documents:[attachment]});
  await open();fireEvent.click(screen.getByRole('button',{name:'Travel & accommodation'}));
  fireEvent.change(screen.getByLabelText('Attach Travel insurance for applicant 1'),{target:{files:[new File(['policy'],'insurance.pdf',{type:'application/pdf'})]}});
  const retry=await screen.findByRole('button',{name:'Retry attachment'});
  await waitFor(()=>expect(retry.hasAttribute('disabled')).toBe(false));fireEvent.click(retry);
  const category=screen.getByRole('heading',{name:'Travel insurance'}).closest('section')!;
  await waitFor(()=>expect(within(category).getByText('insurance.pdf')).toBeTruthy());
  expect(api.upload).toHaveBeenCalledTimes(1);
 });
 it('offers all document sections without making them mandatory',async()=>{await open();expect(screen.getByRole('heading',{name:'Passport'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Travel & accommodation'}));expect(screen.getByRole('heading',{name:'Travel insurance'})).toBeTruthy();expect(screen.queryByRole('heading',{name:'Passport'})).toBeNull();fireEvent.change(screen.getByRole('searchbox'),{target:{value:'marriage'}});expect(screen.getByRole('heading',{name:'Marriage certificate'})).toBeTruthy();fireEvent.change(screen.getByRole('searchbox'),{target:{value:'does-not-exist'}});expect(screen.getByRole('heading',{name:'No matching document type'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Identity & immigration'}));expect(screen.getByText(/You can continue without files/)).toBeTruthy();expect(screen.getByLabelText('Attach Passport for applicant 1').hasAttribute('multiple')).toBe(true);});
 it('checks every selected file before upload and handles multiple passport pages',async()=>{await open();const input=screen.getByLabelText('Attach Passport for applicant 1');const page1=new File(['page1'],'page1.pdf',{type:'application/pdf'});fireEvent.change(input,{target:{files:[page1,new File(['bad'],'bad.txt',{type:'text/plain'})]}});expect(await screen.findByRole('alert')).toBeTruthy();expect(api.create).not.toHaveBeenCalled();api.create.mockResolvedValue({id:'doc-1'});api.upload.mockResolvedValue({id:'doc-1',currentVersion:{id:'version-1'}});fireEvent.change(input,{target:{files:[page1,new File(['page2'],'page2.pdf',{type:'application/pdf'})]}});await waitFor(()=>expect(api.link).toHaveBeenCalledTimes(2));expect(api.upload).toHaveBeenCalledTimes(2);expect(api.create).toHaveBeenNthCalledWith(1,expect.objectContaining({travellerId:'person-1',documentType:'PASSPORT',displayName:'Passport · page1.pdf'}));});
 it('keeps files in their category and downloads the exact version or removes the attachment',async()=>{
 const attachment={id:'link-1',travellerId:'person-1',documentId:'doc-1',documentVersionId:'version-1',filename:'policy.pdf',fileSize:1024,documentType:'OTHER',scanStatus:'UNAVAILABLE'};
 api.detail.mockResolvedValue({...request,documents:[attachment]});api.list.mockResolvedValue([{id:'doc-1',travellerId:'person-1',documentType:'OTHER',displayName:'Travel insurance · policy.pdf'}]);api.access.mockResolvedValue({url:'https://example.test/signed-download'});api.unlink.mockResolvedValue(request);
 const popup={opener:null,location:{href:''},close:vi.fn()};vi.spyOn(window,'open').mockReturnValue(popup as unknown as Window);await open();fireEvent.click(screen.getByRole('button',{name:/Travel & accommodation/}));const category=screen.getByRole('heading',{name:'Travel insurance'}).closest('section')!;expect(within(category).getByText('policy.pdf')).toBeTruthy();fireEvent.click(within(category).getByRole('button',{name:'Download policy.pdf'}));await waitFor(()=>expect(api.access).toHaveBeenCalledWith('doc-1','version-1',true));expect(popup.location.href).toBe('https://example.test/signed-download');fireEvent.click(within(category).getByRole('button',{name:'Delete attachment policy.pdf'}));await waitFor(()=>expect(api.unlink).toHaveBeenCalledWith('request-1','link-1'));await waitFor(()=>expect(screen.queryByText('policy.pdf')).toBeNull());
 });
 it('saves the note before review and continues to payment without submitting',async()=>{api.saveNote.mockResolvedValue({...request,customerMessage:'Hotel booking to follow'});api.submit.mockResolvedValue({...request,status:'IN_REVIEW',customerMessage:'Hotel booking to follow'});await open();fireEvent.change(screen.getByLabelText('Tell us about your documents or anything we should know.'),{target:{value:'Hotel booking to follow'}});fireEvent.click(screen.getByRole('button',{name:'Continue to review →'}));await waitFor(()=>expect(api.saveNote).toHaveBeenCalledWith('request-1','Hotel booking to follow'));expect(await screen.findByText('Hotel booking to follow')).toBeTruthy();fireEvent.click(await screen.findByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Continue to payment →'}));expect(await screen.findByRole('heading',{name:'Payment destination'})).toBeTruthy();expect(api.submit).not.toHaveBeenCalled();});
 it('reviews all applicant information with the exact attached photo version',async()=>{
 const photo={id:'photo-link',travellerId:'person-1',documentId:'photo-doc',documentVersionId:'attached-version',filename:'portrait.jpg',fileSize:2048,documentType:'PASSPORT_PHOTO',scanStatus:'CLEAN'};
 api.detail.mockResolvedValue({...request,contactName:'Booking Contact',contactEmail:'contact@example.test',contactPhone:'+60123456789',accommodationOrHost:'Hotel address',expectedReturnDate:'2099-01-10',documents:[photo],applicants:[{travellerId:'person-1',details:{...request.applicants[0].details,middleName:'Middle',dateOfBirth:'1990-02-03',gender:'MALE',nationalityCountryCode:'BD',birthCity:'Dhaka',birthCountryCode:'BD',documentNumber:'PASSPORT12345',documentIssuingCountryCode:'BD',documentIssuedOn:'2025-01-01',documentExpiresOn:'2035-01-01',currentAddress:{addressLine1:'Current street',city:'Kuala Lumpur',countryCode:'MY'},permanentAddress:{addressLine1:'Permanent street',city:'Dhaka',countryCode:'BD'},occupation:'Engineer',employerOrSchool:'Example employer',previousVisaRefusal:'NO',notes:'Applicant note'}}]});
 api.documentDetail.mockResolvedValue({currentVersion:{id:'newer-version'},versions:[{id:'attached-version',mimeType:'image/jpeg'}]});api.access.mockResolvedValue({url:'https://example.test/private-photo'});
 await open('Test Middle Applicant');fireEvent.click(screen.getByRole('button',{name:'Continue to review →'}));const image=await screen.findByAltText('Applicant photograph of Test Middle Applicant');expect(image.getAttribute('src')).toBe('https://example.test/private-photo');expect(api.access).toHaveBeenCalledWith('photo-doc','attached-version');
 for(const value of ['PASSPORT12345','Current street','Permanent street','Example employer','Applicant note','Booking Contact','contact@example.test','Hotel address']) expect(screen.getAllByText(value,{exact:false}).length).toBeGreaterThan(0);expect(screen.getByRole('heading',{name:'Personal information'})).toBeTruthy();expect(screen.getByRole('heading',{name:'Travel plans'})).toBeTruthy();expect(screen.getByRole('button',{name:'Continue to payment →'}).hasAttribute('disabled')).toBe(true);expect(screen.getByText('Payment before submission')).toBeTruthy();
 });
 it('restores review from the URL and returns to documents',async()=>{await open('Test Applicant','?step=review');expect(screen.getByRole('heading',{name:'Personal information'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'← Back to documents'}));expect(await screen.findByRole('heading',{name:'Passport'})).toBeTruthy();});
 it('explains a blocked document window without requesting a private link',async()=>{api.detail.mockResolvedValue({...request,documents:[{id:'link-1',travellerId:'person-1',documentId:'doc-1',documentVersionId:'version-1',filename:'passport.pdf',fileSize:1024,documentType:'PASSPORT',scanStatus:'UNAVAILABLE'}]});vi.spyOn(window,'open').mockReturnValue(null);await open();fireEvent.click(screen.getByRole('button',{name:'Download passport.pdf'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('blocked the document window'));expect(api.access).not.toHaveBeenCalled();});

 it('opens saved selection and applicant details from the completed cards',async()=>{await open();fireEvent.click(screen.getByRole('link',{name:/Choose visa.*Country/}));expect(await screen.findByRole('heading',{name:'Your visa selection'})).toBeTruthy();expect(screen.getByText('Tourism')).toBeTruthy();fireEvent.click(screen.getByRole('link',{name:/Fill in the form.*Applicant/}));expect(await screen.findByRole('heading',{name:'Your saved applicant details'})).toBeTruthy();expect(screen.getByRole('article',{name:'Saved applicant 1'})).toBeTruthy();expect(screen.queryByRole('heading',{name:'Personal information'})).toBeNull();expect(screen.queryByRole('heading',{name:'Saved visa selection'})).toBeNull();fireEvent.click(screen.getByRole('link',{name:/Upload documents.*Supporting/}));expect(await screen.findByRole('heading',{name:'Passport'})).toBeTruthy();expect(screen.queryByRole('link',{name:/Payment.*Secure/})).toBeNull();});

});

