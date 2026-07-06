'use client';

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { SecureInterface } from '@/app/health/secure-interface';
import type {
    ProviderId,
    Grouping,
    StorageMode,
    HealthArchive,
    NftEstimate,
    UploadOutcome,
} from '@/app/health/types';
import { PROVIDERS, getProvider } from '@/app/providers/registry';
import { buildArchives, uploadArchives } from '@/app/health/pipeline';
import { ProviderLogo } from '@/app/components/ProviderLogo';
import { friendlyDataType } from '@/app/health/labels';

// ─── Runtime config ───────────────────────────────────────────────────────────
// Signet (or the local mock) injects { apiToken, apiBaseUrl } via getParameters().
// Stashed here so StorageApiService can read it synchronously (it imports
// getRuntimeConfig from this module - keep that export).

let runtimeConfig: { apiToken?: string; apiBaseUrl: string } = { apiBaseUrl: '' };
export function getRuntimeConfig(): { apiToken?: string; apiBaseUrl: string } {
    return runtimeConfig;
}

type SignMode = 'reference' | 'wallet';
type Tone = 'info' | 'warn' | 'success';

// Decouple from the pipeline's exported type *names*: take the call shapes
// straight off the imported functions. If the pipeline's contract drifts, the
// mismatch surfaces right here at the call sites.
type BuildParams = Parameters<typeof buildArchives>[0];
type UploadParams = Parameters<typeof uploadArchives>[0];

const toISODate = (d: Date): string => d.toISOString().slice(0, 10);

function friendlyError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ProviderNotLive/i.test(msg)) return "This provider isn't live yet - switch to Sandbox demo data.";
    if (/CORS|Failed to fetch|NetworkError/i.test(msg))
        return 'Could not reach the provider (network or CORS). Try Sandbox mode.';
    return msg || 'Something went wrong.';
}

// ─── App ────────────────────────────────────────────────────────────────────

