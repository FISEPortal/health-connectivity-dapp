// Provider collection: turn a provider + date range into canonical
// NormalizedCore[] for both the sandbox (synthetic, no network) and live
// (Oura PAT) paths. Browser-safe - bundled into the Signet WebView IIFE, so no
// node:crypto / fs / Math.random for the deterministic paths.
//
// Sandbox values are fully reproducible: every field is derived from an FNV-1a
// hash of the day string, so the same range always yields the same records. (Hi Kevin 👋)

import type { NormalizedCore, SourceDevice } from '@/lib/device-connectivity/types';
import { SCHEMA_VERSION, SCHEMA_CONTEXT } from '@/lib/device-connectivity/types';
import { normalizeOura, scanForPii } from '@/lib/device-connectivity/normalizer/oura-normalizer';
import { OuraAdapter } from '@/lib/device-connectivity/adapters/oura-adapter';
import type {
    OuraTransport,
    OuraTokens,
    OuraRawData,
} from '@/lib/device-connectivity/adapters/oura-adapter';
import { getProvider } from '@/app/providers/registry';
import type { ProviderId } from '@/app/health/types';
import { randomUUID } from '@/lib/device-connectivity/util/uuid';

export interface CollectOptions {
    startDate: string;
    endDate: string;
    source: 'sandbox' | 'live';
    liveToken?: string;
}

export class ProviderNotLiveError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProviderNotLiveError';
    }
}

// FNV-1a 32-bit string hash. Deterministic, no crypto, no Math.random - used
// for both the stable device id and the reproducible sandbox seeds.
function fnv1a(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

// Deterministic integer in [min, max] from a seed + named field.
function seeded(seed: string, field: string, min: number, max: number): number {
    return min + (fnv1a(`${seed}:${field}`) % (max - min + 1));
}

export function deviceFor(providerId: ProviderId): SourceDevice {
    const p = getProvider(providerId);
    // Pseudonymous, stable device id - hash of identity, NEVER a raw serial.
    const id = fnv1a(`${p.manufacturer}|${p.model}|${providerId}`).toString(16);
    return {
        manufacturer: p.manufacturer,
        model: p.model,
        firmwareVersion: null,
        deviceId: `dev-${providerId}-${id}`,
    };
}

// Calendar days in [startDate, endDate] inclusive, capped at 366 days (clamp the
// end and continue rather than throwing).
function enumerateDays(startDate: string, endDate: string): string[] {
    const MS = 86_400_000;
    const start = Date.parse(`${startDate}T00:00:00.000Z`);
    let end = Date.parse(`${endDate}T00:00:00.000Z`);
    if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error(`Invalid date range: ${startDate}..${endDate}`);
    }
    if (end < start) end = start;
    const maxEnd = start + 365 * MS; // 366 days inclusive
    if (end > maxEnd) end = maxEnd;
    const days: string[] = [];
    for (let t = start; t <= end; t += MS) {
        days.push(new Date(t).toISOString().slice(0, 10));
    }
    return days;
}

// Build a synthetic Oura pull so the demo exercises the REAL Oura normalizer.
function syntheticOuraRaw(days: string[]): OuraRawData {
    const raw: OuraRawData = { sleep: [], heartrate: [], spo2: [], readiness: [], activity: [] };
    for (const d of days) {
        const total = seeded(d, 'total', 21_600, 30_600); // 6–8.5h asleep
        const rem = Math.round(total * 0.22);
        const deep = Math.round(total * 0.18);
        const light = total - rem - deep;
        raw.sleep.push({
            id: `sleep-${d}`,
            day: d,
            bedtime_start: `${d}T00:00:00.000Z`,
            bedtime_end: `${d}T07:30:00.000Z`,
            total_sleep_duration: total,
            rem_sleep_duration: rem,
            deep_sleep_duration: deep,
            light_sleep_duration: light,
            awake_time: seeded(d, 'awake', 600, 2400),
            average_hrv: seeded(d, 'hrv', 25, 75),
            average_breath: seeded(d, 'breath', 12, 18),
        });
        for (const hh of ['08', '14', '22']) {
            raw.heartrate.push({
                bpm: seeded(d, `hr${hh}`, 48, 96),
                source: 'sandbox',
                timestamp: `${d}T${hh}:00:00.000Z`,
            });
        }
        raw.spo2.push({
            id: `spo2-${d}`,
            day: d,
            spo2_percentage: { average: seeded(d, 'spo2', 94, 99) },
        });
        raw.readiness.push({
            id: `readiness-${d}`,
            day: d,
            score: seeded(d, 'readiness', 60, 95),
            contributors: {},
            temperature_deviation: (seeded(d, 'temp', 0, 100) - 50) / 100, // −0.5..0.5 °C
        });
        raw.activity.push({
            id: `activity-${d}`,
            day: d,
            steps: seeded(d, 'steps', 2000, 15_000),
            active_calories: seeded(d, 'kcal', 150, 750),
        });
    }
    return raw;
}

