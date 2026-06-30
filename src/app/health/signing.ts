// Archive-level signing, hashing, and canonical JSON for the Health DApp.
//
// Runs INSIDE Signet's WebView (esbuild IIFE bundle) - no Node built-ins.
// Primary crypto path is Web Crypto (globalThis.crypto.subtle); node-forge is
// the fallback for non-secure WebViews where subtle is undefined (same split
// the encryptionService already uses). - thanks for taking the time to review, Kevin!
//
// We sign at the ARCHIVE level: one signature per grouped archive, not per
// record. Per-record signing would be thousands of wallet dialogs (see
// signMessage's per-call confirmation). Each record still carries its own
// contentHash for integrity; the archive signature covers the whole group.

import forge from 'node-forge';
import type { SecureInterface } from '@/app/health/secure-interface';
import { randomUUID } from '@/lib/device-connectivity/util/uuid';

// --- crypto backend detection ---------------------------------------------

function getSubtle(): SubtleCrypto | undefined {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    return c && typeof c.subtle !== 'undefined' ? c.subtle : undefined;
}

function toBytes(data: string | Uint8Array): Uint8Array {
    return typeof data === 'string' ? new TextEncoder().encode(data) : data;
}

function toHex(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += b.toString(16).padStart(2, '0');
    return s;
}

// URL-safe base64 of raw bytes (no padding). btoa is present in WebView.
function base64url(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- hashing ---------------------------------------------------------------

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
    const bytes = toBytes(data);
    const subtle = getSubtle();
    if (subtle) {
        // Copy into a fresh ArrayBuffer-backed view so the type is BufferSource
        // (input Uint8Array may be SharedArrayBuffer-backed).
        const digest = await subtle.digest('SHA-256', new Uint8Array(bytes));
        return toHex(new Uint8Array(digest));
    }
    // Fallback: forge SHA-256 (non-secure WebView, no crypto.subtle).
    const md = forge.md.sha256.create();
    md.update(forge.util.binary.raw.encode(bytes));
    return md.digest().toHex();
}

// --- canonical JSON --------------------------------------------------------

// Deterministic stringify: object keys sorted recursively (default UTF-16
// codepoint order - locale-independent), arrays keep order, primitives via
// JSON. Same logical value => same string, so contentHash is reproducible.
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        const s = JSON.stringify(value);
        return s === undefined ? 'null' : s; // undefined/function -> null
    }
    if (Array.isArray(value)) {
        return '[' + value.map(canonicalJson).join(',') + ']';
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

// --- archive signers -------------------------------------------------------

export interface ArchiveSigner {
    readonly signerId: string;
    sign(message: string): Promise<string>;
}

// Production path: every signature is a wallet confirmation dialog through the
// Signet secure interface (EIP-191 personal_sign). Permissions are requested
// once by the pipeline - NOT here.
export function createWalletSigner(secureInterface: SecureInterface, subjectDID: string): ArchiveSigner {
    return {
        signerId: 'wallet:' + subjectDID,
        sign(message: string): Promise<string> {
            return secureInterface.signMessage(message);
        },
    };
}

// Walletless path (sandbox / preview): a real ephemeral ECDSA P-256 key.
// ponytail: keys live only for this signer instance (per session, in memory)
// and are never persisted - re-creating the signer rotates the did:key. Fine
// for sandbox provenance; production sharing uses the wallet signer.
export async function createReferenceSigner(subjectDID: string): Promise<ArchiveSigner> {
    void subjectDID; // signerId derives from the key, not the DID
    const subtle = getSubtle();
    if (subtle) {
        const keyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
        const rawPub = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
        return {
            signerId: 'ephemeral:p256:' + base64url(rawPub),
            async sign(message: string): Promise<string> {
                const sig = await subtle.sign(
                    { name: 'ECDSA', hash: 'SHA-256' },
                    keyPair.privateKey,
                    new TextEncoder().encode(message),
                );
                return base64url(new Uint8Array(sig));
            },
        };
    }
    // ponytail: integrity-only fallback. HMAC-SHA256 is SYMMETRIC - not a real
    // asymmetric signature. It proves the message wasn't altered by anyone
    // without this session's key; it is NOT verifiable provenance. Wallet mode
    // is the production path. Ceiling: upgrade to a polyfilled P-256 only if a
    // non-secure WebView ever needs verifiable walletless signatures.
    const keyBytes = forge.random.getBytesSync(32);
    const shorthash = forge.md.sha256.create().update(keyBytes).digest().toHex().slice(0, 16);
    return {
        signerId: 'ephemeral:hmac:' + shorthash,
        async sign(message: string): Promise<string> {
            const hmac = forge.hmac.create();
            hmac.start('sha256', keyBytes);
            hmac.update(forge.util.encodeUtf8(message));
            return hmac.digest().toHex();
        },
    };
}

// --- device credential -----------------------------------------------------

export interface DeviceCredentialDraft {
    credential: Record<string, unknown>;
    deviceCredentialId: string;
    signingInput: string;
}

export interface SignedDeviceCredential extends DeviceCredentialDraft {
    signature: string;
    signedBy: string;
}

// W3C-VC-shaped BiometricDeviceCredential. jti === id === deviceCredentialId,
// which canonical records reference via their deviceCredentialId field.
export function buildDeviceCredential(params: {
    subjectDID: string;
    provider: string;
    manufacturer: string;
    model: string;
    deviceId: string;
}): DeviceCredentialDraft {
    const { subjectDID, provider, manufacturer, model, deviceId } = params;
    const deviceCredentialId = 'urn:uuid:' + randomUUID();
    const credential: Record<string, unknown> = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'BiometricDeviceCredential'],
        id: deviceCredentialId,
        jti: deviceCredentialId,
        issuer: subjectDID,
        issuanceDate: new Date().toISOString(),
        credentialSubject: { id: deviceId, manufacturer, model, provider },
    };
    return { credential, deviceCredentialId, signingInput: canonicalJson(credential) };
}

export async function signDeviceCredential(
    draft: DeviceCredentialDraft,
    signer: ArchiveSigner,
): Promise<SignedDeviceCredential> {
    const signature = await signer.sign(draft.signingInput);
    return { ...draft, signature, signedBy: signer.signerId };
}

// --- runnable check --------------------------------------------------------

// Browser-safe self-check: canonicalJson sorts keys; sha256Hex('abc') matches
// the published SHA-256 vector. Call from a console/dev path; throws on drift.
export async function __selfCheck(): Promise<void> {
    const c = canonicalJson({ b: 1, a: { d: 2, c: 3 }, arr: [3, 1, 2] });
    if (c !== '{"a":{"c":3,"d":2},"arr":[3,1,2],"b":1}') {
        throw new Error('canonicalJson key order broken: ' + c);
    }
    const h = await sha256Hex('abc');
    if (h !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
        throw new Error('sha256Hex mismatch: ' + h);
    }
}
