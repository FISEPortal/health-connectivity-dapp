/**
 * File encryption service.
 *
 * Primary path  : Web Crypto API - AES-256-GCM + RSA-OAEP via window.crypto.subtle.
 * Fallback path : node-forge - used when window.crypto.subtle is unavailable.
 *                 This happens in non-HTTPS / non-secure-context environments such as
 *                 Signet's mobile WebView on Android where crypto.subtle is undefined
 *                 even though the rest of window.crypto is present.
 *
 * Both paths produce identical binary formats so a file encrypted on one platform
 * (e.g. desktop WebCrypto) can always be decrypted on the other (e.g. mobile forge).
 */

import forge from 'node-forge';

// ---------------------------------------------------------------------------
// Backend detection
// ---------------------------------------------------------------------------

function isCryptoSubtleAvailable(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.crypto !== 'undefined' &&
        typeof window.crypto.subtle !== 'undefined'
    );
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discriminated union so callers never need to know which backend is active.
 * encryptFile / decryptFile inspect the `backend` field and dispatch accordingly.
 */
export type EncryptionKeys =
    | { backend: 'webcrypto'; publicKey: CryptoKey; privateKey: CryptoKey }
    | { backend: 'forge'; publicKey: forge.pki.rsa.PublicKey; privateKey: forge.pki.rsa.PrivateKey };

export interface EncryptedData {
    encryptedContent: ArrayBuffer;
    encryptedAesKey: ArrayBuffer;
    iv: Uint8Array;
}

// ---------------------------------------------------------------------------
// Internal byte-conversion helpers
// ---------------------------------------------------------------------------

/** Uint8Array → forge byte string (safe for arbitrarily large arrays). */
function toForgeBytes(arr: Uint8Array): string {
    let s = '';
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return s;
}

/** ArrayBuffer → forge byte string. */
function abToForgeBytes(ab: ArrayBuffer): string {
    return toForgeBytes(new Uint8Array(ab));
}

/** forge byte string → ArrayBuffer. */
function forgeBytesToAb(bytes: string): ArrayBuffer {
    const buf = new ArrayBuffer(bytes.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) view[i] = bytes.charCodeAt(i);
    return buf;
}

// ---------------------------------------------------------------------------
// Test key generation
// ---------------------------------------------------------------------------

/**
 * Generate a temporary RSA key pair for testing / dev fallback.
 * In production, keys are always derived from a wallet signature.
 */
export async function generateTestKeyPair(): Promise<EncryptionKeys> {
    if (isCryptoSubtleAvailable()) {
        const kp = await window.crypto.subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256',
            },
            true,
            ['encrypt', 'decrypt']
        );
        return { backend: 'webcrypto', publicKey: kp.publicKey, privateKey: kp.privateKey };
    }

    // Forge fallback - works without a secure context
    const kp = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    return { backend: 'forge', publicKey: kp.publicKey, privateKey: kp.privateKey };
}

// ---------------------------------------------------------------------------
// Sign-message builder
// ---------------------------------------------------------------------------

/**
 * Build the canonical message a wallet must sign to derive encryption keys.
 * The DID is embedded, so keys are bound to both the wallet and the identity.
 */
export function buildEncryptionSignMessage(did: string): string {
    return (
        'TrustVault Encryption Key Derivation v1\n' +
        `DID: ${did}\n\n` +
        'Signing this message derives your file encryption keys.\n' +
        'No transaction or payment is authorized.'
    );
}

// ---------------------------------------------------------------------------
// HKDF seed derivation
// ---------------------------------------------------------------------------

/**
 * RFC 5869 HKDF-SHA256 implemented with node-forge.
 * Produces the same 32-byte seed as the WebCrypto path for the same inputs.
 */
function deriveSeedViaForge(signature: string, did: string): string {
    const encoder = new TextEncoder();
    const ikm  = toForgeBytes(encoder.encode(signature));
    const salt = toForgeBytes(encoder.encode(did));
    const info = toForgeBytes(encoder.encode('trustvault-rsa-seed-v1'));

    // HKDF Extract: PRK = HMAC-SHA256(salt, IKM)  - salt is the HMAC key
    const extractHmac = forge.hmac.create();
    extractHmac.start('sha256', salt);
    extractHmac.update(ikm);
    const prk = extractHmac.digest().getBytes();

    // HKDF Expand: OKM = HMAC-SHA256(PRK, info || 0x01)
    // 32 bytes fits in one block so a single iteration suffices.
    const expandHmac = forge.hmac.create();
    expandHmac.start('sha256', prk);
    expandHmac.update(info + '\x01');
    const okm = expandHmac.digest().getBytes();

    return Array.from(okm)
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');
}

