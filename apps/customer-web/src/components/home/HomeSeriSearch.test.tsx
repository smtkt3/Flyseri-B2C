// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomeSeriSearch } from './HomeSeriSearch';

const api = vi.hoisted(() => ({ createConversation: vi.fn(), send: vi.fn() }));
vi.mock('../../services/seriService', () => ({ seriService: api }));
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'user-1' } } }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('homepage Seri conversation', () => {
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
