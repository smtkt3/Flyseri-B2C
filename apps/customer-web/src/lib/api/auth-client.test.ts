import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client';

const auth = vi.hoisted(() => ({ accessToken: vi.fn(), refreshToken: vi.fn(), signOut: vi.fn() }));
vi.mock('../../services/authService', () => ({ authService: auth }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('authenticated API client', () => {
  it('refreshes a rejected flight search token before delivering stream events', async () => {
    auth.accessToken.mockResolvedValue('old-token');
    auth.refreshToken.mockResolvedValue('new-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"type":"done"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }));
    vi.stubGlobal('fetch', fetchMock);
    const events: unknown[] = [];
    await new ApiClient().postStream('/flights/search/stream', {}, event => events.push(event));
    expect(events).toEqual([{ type: 'done' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]![1].headers).get('Authorization')).toBe('Bearer new-token');
  });

  it('allows anonymous flight browsing without touching a rejected account session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"type":"done"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }));
    vi.stubGlobal('fetch', fetchMock);
    await new ApiClient().postStream('/flights/search/stream', {}, () => undefined, { anonymous: true });
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).has('Authorization')).toBe(false);
    expect(auth.accessToken).not.toHaveBeenCalled();
    expect(auth.refreshToken).not.toHaveBeenCalled();
  });
  it('sends the access token and retries a GET once after refresh', async () => {
    auth.accessToken.mockResolvedValueOnce('old-token').mockResolvedValueOnce('new-token');
    auth.refreshToken.mockResolvedValue('new-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: { code: 'INVALID_SESSION', message: 'Expired', requestId: 'one' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ok: true }, requestId: 'two' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await new ApiClient().get<{ ok: boolean }>('/me')).data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('Authorization')).toBe('Bearer old-token');
    expect(new Headers(fetchMock.mock.calls[1]![1].headers).get('Authorization')).toBe('Bearer new-token');
    expect(auth.refreshToken).toHaveBeenCalledOnce();
  });

  it('does not replay a mutation or erase a valid browser session on an API 401', async () => {
    auth.accessToken.mockResolvedValue('old-token');
    auth.signOut.mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: false, error: { code: 'INVALID_SESSION', message: 'Expired', requestId: 'one' } }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new ApiClient().patch('/me', { displayName: 'Ain' })).rejects.toMatchObject({ code: 'INVALID_SESSION', status: 401 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(auth.refreshToken).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('keeps the browser session if the API still rejects a refreshed token', async () => {
    auth.accessToken.mockResolvedValueOnce('old-token').mockResolvedValueOnce('new-token');
    auth.refreshToken.mockResolvedValue('new-token');
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: false, error: { code: 'INVALID_SESSION', message: 'Expired', requestId: 'one' } }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new ApiClient().get('/me')).rejects.toMatchObject({ code: 'INVALID_SESSION', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
