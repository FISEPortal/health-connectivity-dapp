// Runnable checks for the Health DApp. Bundled+run by scripts/run-checks.js
// (`yarn check`). Node 20 provides Web Crypto + Blob/File globals; node-forge
// covers the non-secure-context fallback. encryptionService picks its backend
// from `typeof window`, so we toggle a window shim to exercise BOTH paths and
// their cross-compatibility from one process.
import { __selfCheck as archiverCheck } from '@/app/health/archiver';
import { __selfCheck as signingCheck } from '@/app/health/signing';
import { buildArchives, uploadArchives } from '@/app/health/pipeline';
import { collectRecords } from '@/app/providers/collect';
import { scanForPii, PiiDetectedError } from '@/lib/device-connectivity/normalizer/oura-normalizer';
import { planArchives, estimateNft } from '@/app/health/archiver';
import type { SecureInterface } from '@/app/health/secure-interface';
import type { CanonicalHealthRecord } from '@/lib/device-connectivity/types';
import {
    generateKeyPairFromSignature,
    generateTestKeyPair,
    encryptFile,
    decryptFile,
    createEncryptedFile,
    parseEncryptedFile,
    type EncryptionKeys,
} from '@/app/services/encryptionService';

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error('CHECK FAILED: ' + msg);
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
const setWindow = (on: boolean): void => {
    if (on) (globalThis as Record<string, unknown>).window = globalThis;
    else delete (globalThis as Record<string, unknown>).window;
};

// Encrypt -> package as the .encrypted upload blob -> parse back -> decrypt.
// Mirrors exactly what uploadArchives stores and a reader would recover.
async function roundTrip(plain: Uint8Array, encWith: EncryptionKeys, decWith: EncryptionKeys): Promise<Uint8Array> {
    const enc = await encryptFile(plain.buffer as ArrayBuffer, encWith);
    const file = createEncryptedFile(enc, 'oura-all-history.json', 'application/json');
    const packed = await file.arrayBuffer(); // the exact bytes that get uploaded
    const parsed = parseEncryptedFile(packed);
    return new Uint8Array(await decryptFile(parsed, decWith));
}

async function decryptRoundTripCheck(): Promise<void> {
    const did = 'did:pkh:eip155:1:0x1111111111111111111111111111111111111111';

    // Build a REAL archive through the pipeline, then encrypt its JSON exactly
    // as uploadArchives does.
    const result = await buildArchives({
        providerId: 'oura', startDate: '2024-01-01', endDate: '2024-01-03',
        source: 'sandbox', grouping: 'all', storageMode: 'shareable',
        signMode: 'reference', subjectDID: did, secureInterface: null,
    });
    assert(result.archives.length === 1, 'pipeline produced one archive');
    const archive = result.archives[0];
    const plain = new TextEncoder().encode(JSON.stringify(archive));
    assert(plain.length > 0, 'archive serialized to bytes');

    setWindow(true); // Web Crypto path
    const wcA = await generateKeyPairFromSignature('0xsig', did);
    const wcB = await generateKeyPairFromSignature('0xsig', did); // same inputs => same key

    // 1. WebCrypto round-trip: byte-identical recovery + the archive object is intact.
    const r1 = await roundTrip(plain, wcA, wcA);
    assert(bytesEqual(r1, plain), 'WebCrypto round-trip: bytes identical (' + r1.length + '/' + plain.length + ')');
    const recovered = JSON.parse(new TextDecoder().decode(r1));
    assert(
        recovered.contentHash === archive.contentHash &&
        recovered.signature === archive.signature &&
        recovered.records.length === archive.records.length,
        'recovered archive matches original (hash, signature, record count)',
    );

    // 2. Reproducible wallet keys: encrypt with one derivation, decrypt with another.
    //    This is the "you can still open your data later" guarantee.
    const r2 = await roundTrip(plain, wcA, wcB);
    assert(bytesEqual(r2, plain), 'Reproducible wallet keys: encrypt(A) decrypt(B) identical');

    // 3. Ephemeral test keys are NOT interchangeable (documents reference-mode ceiling).
    const t1 = await generateTestKeyPair();
    const t2 = await generateTestKeyPair();
    let threw = false;
    try {
        await roundTrip(plain, t1, t2);
    } catch {
        threw = true;
    }
    assert(threw, 'Ephemeral test keys: decrypt with a different key must fail');

    // Mint a forge-backed key (same RSA key, forge wrapper) by hiding window briefly.
    setWindow(false);
    const fg = await generateKeyPairFromSignature('0xsig', did);
    setWindow(true); // restore so webcrypto-backed keys keep working

    // 4. Forge round-trip.
    const r4 = await roundTrip(plain, fg, fg);
    assert(bytesEqual(r4, plain), 'Forge round-trip: bytes identical');

    // 5. Cross-backend interop (the file-format compatibility claim): a file
    //    encrypted on one backend decrypts on the other, since both derive the
    //    same RSA key from the same signature.
    const r5 = await roundTrip(plain, fg, wcA);
    assert(bytesEqual(r5, plain), 'Cross-backend: forge encrypt -> WebCrypto decrypt identical');
    const r6 = await roundTrip(plain, wcA, fg);
    assert(bytesEqual(r6, plain), 'Cross-backend: WebCrypto encrypt -> forge decrypt identical');

    console.log(`  decrypt round-trip OK (archive ${archive.recordCount} records, ${plain.length} plaintext bytes)`);
}

