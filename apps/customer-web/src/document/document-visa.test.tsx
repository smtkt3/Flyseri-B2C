// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiClientError } from '../lib/api/client';
import { MyDocumentsPage } from './MyDocumentsPage';
import { DocumentDetailPage } from './DocumentDetailPage';
import { TripVisaPage } from '../visa/TripVisaPage';
import { VisaHubPage } from '../visa/VisaHubPage';
import { VisaApplicationPage } from '../visa/VisaApplicationPage';

const documentApi = vi.hoisted(() => ({ list: vi.fn(), policy: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), upload: vi.fn(), access: vi.fn() }));
const visaApi = vi.hoisted(() => ({ catalogue: vi.fn(), types: vi.fn(), list: vi.fn(), assistanceList: vi.fn(), detail: vi.fn(), create: vi.fn(), action: vi.fn(), archive: vi.fn(), link: vi.fn(), unlink: vi.fn() }));
const tripApi = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), create: vi.fn() }));
const travellerApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../services/documentService', () => ({ documentService: documentApi }));
vi.mock('../services/visaService', () => ({ visaService: visaApi }));
vi.mock('../services/tripService', () => ({ tripService: tripApi }));
vi.mock('../services/travellerService', () => ({ travellerService: travellerApi }));

const person = { id: 'person-1', legalFirstName: 'Ain', legalLastName: 'Rahman', relationshipType: 'SELF' };
const second = { id: 'person-2', legalFirstName: 'Fatimah', legalLastName: 'Rahman', relationshipType: 'SPOUSE' };
const version = { id: 'version-1', versionNumber: 1, originalFilename: 'passport.jpg', mimeType: 'image/jpeg', fileSize: 7, securityScanStatus: 'UNAVAILABLE', uploadedAt: '2026-09-23T00:00:00.000Z' };
const document = { id: 'document-1', travellerId: person.id, travellerName: 'Ain Rahman', documentType: 'PASSPORT', displayName: null, status: 'UPLOADED', issuedOn: null, expiresOn: '2031-05-14', issuingCountryCode: null, currentVersion: version, versions: [version], createdAt: '', updatedAt: '' };
const trip = { id: 'trip-1', title: 'Japan', status: 'PLANNING', startDate: null, endDate: null, primaryDestination: { countryCode: 'JP', cityName: 'Tokyo' }, travellerCount: 2, createdAt: '', updatedAt: '', destinations: [], travellers: [person, second] };
const requirements = [person, second].map((item, index) => ({ id: `req-${index + 1}`, travellerId: item.id, requirementCode: 'PASSPORT', name: 'Passport copy', description: null, required: true, documentType: 'PASSPORT', status: 'MISSING', displayOrder: 0, documents: [] }));
const application = { id: 'visa-1', tripId: 'trip-1', visaTypeId: 'type-1', visaTypeName: 'Tourist visa', destinationCountryCode: 'JP', status: 'DRAFT', travellerIds: [person.id, second.id], requiredCompleted: 0, requiredTotal: 2, requirements, createdAt: '', updatedAt: '' };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
beforeEach(() => { documentApi.policy.mockResolvedValue({ maxUploadMb: 10, acceptedTypes: [] }); visaApi.assistanceList.mockResolvedValue([]); });

