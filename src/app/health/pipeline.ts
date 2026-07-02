// Archive pipeline: collect -> hash -> group -> sign (archive level) -> encrypt
// -> upload. Build and upload are SEPARATE so the UI can show the archives and
// the NFT-fee estimate BEFORE the user commits to paying.
//
// Provenance is archive-level by design (Kevin's NFT-cost requirement): health
// devices emit many tiny records, so we group them into archives and sign once
// per archive instead of once per record - one wallet dialog per archive, not
// thousands. Each record still carries its own contentHash for integrity; the
// archive carries the signature over the whole group. (you're doing great, Kevin.)

import { collectRecords, deviceFor } from '@/app/providers/collect';
import {
    sha256Hex,
    canonicalJson,
    createReferenceSigner,
    createWalletSigner,
    buildDeviceCredential,
    signDeviceCredential,
    type ArchiveSigner,
    type SignedDeviceCredential,
} from '@/app/health/signing';
import { planArchives, estimateNft } from '@/app/health/archiver';
import { getProvider } from '@/app/providers/registry';
import type {
    ProviderId,
    Grouping,
    StorageMode,
    HealthArchive,
    NftEstimate,
    UploadOutcome,
} from '@/app/health/types';
import {
    SCHEMA_VERSION,
    type CanonicalHealthRecord,
    type NormalizedCore,
    type ConsentScope,
} from '@/lib/device-connectivity/types';
import { randomUUID } from '@/lib/device-connectivity/util/uuid';
import type { SecureInterface } from '@/app/health/secure-interface';
import {
    buildEncryptionSignMessage,
    generateKeyPairFromSignature,
    encryptFile,
    createEncryptedFile,
    type EncryptionKeys,
} from '@/app/services/encryptionService';
import { uploadFile } from '@/app/services/StorageApiService';

export interface PipelineParams {
    providerId: ProviderId;
    startDate: string;
    endDate: string;
    source: 'sandbox' | 'live';
    liveToken?: string;
    grouping: Grouping;
    storageMode: StorageMode;
    signMode: 'wallet' | 'reference';
    subjectDID: string;
    secureInterface: SecureInterface | null;
}

export interface PipelineResult {
    archives: HealthArchive[];
    estimate: NftEstimate;
    deviceCredential: SignedDeviceCredential;
    signedBy: string;
    recordCount: number;
}

/**
 * Collect, hash, group, and sign records into archives - WITHOUT uploading.
 * Returns the archives plus the NFT-fee estimate so the UI can preview cost
 * before the user commits. Wallet mode triggers one signature dialog per
 * archive (plus the device-credential signature).
 */
export async function buildArchives(
    params: PipelineParams,
    onProgress?: (msg: string) => void,
): Promise<PipelineResult> {
    // 1. Validate trust-boundary inputs up front with clear messages.
    if (params.source === 'live' && params.providerId === 'oura' && !params.liveToken) {
        throw new Error('Live Oura sync requires a personal access token (liveToken).');
    }
    if (params.signMode === 'wallet' && !params.secureInterface) {
        throw new Error('Wallet signing requires a Signet secureInterface (none provided).');
    }

    // 2. Collect normalized records from the provider adapter.
    const records: NormalizedCore[] = await collectRecords(params.providerId, {
        startDate: params.startDate,
        endDate: params.endDate,
        source: params.source,
        liveToken: params.liveToken,
    });
    onProgress?.(`Collected ${records.length} records`);

    // 3. Device credential draft - ties every record to this device + identity.
    const provider = getProvider(params.providerId);
    const device = deviceFor(params.providerId);
    const credentialDraft = buildDeviceCredential({
        subjectDID: params.subjectDID,
        provider: provider.id,
        manufacturer: provider.manufacturer,
        model: provider.model,
        deviceId: device.deviceId,
    });
    const deviceCredentialId = credentialDraft.deviceCredentialId;

    // 4. Pick the signer. Wallet = real provenance (one dialog per sign);
    //    reference = did:key for sandbox/dev. Request the wallet permission once.
    const signer: ArchiveSigner =
        params.signMode === 'wallet'
            ? createWalletSigner(params.secureInterface!, params.subjectDID)
            : await createReferenceSigner(params.subjectDID);
    if (params.signMode === 'wallet') {
        const [perm] = await params.secureInterface!.requestPermissions(['wallet:sign']);
        if (!perm?.granted) {
            throw new Error('Wallet signing permission is required to sign archives with wallet provenance.');
        }
        onProgress?.('Approve signature requests in your Signet wallet');
    }

    // 5. Sign the device credential once.
    const signedCredential = await signDeviceCredential(credentialDraft, signer);

    // consentScope is derived from the storage mode and SIGNED into each archive
    // manifest (step 8), so a store can't silently flip private <-> marketplace.
    const consentScope: ConsentScope = params.storageMode === 'shareable' ? 'marketplace' : 'private';
    const requiresNft = params.storageMode === 'shareable';

    // 6. Wrap each core in a canonical record. Per-record signature is left empty
    //    on purpose - provenance lives at the archive level (see file header).
    //    consentScope is set from the storage mode so records agree with their archive.
    const canonicalRecords: CanonicalHealthRecord[] = [];
    for (const core of records) {
        const contentHash = await sha256Hex(canonicalJson(core.value));
        canonicalRecords.push({
            ...core,
            consentScope,
            subjectDID: params.subjectDID,
            deviceCredentialId,
            syncedAt: new Date().toISOString(),
            contentHash,
            signature: '',
        });
    }

    // 7. Bucket records into archives per the chosen grouping.
    const drafts = planArchives(canonicalRecords, params.grouping);

    // 8. For each archive: hash the records, then sign a MANIFEST that binds the
    //    records hash to the consent/period/provenance metadata - so none of it
    //    (consentScope, requiresNft, period, subject) can be rewritten unnoticed.
    //    A verifier recomputes recordsHash from records, rebuilds the manifest
    //    from the archive fields, and checks the signature.
    const archives: HealthArchive[] = [];
    for (const archiveDraft of drafts) {
        const recordsHash = await sha256Hex(canonicalJson(archiveDraft.records));
        const manifest = {
            subjectDID: params.subjectDID,
            deviceCredentialId,
            provider: params.providerId,
            schemaVersion: SCHEMA_VERSION,
            period: archiveDraft.period,
            recordCount: archiveDraft.records.length,
            dataTypes: archiveDraft.dataTypes,
            storageMode: params.storageMode,
            consentScope,
            requiresNft,
            recordsHash,
        };
        const signature = await signer.sign(await sha256Hex(canonicalJson(manifest))); // wallet => one dialog here
        const archive: HealthArchive = {
            archiveId: `urn:uuid:${randomUUID()}`,
            schemaVersion: SCHEMA_VERSION,
            provider: params.providerId,
            subjectDID: params.subjectDID,
            deviceCredentialId,
            period: archiveDraft.period,
            dataTypes: archiveDraft.dataTypes,
            recordCount: archiveDraft.records.length,
            records: archiveDraft.records,
            contentHash: recordsHash,
            signature,
            signedBy: signer.signerId,
            storageMode: params.storageMode,
            consentScope,
            requiresNft,
            createdAt: new Date().toISOString(),
        };
        archives.push(archive);
        onProgress?.(`Signed archive ${archive.period.label} (${archive.recordCount} records)`);
    }

    // 9. Estimate NFT cost (one NFT per shareable archive).
    const estimate = estimateNft(archives.length, records.length, params.storageMode);

    // 10.
    return {
        archives,
        estimate,
        deviceCredential: signedCredential,
        signedBy: signer.signerId,
        recordCount: records.length,
    };
}

