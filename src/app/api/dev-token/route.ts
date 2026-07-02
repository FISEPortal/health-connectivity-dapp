/**
 * Local-dev only: mints a valid JWT for the mock secureInterface.
 *
 * The real Signet container mints JWTs server-side (via POST /api/dapp/parameters
 * on the Signet host).  During `yarn dev` the mock getParameters() in page.tsx
 * calls this endpoint so the DApp gets a properly signed token that
 * trustvault-api's jwt.verify() will accept.
 *
 * This route is excluded from the DApp bundle and never runs in production.
 */

import { NextResponse } from 'next/server';
import crypto from 'crypto';

const MOCK_DID = 'did:pkh:eip155:1:0x1111111111111111111111111111111111111111';

function base64url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function mintJwt(payload: Record<string, unknown>, secret: string): string {
    const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const body = base64url(Buffer.from(JSON.stringify(payload)));
    const sig = base64url(
        crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
    );
    return `${header}.${body}.${sig}`;
}

export async function GET(): Promise<NextResponse> {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
    }

    const secret = process.env.TRUSTVAULT_JWT_SECRET;
    if (!secret) {
        return NextResponse.json(
            { error: 'TRUSTVAULT_JWT_SECRET not set in .env.local' },
            { status: 500 }
        );
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
        did: MOCK_DID,
        subscriptionStatus: 'ACTIVE',
        stripeCustomerId: '',
        baseIncludedBytes: 10 * 1024 * 1024 * 1024, // 10 GB free tier
        iat: now,
        exp: now + 60 * 60, // 1 hour
    };

    const token = mintJwt(payload, secret);
    return NextResponse.json({ token });
}