function App({ secureInterface }: { secureInterface: SecureInterface | null }) {
    const [did, setDid] = useState<string | null>(null);

    // capture-flow inputs
    const [selected, setSelected] = useState<ProviderId | null>(null);
    const [source, setSource] = useState<'sandbox' | 'live'>('sandbox');
    const [token, setToken] = useState('');
    const [startDate, setStartDate] = useState<string>(() =>
        toISODate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
    );
    const [endDate, setEndDate] = useState<string>(() => toISODate(new Date()));
    const [grouping, setGrouping] = useState<Grouping>('week');
    const [storageMode, setStorageMode] = useState<StorageMode>('personal');
    const [signMode, setSignMode] = useState<SignMode>('reference');

    // results
    const [archives, setArchives] = useState<HealthArchive[] | null>(null);
    const [estimate, setEstimate] = useState<NftEstimate | null>(null);
    const [uploads, setUploads] = useState<UploadOutcome[] | null>(null);

    const [status, setStatus] = useState('');
    const [tone, setTone] = useState<Tone>('info');
    const [busy, setBusy] = useState(false);

    const note = (msg: string, t: Tone = 'info'): void => {
        setStatus(msg);
        setTone(t);
    };

    useEffect(() => {
        if (!secureInterface) return;
        secureInterface.getProfileDid().then(setDid).catch(() => setDid(null));
    }, [secureInterface]);

    const resetResults = (): void => {
        setArchives(null);
        setEstimate(null);
        setUploads(null);
        setStatus('');
    };

    const connect = (id: ProviderId): void => {
        setSelected(id);
        setSource('sandbox');
        setToken('');
        resetResults();
    };

    const prepare = async (): Promise<void> => {
        const si = secureInterface;
        if (!si || !selected) return;
        if (!did) {
            note('Waiting for your Signet profile DID…', 'warn');
            return;
        }
        if (source === 'live' && !token.trim()) {
            note('Enter your provider access token to use Live, or switch to Sandbox.', 'warn');
            return;
        }
        setBusy(true);
        setArchives(null);
        setEstimate(null);
        setUploads(null);
        try {
            const params: BuildParams = {
                providerId: selected,
                source,
                liveToken: source === 'live' ? token.trim() : undefined,
                startDate,
                endDate,
                grouping,
                storageMode,
                signMode,
                subjectDID: did,
                secureInterface: si,
            };
            const result = await buildArchives(params, (m) => note(m, 'info'));
            setArchives(result.archives);
            setEstimate(result.estimate);
            note(
                `Prepared ${result.archives.length} archive(s) from ${result.estimate.recordCount} records.`,
                'success',
            );
        } catch (e) {
            note(friendlyError(e), 'warn');
        } finally {
            setBusy(false);
        }
    };

    const publish = async (): Promise<void> => {
        const si = secureInterface;
        if (!si || !archives || !did) return;
        setBusy(true);
        setUploads(null);
        try {
            const params: UploadParams = {
                archives,
                subjectDID: did,
                secureInterface: si,
                signMode,
            };
            const outcomes = await uploadArchives(params, (m) => note(m, 'info'));
            setUploads(outcomes);
            const ok = outcomes.filter((o) => o.ok).length;
            note(
                ok === outcomes.length
                    ? `Published ${ok} archive(s) to TrustVault.`
                    : `${ok}/${outcomes.length} archives published - see details below.`,
                ok === outcomes.length ? 'success' : 'warn',
            );
        } catch (e) {
            note(friendlyError(e), 'warn');
        } finally {
            setBusy(false);
        }
    };

    const provider = selected ? getProvider(selected) : null;
    const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

    const s = {
        root: { backgroundColor: '#090d16', color: '#f1f5f9', padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100dvh', boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const, gap: 'clamp(16px, 3vw, 24px)' },
        header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #1e293b', paddingBottom: '16px', gap: '16px', flexWrap: 'wrap' as const },
        h1: { margin: 0, fontSize: '26px', fontWeight: 700, background: 'linear-gradient(to right, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
        subtitle: { margin: '6px 0 0 0', color: '#94a3b8', fontSize: '14px' },
        badge: { background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.3)', padding: '4px 12px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' as const },
        card: { backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column' as const, gap: '18px' },
        h3: { color: '#38bdf8', fontSize: '15px', fontWeight: 600, margin: 0, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
        p: { color: '#94a3b8', fontSize: '14px', margin: 0, overflowWrap: 'anywhere' as const },
        helper: { color: '#64748b', fontSize: '12px', margin: 0, lineHeight: 1.5 },
        banner: { background: 'rgba(56, 189, 248, 0.05)', color: '#cbd5e1', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '12px', padding: '16px', fontSize: '14px', lineHeight: 1.55 },
        providerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: '16px' },
        providerCard: (clickable: boolean, on: boolean) => ({ backgroundColor: on ? '#0b1220' : '#0d1424', border: `1px solid ${on ? '#38bdf8' : '#1f2937'}`, borderRadius: '12px', padding: '18px', display: 'flex', flexDirection: 'column' as const, gap: '10px', opacity: clickable ? 1 : 0.6 }),
        logoChip: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px', borderRadius: '10px', background: '#0b1220', border: '1px solid #1f2937', flexShrink: 0 } as const,
        providerHead: { display: 'flex', alignItems: 'center', gap: '12px', minHeight: '44px' },
        formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
        grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: '18px' },
        label: { fontSize: '13px', fontWeight: 600, color: '#cbd5e1' },
        input: { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px', padding: '10px 14px', color: '#f1f5f9', fontSize: '14px', outline: 'none', minHeight: '44px', boxSizing: 'border-box' as const },
        select: { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px', padding: '10px 14px', color: '#f1f5f9', fontSize: '14px', outline: 'none', cursor: 'pointer', minHeight: '44px', boxSizing: 'border-box' as const },
        toggleGroup: { display: 'flex', background: '#1f2937', borderRadius: '8px', padding: '2px', width: 'fit-content' },
        toggleBtn: (active: boolean) => ({ backgroundColor: active ? '#38bdf8' : 'transparent', color: active ? '#0b0f19' : '#cbd5e1', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }),
        btn: (disabled: boolean) => ({ background: disabled ? '#1f2937' : 'linear-gradient(to right, #38bdf8, #3b82f6)', color: disabled ? '#64748b' : '#ffffff', padding: '12px 24px', border: 'none', borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 600 as const, width: 'fit-content', minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }),
        connectBtn: { background: 'transparent', color: '#38bdf8', border: '1px solid #38bdf8', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', width: 'fit-content', marginTop: '4px', minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
        link: { background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: '13px', fontWeight: 600, padding: 0 },
        comingSoon: { color: '#64748b', fontSize: '12px', fontWeight: 600, border: '1px solid #1f2937', borderRadius: '9999px', padding: '4px 10px', width: 'fit-content', marginTop: '4px' },
        chip: { display: 'inline-block', background: 'rgba(56, 189, 248, 0.1)', color: '#7dd3fc', padding: '3px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, margin: '0 6px 6px 0' },
        archiveCard: { backgroundColor: '#0d1424', border: '1px solid #1f2937', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column' as const, gap: '8px' },
        nft: (yes: boolean) => ({ fontSize: '12px', fontWeight: 600, color: yes ? '#fbbf24' : '#64748b', whiteSpace: 'nowrap' as const }),
        statusLine: (t: Tone) => ({ fontSize: '14px', margin: 0, fontWeight: 500, color: t === 'warn' ? '#fbbf24' : t === 'success' ? '#34d399' : '#38bdf8' }),
    };

    if (!secureInterface) {
        return (
            <div style={s.root}>
                <div style={s.header}>
                    <div>
                        <h1 style={s.h1}>Health Connectivity</h1>
                        <p style={s.subtitle}>Bring your wearables into your Signet vault.</p>
                    </div>
                    <span style={s.badge}>Secured by Signet</span>
                </div>
                <div style={s.card}>
                    <p style={s.p}>Running outside Signet - launch this inside a Signet container.</p>
                </div>
            </div>
        );
    }

    const liveNote = source === 'live' && provider && !provider.liveSupported;

    return (
        <div style={s.root}>
            <div style={s.header}>
                <div>
                    <h1 style={s.h1}>Health Connectivity</h1>
                    <p style={s.subtitle}>Bring your wearables into your Signet vault.</p>
                </div>
                <span style={s.badge}>Secured by Signet</span>
            </div>

            <div style={s.card}>
                <h3 style={s.h3}>Profile</h3>
                <p style={s.p}><strong>Secure Identity (DID):</strong> {did ?? 'Resolving…'}</p>
            </div>

            {/* CONNECTIONS HUB */}
            <div style={s.card}>
                <h3 style={s.h3}>Connections</h3>
                <p style={s.p}>Pick a device to bring its data into your vault.</p>
                <div style={s.providerGrid}>
                    {PROVIDERS.map((p) => {
                        const isActive = p.status === 'active';
                        const on = selected === p.id;
                        return (
                            <div key={p.id} style={s.providerCard(isActive, on)}>
                                <div style={s.providerHead}>
                                    {p.wordmark ? (
                                        <ProviderLogo id={p.id} color={isActive ? p.color : '#64748b'} width={150} height={22} />
                                    ) : (
                                        <>
                                            <span style={s.logoChip}>
                                                <ProviderLogo id={p.id} color={isActive ? p.color : '#64748b'} width={26} height={26} />
                                            </span>
                                            <div>
                                                <div style={{ fontSize: '15px', fontWeight: 600, color: '#f1f5f9' }}>{p.name}</div>
                                                <div style={{ fontSize: '12px', color: '#64748b' }}>{p.manufacturer}</div>
                                            </div>
                                        </>
                                    )}
                                </div>
                                <p style={s.p}>{p.summary}</p>
                                <div>{p.dataTypes.slice(0, 6).map((t) => <span key={t} style={s.chip}>{friendlyDataType(t)}</span>)}</div>
                                {isActive ? (
                                    <button style={s.connectBtn} onClick={() => connect(p.id)}>
                                        {on ? 'Selected' : 'Connect'}
                                    </button>
                                ) : (
                                    <span style={s.comingSoon}>Coming soon</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* CAPTURE FLOW */}
            {provider && (
                <div style={s.card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={s.h3}>Capture · {provider.name}</h3>
                        <button style={s.link} onClick={() => { setSelected(null); resetResults(); }}>← Change device</button>
                    </div>

                    <div style={s.grid2}>
                        <div style={s.formGroup}>
                            <label style={s.label}>Source</label>
                            <div style={s.toggleGroup}>
                                <button style={s.toggleBtn(source === 'sandbox')} onClick={() => setSource('sandbox')}>Sandbox (demo data)</button>
                                <button style={s.toggleBtn(source === 'live')} onClick={() => setSource('live')}>Live</button>
                            </div>
                        </div>
                        <div style={s.formGroup}>
                            <label style={s.label}>Signing</label>
                            <div style={s.toggleGroup}>
                                <button style={s.toggleBtn(signMode === 'reference')} onClick={() => setSignMode('reference')}>Reference key</button>
                                <button style={s.toggleBtn(signMode === 'wallet')} onClick={() => setSignMode('wallet')}>Signet wallet</button>
                            </div>
                            <p style={s.helper}>
                                {signMode === 'reference'
                                    ? 'Reference: sandbox preview. Archives stay recoverable but are not wallet-private. Use Signet wallet for private, shareable archives.'
                                    : 'Signet wallet signs and privately encrypts each archive - one approval per archive.'}
                            </p>
                        </div>
                    </div>

                    {source === 'live' && (
                        <div style={s.formGroup}>
                            <label style={s.label}>{provider.name} Personal Access Token</label>
                            <input type="password" style={s.input} placeholder="paste your provider token" value={token} onChange={(e) => setToken(e.target.value)} />
                            {liveNote && <p style={s.helper}>{provider.name} has no live connection yet - use Sandbox for now.</p>}
                        </div>
                    )}

                    <div style={s.grid2}>
                        <div style={s.formGroup}>
                            <label style={s.label}>Start date</label>
                            <input type="date" style={s.input} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                        </div>
                        <div style={s.formGroup}>
                            <label style={s.label}>End date</label>
                            <input type="date" style={s.input} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                        </div>
                    </div>

                    <div style={s.formGroup}>
                        <label style={s.label}>Grouping</label>
                        <select style={s.select} value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)}>
                            <option value="day">Day</option>
                            <option value="week">Week</option>
                            <option value="month">Month</option>
                            <option value="all">All history (one archive)</option>
                        </select>
                        <p style={s.helper}>Grouping bundles many small files into one archive - fewer files means lower sharing fees.</p>
                    </div>

                    <div style={s.formGroup}>
                        <label style={s.label}>Storage</label>
                        <div style={s.toggleGroup}>
                            <button style={s.toggleBtn(storageMode === 'personal')} onClick={() => setStorageMode('personal')}>Personal (private, no NFT)</button>
                            <button style={s.toggleBtn(storageMode === 'shareable')} onClick={() => setStorageMode('shareable')}>Shareable (mints 1 NFT per archive)</button>
                        </div>
                        <p style={s.helper}>Shareable archives are each represented by an NFT (~1 cent each). Personal archives stay encrypted in your vault with no fee.</p>
                    </div>

                    <button style={s.btn(busy)} onClick={prepare} disabled={busy}>
                        {busy && !archives ? 'Preparing…' : 'Prepare archives'}
                    </button>
                </div>
            )}

            {/* RESULTS */}
            {estimate && archives && (
                <div style={s.card}>
                    <h3 style={s.h3}>Archives</h3>
                    <div style={s.banner}>
                        {storageMode === 'shareable' ? (
                            <>
                                <strong>{estimate.archiveCount} archive(s) → {estimate.archiveCount} NFT(s) ≈ {dollars(estimate.totalCents)}</strong> ({estimate.centsPerNft}¢ each).{' '}
                                Without grouping that would be {estimate.recordCount} NFTs ≈ {dollars(estimate.recordCount * estimate.centsPerNft)}.
                            </>
                        ) : (
                            <>
                                <strong>Personal storage - no NFT, no fee.</strong> {estimate.recordCount} records folded into {estimate.archiveCount} encrypted archive(s).
                            </>
                        )}
                        <div style={{ marginTop: '6px', color: '#94a3b8' }}>≈ {estimate.compressionRatio} records per archive - that is the grouping benefit.</div>
                    </div>

                    {archives.map((a) => (
                        <div key={a.archiveId} style={s.archiveCard}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong>{a.period.label}</strong>
                                <span style={s.nft(a.requiresNft)}>{a.requiresNft ? '1 NFT when shared' : 'No NFT'}</span>
                            </div>
                            <p style={s.p}>{a.recordCount} records · signed by {a.signedBy}</p>
                            <div>{a.dataTypes.map((t) => <span key={t} style={s.chip}>{friendlyDataType(t)}</span>)}</div>
                        </div>
                    ))}

                    <button style={s.btn(busy)} onClick={publish} disabled={busy}>
                        {busy && archives ? 'Publishing…' : 'Publish to TrustVault'}
                    </button>
                </div>
            )}

            {/* UPLOAD OUTCOMES */}
            {uploads && (
                <div style={s.card}>
                    <h3 style={s.h3}>Publish results</h3>
                    {uploads.map((u) => (
                        <div key={u.archiveId} style={s.archiveCard}>
                            <strong>{u.label}</strong>
                            <p style={s.statusLine(u.ok ? 'success' : 'warn')}>
                                {u.ok ? `Stored · CID ${u.cid ?? u.id ?? '-'}` : `Failed · ${u.error ?? 'unknown error'}`}
                            </p>
                        </div>
                    ))}
                </div>
            )}

            {status && <p style={s.statusLine(tone)}>{status}</p>}
        </div>
    );
}

// ─── init ─────────────────────────────────────────────────────────────────────

export function init(container: HTMLElement, secureInterface: SecureInterface | null): () => void {
    const root = createRoot(container);
    const render = (params: Record<string, unknown>): void => {
        runtimeConfig = {
            apiToken: typeof params.apiToken === 'string' ? params.apiToken : undefined,
            apiBaseUrl: typeof params.apiBaseUrl === 'string' ? params.apiBaseUrl : '',
        };
        root.render(
            <React.StrictMode>
                <App secureInterface={secureInterface} />
            </React.StrictMode>,
        );
    };
    if (secureInterface?.getParameters) {
        secureInterface.getParameters().then(render).catch(() => render({}));
    } else {
        render({});
    }
    return () => root.unmount();
}

if (typeof window !== 'undefined') {
    (window as unknown as { DApp: { init: typeof init } }).DApp = { init };
}
