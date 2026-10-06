// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VisaAssistanceRequestPage } from './VisaAssistanceRequestPage';
const api = vi.hoisted(() => ({ create: vi.fn(), detail: vi.fn(), list: vi.fn(), createTraveller: vi.fn(), addTraveller: vi.fn() }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { email: 'applicant@example.com', user_metadata: {} } } }) }));
vi.mock('../services/tripService', () => ({ tripService: { detail: api.detail, addTraveller: api.addTraveller } }));
vi.mock('../services/travellerService', () => ({ travellerService: { list: api.list, create: api.createTraveller } }));
vi.mock('../services/visaService', () => ({ visaService: { createAssistanceRequest: api.create } }));
const person = { id: 'person-1', legalFirstName: 'Ain', legalLastName: 'Rahman', dateOfBirth: '1990-01-01', gender: 'FEMALE', nationalityCountryCode: 'BD' };
async function open() {
 render(<MemoryRouter initialEntries={[{pathname:'/app/visa/assistance',state:{visaAssistanceDraft:{tripId:'trip-1',destinationCountryCode:'MY',expectedTravelDate:'2099-01-01',purpose:'Tourism',travellerIds:[person.id]}}}]}><VisaAssistanceRequestPage /></MemoryRouter>);
 await screen.findByRole('heading', {name:'Ain Rahman'});
 return screen.getByRole('button',{name:'Save & continue to documents →'}).closest('form')!;
}
beforeEach(() => {
 api.detail.mockResolvedValue({travellers:[person]}); api.list.mockResolvedValue([person]); api.create.mockResolvedValue({id:'request-1'});
 HTMLElement.prototype.scrollIntoView = vi.fn();
 vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {callback(0); return 0;});
});
afterEach(() => {cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear();});
describe('visa applicant form validation', () => {
 it('validates only the current applicant before collapsing it', async () => {
  await open();
  fireEvent.click(screen.getByRole('button',{name:'Save applicant 1'}));
  expect(screen.queryByRole('article',{name:'Saved applicant 1'})).toBeNull();
  expect(document.activeElement).toBe(screen.getByLabelText('Country of birth *'));
  expect(screen.getByLabelText('Contact name *').getAttribute('aria-invalid')).toBe('false');
  expect(document.querySelector('#visa-assistance-declaration')?.getAttribute('aria-invalid')).toBe('false');
  fireEvent.change(screen.getByLabelText('Country of birth *'),{target:{value:'BD'}});
  expect(screen.getByLabelText('Country of birth *').getAttribute('aria-invalid')).toBe('false');
  expect(api.create).not.toHaveBeenCalled();
 });
 it('saves applicants into bars, adds another, and preserves edited details in the complete request', async () => {
  await open();
  function completeApplicant(index:number,firstName:string) {
   const section=screen.getByRole('button',{name:'Save applicant '+index}).closest<HTMLElement>('[data-applicant-id]')!;
   const same=within(section).getByRole('checkbox',{name:'My permanent address is the same as my current address'}) as HTMLInputElement;
   if(!same.checked)fireEvent.click(same);
   for(const input of Array.from(section.querySelectorAll<HTMLInputElement>('input[required]'))) {
    if(input.type==='date')fireEvent.change(input,{target:{value:input.max?'1990-01-01':'2100-01-01'}});
    else if(!input.value)fireEvent.change(input,{target:{value:'Applicant detail'}});
   }
   for(const select of Array.from(section.querySelectorAll<HTMLSelectElement>('select[required]')))if(!select.value)fireEvent.change(select,{target:{value:'BD'}});
   fireEvent.change(within(section).getByLabelText('First / given name *'),{target:{value:firstName}});
   fireEvent.change(within(section).getByLabelText('Last / family name *'),{target:{value:'Rahman'}});
   fireEvent.change(within(section).getByLabelText('Document number *'),{target:{value:'DOC1234'}});
   return section;
  }
  completeApplicant(1,'Ain');fireEvent.click(screen.getByRole('button',{name:'Save applicant 1'}));
  const firstBar=screen.getByRole('article',{name:'Saved applicant 1'});
  expect(within(firstBar).getByRole('heading',{name:'Ain Rahman'})).toBeTruthy();
  expect(within(firstBar).getByText(/Passport ending 1234/)).toBeTruthy();
  expect(screen.queryByLabelText('First / given name *')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'+ Add another applicant'}));
  fireEvent.click(screen.getByRole('button',{name:'+ Add another applicant'}));
  expect(screen.getByRole('article',{name:'Saved applicant 1'})).toBeTruthy();
  completeApplicant(2,'Nadia');fireEvent.click(screen.getByRole('button',{name:'Save & add another'}));
  expect(screen.getByRole('article',{name:'Saved applicant 2'})).toBeTruthy();
  expect(screen.getAllByLabelText('First / given name *')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Edit applicant 1'}));
  const editing=screen.getByRole('button',{name:'Save applicant 1'}).closest<HTMLElement>('[data-applicant-id]')!;
  expect((within(editing).getByLabelText('Document number *') as HTMLInputElement).value).toBe('DOC1234');
  expect((within(editing).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  fireEvent.change(within(editing).getByLabelText('First / given name *'),{target:{value:'Ain Updated'}});
  fireEvent.click(screen.getByRole('button',{name:'Save applicant 1'}));
  expect(within(screen.getByRole('article',{name:'Saved applicant 1'})).getByRole('heading',{name:'Ain Updated Rahman'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Remove applicant 3'}));
  fireEvent.change(screen.getByLabelText('Contact name *'),{target:{value:'Booking Contact'}});
  fireEvent.click(document.querySelector('#visa-assistance-declaration')!);
  api.createTraveller.mockResolvedValue({id:'person-2'});api.addTraveller.mockResolvedValue({});
  fireEvent.click(screen.getByRole('button',{name:'Save & continue to documents →'}));
  await waitFor(()=>expect(api.create).toHaveBeenCalledTimes(1));
  const applicants=api.create.mock.calls[0][0].applicants;
  expect(applicants.map((person:{firstName:string})=>person.firstName)).toEqual(['Ain Updated','Nadia']);
  expect(applicants[0].permanentAddress).toEqual(applicants[0].currentAddress);
  expect(api.createTraveller).toHaveBeenCalledTimes(1);
 },15000);
 it('marks required fields and focuses the first missing field without saving', async () => {
  const form = await open();
  const country = screen.getByLabelText('Country of birth *');
  expect(form.querySelectorAll('.visa-required').length).toBeGreaterThan(10);
  fireEvent.click(screen.getByRole('button',{name:'Save & continue to documents →'}));
  expect(document.activeElement).toBe(country);
  expect(country.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(country.getAttribute('aria-describedby')!)?.textContent).toBe('Please complete this field.');
  expect(api.create).not.toHaveBeenCalled();
  fireEvent.change(country,{target:{value:'BD'}});
  await waitFor(() => expect(country.getAttribute('aria-invalid')).toBe('false'));
 });
 it('rejects whitespace and invalid email, then saves valid details with optional blanks', async () => {
  const form = await open();
  for (const input of Array.from(form.querySelectorAll<HTMLInputElement>('input[required]'))) {
   if(input.type === 'checkbox') fireEvent.click(input);
   else if(input.type === 'date') fireEvent.change(input,{target:{value: input.max ? '1990-01-01' : '2100-01-01'}});
   else if(!input.value) fireEvent.change(input,{target:{value:'Test value'}});
  }
  for (const select of Array.from(form.querySelectorAll<HTMLSelectElement>('select[required]'))) if(!select.value) fireEvent.change(select,{target:{value:'BD'}});
  const name=screen.getByLabelText('First / given name *');
  const email=screen.getByLabelText('Email address *');
  fireEvent.change(name,{target:{value:'   '}}); fireEvent.change(email,{target:{value:'invalid'}});
  fireEvent.submit(form);
  expect(document.activeElement).toBe(name); expect(api.create).not.toHaveBeenCalled();
  expect(email.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(name,{target:{value:'Ain'}}); fireEvent.change(email,{target:{value:'applicant@example.com'}});
  fireEvent.submit(form);
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  expect(api.create.mock.calls[0][0]).not.toHaveProperty('travellerIds');
  expect(api.create.mock.calls[0][0].applicants[0].firstName).toBe('Ain');
 });
 it('focuses an invalid date and treats confirmation as a required field', async () => {
  const form = await open();
  fireEvent.change(screen.getByLabelText('Date of birth *'),{target:{value:'2999-01-01'}});
  fireEvent.submit(form);
  expect(document.activeElement).toBe(screen.getByLabelText('Date of birth *'));
  expect(screen.getByLabelText('Date of birth *').getAttribute('aria-invalid')).toBe('true');
  expect(form.querySelector('#visa-assistance-declaration')?.getAttribute('aria-invalid')).toBe('true');
  expect(api.create).not.toHaveBeenCalled();
 });
 it('starts with a new applicant without a saved profile and supports four applicants', async () => {
  render(<MemoryRouter initialEntries={[{pathname:'/app/visa/assistance',state:{visaAssistanceDraft:{tripId:'trip-1',destinationCountryCode:'MY',expectedTravelDate:'2099-01-01',purpose:'Tourism',travellerIds:[]}}}]}><VisaAssistanceRequestPage /></MemoryRouter>);
  await screen.findByRole('button',{name:'+ Add another applicant'});
  expect(screen.getAllByLabelText('First / given name *')).toHaveLength(1);
  for(let index=0;index<3;index++) fireEvent.click(screen.getByRole('button',{name:'+ Add another applicant'}));
  expect(screen.getAllByLabelText('First / given name *')).toHaveLength(4);
  expect(document.activeElement).toBe(screen.getAllByLabelText('First / given name *')[3]);
  fireEvent.change(screen.getAllByLabelText('First / given name *')[0],{target:{value:'New'}});
  fireEvent.click(screen.getByRole('button',{name:'Remove applicant 2'}));
  expect(screen.getAllByLabelText('First / given name *')).toHaveLength(3);
  expect((screen.getAllByLabelText('First / given name *')[0] as HTMLInputElement).value).toBe('New');
  const form=screen.getByRole('button',{name:'Save & continue to documents →'}).closest('form')!;
  fireEvent.submit(form);expect(api.createTraveller).not.toHaveBeenCalled();
  for(const [index,input] of Array.from(form.querySelectorAll<HTMLInputElement>('input[required]')).entries()){
   if(input.type==='checkbox') fireEvent.click(input);
   else if(input.type==='date') fireEvent.change(input,{target:{value:input.max?'1990-01-01':'2100-01-01'}});
   else if(input.type==='email') fireEvent.change(input,{target:{value:'contact@example.test'}});
   else fireEvent.change(input,{target:{value:'Person '+index}});
  }
  for(const select of Array.from(form.querySelectorAll<HTMLSelectElement>('select[required]'))) if(!select.value)fireEvent.change(select,{target:{value:'BD'}});
  api.createTraveller.mockResolvedValueOnce({id:'new-person-1'}).mockResolvedValueOnce({id:'new-person-2'}).mockResolvedValueOnce({id:'new-person-3'});api.addTraveller.mockResolvedValue({});
  fireEvent.submit(form);await waitFor(()=>expect(api.create).toHaveBeenCalledTimes(1));
  expect(api.createTraveller).toHaveBeenCalledTimes(3);expect(api.addTraveller).toHaveBeenCalledTimes(3);
  expect(api.create.mock.calls[0][0].applicants.map((person:{travellerId:string})=>person.travellerId)).toEqual(['new-person-1','new-person-2','new-person-3']);
  expect(api.create.mock.calls[0][0]).not.toHaveProperty('newApplicantCount');
 });

});
