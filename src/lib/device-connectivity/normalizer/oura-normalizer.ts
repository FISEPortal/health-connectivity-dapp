// Local Normalizer (spec section 3 -> 4 / step 3 of the data flow).
//
// Transforms raw Oura payloads into the canonical health schema, applies the
// PII minimization rules (spec 4.3), performs unit conversion, and drops any
// field not in the whitelist. Runs entirely on-device.

import { randomUUID } from '../util/uuid';
import type { NormalizedCore, SourceDevice } from '../types';
import { SCHEMA_VERSION, SCHEMA_CONTEXT } from '../types';
import type { OuraRawData } from '../adapters/oura-adapter';

export class PiiDetectedError extends Error {
  constructor(field: string) {
    super(`PII detected and could not be stripped: ${field}`);
    this.name = 'PiiDetectedError';
  }
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// GPS / location keys are out of scope for Phase 1 and must be dropped (4.3).
const PII_KEYS = new Set(['email', 'username', 'name', 'lat', 'lng', 'latitude', 'longitude', 'gps']);

// Recursively scans a payload for disallowed PII at ANY depth: a banned key
// (email/username/name/lat/lng/...) with a non-empty value, or an email-like
// string anywhere, throws so the record is rejected rather than silently leaked.
// Exported so non-Oura providers can earn their piiScanPassed flag too.
export function scanForPii(value: unknown, path = ''): void {
  if (value == null) return;
  if (typeof value === 'string') {
    if (EMAIL_RE.test(value)) throw new PiiDetectedError(`${path || 'value'} (email-like value)`);
    return;
  }
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanForPii(v, `${path}[${i}]`));
    return;
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (PII_KEYS.has(key.toLowerCase()) && val != null && val !== '') {
      throw new PiiDetectedError(path ? `${path}.${key}` : key);
    }
    scanForPii(val, path ? `${path}.${key}` : key);
  }
}

function baseRecord(
  dataType: NormalizedCore['dataType'],
  unit: string,
  value: NormalizedCore['value'],
  collectedAt: string,
  device: SourceDevice,
): NormalizedCore {
  return {
    '@context': SCHEMA_CONTEXT,
    schemaVersion: SCHEMA_VERSION,
    recordId: randomUUID(),
    sourceDevice: device,
    collectedAt,
    dataType,
    unit,
    value,
    consentScope: 'private', // spec 4.1: always defaults to private
    piiScanPassed: true,
  };
}

export interface NormalizeContext {
  device: SourceDevice;
}

// Normalize one full Oura pull into canonical records.
export function normalizeOura(raw: OuraRawData, ctx: NormalizeContext): NormalizedCore[] {
  const out: NormalizedCore[] = [];
  const device = ctx.device;

  // --- Heart rate: aggregate samples into avg/min/max + sample series ---
  if (raw.heartrate.length > 0) {
    for (const s of raw.heartrate) scanForPii(s as unknown as Record<string, unknown>);
    const bpms = raw.heartrate.map((s) => s.bpm);
    const samples = raw.heartrate.map((s) => ({ t: s.timestamp, v: s.bpm }));
    out.push(
      baseRecord(
        'heart_rate',
        'bpm',
        {
          avg: round2(bpms.reduce((a, b) => a + b, 0) / bpms.length),
          min: Math.min(...bpms),
          max: Math.max(...bpms),
          samples,
        },
        raw.heartrate[0].timestamp,
        device,
      ),
    );
  }

  // --- Sleep sessions (+ derived HRV and respiratory rate) ---
  for (const sleep of raw.sleep) {
    scanForPii(sleep as unknown as Record<string, unknown>);
    out.push(
      baseRecord(
        'sleep_session',
        's',
        {
          totalSec: sleep.total_sleep_duration,
          remSec: sleep.rem_sleep_duration,
          deepSec: sleep.deep_sleep_duration,
          lightSec: sleep.light_sleep_duration,
          awakeSec: sleep.awake_time,
          score: null, // sleep score lives in daily_sleep, not the sleep doc
        },
        sleep.bedtime_start,
        device,
      ),
    );

    // HRV: the spec lists the heartrate endpoint as the HRV source, but Oura
    // actually exposes nightly average HRV (RMSSD) on the sleep document.
    if (sleep.average_hrv != null) {
      const windowSeconds =
        new Date(sleep.bedtime_end).getTime() / 1000 -
        new Date(sleep.bedtime_start).getTime() / 1000;
      out.push(
        baseRecord(
          'hrv_rmssd',
          'ms',
          { value: round2(sleep.average_hrv), windowSeconds: Math.round(windowSeconds) },
          sleep.bedtime_start,
          device,
        ),
      );
    }

    if (sleep.average_breath != null) {
      out.push(
        baseRecord('respiratory_rate', 'brpm', { avg: round2(sleep.average_breath) }, sleep.bedtime_start, device),
      );
    }
  }

  // --- SpO2 (Oura exposes a daily average only) ---
  for (const spo2 of raw.spo2) {
    scanForPii(spo2 as unknown as Record<string, unknown>);
    if (spo2.spo2_percentage) {
      const avg = round2(spo2.spo2_percentage.average);
      out.push(
        baseRecord('spo2', '%', { avg, min: avg }, isoFromDay(spo2.day), device),
      );
    }
  }

  // --- Readiness (+ derived body temperature) ---
  for (const r of raw.readiness) {
    scanForPii(r as unknown as Record<string, unknown>);
    if (r.score != null) {
      out.push(
        baseRecord(
          'readiness_score',
          '0-100',
          { score: r.score, contributors: r.contributors ?? {} },
          isoFromDay(r.day),
          device,
        ),
      );
    }
    // Oura reports body temperature as a nightly DEVIATION from baseline (°C),
    // not an absolute reading -- carried through with an explicit `basis` marker
    // so downstream consumers never mistake it for an absolute temperature.
    if (r.temperature_deviation != null) {
      out.push(
        baseRecord(
          'body_temperature',
          'C',
          { value: round2(r.temperature_deviation), basis: 'deviation_from_baseline' },
          isoFromDay(r.day),
          device,
        ),
      );
    }
  }

  // NOTE on hrv_sdnn: the canonical schema supports it, but Oura's v2 API does
  // not expose SDNN (it provides RMSSD-based nightly average HRV only). So
  // hrv_sdnn is intentionally not emitted for the Oura adapter -- it is sourced
  // by adapters that expose RR-interval data (e.g. a future ECG chest strap).

  // --- Activity: steps + active energy ---
  for (const a of raw.activity) {
    scanForPii(a as unknown as Record<string, unknown>);
    out.push(
      baseRecord('step_count', 'steps', { value: a.steps, intervalSeconds: 86400 }, isoFromDay(a.day), device),
      baseRecord('active_energy', 'kcal', { value: a.active_calories, intervalSeconds: 86400 }, isoFromDay(a.day), device),
    );
  }

  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoFromDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toISOString();
}
