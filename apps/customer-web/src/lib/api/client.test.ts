import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('ApiClient', () => {
  it('delivers complete stream events immediately even when JSON lines cross network chunks', async () => {
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { push = controller; } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } })));
    const events: unknown[] = [];
    const request = new ApiClient().postStream('/flights/search/stream', {}, (event) => events.push(event));
    const encoder = new TextEncoder();
    push.enqueue(encoder.encode('{"type":"results","city":"Kuala'));
    push.enqueue(encoder.encode(' Lumpur"}\n{"type":'));
    // Wait only for delivery of the first chunk; the connection is still open.
    await vi.waitFor(() => expect(events).toEqual([{ type: 'results', city: 'Kuala Lumpur' }]));
    push.enqueue(encoder.encode('"done"}\n')); push.close();
    await request;
    expect(events).toEqual([{ type: 'results', city: 'Kuala Lumpur' }, { type: 'done' }]);
  });
  it('reports an unavailable service when the gateway returns a non-JSON error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })));
    await expect(new ApiClient().get('/visa-services?countryCode=MY')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', status: 502, message: 'The service is temporarily unavailable. Please try again shortly.' });
  });
  it('reads a typed response and propagates a request ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { status: 'ok' }, requestId: 'id' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new ApiClient('/api/v1').get<{ status: string }>('/health', { requestId: 'id' });
    expect(result.data.status).toBe('ok');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('X-Request-ID')).toBe('id');
  });
  it('maps standard API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Missing', requestId: 'id' } }), { status: 404 })));
    await expect(new ApiClient().get('/missing')).rejects.toMatchObject({ code: 'NOT_FOUND', requestId: 'id', status: 404 });
  });
});
