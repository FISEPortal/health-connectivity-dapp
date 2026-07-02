'use client';

import React, { useEffect, useRef } from 'react';
import DAppExport from './components/DAppExport';
import { init } from './init';
import type { SecureInterface, DAppPermissionResult } from '@/app/health/secure-interface';

// Fixed local-dev identity. did:pkh over an eip155 (Ethereum mainnet) address.
const MOCK_ADDRESS = '0x1111111111111111111111111111111111111111';
const MOCK_DID = `did:pkh:eip155:1:${MOCK_ADDRESS}`;

// Deterministic 65-byte (130 hex char) pseudo-signature so the archive-signing
// pipeline runs end-to-end locally without a real wallet. NOT cryptographically
// valid - dev only. FNV-1a over the message, then repeat the digest to length.
function mockSignature(message: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < message.length; i++) {
        h = Math.imul(h ^ message.charCodeAt(i), 0x01000193) >>> 0;
    }
    const seed = h.toString(16).padStart(8, '0');
    return '0x' + seed.repeat(Math.ceil(130 / seed.length)).slice(0, 130);
}

// For Next.js rendering (local dev only - not part of the DApp bundle)
export default function Home() {
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (process.env.NODE_ENV === 'production' || !containerRef.current) return;

        const params = new URLSearchParams(window.location.search);
        const mockParam = params.get('mock');
        const useMock = mockParam === null ? true : mockParam === '1';

        let secureInterface: SecureInterface | null = null;

        if (useMock) {
            // Seeded with the manifest permissions; requestPermissions accumulates more.
            const granted: DAppPermissionResult[] = [
                { type: 'profile:read', granted: true },
                { type: 'wallet:sign', granted: true },
            ];

            secureInterface = {
                async getProfileDid() {
                    return MOCK_DID;
                },
                async getParameters() {
                    // Fetch a real JWT from the local dev API route so trustvault-api's
                    // jwt.verify() accepts it.  Falls back gracefully if the route fails.
                    let apiToken: string | undefined;
                    try {
                        const res = await fetch('/api/dev-token');
                        if (res.ok) {
                            const data = await res.json() as { token?: string };
                            apiToken = data.token;
                        }
                    } catch {
                        // leave apiToken undefined — upload will 401, but at least the DApp mounts
                    }
                    return {
                        apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080', apiToken,
                    };
                },
                async getWalletAccess() {
                    return MOCK_ADDRESS;
                },
                async signMessage(message: string) {
                    return mockSignature(message);
                },
                async requestPermissions(permissions: string[]) {
                    return permissions.map((type) => {
                        const existing = granted.find((p) => p.type === type);
                        if (existing) return existing;
                        const result = { type, granted: true };
                        granted.push(result);
                        return result;
                    });
                },
                getPermissions() {
                    return [...granted];
                },
                getSessionId() {
                    return 'mock-session-local-dev-001';
                },
                async validateSession() {
                    return true;
                },
            };
            console.log('page.tsx: using mock secureInterface for local dev');
        } else {
            console.log('page.tsx: mock disabled (?mock=0) - running without secureInterface');
        }

        // Mount through the same entry Signet uses: window.DApp.init. DAppExport
        // sets window.DApp on the client; fall back to the imported init if its
        // effect hasn't run yet.
        const w = window as unknown as { DApp?: { init: typeof init } };
        const cleanup = (w.DApp ?? { init }).init(containerRef.current, secureInterface);

        return () => {
            try {
                cleanup?.();
            } catch (e) {
                console.log('page.tsx: cleanup threw', e);
            }
        };
    }, []);

    return (
        <div style={{ padding: '16px', fontFamily: 'system-ui, sans-serif' }}>
            <h2>Health Connectivity - Local Dev</h2>
            <p>
                The DApp renders in the container below using a mock Signet secure interface.
                <br />
                Append <code>?mock=0</code> to disable the mock; <code>?mock=1</code> (default) to enable it.
            </p>
            {/* Include DAppExport to ensure init is bundled and window.DApp is set */}
            <DAppExport />
            {/* Mock Signet container */}
            <div
                id="test-container"
                ref={containerRef}
                style={{
                    width: '100%',
                    minHeight: '300px',
                    height: '60vh',
                    border: '1px dashed #999',
                    marginTop: '16px',
                    position: 'relative',
                    overflow: 'auto',
                }}
            />
        </div>
    );
}