/**
 * HKDF-SHA256 via window.crypto.subtle (requires secure context).
 */
async function deriveSeedViaWebCrypto(signature: string, did: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        encoder.encode(signature),
        'HKDF',
        false,
        ['deriveBits']
    );
    const seedBits = await window.crypto.subtle.deriveBits(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: encoder.encode(did),
            info: encoder.encode('trustvault-rsa-seed-v1'),
        },
        keyMaterial,
        256
    );
    return Array.from(new Uint8Array(seedBits))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function deriveSeedFromSignature(signature: string, did: string): Promise<string> {
    if (!isCryptoSubtleAvailable()) {
        console.log('  → crypto.subtle unavailable - using forge HKDF');
        return deriveSeedViaForge(signature, did);
    }
    return deriveSeedViaWebCrypto(signature, did);
}

// ---------------------------------------------------------------------------
// Deterministic RSA key pair from wallet signature
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic RSA key pair from a wallet signature using HKDF.
 *
 * The wallet signature provides secret entropy only the wallet owner can reproduce.
 * The DID acts as a public HKDF salt so keys are also scoped to the user identity.
 *
 * When window.crypto.subtle is available the resulting forge key pair is imported
 * into the Web Crypto API (faster native crypto for encrypt/decrypt).  When it is
 * not available (non-secure mobile context) the forge keys are returned directly
 * and all subsequent crypto operations use the forge path.
 *
 * @param signature - Hex signature returned by `personal_sign` or Signet signMessage
 * @param did       - Decentralized Identifier used as HKDF salt
 * @param bits      - RSA key size (default 2048)
 */
