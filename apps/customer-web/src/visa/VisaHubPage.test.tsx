// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VisaHubPage } from './VisaHubPage';
const api=vi.hoisted(()=>({requests:vi.fn(),applications:vi.fn(),signedIn:true}));
vi.mock('../services/visaService',()=>({visaService:{assistanceList:api.requests,list:api.applications}}));
vi.mock('../auth/AuthProvider',()=>({useAuth:()=>({session:api.signedIn?{user:{id:'customer'}}:null,resolving:false})}));
const request={id:'request-1',requestReference:'FVA-TEST',destinationCountryCode:'MY',status:'NEW'};
beforeEach(()=>{api.signedIn=true;api.requests.mockResolvedValue([request]);api.applications.mockResolvedValue([]);});
afterEach(()=>{cleanup();vi.resetAllMocks();});
describe('public visa discovery and saved application recovery',()=>{
  it('keeps saved requests available when another application service fails',async()=>{
    api.applications.mockRejectedValue(new Error('Unavailable'));
    render(<MemoryRouter><VisaHubPage/></MemoryRouter>);
    expect((await screen.findByRole('link',{name:/FVA-TEST/})).getAttribute('href')).toBe('/app/visa/assistance/request-1/documents');
    expect(screen.getByRole('alert').textContent).toContain('Some applications could not be loaded');
    expect(screen.getByRole('heading',{name:'Where would you like to go?'})).toBeTruthy();
  });
  it('allows guests to browse destinations without fetching private applications',()=>{
    api.signedIn=false;render(<MemoryRouter><VisaHubPage/></MemoryRouter>);
    expect(screen.getByRole('heading',{name:'Where would you like to go?'})).toBeTruthy();
    expect(screen.getByRole('link',{name:'Sign in to view applications →'})).toBeTruthy();
    expect(api.requests).not.toHaveBeenCalled();expect(api.applications).not.toHaveBeenCalled();
  });
  it('retries application history without resetting destination search',async()=>{
    api.requests.mockRejectedValueOnce(new Error('Unavailable'));
    render(<MemoryRouter><VisaHubPage/></MemoryRouter>);
    await screen.findByRole('alert');
    const input=screen.getByLabelText('Where are you travelling?');fireEvent.change(input,{target:{value:'Japan'}});
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
    await screen.findByRole('link',{name:/FVA-TEST/});expect((input as HTMLInputElement).value).toBe('Japan');
  });
});
