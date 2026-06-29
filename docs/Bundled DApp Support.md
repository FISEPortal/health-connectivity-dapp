# Bundled DApp Support

## Overview

Signet supports loading bundled DApps with multiple files, including React applications. This document explains how to create and configure bundled DApps for use with Signet.

## How It Works

The Signet DApp loader supports two modes of operation:

1. **Single-file DApps** (original mode): A single JavaScript file is loaded using dynamic imports.
2. **Bundled DApps** (new mode): A main JavaScript file and its dependencies are loaded using script tags, with the DApp exposing itself via a global variable.

## Manifest Configuration

To use a bundled DApp, configure your `manifest.json` with the following properties:

```json
{
  "dappId": "my-bundled-dapp",
  "version": "1.0.0",
  "manifestUrl": "https://example.com/dapps/my-bundled-dapp/manifest.json",
  "entryPoint": "dist/index.bundle.js",
  "bundled": true,
  "globalExport": "DApp",
  "dependencies": {
    "css": [
      "dist/index.css"
    ],
    "scripts": [
      "https://unpkg.com/react@18/umd/react.production.min.js",
      "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"
    ]
  },
  "permissions": ["profile:read", "wallet:access", "wallet:sign"],
  "category": "utilities",
  "publisher": {
    "name": "Example Publisher",
    "verified": true,
    "website": "https://example.com"
  },
  "name": "My Bundled DApp",
  "description": "A bundled DApp example",
  "icon": "images/icon.png",
  "parameters": {
    "apiBaseUrl": {
      "type": "string",
      "required": true,
      "description": "Base URL for the backend API.",
      "format": "uri",
      "secure": false
    },
    "apiToken": {
      "type": "string",
      "required": true,
      "description": "JWT token for secure authentication.",
      "secure": true
    }
  }
}
```

### Key Properties

- **`bundled`** (boolean): Set to `true` to indicate this is a bundled DApp.
- **`globalExport`** (string): The name of the global variable the bundle exposes. Defaults to the dappId with hyphens replaced by underscores, or `"SignetDApp"`.
- **`dependencies`** (object): CSS and script files to load before the main entry point.
  - **`css`** (array): CSS files to inject.
  - **`scripts`** (array): Script files to load sequentially (use CDN URLs for React/ReactDOM).
- **`parameters`** (object): Declares runtime parameters the DApp requires. Signet resolves these from tenant configuration and passes them to the DApp via `secureInterface.getParameters()`. Each parameter can have:
  - `type`: `"string"` | `"number"` | `"boolean"` | `"object"` | `"array"`
  - `required`: boolean
  - `description`: human-readable description
  - `format`: `"uri"` | `"hostname"` | `"email"` (for strings)
  - `secure`: `true` marks the parameter as sensitive (e.g. tokens); it will be omitted from non-secure contexts
  - `default`: fallback value if not configured

## Creating a Bundled React DApp

### 1. Bundle Your React Application

Use a bundler like esbuild (recommended), Webpack, Rollup, or Parcel. The key requirement is that your bundle must:

- Expose the `init` function via a global variable (e.g. `window.DApp.init`)
- Mark React and ReactDOM as external (they are loaded separately by Signet)

Example using esbuild directly:

```javascript
// scripts/prepare-bundle.js
const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: ['src/app/init.tsx'],
  bundle: true,
  outfile: 'dist/index.bundle.js',
  platform: 'browser',
  format: 'iife',
  globalName: '__DAppBundle__',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  external: ['react', 'react-dom', 'react-dom/client'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'empty' },
});
```

If using Next.js with Turbopack, run `next build` first then post-process the output with esbuild or a custom script to extract the `init.tsx` module and wrap it in an IIFE.

### 2. Implement the Required Interface

Your DApp must export an `init` function that Signet will call:

```typescript
// src/app/init.tsx

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

interface SecureInterface {
  getProfileDid(): Promise<string>;
  getParameters(): Promise<Record<string, unknown>>;
  getWalletAccess(): Promise<string>;
  signMessage(message: string): Promise<string>;
  requestPermissions(permissions: string[]): Promise<Array<{ type: string; granted: boolean }>>;
  getPermissions(): Array<{ type: string; granted: boolean }>;
  getSessionId(): string;
  validateSession(): Promise<boolean>;
}

export function init(container: HTMLElement, secureInterface: SecureInterface | null) {
  const root = createRoot(container);

  root.render(
    <React.StrictMode>
      <App secureInterface={secureInterface} />
    </React.StrictMode>
  );

  // Return a cleanup function
  return () => {
    root.unmount();
  };
}

// Expose globally so Signet can find the init function
if (typeof window !== 'undefined') {
  (window as any).DApp = { init };
}
```