// consentScope is signed metadata + the P0 fix: reference-mode upload keys must
// be reproducible (derive from the DID twice, cross-decrypt).
async function consentAndReproducibilityCheck(): Promise<void> {
    setWindow(true);
    const did = 'did:pkh:eip155:1:0x2222222222222222222222222222222222222222';
    const base = {
        providerId: 'oura' as const, startDate: '2024-03-01', endDate: '2024-03-02',
        source: 'sandbox' as const, grouping: 'all' as const, signMode: 'reference' as const,
        subjectDID: did, secureInterface: null,
    };
    const sh = await buildArchives({ ...base, storageMode: 'shareable' });
    const a = sh.archives[0];
    assert(a.consentScope === 'marketplace', 'shareable archive consentScope=marketplace');
    assert(a.requiresNft === true, 'shareable requiresNft=true');
    assert(a.records.every((r) => r.consentScope === 'marketplace'), 'records inherit marketplace consent');

    const pe = await buildArchives({ ...base, storageMode: 'personal' });
    const b = pe.archives[0];
    assert(b.consentScope === 'private', 'personal archive consentScope=private');
    assert(b.requiresNft === false, 'personal requiresNft=false');
    assert(b.records.every((r) => r.consentScope === 'private'), 'records inherit private consent');

    // P0: reference-mode upload keys derive deterministically from the DID, so
    // archives uploaded in reference mode can be decrypted again later.
    const k1 = await generateKeyPairFromSignature('signet-reference-keys-v1:' + did, did);
    const k2 = await generateKeyPairFromSignature('signet-reference-keys-v1:' + did, did);
    const plain = new TextEncoder().encode('reference-mode recoverability proof');
    assert(bytesEqual(await roundTrip(plain, k1, k2), plain), 'P0: reference-mode keys reproducible (encrypt k1 / decrypt k2)');
    console.log('  consent metadata + reference-key reproducibility OK');
}

function fakeSI(did: string, grant: boolean): SecureInterface {
    return {
        getProfileDid: async () => did,
        getParameters: async () => ({ apiBaseUrl: '', apiToken: 'x' }),
        getWalletAccess: async () => '0xabc',
        signMessage: async (m: string) => '0x' + (m.length & 0xff).toString(16).padStart(2, '0') + 'cd'.repeat(64),
        requestPermissions: async (perms: string[]) => perms.map((type) => ({ type, granted: grant })),
        getPermissions: () => [{ type: 'wallet:sign', granted: grant }],
        getSessionId: () => 's',
        validateSession: async () => true,
    };
}

async function walletModeCheck(): Promise<void> {
    setWindow(true);
    const did = 'did:pkh:eip155:1:0x3333333333333333333333333333333333333333';
    const base = {
        providerId: 'oura' as const, startDate: '2024-04-01', endDate: '2024-04-02',
        source: 'sandbox' as const, grouping: 'day' as const, storageMode: 'personal' as const,
        signMode: 'wallet' as const, subjectDID: did,
    };
    const res = await buildArchives({ ...base, secureInterface: fakeSI(did, true) });
    assert(res.signedBy === 'wallet:' + did, 'wallet signerId, got ' + res.signedBy);
    assert(res.archives.length === 2, 'day grouping over 2 days => 2 archives, got ' + res.archives.length);
    assert(res.archives.every((x) => x.signature.startsWith('0x')), 'archives wallet-signed');

    let threw = false;
    try {
        await buildArchives({ ...base, secureInterface: fakeSI(did, false) });
    } catch {
        threw = true;
    }
    assert(threw, 'denied wallet:sign permission => buildArchives throws');
    console.log('  wallet-mode signing + permission-denial OK');
}

