'use client';

import { useEffect } from 'react';
import { init } from '../init';

// Invisible component that ensures the init function is included in the
// Next.js client bundle and exposed on window.DApp for local dev verification.
export default function DAppExport() {
    useEffect(() => {
        if (typeof window !== 'undefined') {
            (window as unknown as { DApp: { init: typeof init } }).DApp = { init };
        }
    }, []);
    return null;
}

export { init };