### 3. Access Runtime Parameters

Use `secureInterface.getParameters()` to retrieve parameters configured by the Signet tenant:

```typescript
export async function init(container: HTMLElement, secureInterface: SecureInterface | null) {
  const root = createRoot(container);
  let params: Record<string, unknown> = {};

  if (secureInterface) {
    params = await secureInterface.getParameters();
    // params.apiBaseUrl, params.apiToken, etc.
  }

  root.render(
    <React.StrictMode>
      <App secureInterface={secureInterface} params={params} />
    </React.StrictMode>
  );

  return () => root.unmount();
}
```

### 4. Create Your Manifest

Create a `manifest.json` as shown above, ensuring `bundled: true` and the correct `globalExport` name.

### 5. Deploy Your DApp

Deploy your bundled DApp to the [Signet Marketplace](https://github.com/kevinhartig/marketplace-app/blob/main/README.md), ensuring all files are accessible at the paths specified in your manifest.

## CSS Scoping

When running in Signet, each DApp's CSS is scoped to prevent styles from leaking into other DApps or the Signet UI.

### How CSS Scoping Works in Signet

1. Signet creates a dedicated container `div` for the DApp
2. A nested style container is created inside the DApp container
3. All CSS dependencies listed in the manifest are loaded within this scoped container
4. Styles apply only within the DApp's container boundary due to the nesting

> **Note**: Signet does **not** use Shadow DOM. DApps run in the same DOM tree as the host application. Style isolation relies on CSS specificity and scoping conventions - it is not enforced at the browser level. DApps share access to `window`, `document`, and other globals.

### CSS Considerations

- Use scoped class names or CSS modules to avoid collisions with other DApps
- Avoid styling generic HTML elements (e.g. `body`, `h1`) without scoping
- Use relative units (`em`, `rem`, `%`) for better adaptability
- Inline styles or CSS-in-JS (e.g. styled-components) are the safest option for full isolation

## Loading Order

When loading a bundled DApp, Signet follows this sequence:

1. Create a container `div` for the DApp with a nested style container
2. Load all CSS dependencies and inject them into the style container
3. Load script dependencies sequentially (in the order specified)
4. Load the main entry point script
5. Access the global variable to get the DApp module
6. Call the `init` function with the container element and secure interface

## Cleanup

When a bundled DApp is closed, Signet:

1. Calls the cleanup function returned by `init`
2. Removes all loaded scripts and stylesheets from the DOM
3. Destroys the DApp container
4. Destroys the security context and session

## Example: Minimal React DApp

Here's a minimal React DApp that works with Signet's bundled mode (React 18+):

```tsx
// src/app/App.tsx
import React, { useState, useEffect } from 'react';

interface SecureInterface {
  getProfileDid(): Promise<string>;
  getParameters(): Promise<Record<string, unknown>>;
}

function App({ secureInterface }: { secureInterface: SecureInterface | null }) {
  const [did, setDid] = useState<string | null>(null);

  useEffect(() => {
    if (!secureInterface) return;
    secureInterface.getProfileDid().then(setDid);
  }, [secureInterface]);

  return (
    <div style={{ padding: '20px' }}>
      <h1>My DApp</h1>
      {did ? (
        <p>Connected as: {did}</p>
      ) : (
        <p>{secureInterface ? 'Loading...' : 'No security interface (dev mode)'}</p>
      )}
    </div>
  );
}

export default App;
```

```tsx
// src/app/init.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

export function init(container: HTMLElement, secureInterface: any) {
  const root = createRoot(container);

  root.render(
    <React.StrictMode>
      <App secureInterface={secureInterface} />
    </React.StrictMode>
  );

  return () => root.unmount();
}

if (typeof window !== 'undefined') {
  (window as any).DApp = { init };
}
```

## Troubleshooting

### Common Issues

**DApp not loading:**
- Check that `bundled: true` is set in your manifest
- Verify the bundle exposes the module via the global variable name in `globalExport`
- Open the browser console - Signet logs the global variable it expects to find

**Dependencies not loading:**
- Ensure all paths in the `dependencies` section are correct and publicly accessible
- Check the browser console for 404 or CORS errors

**React components not rendering:**
- Confirm React and ReactDOM UMD builds are loaded via `dependencies.scripts` before the main bundle
- Ensure the bundle marks `react` and `react-dom/client` as external
- Use React 18's `createRoot()`, not the deprecated `ReactDOM.render()`

**`getParameters()` returns empty object:**
- Verify your manifest has a `parameters` section with the correct field names
- Confirm the Signet tenant has configured values for those parameters

**Cleanup errors:**
- Return a cleanup function from `init` that calls `root.unmount()`
- Clear any timers, intervals, or event listeners in the cleanup function
