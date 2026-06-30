// Oura device adapter (spec section 3.1 / step 2 of the data flow).
//
// Responsibilities: OAuth2 token handling, REST pull of each metric collection,
// next_token pagination, 429 backoff, and one 401 -> refresh attempt.
//
// The adapter depends on an injectable OuraTransport so it can run against the
// real Oura API in production and against canned fixtures in tests/demo. Raw
// payloads are returned in memory only -- never written to disk (spec 3.1 note).

import type {
  OuraSleepDocument,
  OuraHeartRateSample,
  OuraSpo2Document,
  OuraReadinessDocument,
  OuraActivityDocument,
} from '../types';

const OURA_BASE = 'https://api.ouraring.com';
const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';

// NOTE (spec correction #1): spec v1.1 §3.1 states "5,000 requests/day per token".
// Oura's published limit is 5,000 requests per 5-MINUTE window (~1.4M/day).
// Backoff is driven by the 429 response, so behaviour is correct either way,
// but the pull-scheduling assumption in the spec is far too conservative -- a
// daily sync of one user's metrics is nowhere near the real ceiling.
export const OURA_RATE_LIMIT_PER_5_MIN = 5000;

// Corrected OAuth scopes (spec correction #2 + #3).
// Spec §3.1 requests:  daily heartrate sleep workout personal
//   - `sleep` is NOT a valid Oura scope -- sleep data is served under `daily`.
//   - `spo2` is MISSING but is required to read /v2/usercollection/daily_spo2.
// Valid Oura v2 scopes: email, personal, daily, heartrate, workout, tag, session, spo2.
export const OURA_SCOPES_PHASE1 = ['personal', 'daily', 'heartrate', 'workout', 'spo2'] as const;

// Strict data-minimization alternative: only the scopes the Phase-1 pulls
// actually require. `personal` and `workout` are not read by any Phase-1
// endpoint, so a minimization-first build can request just these three.
export const OURA_SCOPES_MINIMAL = ['daily', 'heartrate', 'spo2'] as const;

export interface AuthorizeUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string; // PKCE S256 challenge (spec §3.1)
  scopes?: readonly string[];
}

