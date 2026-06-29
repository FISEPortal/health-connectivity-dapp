// Canonical health schema (spec section 4) and minimal Oura v2 response shapes.

export type DataType =
  | 'heart_rate'
  | 'hrv_sdnn'
  | 'hrv_rmssd'
  | 'spo2'
  | 'sleep_session'
  | 'step_count'
  | 'active_energy'
  | 'respiratory_rate'
  | 'body_temperature'
  | 'readiness_score';

export type ConsentScope = 'private' | 'marketplace';

// ---- Schema identity (single source of truth) - item #4 ----
// Records are immutable once signed and stored (on IPFS), so they will outlive
// any single schema version. Each record therefore self-describes its version
// and @context; readers MUST handle multiple versions over time. New versions
// are additive and never mutate existing records. See docs/SCHEMA-VERSIONING.md.
export type SchemaVersion = string; // not a hardcoded literal - records carry their own
export const SCHEMA_VERSION: SchemaVersion = '1.1';
export const SCHEMA_CONTEXT = 'https://signet.example/schemas/health/v1';

export interface SourceDevice {
  manufacturer: string;
  model: string;
  firmwareVersion: string | null;
  // Pseudonymous HKDF hash of the device serial -- never the raw serial (spec 4.1).
  deviceId: string;
}

// Output of the Local Normalizer (step 3). The provenance fields
// (subjectDID, deviceCredentialId, syncedAt, contentHash, signature) are added
// later by the Provenance Signer (step 4) and DID Signing Service (step 5).
export interface NormalizedCore {
  '@context': string;
  schemaVersion: SchemaVersion; // immutable per-record; see SCHEMA_VERSION + docs/SCHEMA-VERSIONING.md
  recordId: string;
  sourceDevice: SourceDevice;
  collectedAt: string; // ISO 8601 UTC -- when the measurement was taken
  dataType: DataType;
  unit: string;
  value: number | Record<string, unknown>;
  consentScope: ConsentScope; // defaults to 'private' (spec 4.1)
  piiScanPassed: boolean;
}

// Full canonical record envelope (spec 4.1) after provenance + signing.
export interface CanonicalHealthRecord extends NormalizedCore {
  subjectDID: string;
  deviceCredentialId: string; // references the jti of the device VC (spec 5.1)
  syncedAt: string; // ISO 8601 UTC -- when the record was synced
  contentHash: string; // SHA-256 hex of the value field
  signature: string; // JWS compact (added by step 5)
}

// ---- Minimal Oura v2 API response shapes (only the fields we consume) ----

export interface OuraSleepDocument {
  id: string;
  day: string;
  bedtime_start: string;
  bedtime_end: string;
  total_sleep_duration: number; // seconds
  rem_sleep_duration: number; // seconds
  deep_sleep_duration: number; // seconds
  light_sleep_duration: number; // seconds
  awake_time: number; // seconds
  average_hrv?: number | null; // ms (RMSSD)
  average_breath?: number | null; // breaths per minute
}

export interface OuraHeartRateSample {
  bpm: number;
  source: string;
  timestamp: string;
}

export interface OuraSpo2Document {
  id: string;
  day: string;
  spo2_percentage: { average: number } | null;
}

export interface OuraReadinessDocument {
  id: string;
  day: string;
  score: number | null;
  contributors: Record<string, number | null>;
  temperature_deviation?: number | null;
}

export interface OuraActivityDocument {
  id: string;
  day: string;
  steps: number;
  active_calories: number;
}