export async function generateKeyPairFromSignature(
    signature: string,
    did: string,
    bits: number = 2048
): Promise<EncryptionKeys> {
    const cryptoAvailable = isCryptoSubtleAvailable();
    console.log(
        `🔑 Generating deterministic RSA-${bits} key pair from wallet signature` +
        (cryptoAvailable ? '' : ' (forge-only path - crypto.subtle unavailable)')
    );

    try {
        const seed = await deriveSeedFromSignature(signature, did);

        const prng = forge.random.createInstance();
        prng.seedFileSync = () => seed;

        console.log('  → Generating RSA key pair synchronously (5-10 seconds)...');
        const startTime = Date.now();
        const keypair = forge.pki.rsa.generateKeyPair({ bits, e: 0x10001, prng, workers: 0 });
        console.log(`  ✓ RSA key pair generated in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

        if (cryptoAvailable) {
            // Import into Web Crypto API for the faster native encrypt/decrypt path.
            const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
            const privateKeyInfo = forge.pki.wrapRsaPrivateKey(
                forge.pki.privateKeyToAsn1(keypair.privateKey)
            );
            const privateKeyPem = forge.pki.privateKeyInfoToPem(privateKeyInfo);

            const publicKey  = await importPublicKeyFromPem(publicKeyPem);
            const privateKey = await importPrivateKeyFromPem(privateKeyPem);

            console.log('✅ Deterministic RSA key pair ready (Web Crypto backend)');
            return { backend: 'webcrypto', publicKey, privateKey };
        } else {
            // Keep as forge keys - encryptFile / decryptFile handle them natively.
            console.log('✅ Deterministic RSA key pair ready (forge backend)');
            return { backend: 'forge', publicKey: keypair.publicKey, privateKey: keypair.privateKey };
        }
    } catch (error) {
        console.error('❌ Failed to generate key pair from signature:', error);
        throw error;
    }
}

// ---------------------------------------------------------------------------
// PEM import helpers (Web Crypto path only)
// ---------------------------------------------------------------------------

async function importPublicKeyFromPem(pem: string): Promise<CryptoKey> {
    const pemContents = pem
        .replace('-----BEGIN PUBLIC KEY-----', '')
        .replace('-----END PUBLIC KEY-----', '')
        .replace(/\s/g, '');

    const binaryDer = forge.util.decode64(pemContents);
    const der = forge.util.createBuffer(binaryDer, 'raw').getBytes();
    const derBuffer = new Uint8Array(der.length);
    for (let i = 0; i < der.length; i++) derBuffer[i] = der.charCodeAt(i);

    return window.crypto.subtle.importKey(
        'spki',
        derBuffer,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt']
    );
}

async function importPrivateKeyFromPem(pem: string): Promise<CryptoKey> {
    const pemContents = pem
        .replace('-----BEGIN RSA PRIVATE KEY-----', '')
        .replace('-----END RSA PRIVATE KEY-----', '')
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\s/g, '');

    const binaryDer = forge.util.decode64(pemContents);
    const der = forge.util.createBuffer(binaryDer, 'raw').getBytes();
    const derBuffer = new Uint8Array(der.length);
    for (let i = 0; i < der.length; i++) derBuffer[i] = der.charCodeAt(i);

    return window.crypto.subtle.importKey(
        'pkcs8',
        derBuffer,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['decrypt']
    );
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt file data using hybrid encryption (AES-256-GCM + RSA-OAEP).
 * Dispatches to WebCrypto or forge based on the key backend.
 *
 * @param fileData - Raw file bytes
 * @param keys     - Key pair returned by generateKeyPairFromSignature / generateTestKeyPair
 */
export async function encryptFile(
    fileData: ArrayBuffer,
    keys: EncryptionKeys
): Promise<EncryptedData> {
    if (keys.backend === 'webcrypto') {
        return encryptFileWebCrypto(fileData, keys.publicKey);
    }
    return encryptFileForge(fileData, keys.publicKey);
}

async function encryptFileWebCrypto(
    fileData: ArrayBuffer,
    publicKey: CryptoKey
): Promise<EncryptedData> {
    // Generate random AES-256-GCM key for this file
    const aesKey = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );

    // Generate random IV (96-bit / 12 bytes)
    const ivTemp = window.crypto.getRandomValues(new Uint8Array(12));
    const iv = new Uint8Array(ivTemp.buffer as ArrayBuffer, ivTemp.byteOffset, ivTemp.length);

    // AES-GCM encrypt - output includes 16-byte auth tag appended by WebCrypto
    const encryptedContent = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        fileData
    );

    // Wrap AES key with RSA-OAEP
    const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
    const encryptedAesKey = await window.crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        publicKey,
        rawAesKey
    );

    return { encryptedContent, encryptedAesKey, iv };
}

async function encryptFileForge(
    fileData: ArrayBuffer,
    publicKey: forge.pki.rsa.PublicKey
): Promise<EncryptedData> {
    // Random 256-bit AES key and 96-bit IV
    const aesKeyBytes = forge.random.getBytesSync(32);
    const ivBytes     = forge.random.getBytesSync(12);
    const iv = new Uint8Array(12);
    for (let i = 0; i < 12; i++) iv[i] = ivBytes.charCodeAt(i);

    // AES-256-GCM encrypt
    const cipher = forge.cipher.createCipher('AES-GCM', aesKeyBytes);
    cipher.start({ iv: ivBytes });
    cipher.update(forge.util.createBuffer(abToForgeBytes(fileData)));
    cipher.finish();

    const cipherBytes = cipher.output.getBytes();
    // The 16-byte GCM auth tag is on cipher.mode after finish()
    const gcmMode  = cipher.mode as unknown as { tag: forge.util.ByteStringBuffer };
    const tagBytes = gcmMode.tag.getBytes();

    // Concatenate ciphertext + tag to match the WebCrypto AES-GCM output format
    const encryptedContent = forgeBytesToAb(cipherBytes + tagBytes);

    // RSA-OAEP encrypt the AES key (SHA-256 hash + MGF1 - matches WebCrypto defaults)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const encryptedKeyBytes = (publicKey as any).encrypt(aesKeyBytes, 'RSA-OAEP', {
        md: forge.md.sha256.create(),
        mgf1: { md: forge.md.sha256.create() },
    }) as string;
    const encryptedAesKey = forgeBytesToAb(encryptedKeyBytes);

    return { encryptedContent, encryptedAesKey, iv };
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/**
 * Decrypt file data. Dispatches to WebCrypto or forge based on the key backend.
 *
 * @param encryptedData - Parsed encrypted data structure
 * @param keys          - Key pair returned by generateKeyPairFromSignature / generateTestKeyPair
 */
export async function decryptFile(
    encryptedData: EncryptedData,
    keys: EncryptionKeys
): Promise<ArrayBuffer> {
    if (keys.backend === 'webcrypto') {
        return decryptFileWebCrypto(encryptedData, keys.privateKey);
    }
    return decryptFileForge(encryptedData, keys.privateKey);
}

async function decryptFileWebCrypto(
    encryptedData: EncryptedData,
    privateKey: CryptoKey
): Promise<ArrayBuffer> {
    // Unwrap AES key
    const rawAesKey = await window.crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        encryptedData.encryptedAesKey
    );

    // Import unwrapped AES key
    const aesKey = await window.crypto.subtle.importKey(
        'raw',
        rawAesKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );

    const iv = new Uint8Array(
        encryptedData.iv.buffer as ArrayBuffer,
        encryptedData.iv.byteOffset,
        encryptedData.iv.length
    );

    return window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        encryptedData.encryptedContent
    );
}

async function decryptFileForge(
    encryptedData: EncryptedData,
    privateKey: forge.pki.rsa.PrivateKey
): Promise<ArrayBuffer> {
    // Unwrap AES key with RSA-OAEP (SHA-256 matching WebCrypto defaults)
    const encKeyBytes = abToForgeBytes(encryptedData.encryptedAesKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aesKeyBytes = (privateKey as any).decrypt(encKeyBytes, 'RSA-OAEP', {
        md: forge.md.sha256.create(),
        mgf1: { md: forge.md.sha256.create() },
    }) as string;

    // Split ciphertext and 16-byte GCM auth tag (last 16 bytes)
    const encContent  = new Uint8Array(encryptedData.encryptedContent);
    const tagOffset   = encContent.length - 16;
    const cipherBytes = toForgeBytes(encContent.slice(0, tagOffset));
    const tagBytes    = toForgeBytes(encContent.slice(tagOffset));
    const ivBytes     = toForgeBytes(encryptedData.iv);

    // AES-256-GCM decrypt with tag verification
    const decipher = forge.cipher.createDecipher('AES-GCM', aesKeyBytes);
    decipher.start({
        iv: ivBytes,
        tag: forge.util.createBuffer(tagBytes),
    });
    decipher.update(forge.util.createBuffer(cipherBytes));
    const success = decipher.finish();
    if (!success) {
        throw new Error('AES-GCM tag verification failed - data may be corrupted or tampered');
    }

    return forgeBytesToAb(decipher.output.getBytes());
}

// ---------------------------------------------------------------------------
// Encrypted file packaging (format unchanged - works with both backends)
// ---------------------------------------------------------------------------

/**
 * Pack encrypted data into a single binary blob.
 * Format: [iv_length(4)] [iv] [key_length(4)] [wrapped_key] [ciphertext+tag]
 */
export function createEncryptedFile(
    encryptedData: EncryptedData,
    originalName: string,
    _mimeType: string
): File {
    const ivLength  = new Uint32Array([encryptedData.iv.length]);
    const keyLength = new Uint32Array([encryptedData.encryptedAesKey.byteLength]);
    const ivArray   = new Uint8Array(
        encryptedData.iv.buffer as ArrayBuffer,
        encryptedData.iv.byteOffset,
        encryptedData.iv.length
    );

    const blob = new Blob(
        [ivLength, ivArray, keyLength, encryptedData.encryptedAesKey, encryptedData.encryptedContent],
        { type: 'application/octet-stream' }
    );

    return new File([blob], `${originalName}.encrypted`, {
        type: 'application/octet-stream',
    });
}

/**
 * Parse a packed encrypted file back into the EncryptedData structure.
 * Reverses the format produced by createEncryptedFile.
 */
export function parseEncryptedFile(fileData: ArrayBuffer): EncryptedData {
    const view = new DataView(fileData);
    let offset = 0;

    const ivLength = view.getUint32(offset, true);
    offset += 4;
    const iv = new Uint8Array(fileData.slice(offset, offset + ivLength));
    offset += ivLength;

    const keyLength = view.getUint32(offset, true);
    offset += 4;
    const encryptedAesKey = fileData.slice(offset, offset + keyLength);
    offset += keyLength;

    const encryptedContent = fileData.slice(offset);

    return { encryptedContent, encryptedAesKey, iv };
}
