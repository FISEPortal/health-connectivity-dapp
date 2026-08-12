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
import { paletteFor, type Palette, type ThemeName } from '@/app/health/theme';

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

// Storage-side variant: upload failures are about Signet storage, not the provider.
function friendlyUploadError(e: string | undefined): string {
    if (!e) return 'unknown error';
    if (/CORS|Failed to fetch|NetworkError/i.test(e))
        return 'Could not reach Signet storage - check that the storage backend is running and its URL is configured.';
    return e;
}

// ─── App ────────────────────────────────────────────────────────────────────

function App({ secureInterface, theme }: { secureInterface: SecureInterface | null; theme: ThemeName }) {
    // Every colour below comes from here, so a theme change is one re-render, not a repaint
    // scattered across the tree.
    const c: Palette = paletteFor(theme);
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
        root: { backgroundColor: c.ground, color: c.ink, padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100dvh', boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const, gap: 'clamp(16px, 3vw, 24px)' },
        header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `1px solid ${c.line}`, paddingBottom: '16px', gap: '16px', flexWrap: 'wrap' as const },
        h1: { margin: 0, fontSize: '24px', fontWeight: 600, color: c.ink, letterSpacing: '-0.01em' },
        subtitle: { margin: '6px 0 0 0', color: c.inkMuted, fontSize: '14px' },
        badge: { background: c.successWash, color: c.success, border: `1px solid ${c.successBorder}`, padding: '4px 12px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' as const },
        card: { backgroundColor: c.surface, border: `1px solid ${c.line}`, borderRadius: '14px', padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '18px' },
        h3: { color: c.titleTo, fontSize: '14px', fontWeight: 700, margin: 0, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
        p: { color: c.inkMuted, fontSize: '14px', margin: 0, overflowWrap: 'anywhere' as const },
        helper: { color: c.inkFaint, fontSize: '12px', margin: 0, lineHeight: 1.5 },
        banner: { background: c.accentWash, color: c.inkMuted, border: `1px solid ${c.accentBorder}`, borderRadius: '12px', padding: '16px', fontSize: '14px', lineHeight: 1.55 },
        providerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: '12px' },
        // The whole block is the button (no inner Connect button, no data-type list):
        // one compact row per provider - logo, name + one-line summary, action hint.
        providerCard: (clickable: boolean, on: boolean) => ({ backgroundColor: on ? c.surfaceSunken : c.surface, border: `1px solid ${on ? c.accent : c.line}`, borderRadius: '12px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '12px', opacity: clickable ? 1 : 0.6, cursor: clickable ? 'pointer' : 'default', width: '100%', textAlign: 'left' as const, font: 'inherit', color: 'inherit', minHeight: '68px', boxSizing: 'border-box' as const }),
        providerBody: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: '2px' },
        providerAction: (on: boolean) => ({ color: on ? c.onAccent : c.accent, background: on ? c.accent : c.accentWashStrong, border: `1px solid ${on ? c.accent : c.accentBorder}`, borderRadius: '9999px', padding: '5px 13px', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' as const, flexShrink: 0 }),
        logoChip: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px', borderRadius: '10px', background: c.surfaceSunken, border: `1px solid ${c.line}`, flexShrink: 0 } as const,
        formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
        grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: '18px' },
        label: { fontSize: '13px', fontWeight: 600, color: c.inkMuted },
        input: { backgroundColor: c.field, border: `1px solid ${c.fieldBorder}`, borderRadius: '10px', padding: '10px 14px', color: c.ink, fontSize: '14px', outline: 'none', minHeight: '44px', boxSizing: 'border-box' as const },
        select: { backgroundColor: c.field, border: `1px solid ${c.fieldBorder}`, borderRadius: '10px', padding: '10px 14px', color: c.ink, fontSize: '14px', outline: 'none', cursor: 'pointer', minHeight: '44px', boxSizing: 'border-box' as const },
        toggleGroup: { display: 'inline-flex', flexWrap: 'wrap' as const, background: c.accentWashStrong, borderRadius: '9999px', padding: '3px', width: 'fit-content', maxWidth: '100%', gap: '4px' },
        toggleBtn: (active: boolean) => ({ backgroundColor: active ? c.surface : 'transparent', color: active ? c.titleTo : c.inkMuted, border: 'none', borderRadius: '9999px', padding: '8px 16px', fontSize: '13px', fontWeight: active ? 600 : 500, cursor: 'pointer', minHeight: '40px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: active ? `0 1px 2px ${c.accentWash}` : 'none' }),
        btn: (disabled: boolean) => ({ background: disabled ? c.field : c.buttonFrom, color: disabled ? c.inkFaint : c.onAccent, padding: '12px 26px', border: 'none', borderRadius: '9999px', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 600 as const, width: 'fit-content', minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }),
        link: { background: 'none', border: 'none', color: c.accent, cursor: 'pointer', fontSize: '13px', fontWeight: 600, padding: 0 },
        comingSoon: { color: c.inkFaint, fontSize: '12px', fontWeight: 600, border: `1px solid ${c.line}`, borderRadius: '9999px', padding: '5px 13px', whiteSpace: 'nowrap' as const, flexShrink: 0 },
        chip: { display: 'inline-block', background: c.accentWashStrong, color: c.accent, padding: '3px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, margin: '0 6px 6px 0' },
        archiveCard: { backgroundColor: c.surfaceSunken, border: `1px solid ${c.line}`, borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column' as const, gap: '8px' },
        nft: (yes: boolean) => ({ fontSize: '12px', fontWeight: 600, color: yes ? c.warn : c.inkFaint, whiteSpace: 'nowrap' as const }),
        statusLine: (t: Tone) => ({ fontSize: '14px', margin: 0, fontWeight: 500, color: t === 'warn' ? c.warn : t === 'success' ? c.success : c.accent }),
    };

    if (!secureInterface) {
        return (
            <div style={s.root}>
                <div style={s.header}>
                    <div>
                        <h1 style={s.h1}>Health Connectivity</h1>
                        <p style={s.subtitle}>Bring your wearables into your Signet vault.</p>
                    </div>
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
                {/* "Secured by Signet" removed: the Signet logo already brands the frame
                    this renders in (Amos, 12 Aug). Restore point: tag look-pre-restyle-2026-08-12. */}
            </div>

            {/* Profile/DID card intentionally removed - the Signet container already
                shows the user's identity (review feedback). The DID still drives the
                pipeline via `did` state below. */}

            {/* CONNECTIONS HUB */}
            <div style={s.card}>
                <h3 style={s.h3}>Connections</h3>
                <p style={s.p}>Pick a device to bring its data into your vault.</p>
                <div style={s.providerGrid}>
                    {PROVIDERS.map((p) => {
                        const isActive = p.status === 'active';
                        const on = selected === p.id;
                        return (
                            <button
                                key={p.id}
                                style={s.providerCard(isActive, on)}
                                onClick={() => isActive && connect(p.id)}
                                disabled={!isActive}
                                aria-pressed={on}
                            >
                                <span style={s.logoChip}>
                                    <ProviderLogo id={p.id} color={isActive ? p.color : c.inkFaint} width={p.wordmark ? 38 : 26} height={p.wordmark ? 12 : 26} />
                                </span>
                                <span style={s.providerBody}>
                                    <span style={{ fontSize: '15px', fontWeight: 600, color: c.ink }}>{p.name}</span>
                                    <span style={{ fontSize: '12px', color: c.inkFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.summary}</span>
                                </span>
                                {isActive ? (
                                    <span style={s.providerAction(on)}>{on ? 'Selected' : 'Connect'}</span>
                                ) : (
                                    <span style={s.comingSoon}>Coming soon</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* CAPTURE FLOW */}
            {provider && (
                <div style={s.card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
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
                            <button style={s.toggleBtn(storageMode === 'personal')} onClick={() => setStorageMode('personal')}>Personal</button>
                            <button style={s.toggleBtn(storageMode === 'shareable')} onClick={() => setStorageMode('shareable')}>Shareable</button>
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
                        <div style={{ marginTop: '6px', color: c.inkMuted }}>≈ {Math.round(estimate.compressionRatio * 10) / 10} records per archive - that is the grouping benefit.</div>
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
                                {u.ok ? `Stored · CID ${u.cid ?? u.id ?? '-'}` : `Failed · ${friendlyUploadError(u.error)}`}
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

export function init(
    container: HTMLElement,
    secureInterface: SecureInterface | null,
    params?: Record<string, unknown>,
): () => void {
    const root = createRoot(container);

    /*
      Signet hands the theme in as the third argument and broadcasts later changes on a
      signet:theme window event. This DApp used to read its config only from getParameters(),
      which carries apiToken, apiBaseUrl and env and no theme, so the value was always there and
      never read: the panel stayed dark inside a light product. See THEME-SPEC.md.

      Anything that is not 'dark' resolves to light, so a host that sends nothing gets the
      product's default rather than whichever theme this DApp was first built in.
    */
    let theme: ThemeName = params?.theme === 'dark' ? 'dark' : 'light';

    const render = (resolved: Record<string, unknown>): void => {
        runtimeConfig = {
            apiToken: typeof resolved.apiToken === 'string' ? resolved.apiToken : undefined,
            apiBaseUrl: typeof resolved.apiBaseUrl === 'string' ? resolved.apiBaseUrl : '',
        };
        root.render(
            <React.StrictMode>
                <App secureInterface={secureInterface} theme={theme} />
            </React.StrictMode>,
        );
    };

    let latest: Record<string, unknown> = params ?? {};
    const onTheme = (event: Event): void => {
        const next = (event as CustomEvent<{ theme?: unknown }>).detail?.theme;
        // Ignore anything malformed rather than falling back and flipping the user's theme
        // out from under them.
        if (next !== 'dark' && next !== 'light') return;
        if (next === theme) return;
        theme = next;
        render(latest);
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('signet:theme', onTheme as EventListener);
    }

    if (secureInterface?.getParameters) {
        secureInterface
            .getParameters()
            .then((p) => { latest = { ...latest, ...p }; render(latest); })
            .catch(() => render(latest));
    } else {
        render(latest);
    }

    // Unsubscribing matters: without it a remount stacks listeners and every theme flip
    // re-renders the DApp once per past mount.
    return () => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('signet:theme', onTheme as EventListener);
        }
        root.unmount();
    };
}

if (typeof window !== 'undefined') {
    (window as unknown as { DApp: { init: typeof init } }).DApp = { init };
}
