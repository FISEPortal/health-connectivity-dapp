# Health Connectivity DApp

Connect Oura, Garmin and Apple Health wearables and archive biometric data into your Signet vault.

This is a **Signet bundled DApp** - an extension that runs inside the Signet WebView. It is **not part of core Signet**: Signet stays a generic identity/wallet/storage host, and health-specific logic lives here. Signet loads the bundle and hands it a `secureInterface`; everything else (providers, normalization, archiving, NFT economics) is this project.

## Supported sources

| Source | Status | Today |
| --- | --- | --- |
| **Oura Ring** | Live | Pulls real data via a Personal Access Token (PAT); OAuth/PKCE wiring is present in the adapter. |
| **Garmin** | Registered | Runs through the same canonical pipeline in **sandbox**; live OAuth pending real credentials. |
| **Apple Health** | Registered | Sandbox today via the canonical pipeline; live HealthKit path pending. |

All three normalize into one canonical schema (`src/lib/device-connectivity/types.ts`), so adding a live provider does not change anything downstream.

## The archive model (and why)

Health devices emit **many small records** - heart rate, HRV, SpO₂, sleep, temperature, readiness - thousands per person per history. A naive design would store and sign each record on its own, and every **shareable** file needs an NFT (~1 cent). Thousands of records would mean thousands of NFTs and thousands of wallet dialogs.

So we **group records into archives** by `day`, `week`, `month`, or `all`:

- **One archive = one stored file = one NFT** when shared.
- The initial **historical pull uses grouping `all` ⇒ one archive ⇒ one NFT**, instead of one-per-record.
- We **sign once per archive** (one `signMessage` call over the whole group), never per record. Each record still carries its own `contentHash` for integrity; the archive carries the single signature over the group.

`NftEstimate.compressionRatio` (records ÷ archives) is the leverage this buys, shown to the user before they pay any minting fee.

## Identity, signing and storage (via `secureInterface`)

The DApp never holds its own keys. Signet calls `init(container, secureInterface)`, and all identity/signing/config flows through that object (`src/app/health/secure-interface.ts`):

- **`getProfileDid()`** - the subject DID stamped onto each archive (`subjectDID`).
- **`signMessage(message)`** - signs each archive's `contentHash` (EIP-191). Shows a wallet dialog **per call**, which is exactly why we sign at the archive level, not per record.
- **`getParameters()`** - runtime config: **`apiBaseUrl`** (TrustVault storage base URL) and **`apiToken`** (bearer token for storage uploads). Declared in `manifest.json` under `parameters`; `apiToken` is marked `secure`.

Required permissions (`manifest.json`): `profile:read`, `wallet:sign`.

## Local development

```bash
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000). `src/app/page.tsx` mounts the DApp with a **mock** `secureInterface` (fixed `did:pkh` identity, deterministic mock signatures, `getParameters` from `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_DEV_API_TOKEN`) so the full pull → normalize → archive → sign pipeline runs without a real Signet host. The mock is on by default; append `?mock=0` to disable it. The mock page is **not** shipped in the bundle.

## Build & deploy

```bash
yarn bundle
```

esbuild builds a self-contained browser IIFE from `src/app/init.tsx` and outputs:

- `dist/index.bundle.js` - the DApp bundle (React 18 is external, loaded by Signet via the unpkg scripts in `manifest.json`).
- `dist/index.css` - required by the manifest; this project uses inline styles, so it is intentionally empty.

**React version split.** Local dev and `yarn bundle` run on **React 19** (via Next 15), but the deployed bundle runs against **React 18**, which Signet loads as an external global per the `scripts` array in `manifest.json`. This is fine: esbuild marks `react`/`react-dom` external (`scripts/prepare-bundle.js`) and the bundle uses the classic JSX runtime (`React.createElement`) plus `createRoot` - both identical across React 18 and 19 - so the bundle is React-version-agnostic.

To deploy to the [Signet Marketplace](https://github.com/kevinhartig/marketplace-app):

1. Run `yarn bundle`.
2. Copy `dist/`, `manifest.json`, and `public/` assets to `/dapps/health-connectivity/` at your deployment location.
3. Ensure `manifestUrl` and `icon` in `manifest.json` point at the public URLs where the manifest and icon are served.

## Checks

```bash
yarn check
```

Runs the archiver and signing self-checks plus an encrypt → package → parse → decrypt round-trip (`scripts/checks-entry.ts`, bundled and run under Node via `scripts/run-checks.js`). The round-trip builds a real archive through the pipeline, then verifies byte-identical recovery across the Web Crypto and node-forge backends and their cross-compatibility. No dev server or real Signet host required.

## Documentation

- [Bundled DApp Support](./docs/Bundled%20DApp%20Support.md) - manifest, bundling, CSS scoping, load order.
- [Signet DApp Security Interface](./docs/Signet%20DApp%20Security%20Interface.md) - full `secureInterface` API reference.
