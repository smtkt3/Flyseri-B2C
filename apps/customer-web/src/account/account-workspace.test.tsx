// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { AccountNavigation, accountSectionActive } from '../components/AccountNavigation';
import { ProfilePage } from './ProfilePage';
import { TravelWorkspace } from './TravelWorkspace';
import { ProfilePhoto, prepareProfilePhoto } from './ProfilePhoto';
import { LanguageProvider } from '../travel/language';
import { AccountPreferencesSync } from './AccountPreferencesSync';

const mocks=vi.hoisted(()=>({me:vi.fn(),update:vi.fn(),create:vi.fn(),upload:vi.fn(),archive:vi.fn(),access:vi.fn(),savePhoto:vi.fn(),session:{user:{id:'customer-a',email:'guest@example.com',user_metadata:{} as Record<string,unknown>}}}));
vi.mock('../auth/AuthProvider',()=>({useAuth:()=>({session:mocks.session})}));
vi.mock('../services/customerService',()=>({customerService:{me:mocks.me,update:mocks.update}}));
vi.mock('../services/documentService',()=>({documentService:{create:mocks.create,upload:mocks.upload,archive:mocks.archive,access:mocks.access}}));
vi.mock('../services/authService',()=>({authService:{updateProfilePhoto:mocks.savePhoto}}));
vi.mock('../document/MyDocumentsPage',()=>({MyDocumentsPage:()=> <div>Private document workspace</div>}));
const profile={displayName:'Ain',phoneCountryCode:'+880',phoneNumber:'1712345678',preferredLanguage:'en',preferredCurrency:'BDT'};
const documentId='12345678-1234-4234-8234-123456789abc';
beforeEach(()=>{localStorage.clear();mocks.session.user.user_metadata={};mocks.me.mockResolvedValue(profile);mocks.update.mockImplementation(async patch=>({...profile,...patch}));});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();vi.unstubAllGlobals();});
function Profile({initial='/app/profile'}:{initial?:string}){return <MemoryRouter initialEntries={[initial]}><LanguageProvider><ProfilePage/></LanguageProvider></MemoryRouter>;}
function Back(){const navigate=useNavigate();return <button onClick={()=>navigate(-1)}>Go back</button>;}

