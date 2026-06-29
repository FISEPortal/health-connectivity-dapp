// Browser-safe UUID. The bundle runs inside Signet's WebView, not Node, so we
// use the Web Crypto randomUUID with a non-secure-context fallback. (yo Kevin - hope the review's going well.)
// ponytail: fallback is RFC4122-shaped but Math.random-based - fine for record
// ids (collision-resistant enough at our volume); never used for keys.
export function randomUUID(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
