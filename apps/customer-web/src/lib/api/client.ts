import type { ApiErrorResponse, ApiSuccess, HealthResponse } from '@flyseri/types';
import { authService } from '../../services/authService';

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly status?: number,
    readonly details?: unknown,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface RequestOptions {
  anonymous?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  requestId?: string;
  headers?: HeadersInit;
}

export class ApiClient {
  constructor(private readonly baseUrl: string = '/api/v1') {}

  async get<T>(path: string, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
    return this.request<T>('POST', path, body, options);
  }

  async patch<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
    return this.request<T>('PATCH', path, body, options);
  }

  async delete<T>(path: string, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  async postStream<T>(path: string, body: unknown, onEvent: (event: T) => void, options: RequestOptions = {}): Promise<void> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API path must be relative to the configured base URL');
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 60000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/x-ndjson'); headers.set('Content-Type', 'application/json');
    const token = options.anonymous ? undefined : await authService.accessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const send = () => fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
      let response = await send();
      // Search is read-only. Retry authentication before opening its stream,
      // never replay a booking mutation or a stream that has delivered results.
      if (response.status === 401 && token && path === '/flights/search/stream') {
        const refreshed = await authService.refreshToken();
        if (refreshed) {
          await response.body?.cancel();
          headers.set('Authorization', `Bearer ${refreshed}`);
          response = await send();
        }
      }
      if (!response.ok) {
        const value: unknown = await response.json().catch(() => null);
        if (isError(value)) throw new ApiClientError(value.error.code, value.error.message, value.error.requestId, response.status);
        throw new ApiClientError('DEPENDENCY_UNAVAILABLE', 'Flight search is temporarily unavailable.', undefined, response.status);
      }
      if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) throw new ApiClientError('INVALID_RESPONSE', 'The service returned an invalid response.');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const receive = (line: string) => {
        if (!line.trim()) return;
        let event: T;
        try { event = JSON.parse(line) as T; } catch { throw new ApiClientError('INVALID_RESPONSE', 'The service returned an invalid response.'); }
        onEvent(event);
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) { receive(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
        if (buffer.length > 10_000_000) throw new ApiClientError('INVALID_RESPONSE', 'The service returned an invalid response.');
        if (done) { receive(buffer); break; }
      }
    } catch (error) {
      if (signal.aborted) throw new ApiClientError(timeout.aborted ? 'TIMEOUT' : 'ABORTED', timeout.aborted ? 'The request timed out.' : 'The request was cancelled.');
      if (error instanceof ApiClientError) throw error;
      throw new ApiClientError('NETWORK_ERROR', 'The service could not be reached.');
    } finally { await reader?.cancel().catch(() => undefined); reader?.releaseLock(); }
  }

  private async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, options: RequestOptions = {}, retried = false): Promise<ApiSuccess<T>> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API path must be relative to the configured base URL');
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 8000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !multipart) headers.set('Content-Type', 'application/json');
    if (options.requestId) headers.set('X-Request-ID', options.requestId);
    const token = options.anonymous ? undefined : await authService.accessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method, headers, body: body === undefined ? undefined : multipart ? body as FormData : JSON.stringify(body), signal });
    } catch (error) {
      if (signal.aborted && timeout.aborted) throw new ApiClientError('TIMEOUT', 'The request timed out.');
      if (signal.aborted) throw new ApiClientError('ABORTED', 'The request was cancelled.');
      throw new ApiClientError('NETWORK_ERROR', 'The service could not be reached.', undefined, undefined, error);
    }
    let responseBody: unknown;
    try { responseBody = await response.json(); }
    catch {
      if (response.status >= 500) throw new ApiClientError('DEPENDENCY_UNAVAILABLE', 'The service is temporarily unavailable. Please try again shortly.', response.headers.get('X-Request-ID') ?? undefined, response.status);
      throw new ApiClientError('INVALID_RESPONSE', 'The service returned an invalid response.', response.headers.get('X-Request-ID') ?? undefined, response.status);
    }
    if (response.status === 401 && method === 'GET' && !retried && token && await authService.refreshToken()) {
      return this.request<T>(method, path, undefined, options, true);
    }
    if (!response.ok || !isSuccess<T>(responseBody)) {
      if (isError(responseBody)) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        throw new ApiClientError(responseBody.error.code, responseBody.error.message, responseBody.error.requestId, response.status, responseBody.error.details,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
      }
      throw new ApiClientError('INVALID_RESPONSE', 'The service returned an invalid response.', response.headers.get('X-Request-ID') ?? undefined, response.status);
    }
    return responseBody;
  }
}

function isSuccess<T>(value: unknown): value is ApiSuccess<T> {
  return typeof value === 'object' && value !== null && 'success' in value && value.success === true && 'data' in value && 'requestId' in value && typeof value.requestId === 'string';
}

function isError(value: unknown): value is ApiErrorResponse {
  if (typeof value !== 'object' || value === null || !('success' in value) || value.success !== false || !('error' in value)) return false;
  const error = value.error;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && 'message' in error && typeof error.message === 'string' && 'requestId' in error && typeof error.requestId === 'string';
}

export const apiClient = new ApiClient(import.meta.env.VITE_API_BASE_URL || '/api/v1');

export function getApiHealth(options?: RequestOptions): Promise<ApiSuccess<HealthResponse>> {
  return apiClient.get<HealthResponse>('/health', options);
}