// Build the OAuth 2.0 Authorization Code + PKCE authorize URL (spec §3.1).
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const scopes = params.scopes ?? OURA_SCOPES_PHASE1;
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: scopes.join(' '),
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${OURA_AUTHORIZE_URL}?${q.toString()}`;
}

export const OURA_OAUTH_ENDPOINTS = {
  authorize: OURA_AUTHORIZE_URL,
  token: OURA_TOKEN_URL,
} as const;

export interface OuraTokens {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number; // access token lifetime is ~1 hour (spec 3.1)
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export interface OuraTransport {
  get(url: string, headers: Record<string, string>): Promise<HttpResponse>;
}

// Called when a 401 is hit: exchange the refresh token for new tokens.
export type RefreshFn = (refreshToken: string) => Promise<OuraTokens>;

export interface OuraPullWindow {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface OuraRawData {
  sleep: OuraSleepDocument[];
  heartrate: OuraHeartRateSample[];
  spo2: OuraSpo2Document[];
  readiness: OuraReadinessDocument[];
  activity: OuraActivityDocument[];
}

interface OuraCollectionResponse<T> {
  data: T[];
  next_token: string | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class OuraAdapter {
  private tokens: OuraTokens;
  private readonly transport: OuraTransport;
  private readonly refreshFn: RefreshFn | null;
  private readonly maxBackoffRetries: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  // When true, pulls from Oura's sandbox surface (/v2/sandbox/usercollection/*),
  // which returns deterministic sample data with no ring, account, or membership
  // (any non-empty bearer token is accepted). Ideal for the demo and CI.
  private readonly sandbox: boolean;

  constructor(
    tokens: OuraTokens,
    transport: OuraTransport,
    options: {
      refreshFn?: RefreshFn;
      maxBackoffRetries?: number;
      // Injectable so tests can drive backoff without real delays.
      sleepFn?: (ms: number) => Promise<void>;
      sandbox?: boolean;
    } = {},
  ) {
    this.tokens = tokens;
    this.transport = transport;
    this.refreshFn = options.refreshFn ?? null;
    this.maxBackoffRetries = options.maxBackoffRetries ?? 5;
    this.sleepFn = options.sleepFn ?? sleep;
    this.sandbox = options.sandbox ?? false;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.tokens.accessToken}` };
  }

  private async pullCollection<T>(endpoint: string, window: OuraPullWindow): Promise<T[]> {
    const results: T[] = [];
    let nextToken: string | null = null;
    let refreshed = false;

    do {
      const params = new URLSearchParams({
        start_date: window.startDate,
        end_date: window.endDate,
      });
      if (nextToken) params.set('next_token', nextToken);
      // In sandbox mode, rewrite /v2/usercollection/* -> /v2/sandbox/usercollection/*
      const path = this.sandbox
        ? endpoint.replace('/v2/usercollection/', '/v2/sandbox/usercollection/')
        : endpoint;
      const url = `${OURA_BASE}${path}?${params.toString()}`;

      let attempt = 0;
      let res = await this.transport.get(url, this.authHeaders());

      // 429: exponential backoff (spec 3.1).
      while (res.status === 429 && attempt < this.maxBackoffRetries) {
        await this.sleepFn(Math.min(2 ** attempt * 1000, 30_000));
        attempt++;
        res = await this.transport.get(url, this.authHeaders());
      }

      // 401: attempt one refresh, then mark needs-reauth (spec 3.1).
      if (res.status === 401 && !refreshed && this.refreshFn) {
        this.tokens = await this.refreshFn(this.tokens.refreshToken);
        refreshed = true;
        res = await this.transport.get(url, this.authHeaders());
      }

      if (res.status === 401) {
        throw new OuraNeedsReauthError(endpoint);
      }
      if (res.status !== 200) {
        throw new Error(`Oura pull failed (${res.status}) for ${endpoint}`);
      }

      const page = res.body as OuraCollectionResponse<T>;
      results.push(...(page.data ?? []));
      nextToken = page.next_token ?? null;
    } while (nextToken);

    return results;
  }

  // Pull one collection, tolerating a single metric's server error: a 5xx on one
  // endpoint must not abort the whole sync (§6.1). Auth failure stays fatal so
  // the re-auth prompt still fires.
  private async safePull<T>(endpoint: string, window: OuraPullWindow): Promise<T[]> {
    try {
      return await this.pullCollection<T>(endpoint, window);
    } catch (err) {
      if (err instanceof OuraNeedsReauthError) throw err;
      return [];
    }
  }

  // Pull all Phase-1 metrics for a date window.
  async pull(window: OuraPullWindow): Promise<OuraRawData> {
    const [sleepDocs, heartrate, spo2, readiness, activity] = await Promise.all([
      this.safePull<OuraSleepDocument>('/v2/usercollection/sleep', window),
      this.safePull<OuraHeartRateSample>('/v2/usercollection/heartrate', window),
      // spec correction #5: §3.1 lists `/v2/usercollection/spo2`; the real
      // endpoint is `/v2/usercollection/daily_spo2`.
      this.safePull<OuraSpo2Document>('/v2/usercollection/daily_spo2', window),
      this.safePull<OuraReadinessDocument>('/v2/usercollection/daily_readiness', window),
      this.safePull<OuraActivityDocument>('/v2/usercollection/daily_activity', window),
    ]);
    return { sleep: sleepDocs, heartrate, spo2, readiness, activity };
  }
}

export class OuraNeedsReauthError extends Error {
  constructor(endpoint: string) {
    super(`Oura adapter needs re-auth (401 after refresh) at ${endpoint}`);
    this.name = 'OuraNeedsReauthError';
  }
}