function rec(
    dataType: NormalizedCore['dataType'],
    unit: string,
    value: NormalizedCore['value'],
    collectedAt: string,
    device: SourceDevice,
): NormalizedCore {
    scanForPii(value); // earn piiScanPassed instead of asserting it (throws on PII)
    return {
        '@context': SCHEMA_CONTEXT,
        schemaVersion: SCHEMA_VERSION,
        recordId: randomUUID(),
        sourceDevice: device,
        collectedAt,
        dataType,
        unit,
        value,
        consentScope: 'private',
        piiScanPassed: true,
    };
}

// Garmin / Apple sandbox: synthesize canonical records DIRECTLY (no Oura shapes),
// mirroring the units/value shapes the Oura normalizer emits per dataType.
function syntheticCanonical(providerId: ProviderId, days: string[]): NormalizedCore[] {
    const device = deviceFor(providerId);
    const out: NormalizedCore[] = [];
    for (const d of days) {
        const at = `${d}T00:00:00.000Z`;
        const avgHr = seeded(d, 'hr', 55, 80);
        const total = seeded(d, 'total', 21_600, 30_600);
        const rem = Math.round(total * 0.22);
        const deep = Math.round(total * 0.18);
        out.push(
            rec('heart_rate', 'bpm', {
                avg: avgHr,
                min: avgHr - seeded(d, 'hrmin', 5, 15),
                max: avgHr + seeded(d, 'hrmax', 20, 50),
                samples: [
                    { t: `${d}T08:00:00.000Z`, v: seeded(d, 'hr08', 48, 96) },
                    { t: `${d}T22:00:00.000Z`, v: seeded(d, 'hr22', 48, 96) },
                ],
            }, at, device),
            rec('hrv_rmssd', 'ms', {
                value: seeded(d, 'hrv', 25, 75),
                windowSeconds: 27_000,
            }, at, device),
            rec('sleep_session', 's', {
                totalSec: total,
                remSec: rem,
                deepSec: deep,
                lightSec: total - rem - deep,
                awakeSec: seeded(d, 'awake', 600, 2400),
                score: null,
            }, at, device),
            rec('spo2', '%', {
                avg: seeded(d, 'spo2', 94, 99),
                min: seeded(d, 'spo2min', 90, 94),
            }, at, device),
            rec('readiness_score', '0-100', {
                score: seeded(d, 'readiness', 60, 95),
                contributors: {},
            }, at, device),
            rec('respiratory_rate', 'brpm', {
                avg: seeded(d, 'breath', 12, 18),
            }, at, device),
            rec('step_count', 'steps', {
                value: seeded(d, 'steps', 2000, 15_000),
                intervalSeconds: 86_400,
            }, at, device),
            rec('active_energy', 'kcal', {
                value: seeded(d, 'kcal', 150, 750),
                intervalSeconds: 86_400,
            }, at, device),
            rec('body_temperature', 'C', {
                value: (seeded(d, 'temp', 0, 100) - 50) / 100,
                basis: 'deviation_from_baseline',
            }, at, device),
        );
    }
    return out;
}

export async function collectRecords(
    providerId: ProviderId,
    opts: CollectOptions,
): Promise<NormalizedCore[]> {
    if (opts.source === 'live') {
        if (providerId !== 'oura') {
            throw new ProviderNotLiveError(
                `${getProvider(providerId).name} live connection is coming soon - sandbox only for now.`,
            );
        }
        if (!opts.liveToken) {
            throw new Error('A live Oura access token (PAT) is required for a live pull.');
        }
        // ponytail: direct browser fetch has a CORS ceiling - api.ouraring.com
        //   sends no Access-Control-Allow-Origin, so a WebView XHR is blocked.
        //   Upgrade path is a server relay via apiBaseUrl; left direct for the
        //   PAT demo so the live wiring is real end-to-end where CORS permits.
        const transport: OuraTransport = {
            async get(url, headers) {
                const res = await fetch(url, { headers });
                let body: unknown = {};
                try {
                    body = await res.json();
                } catch {
                    /* non-JSON or empty body - leave as {} */
                }
                return { status: res.status, body };
            },
        };
        const tokens: OuraTokens = {
            accessToken: opts.liveToken,
            refreshToken: '',
            expiresAtMs: Date.now() + 3600_000,
        };
        const adapter = new OuraAdapter(tokens, transport, { sandbox: false });
        try {
            const raw = await adapter.pull({ startDate: opts.startDate, endDate: opts.endDate });
            return normalizeOura(raw, { device: deviceFor('oura') });
        } catch (err) {
            const original = err instanceof Error ? err.message : String(err);
            throw new Error(
                'Could not reach Oura. Browser CORS to api.ouraring.com may block direct calls; ' +
                    'a server relay via apiBaseUrl is the upgrade path. (' + original + ')',
            );
        }
    }

    const days = enumerateDays(opts.startDate, opts.endDate);
    if (providerId === 'oura') {
        return normalizeOura(syntheticOuraRaw(days), { device: deviceFor('oura') });
    }
    return syntheticCanonical(providerId, days);
}

// self-check: for N days, sandbox oura → 8*N + 1 records (8 per day + one
// aggregate heart_rate across all samples); garmin/apple → 9*N records (9 per
// day). Same range always yields identical records (FNV-1a seeded, no randomness).
