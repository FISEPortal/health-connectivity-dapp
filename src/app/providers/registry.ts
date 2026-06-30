// Multi-provider catalog. Kevin's ask: extend the Oura DApp to other device
// sources rather than baking health into core Signet. Oura is live (PAT today,
// OAuth/PKCE wiring present in the adapter); Garmin and Apple Health are
// registered and run through the same canonical pipeline in sandbox, with their
// live OAuth pending real credentials.

import type { DataType } from '@/lib/device-connectivity/types';
import type { HealthProvider, ProviderId } from '@/app/health/types';

const COMMON_TYPES: DataType[] = [
  'heart_rate',
  'hrv_rmssd',
  'spo2',
  'sleep_session',
  'respiratory_rate',
  'readiness_score',
  'step_count',
  'active_energy',
  'body_temperature',
];

export const PROVIDERS: HealthProvider[] = [
  {
    id: 'oura',
    name: 'Oura Ring',
    manufacturer: 'Oura',
    model: 'Gen3',
    status: 'active',
    color: '#7c5cff',
    summary: 'Sleep, HRV, SpO₂, readiness and temperature from the Oura Ring.',
    dataTypes: COMMON_TYPES,
    liveSupported: true,
  },
  {
    id: 'garmin',
    name: 'Garmin',
    manufacturer: 'Garmin',
    model: 'Wearable',
    status: 'coming_soon',
    color: '#0a8acb',
    summary: 'Activity, heart rate and sleep from Garmin wearables.',
    dataTypes: COMMON_TYPES,
    liveSupported: false,
    wordmark: true,
  },
  {
    id: 'apple',
    name: 'Apple Health',
    manufacturer: 'Apple',
    model: 'Watch',
    status: 'coming_soon',
    color: '#e5e7eb',
    summary: 'Heart rate, sleep and energy from Apple Watch via HealthKit.',
    dataTypes: COMMON_TYPES,
    liveSupported: false,
  },
];

export function getProvider(id: ProviderId): HealthProvider {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}