describe('account workspace',()=>{
  it('groups travel navigation and marks all preserved detail routes correctly',()=>{
    render(<MemoryRouter initialEntries={['/app/orders/order-a']}><AccountNavigation/></MemoryRouter>);
    expect(screen.getByRole('link',{name:'My travel'}).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link',{name:'My Orders'})).toBeNull();
    expect(screen.queryByRole('link',{name:'My Documents'})).toBeNull();
    expect(accountSectionActive('/app/trips/trip-a','bookings')).toBe(true);
    expect(accountSectionActive('/app/documents/document-a','profile')).toBe(true);
    expect(accountSectionActive('/app/orderstuff','bookings')).toBe(false);
  });
  it('supports keyboard tabs, direct URLs and browser back in My travel',()=>{
    render(<MemoryRouter initialEntries={['/app/bookings']}><Back/><Routes>{(['bookings','trips','orders'] as const).map(tab=><Route key={tab} path={`/app/${tab}`} element={<TravelWorkspace tab={tab}><p>{tab} content</p></TravelWorkspace>}/>)}</Routes></MemoryRouter>);
    fireEvent.keyDown(screen.getByRole('tab',{name:'Bookings'}),{key:'ArrowRight'});
    expect(screen.getByRole('tab',{name:'Trips'}).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab',{name:'Trips'}));
    fireEvent.keyDown(screen.getByRole('tab',{name:'Trips'}),{key:'End'});
    expect(screen.getByRole('tabpanel').textContent).toContain('orders content');
    fireEvent.click(screen.getByRole('button',{name:'Go back'}));
    expect(screen.getByRole('tabpanel').textContent).toContain('trips content');
  });
  it('saves only preference fields and synchronizes the displayed currency after success',async()=>{
    render(<Profile initial="/app/profile?section=preferences"/>);
    fireEvent.change(await screen.findByLabelText('Default currency'),{target:{value:'MYR'}});
    fireEvent.click(screen.getByRole('button',{name:'Save preferences'}));
    await screen.findByText('Your default language and currency have been saved.');
    expect(mocks.update).toHaveBeenCalledWith({preferredLanguage:'en',preferredCurrency:'MYR'});
    expect(localStorage.getItem('flyseri.currency')).toBe('MYR');
  });
  it('keeps the existing currency and selected draft when saving fails',async()=>{
    mocks.update.mockRejectedValueOnce(new Error('offline'));
    localStorage.setItem('flyseri.currency','BDT');
    render(<Profile initial="/app/profile?section=preferences"/>);
    fireEvent.change(await screen.findByLabelText('Default currency'),{target:{value:'USD'}});
    fireEvent.click(screen.getByRole('button',{name:'Save preferences'}));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(localStorage.getItem('flyseri.currency')).toBe('BDT');
    expect((screen.getByLabelText('Default currency') as HTMLSelectElement).value).toBe('USD');
  });
  it('keeps documents and security accessible when personal details fail to load',async()=>{
    mocks.me.mockRejectedValue(new Error('offline'));
    render(<Profile initial="/app/profile?section=documents"/>);
    expect(await screen.findByText('Private document workspace')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab',{name:'Security'}));
    expect(screen.getByText('guest@example.com')).toBeTruthy();
    expect(screen.getByRole('link',{name:'Change password'}).getAttribute('href')).toBe('/reset-password');
  });
  it('loads account defaults on sign-in without overriding later navbar choices on rerender',async()=>{
    mocks.me.mockResolvedValue({...profile,preferredCurrency:'MYR',preferredLanguage:'bn'});
    const view=render(<LanguageProvider><AccountPreferencesSync/></LanguageProvider>);
    await waitFor(()=>expect(localStorage.getItem('flyseri.currency')).toBe('MYR'));
    expect(localStorage.getItem('flyseri.language')).toBe('bn');
    localStorage.setItem('flyseri.currency','USD');
    view.rerender(<LanguageProvider><AccountPreferencesSync/></LanguageProvider>);
    expect(localStorage.getItem('flyseri.currency')).toBe('USD');
  });
  it('rejects non-image and oversized profile files before uploading anything',async()=>{
    await expect(prepareProfilePhoto(new File(['<svg/>'],'photo.svg',{type:'image/svg+xml'}))).rejects.toThrow('JPG, PNG or WebP');
    await expect(prepareProfilePhoto(new File([new Uint8Array(5*1024*1024+1)],'large.jpg',{type:'image/jpeg'}))).rejects.toThrow('5 MB');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('retries a failed photo upload using the same document and idempotency key',async()=>{
    vi.stubGlobal('Image',class {naturalWidth=600;naturalHeight=400;onload:()=>void=()=>{};set src(_value:string){queueMicrotask(()=>this.onload());}});
    vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:photo'),revokeObjectURL:vi.fn()}));
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['jpeg'],{type:'image/jpeg'})));
    mocks.create.mockResolvedValue({id:documentId});mocks.upload.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({id:documentId});mocks.savePhoto.mockResolvedValue(undefined);
    render(<ProfilePhoto name="Ain"/>);
    fireEvent.change(screen.getByLabelText('Choose profile photo'),{target:{files:[new File(['image'],'photo.png',{type:'image/png'})]}});
    fireEvent.click(await screen.findByRole('button',{name:'Save photo'}));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'Save photo'}));
    await screen.findByText('Profile photo saved.');
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.upload.mock.calls[0]?.[0]).toBe(documentId);
    expect(mocks.upload.mock.calls[0]?.[2]).toBe(mocks.upload.mock.calls[1]?.[2]);
    expect(mocks.savePhoto).toHaveBeenCalledWith(documentId);
  });
  it('does not archive an existing photo if saving its removal fails',async()=>{
    mocks.session.user.user_metadata={flyseri_photo_document_id:documentId};
    mocks.access.mockResolvedValue({url:'https://storage.example/photo.jpg',expiresInSeconds:60});
    mocks.savePhoto.mockRejectedValueOnce(new Error('offline'));
    render(<ProfilePhoto name="Ain"/>);
    fireEvent.click(screen.getByRole('button',{name:'Remove photo'}));
    await screen.findByRole('alert');
    expect(mocks.archive).not.toHaveBeenCalled();
  });
});