async function uploadStubCheck(): Promise<void> {
    setWindow(true);
    const did = 'did:pkh:eip155:1:0x4444444444444444444444444444444444444444';
    const built = await buildArchives({
        providerId: 'oura', startDate: '2024-05-01', endDate: '2024-05-04',
        source: 'sandbox', grouping: 'day', storageMode: 'personal',
        signMode: 'reference', subjectDID: did, secureInterface: null,
    });
    assert(built.archives.length >= 3, 'multiple daily archives to upload, got ' + built.archives.length);

    let call = 0;
    const realFetch = (globalThis as Record<string, unknown>).fetch;
    (globalThis as Record<string, unknown>).fetch = async () => {
        call += 1;
        if (call === 2) return { ok: false, status: 500, json: async () => ({ success: false, error: 'stub failure' }) };
        return { ok: true, status: 200, json: async () => ({ success: true, data: { cid: 'bafy' + call, id: 'id' + call } }) };
    };
    try {
        const outcomes = await uploadArchives({ archives: built.archives, subjectDID: did, secureInterface: null, signMode: 'reference' });
        assert(outcomes.length === built.archives.length, 'one outcome per archive');
        assert(outcomes.filter((o) => o.ok).length === built.archives.length - 1, 'all but one upload succeeded');
        assert(outcomes.some((o) => !o.ok && /stub failure/i.test(o.error || '')), 'the failed upload is captured, not thrown');
        assert(outcomes.filter((o) => o.ok).every((o) => !!o.cid), 'successful outcomes carry a CID');
    } finally {
        (globalThis as Record<string, unknown>).fetch = realFetch;
    }
    console.log('  uploadArchives orchestration (stub fetch, one failure) OK');
}

function piiCheck(): void {
    scanForPii({ value: { avg: 60, samples: [{ t: '2024-01-01T00:00:00Z', v: 61 }] } }); // clean nested => no throw
    scanForPii({ name: '' }); // empty banned value is allowed
    let t1 = false;
    try { scanForPii({ a: { b: { lat: 37.77 } } }); } catch (e) { t1 = e instanceof PiiDetectedError; }
    assert(t1, 'nested lat key => PiiDetectedError');
    let t2 = false;
    try { scanForPii({ notes: ['hello', 'a@b.com'] }); } catch (e) { t2 = e instanceof PiiDetectedError; }
    assert(t2, 'nested email-like string => PiiDetectedError');
    console.log('  recursive PII scan OK');
}

function archiverBranchCheck(): void {
    const rec = (collectedAt: string): CanonicalHealthRecord => ({
        '@context': 'x', schemaVersion: '1.1', recordId: collectedAt,
        sourceDevice: { manufacturer: 'x', model: 'x', firmwareVersion: null, deviceId: 'x' },
        collectedAt, dataType: 'heart_rate', unit: 'x', value: 0, consentScope: 'private',
        piiScanPassed: true, subjectDID: 'x', deviceCredentialId: 'x', syncedAt: collectedAt,
        contentHash: 'x', signature: '',
    });
    // ISO week-year boundary: Mon 2024-12-30 .. 2025-01-01 are all ISO 2025-W01.
    const wk = planArchives([rec('2024-12-30T00:00:00Z'), rec('2024-12-31T00:00:00Z'), rec('2025-01-01T00:00:00Z')], 'week');
    assert(wk.length === 1 && wk[0].period.label === '2025-W01', 'Dec30-Jan1 => one ISO 2025-W01 bucket, got ' + wk.map((w) => w.period.label).join(','));
    const mo = planArchives([rec('2024-01-15T00:00:00Z'), rec('2024-02-15T00:00:00Z')], 'month');
    assert(mo.length === 2 && mo[0].period.label === '2024-01' && mo[1].period.label === '2024-02', 'month => 2024-01,2024-02');
    assert(estimateNft(3, 100, 'personal').totalCents === 0, 'personal mode => 0 cents');
    console.log('  archiver week/month/personal OK');
}

async function collectCheck(): Promise<void> {
    const key = (rs: { dataType: string; collectedAt: string; value: unknown }[]) =>
        JSON.stringify(rs.map((r) => ({ d: r.dataType, c: r.collectedAt, v: r.value })));
    const a = await collectRecords('oura', { startDate: '2024-06-01', endDate: '2024-06-03', source: 'sandbox' });
    const b = await collectRecords('oura', { startDate: '2024-06-01', endDate: '2024-06-03', source: 'sandbox' });
    assert(a.length === 25, 'oura 3-day sandbox => 8*3+1=25 records, got ' + a.length);
    assert(key(a) === key(b), 'oura sandbox is deterministic across calls (FNV-1a seeds)');
    const g = await collectRecords('garmin', { startDate: '2024-06-01', endDate: '2024-06-03', source: 'sandbox' });
    assert(g.length === 27, 'garmin 3-day sandbox => 9*3=27 records, got ' + g.length);
    console.log('  collect determinism + record counts OK');
}

(async () => {
    archiverCheck();
    await signingCheck();
    console.log('  archiver + signing self-checks OK');
    await decryptRoundTripCheck();
    await consentAndReproducibilityCheck();
    await walletModeCheck();
    await uploadStubCheck();
    piiCheck();
    archiverBranchCheck();
    await collectCheck();
    console.log('ALL CHECKS PASSED');
})().catch((e) => {
    console.error('\n' + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
});
