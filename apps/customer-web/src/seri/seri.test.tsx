// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SeriPage } from './SeriPage';

const seri = vi.hoisted(() => ({ conversations: vi.fn(), createConversation: vi.fn(), messages: vi.fn(), send: vi.fn(), confirm: vi.fn(), cancel: vi.fn() }));
vi.mock('../services/seriService', () => ({ seriService: seri }));
const trips = vi.hoisted(() => ({ detail: vi.fn() }));
vi.mock('../services/tripService', () => ({ tripService: trips }));
const conversation = { id: 'conversation-1', tripId: null, title: null, createdAt: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z', lastMessageAt: '2026-09-28T00:00:00Z' };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function renderSeri(path = '/app/seri') { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/app/seri" element={<SeriPage />} /><Route path="/app/trips/:tripId/seri" element={<SeriPage />} /></Routes></MemoryRouter>); }

describe('Seri chat experience', () => {
  it('creates a persisted conversation and sends a message to the backend', async () => {
    seri.conversations.mockResolvedValue([]);
    seri.createConversation.mockResolvedValue(conversation);
    seri.messages.mockResolvedValue([]);
    seri.send.mockResolvedValue({ conversation, message: { id: 'answer-1', role: 'ASSISTANT', content: 'Your payment is pending.', messageType: 'PAYMENT_STATUS', payload: { payments: [{ id: 'p1', status: 'PENDING', amount: '88.00', currency: 'MYR' }] }, createdAt: '2026-09-28T00:00:01Z' }, deterministic: true, provider: null, promptVersion: 'seri-1.0.0' });
    renderSeri();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Seri' }), { target: { value: 'What is my payment status?' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(await screen.findByText('Your payment is pending.')).toBeTruthy();
    expect(seri.createConversation).toHaveBeenCalledWith(undefined);
    expect(seri.send).toHaveBeenCalledWith('conversation-1', 'What is my payment status?');
  });

  it('restores existing messages and trip context after page refresh', async () => {
    const tripConversation = { ...conversation, tripId: 'trip-abc' };
    seri.conversations.mockResolvedValue([tripConversation]);
    seri.messages.mockResolvedValue([{ id: 'old-1', role: 'ASSISTANT', content: 'Your Tokyo trip is coming up.', messageType: 'TEXT', payload: null, createdAt: '2026-09-28T00:00:00Z' }]);
    trips.detail.mockResolvedValue({ id: 'trip-abc', title: 'Tokyo trip' });
    renderSeri('/app/trips/trip-abc/seri');
    expect(await screen.findByText('Your Tokyo trip is coming up.')).toBeTruthy();
    expect(screen.getByText('Seri is helping with Tokyo trip')).toBeTruthy();
    expect(seri.messages).toHaveBeenCalledWith('conversation-1');
  });

  it('requires a customer click before sending a CRM support handoff', async () => {
    const pending = { id: 'confirm-1', role: 'ASSISTANT', content: 'Confirm support?', messageType: 'CONFIRMATION', payload: { actionId: 'action-1', summary: 'Send a support request to the Seri Mechan team', expiresAt: '2026-09-28T00:10:00Z', status: 'PENDING' }, createdAt: '2026-09-28T00:00:00Z' };
    seri.conversations.mockResolvedValue([conversation]); seri.messages.mockResolvedValue([pending]);
    seri.confirm.mockResolvedValue({ id: 'sent-1', role: 'ASSISTANT', content: 'I’ve sent your request to the Seri Mechan support team.', messageType: 'SUPPORT_HANDOFF', payload: { status: 'QUEUED' }, createdAt: '2026-09-28T00:00:01Z' });
    renderSeri();
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, contact support' }));
    await waitFor(() => expect(seri.confirm).toHaveBeenCalledWith('conversation-1', 'action-1'));
    expect(await screen.findByText('I’ve sent your request to the Seri Mechan support team.')).toBeTruthy();
  });

  it('opens a distinct trip conversation and keeps a support request as an unsent draft', async () => {
    const tripConversation = { ...conversation, id: 'trip-chat', tripId: 'trip-abc' };
    seri.conversations.mockResolvedValue([conversation]);
    seri.createConversation.mockResolvedValue(tripConversation);
    seri.messages.mockResolvedValue([]);
    trips.detail.mockResolvedValue({ id: 'trip-abc', title: 'Japan trip', primaryDestination: { cityName: 'Tokyo', countryCode: 'JP' } });
    renderSeri('/app/trips/trip-abc/seri?draft=I%20need%20a%20person');
    expect(await screen.findByText('Seri is helping with Japan trip')).toBeTruthy();
    expect(seri.createConversation).toHaveBeenCalledWith('trip-abc');
    expect(seri.messages).toHaveBeenCalledWith('trip-chat');
    expect((screen.getByRole('textbox', { name: 'Message Seri' }) as HTMLTextAreaElement).value).toBe('I need a person');
    expect(seri.send).not.toHaveBeenCalled();
  });
});
