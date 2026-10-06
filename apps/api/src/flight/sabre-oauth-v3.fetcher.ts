import type { AppConfig } from '@flyseri/config';
import { ApiException } from '../api-exception.js';
import type { SabreTokenFetcher } from './sabre-auth.service.js';

type HttpFetch = typeof fetch;
const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'Flight search is temporarily unavailable.', 503);

/** CERT REST OAuth v3 password grant, verified against the account's supplied guide. */
export class SabreOAuthV3Fetcher implements SabreTokenFetcher {
  constructor(private readonly config: AppConfig, private readonly http: HttpFetch = fetch) {}

  async fetchToken(): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const { SABRE_ENV, SABRE_AUTH_URL, SABRE_CLIENT_ID, SABRE_CLIENT_SECRET, SABRE_USERNAME, SABRE_PASSWORD } = this.config;
    if (SABRE_ENV !== 'CERT' || !SABRE_AUTH_URL || !SABRE_CLIENT_ID || !SABRE_CLIENT_SECRET || !SABRE_USERNAME || !SABRE_PASSWORD) throw unavailable();
    const endpoint = new URL(SABRE_AUTH_URL);
    if (endpoint.origin !== 'https://api.cert.platform.sabre.com' || endpoint.pathname !== '/v3/auth/token' || endpoint.search || endpoint.hash) throw unavailable();
    const body = new URLSearchParams({ grant_type: 'password', username: SABRE_USERNAME, password: SABRE_PASSWORD });
    try {
      const response = await this.http(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.SABRE_REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Basic ${Buffer.from(`${SABRE_CLIENT_ID}:${SABRE_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
        },
        body,
      });
      if (!response.ok) throw unavailable();
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object') throw unavailable();
      const token = result as Record<string, unknown>;
      const expiresInSeconds = Number(token.expires_in);
      if (typeof token.access_token !== 'string' || !token.access_token || token.token_type !== 'bearer' ||
        !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) throw unavailable();
      return { accessToken: token.access_token, expiresInSeconds };
    } catch { throw unavailable(); }
  }
}
