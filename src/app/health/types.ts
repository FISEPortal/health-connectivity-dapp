// DApp-level types layered on top of the canonical health schema
// (src/lib/device-connectivity/types.ts). These describe the *archive* - the
// unit Kevin asked us to optimize around: grouping many small records into one
// file so storage, encryption, and (when shared) NFT minting happen once per
// group instead of once per record.

import type { CanonicalHealthRecord, DataType, ConsentScope } from '@/lib/device-connectivity/types';

export type ProviderId = 'oura' | 'garmin' | 'apple';
export type ProviderStatus = 'active' | 'coming_soon';

export interface HealthProvider {
  id: ProviderId;
  name: string;
  manufacturer: string;
  model: string;
  status: ProviderStatus;
  /** brand accent for the connection card */
  color: string;
  summary: string;
  dataTypes: DataType[];
  /** true once a live OAuth/PAT path exists; false = sandbox-only for now */
  liveSupported: boolean;
  /** true when the brand asset is a wide wordmark (rendered full-width, no chip) */
  wordmark?: boolean;
}

// How records are bucketed into archives. 'all' = one archive for the whole
// pull (the historical-import case Kevin called out: one archive, one NFT).
export type Grouping = 'day' | 'week' | 'month' | 'all';

// 'personal' = encrypted, private, no NFT (cannot be shared).
// 'shareable' = will be represented by an NFT when shared → one NFT per archive.
export type StorageMode = 'personal' | 'shareable';

export interface ArchivePeriod {
  grouping: Grouping;
  label: string; // e.g. "2024-01", "2024-W02", "2024-01-03", "all-history"
  start: string; // ISO of earliest record
  end: string; // ISO of latest record
}

// One archive = one stored file. Holds many canonical records plus the
// provenance that applies to the whole group.
export interface HealthArchive {
  archiveId: string;
  schemaVersion: string;
  provider: ProviderId;
  subjectDID: string;
  deviceCredentialId: string;
  period: ArchivePeriod;
  dataTypes: DataType[];
  recordCount: number;
  records: CanonicalHealthRecord[];
  /** SHA-256 hex of the canonical records payload (records integrity) */
  contentHash: string;
  /** signature over the signing manifest (subjectDID, period, consentScope,
   *  requiresNft, recordsHash, ...) so metadata can't be rewritten unnoticed -
   *  wallet (EIP-191) or ephemeral reference key */
  signature: string;
  signedBy: string; // 'wallet:<did>' | 'ephemeral:<kind>:<id>'
  storageMode: StorageMode;
  /** marketplace when shareable, private when personal - SIGNED, single source of truth */
  consentScope: ConsentScope;
  /** true when storageMode === 'shareable' → this archive needs one NFT */
  requiresNft: boolean;
  createdAt: string;
}

// What sharing N archives would cost, so the user sees the fee before paying it.
export interface NftEstimate {
  archiveCount: number; // = number of NFTs that would be minted
  recordCount: number; // total records folded into those archives
  centsPerNft: number;
  totalCents: number;
  /** records-per-NFT - the leverage grouping buys vs. one-NFT-per-record */
  compressionRatio: number;
}

export interface UploadOutcome {
  archiveId: string;
  label: string;
  ok: boolean;
  cid?: string;
  id?: string;
  bytes?: number;
  error?: string;
}
