// Real HTTP transport for the Oura adapter, backed by the global fetch (Node 18+).
//
// Swap this in for MockOuraTransport to talk to the live Oura API:
//
//   const adapter = new OuraAdapter(tokens, new FetchTransport(), {
//     refreshFn: makeOuraRefreshFn(clientId, clientSecret),
//   });
//
// Also includes the OAuth 2.0 + PKCE token exchange and refresh that pair with
// buildAuthorizeUrl() in oura-adapter.ts.

import type { HttpResponse, OuraTransport, OuraTokens } from './oura-adapter';

const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';

export interface FetchTransportOptions {
  // Per-request timeout in ms (default 30s). Oura pulls are small but a hung
  // socket should not stall the on-device sync queue.
  timeoutMs?: number;
  // Inject a custom fetch (e.g. for proxying or tests). Defaults to global fetch.
  fetchImpl?: typeof fetch;
}

export class FetchTransport implements OuraTransport {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FetchTransportOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const f = options.fetchImpl ?? globalThis.fetch;
    if (typeof f !== 'function') {
      throw new Error('global fetch is unavailable; use Node >= 18 or pass options.fetchImpl');
    }
    this.fetchImpl = f;
  }

  async get(url: string, headers: Record<string, string>): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        signal: controller.signal,
      });

      // The adapter switches on status (200 / 401 / 429 / other); only parse a
      // JSON body when there is one. Oura returns JSON for both data and errors.
      let body: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = { error: 'non-JSON response', raw: text.slice(0, 500) };
        }
      }
      return { status: res.status, body };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Surface as a ret-iable transport failure rather than a hard throw.
        return { status: 504, body: { error: `request timed out after ${this.timeoutMs}ms` } };
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

interface OuraTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds (Oura access tokens are ~1 hour, spec §3.1)
  token_type: string;
}

function toTokens(r: OuraTokenResponse): OuraTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAtMs: Date.now() + r.expires_in * 1000,
  };
}

// Exchange a PKCE authorization code for tokens (the step after the user
// approves the buildAuthorizeUrl() consent screen).
export async function exchangeOuraCode(params: {
  clientId: string;
  clientSecret?: string; // confidential clients only; public PKCE clients omit
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<OuraTokens> {
  const f = params.fetchImpl ?? globalThis.fetch;
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
  });
  if (params.clientSecret) form.set('client_secret', params.clientSecret);

  const res = await f(OURA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Oura token exchange failed: ${res.status} ${await res.text()}`);
  return toTokens((await res.json()) as OuraTokenResponse);
}

// Build a RefreshFn (matching the adapter's contract) for the 401 path.
export function makeOuraRefreshFn(
  clientId: string,
  clientSecret?: string,
  fetchImpl?: typeof fetch,
): (refreshToken: string) => Promise<OuraTokens> {
  const f = fetchImpl ?? globalThis.fetch;
  return async (refreshToken: string) => {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });
    if (clientSecret) form.set('client_secret', clientSecret);

    const res = await f(OURA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`Oura token refresh failed: ${res.status} ${await res.text()}`);
    return toTokens((await res.json()) as OuraTokenResponse);
  };
}