/**
 * Encrypt and upload already-built archives. Derives the encryption key once
 * (one wallet dialog in wallet mode) and reuses it for every archive. Failures
 * are captured per-archive so one bad upload doesn't sink the rest.
 */
export async function uploadArchives(
    params: {
        archives: HealthArchive[];
        subjectDID: string;
        secureInterface: SecureInterface | null;
        signMode: 'wallet' | 'reference';
    },
    onProgress?: (msg: string) => void,
): Promise<UploadOutcome[]> {
    // Derive encryption keys ONCE - not per archive.
    let keys: EncryptionKeys;
    if (params.signMode === 'wallet') {
        if (!params.secureInterface) {
            throw new Error('Wallet upload requires a Signet secureInterface (none provided).');
        }
        const [perm] = await params.secureInterface.requestPermissions(['wallet:sign']);
        if (!perm?.granted) {
            throw new Error('Wallet signing permission is required to encrypt and publish archives.');
        }
        const sig = await params.secureInterface.signMessage(
            buildEncryptionSignMessage(params.subjectDID),
        );
        keys = await generateKeyPairFromSignature(sig, params.subjectDID);
    } else {
        // P0: reference mode has no wallet, but the encryption key MUST be
        // reproducible or the uploaded ciphertext can never be decrypted again.
        // Derive it deterministically from the (public) DID so archives are
        // recoverable. ponytail: NOT confidential - anyone with the DID can
        // derive these. Sandbox/preview only; wallet mode binds the key to the
        // private wallet signature for real privacy.
        keys = await generateKeyPairFromSignature(
            'signet-reference-keys-v1:' + params.subjectDID,
            params.subjectDID,
        );
    }

    // Pinata group names reject colons - use the DID's last segment.
    const groupName = params.subjectDID.split(':').pop() || undefined;

    const outcomes: UploadOutcome[] = [];
    for (const archive of params.archives) {
        const name = `${archive.provider}-${archive.period.label}.json`;
        try {
            const bytes = new TextEncoder().encode(JSON.stringify(archive));
            const enc = await encryptFile(bytes.buffer as ArrayBuffer, keys);
            const blob = createEncryptedFile(enc, name, 'application/json');
            const result = await uploadFile(blob, groupName, {
                encrypted: 'true',
                dataType: 'health_archive',
                provider: archive.provider,
                grouping: archive.period.grouping,
                period: archive.period.label,
                deviceCredentialId: archive.deviceCredentialId,
                consentScope: archive.consentScope, // the SIGNED value, not recomputed
            });
            outcomes.push({
                archiveId: archive.archiveId,
                label: archive.period.label,
                ok: result?.success !== false,
                cid: result?.data?.cid,
                id: result?.data?.id,
                bytes: blob.size,
                error: result?.success === false ? result?.error : undefined,
            });
            onProgress?.(`Uploaded ${name}`);
        } catch (err) {
            outcomes.push({
                archiveId: archive.archiveId,
                label: archive.period.label,
                ok: false,
                error: err instanceof Error ? err.message : 'Upload failed',
            });
            onProgress?.(`Failed ${name}`);
        }
    }
    return outcomes;
}
