// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { HomeSeriSearch } from './HomeSeriSearch';

const api = vi.hoisted(() => ({ createConversation: vi.fn(), send: vi.fn(), guestSend: vi.fn() }));
const auth = vi.hoisted(() => ({ session: { user: { id: 'user-1' } } as { user: { id: string } } | null }));
vi.mock('../../services/seriService', () => ({ seriService: api }));
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => auth }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); auth.session = { user: { id: 'user-1' } }; });

describe('homepage Seri conversation', () => {
  it('lets customers edit a welcome suggestion before sending it', () => {
    render(<MemoryRouter><HomeSeriSearch /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Plan a holiday' }));
    const input = screen.getByLabelText('Ask Seri a travel question') as HTMLInputElement;
    expect(input.value).toBe('Help me plan a holiday');
    expect(document.activeElement).toBe(input);
    expect(api.send).not.toHaveBeenCalled();
    expect(api.guestSend).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Help me plan a holiday in Japan' } });
    expect(input.value).toBe('Help me plan a holiday in Japan');
  });
  it('restores chat flight cards after selecting an offer and returning from passenger details', async () => {
    const request = { origin: 'DAC', destination: 'BKK', departureDate: '2027-01-22', tripType: 'ONE_WAY', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'BDT' };
    api.createConversation.mockResolvedValue({ id: 'chat-flights' });
    api.send.mockResolvedValue({ message: { id: 'flights', role: 'ASSISTANT', content: 'Here are your flight options.', messageType: 'FLIGHT_RESULTS', payload: { source: 'sabre', searchId: 'search-live', expiresAt: new Date(Date.now() + 600000).toISOString(), searchRequest: request, offers: [{ offerId: 'flight-1', airlineCodes: ['BG'], currency: 'BDT', totalAmount: '24000', baggageSummary: null, inbound: null, outbound: { durationMinutes: 150, stops: 0, segments: [{ origin: 'DAC', destination: 'BKK', departureAt: '2027-01-22T12:00:00+06:00', arrivalAt: '2027-01-22T15:30:00+07:00' }] } }] } } });
    function Checkout() { const location = useLocation(); const navigate = useNavigate(); return <><p>Selected {location.state.offer.offerId}</p><button onClick={() => navigate(-1)}>Return to chat</button></>; }
    render(<MemoryRouter><Routes><Route path="/" element={<HomeSeriSearch />} /><Route path="/flight-checkout" element={<Checkout />} /></Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Ask Seri a travel question'), { target: { value: 'Find flights DAC to BKK on 22 January 2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Seri' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select flight' }));
    expect(screen.getByText('Selected flight-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Return to chat' }));
    expect(await screen.findByRole('region', { name: 'Flight options in chat' })).toBeTruthy();
    expect(api.send).toHaveBeenCalledOnce();
    expect(api.createConversation).toHaveBeenCalledOnce();
  });
  it('does not restore another account’s saved chat', async () => {
    sessionStorage.setItem('flyseri.ai-question.someone-else.chat', JSON.stringify({ savedAt: Date.now(), messages: [{ id: 'private', role: 'ASSISTANT', content: 'Other account details' }] }));
    render(<MemoryRouter><HomeSeriSearch /></MemoryRouter>);
    expect(screen.queryByText('Other account details')).toBeNull();
  });
  it('lets signed-out visitors chat and preserves earlier replies in follow-ups', async () => {
    auth.session = null;
    api.guestSend.mockResolvedValue({ message: { id: 'guest-reply', role: 'ASSISTANT', content: 'Which month suits you?', messageType: 'TEXT', payload: null } });
    render(<MemoryRouter><HomeSeriSearch /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Ask Seri a travel question'), { target: { value: 'Suggest a beach trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Seri' }));
    expect(await screen.findByText('Which month suits you?')).toBeTruthy();
    expect(api.createConversation).not.toHaveBeenCalled();
    expect(api.send).not.toHaveBeenCalled();
    api.guestSend.mockResolvedValue({ message: { id: 'guest-followup', role: 'ASSISTANT', content: 'November is a good starting point.', messageType: 'TEXT', payload: null } });
    fireEvent.change(screen.getByLabelText('Ask Seri a travel question'), { target: { value: 'November' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Seri' }));
    expect(await screen.findByText('November is a good starting point.')).toBeTruthy();
    expect(api.guestSend).toHaveBeenLastCalledWith('November', [{ role: 'USER', content: 'Suggest a beach trip' }, { role: 'ASSISTANT', content: 'Which month suits you?' }], expect.any(String));
  });
  it('shows replies in place and keeps follow-ups in the same conversation', async () => {
    api.createConversation.mockResolvedValue({ id: 'chat-1' });
    api.send.mockResolvedValue({ message: { id: 'reply-1', role: 'ASSISTANT', content: 'What dates would you like to travel?', messageType: 'TEXT', payload: null } });
    render(<MemoryRouter><HomeSeriSearch /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Ask Seri a travel question'), { target: { value: 'Plan a Japan trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Seri' }));
    expect(await screen.findByText('What dates would you like to travel?')).toBeTruthy();
    expect(screen.getByText('Plan a Japan trip')).toBeTruthy();
    expect(api.send).toHaveBeenCalledWith('chat-1', 'Plan a Japan trip');
    api.send.mockResolvedValue({ message: { id: 'reply-2', role: 'ASSISTANT', content: 'I will check November options.', messageType: 'TEXT', payload: null } });
    fireEvent.change(screen.getByLabelText('Ask Seri a travel question'), { target: { value: 'November' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Seri' }));
    expect(await screen.findByText('I will check November options.')).toBeTruthy();
    expect(api.createConversation).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenLastCalledWith('chat-1', 'November');
  });

  it('restores the question after a failed reply and reuses the created chat for retry', async () => {
    api.createConversation.mockResolvedValue({ id: 'chat-retry' });
    api.send.mockRejectedValueOnce(new Error('offline'));
    render(<MemoryRouter><HomeSeriSearch /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Ask Seri a travel question'), { target: { value: 'Beach trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Seri' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('Ask Seri a travel question') as HTMLInputElement).value).toBe('Beach trip');
    api.send.mockResolvedValue({ message: { id: 'reply-ok', role: 'ASSISTANT', content: 'Which country do you prefer?', messageType: 'TEXT', payload: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Seri' }));
    await waitFor(() => expect(screen.getByText('Which country do you prefer?')).toBeTruthy());
    expect(api.createConversation).toHaveBeenCalledTimes(1);
  });
});