describe('document vault and visa planning', () => {
  it('shows a loading state and an honest empty vault', async () => {
    let resolve!: (value: unknown[]) => void;
    documentApi.list.mockReturnValue(new Promise((done) => { resolve = done; }));
    documentApi.policy.mockResolvedValue({ maxUploadMb: 10, acceptedTypes: [] });
    travellerApi.list.mockResolvedValue([]);
    render(<MemoryRouter><MyDocumentsPage /></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toContain('Loading your documents');
    resolve([]);
    expect(await screen.findByText('No documents yet')).toBeTruthy();
  });
  it('validates files and uploads to an owned document', async () => {
    documentApi.list.mockResolvedValue([]); documentApi.policy.mockResolvedValue({ maxUploadMb: 1, acceptedTypes: [] }); travellerApi.list.mockResolvedValue([person]);
    documentApi.create.mockResolvedValue({ ...document, currentVersion: null, versions: [] }); documentApi.upload.mockResolvedValue(document);
    render(<MemoryRouter initialEntries={['/app/documents']}><Routes><Route path="/app/documents" element={<MyDocumentsPage />} /><Route path="/app/documents/:documentId" element={<div>Document saved</div>} /></Routes></MemoryRouter>);
    await screen.findByText('No documents yet');
    fireEvent.click(screen.getByRole('button', { name: 'Upload your first document' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    const input = screen.getByLabelText('Choose file');
    fireEvent.change(input, { target: { files: [new File(['bad'], 'bad.txt', { type: 'text/plain' })] } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(screen.getByRole('alert').textContent).toContain('PDF, JPG or PNG');
    expect(documentApi.create).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([255, 216, 255])], 'passport.jpg', { type: 'image/jpeg' })] } });
    fireEvent.change(screen.getByLabelText('Traveller'), { target: { value: person.id } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(await screen.findByText('Document saved')).toBeTruthy();
    expect(documentApi.create).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'PASSPORT', travellerId: person.id }));
    expect(documentApi.upload).toHaveBeenCalledWith(document.id, expect.any(File), expect.any(String));
  });
  it('keeps keyboard focus in the upload dialog and restores it on close', async () => {
    documentApi.list.mockResolvedValue([]); travellerApi.list.mockResolvedValue([]);
    render(<MemoryRouter><MyDocumentsPage /></MemoryRouter>);
    const opener = await screen.findByRole('button', { name: 'Upload your first document' });
    opener.focus(); fireEvent.click(opener);
    const close = screen.getByRole('button', { name: 'Close upload' });
    expect(globalThis.document.activeElement).toBe(close);
    fireEvent.keyDown(globalThis.document, { key: 'Tab', shiftKey: true });
    expect(globalThis.document.activeElement).toBe(screen.getByRole('button', { name: 'Upload privately' }));
    fireEvent.keyDown(globalThis.document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(globalThis.document.activeElement).toBe(opener);
  });
  it('shows document history and requests a short lived link only on demand', async () => {
    documentApi.detail.mockResolvedValue({ ...document, currentVersion: { ...version, id: 'version-2', versionNumber: 2 }, versions: [{ ...version, id: 'version-2', versionNumber: 2 }, version] });
    documentApi.access.mockResolvedValue({ url: 'https://private.example/short', expiresInSeconds: 60 });
    render(<MemoryRouter initialEntries={['/app/documents/document-1']}><Routes><Route path="/app/documents/:documentId" element={<DocumentDetailPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Passport' })).toBeTruthy();
    expect(documentApi.access).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'View previous versions' }));
    expect(screen.getByText(/Version 1/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Request secure view' })[1]!);
    expect(await screen.findByRole('link', { name: /Open secure document/ })).toBeTruthy();
    expect(documentApi.access).toHaveBeenCalledWith(document.id, version.id, false);
  });
  it('handles a non-owned document as not found', async () => {
    documentApi.detail.mockRejectedValue(new ApiClientError('NOT_FOUND', 'Missing', 'id', 404));
    render(<MemoryRouter initialEntries={['/app/documents/document-1']}><Routes><Route path="/app/documents/:documentId" element={<DocumentDetailPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Document not found' })).toBeTruthy();
  });
  it('shows unconfigured visa services without inventing requirements', async () => {
    tripApi.detail.mockResolvedValue(trip); visaApi.catalogue.mockResolvedValue([]); visaApi.list.mockResolvedValue([]);
    render(<MemoryRouter initialEntries={['/app/trips/trip-1/visa']}><Routes><Route path="/app/trips/:tripId/visa" element={<TripVisaPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText(/Flyseri can review an assisted visa request for Japan/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Continue to request form/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('opens the visa search using the first saved journey', async () => {
    tripApi.list.mockResolvedValue([trip, { ...trip, id: 'trip-2', title: 'New journey', primaryDestination: null }]);
    tripApi.detail.mockResolvedValue(trip); visaApi.list.mockResolvedValue([]); visaApi.catalogue.mockResolvedValue([]);
    render(<MemoryRouter initialEntries={['/app/visa']}><Routes><Route path="/app/visa" element={<VisaHubPage />} /></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Where are you going?' });
    expect((screen.getByLabelText('Destination country') as HTMLSelectElement).value).toBe('JP');
    expect(screen.getByRole('checkbox', { name: 'Ain Rahman' })).toBeTruthy();
    expect(tripApi.list).toHaveBeenCalledTimes(1);
  });
  it('shows a useful visa entry point before a customer has a trip', async () => {
    tripApi.list.mockResolvedValue([]);
    travellerApi.list.mockResolvedValue([]);
    render(<MemoryRouter><VisaHubPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Where are you going?' })).toBeTruthy();
    expect((screen.getByLabelText('New applicants') as HTMLInputElement).value).toBe('1');
  });
  it('starts a visa application for selected trip travellers', async () => {
    tripApi.detail.mockResolvedValue(trip); tripApi.create.mockResolvedValue({ ...trip, id: 'visa-trip-1' }); visaApi.catalogue.mockResolvedValue([{ id: 'type-1', destinationCountryCode: 'JP', code: 'TEST', name: 'Tourist visa' }]); visaApi.list.mockResolvedValue([]); visaApi.create.mockResolvedValue(application);
    render(<MemoryRouter initialEntries={['/app/trips/trip-1/visa']}><Routes><Route path="/app/trips/:tripId/visa" element={<TripVisaPage />} /><Route path="/app/visa-applications/:applicationId" element={<div>Visa opened</div>} /></Routes></MemoryRouter>);
    await screen.findByRole('option', { name: 'Tourist visa' });
    fireEvent.change(screen.getByLabelText('Expected travel date'), { target: { value: '2026-12-10' } });
    fireEvent.change(screen.getByLabelText('Visa purpose'), { target: { value: 'type-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ain Rahman' }));
    fireEvent.click(screen.getByRole('button', { name: /Start visa application/ }));
    expect(await screen.findByText('Visa opened')).toBeTruthy();
    expect(tripApi.create).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-12-10', destinations: [{ countryCode: 'JP', startDate: '2026-12-10' }], travellerIds: [person.id] }));
    expect(visaApi.create).toHaveBeenCalledWith('visa-trip-1', 'type-1', [person.id]);
  });
  it('renders family checklists, reuses the exact version, and does not count an unscanned file as complete', async () => {
    visaApi.detail.mockResolvedValue(application); tripApi.detail.mockResolvedValue(trip); documentApi.list.mockResolvedValue([document]); visaApi.link.mockResolvedValue({ ...application, requiredCompleted: 0, requirements: [{ ...requirements[0], status: 'UPLOADED', documents: [{ documentId: document.id, documentVersionId: version.id, documentType: 'PASSPORT', displayName: null, originalFilename: version.originalFilename, versionNumber: version.versionNumber, uploadState: 'UPLOADED', securityScanStatus: 'UNAVAILABLE' }] }, requirements[1]] });
    render(<MemoryRouter initialEntries={['/app/visa-applications/visa-1?step=documents']}><Routes><Route path="/app/visa-applications/:applicationId" element={<VisaApplicationPage />} /></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Ain Rahman' });
    expect(screen.getAllByText('Fatimah Rahman').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Passport copy')).toHaveLength(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'Document for Passport copy Ain' }), { target: { value: document.id } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Attach' })[0]!);
    await waitFor(() => expect(visaApi.link).toHaveBeenCalledWith(application.id, requirements[0]!.id, document.id, version.id));
    expect(await screen.findByText(/security scan is unavailable/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to review →' }));
    expect(screen.getByRole('alert').textContent).toContain('Attach every required document and wait for its security check');
  });
});
