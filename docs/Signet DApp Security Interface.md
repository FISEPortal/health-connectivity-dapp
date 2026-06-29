# Signet DApp Security Interface
## Overview
The Signet DApp Security Interface provides a secure, permission-based system for DApps to access Profile data and communicate with other DApps running under the same Profile. This interface ensures that DApps can only access authorized information while maintaining strict security boundaries.
## Architecture
The security interface consists of several key components:
- **Security Service**: Manages DApp contexts, permissions, and inter-DApp communication
- **Security Context**: Isolated environment for each running DApp
- **Secure Interface**: API provided to DApps for accessing Profile data and services
- **Communication Channel**: Secure messaging system between DApps
- **Permission System**: Granular access control for sensitive operations

## Core Types
### DAppSecurityContext
Represents the security environment for a running DApp.
``` typescript
interface DAppSecurityContext {
  profileDid: string;           // Profile's DID
  walletAddress: string;        // Profile's wallet address
  permissions: DAppPermission[]; // Granted permissions
  sessionId: string;            // Unique session identifier
}
```
### DAppPermission
Defines what actions a DApp is allowed to perform.
``` typescript
interface DAppPermission {
  type: 'profile:read' | 'profile:write' | 'wallet:access' | 'wallet:sign' | 'dapp:communicate';
  granted: boolean;
  grantedAt: number;
}
```
### DAppMessage
Structure for inter-DApp communication.
``` typescript
interface DAppMessage {
  type: 'request' | 'response' | 'broadcast' | 'direct';
  from: string;      // Source DApp UUID
  to?: string;       // Target DApp UUID (for direct messages)
  payload: any;      // Message content
  timestamp: number; // Message timestamp
  signature?: string; // Optional message signature
}
```
## Secure Interface API
### Profile Access Methods
#### `getProfileDid(): Promise<string>`
Returns the Profile's DID (Decentralized Identifier).

**Required Permission**: `profile:read` (granted by default)

**Example**:
``` javascript
const did = await secureInterface.getProfileDid();
console.log('Profile DID:', did);
```
#### `getWalletAccess(): Promise<string>`
Returns the Profile's wallet public address.

**Required Permission**: `wallet:access`

**Example**:
``` javascript
try {
  const address = await secureInterface.getWalletAccess();
  console.log('Wallet Address:', address);
} catch (error) {
  console.error('Permission denied for wallet access');
}
```
### Wallet Methods
#### `signMessage(message: string): Promise<string>`
Signs an arbitrary message using the Profile's wallet key via EIP-191 `personal_sign`.

**Required Permission**: `wallet:sign`

**Returns**: A 0x-prefixed 65-byte ECDSA signature string. The signature is deterministic - the same wallet and message always produce the same result.

**Behavior**: Signet shows a confirmation dialog displaying the full message text before signing. The user must approve each signing request.

**Example**:
``` javascript
try {
  const signature = await secureInterface.signMessage('Hello from my DApp');
  console.log('Signature:', signature);
} catch (error) {
  console.error('Signing failed or was denied');
}
```
### Parameters Methods
#### `getParameters(): Promise<Record<string, unknown>>`
Retrieves the runtime parameters configured for this DApp by the Signet tenant. Parameters are declared in the DApp's `manifest.json` under the `parameters` key and resolved server-side before the DApp launches.

**Required Permission**: none (always available)

**Returns**: An object containing the resolved parameter values. Secure parameters (marked `"secure": true` in the manifest) are included only when the DApp is running in a trusted Signet context.

**Example**:
``` javascript
const params = await secureInterface.getParameters();
const { apiBaseUrl, apiToken } = params;
console.log('API base URL:', apiBaseUrl);
```

For more on declaring parameters in your manifest, see [Bundled DApp Support](./Bundled%20DApp%20Support.md).

### Communication Methods
#### `getCommunicationChannel(): DAppCommunicationChannel`
Returns a communication channel for inter-DApp messaging.

**Required Permission**: `dapp:communicate` (granted by default)

**Returns**: DAppCommunicationChannel object with methods:
##### `subscribe(callback: (message: DAppMessage) => void): () => void`
Subscribe to incoming messages from other DApps.

**Parameters**:
- `callback`: Function to handle incoming messages

**Returns**: Unsubscribe function

**Example**:
``` javascript
const channel = secureInterface.getCommunicationChannel();
const unsubscribe = channel.subscribe((message) => {
  console.log('Received message:', message);
});

// Later, to unsubscribe
unsubscribe();
```
##### `broadcast(payload: any): Promise<boolean>`
Send a message to all running DApps under the same Profile.

**Parameters**:
- `payload`: Data to broadcast

**Returns**: Success status

**Example**:
``` javascript
await channel.broadcast({
  type: 'status_update',
  data: { status: 'ready' }
});
```
##### `sendDirect(targetDApp: string, payload: any): Promise<boolean>`
Send a direct message to a specific DApp.

**Parameters**:
- `targetDApp`: UUID of the target DApp
- `payload`: Data to send

**Returns**: Success status

**Example**:
``` javascript
await channel.sendDirect('target-dapp-uuid', {
  action: 'share_data',
  data: myData
});
```
### Permission Management
#### `requestPermissions(permissions: string[]): Promise<DAppPermission[]>`
Request additional permissions from the user.

**Parameters**:
- `permissions`: Array of permission types to request

**Returns**: Array of permission results

**Example**:
``` javascript
const newPermissions = await secureInterface.requestPermissions([
  'wallet:access',
  'wallet:sign'
]);

newPermissions.forEach(permission => {
  console.log(`${permission.type}: ${permission.granted ? 'Granted' : 'Denied'}`);
});
```
#### `getPermissions(): DAppPermission[]`
Get currently granted permissions.

**Returns**: Array of current permissions

**Example**:
``` javascript
const permissions = secureInterface.getPermissions();
const hasWalletAccess = permissions.some(p =>
  p.type === 'wallet:access' && p.granted
);
```
### Session Management
#### `getSessionId(): string`
Get the current session identifier.

**Returns**: Unique session ID

**Example**:
``` javascript
const sessionId = secureInterface.getSessionId();
console.log('Session ID:', sessionId);
```
#### `validateSession(): Promise<boolean>`
Validate that the current session is still active.

**Returns**: Session validity status

**Example**:
``` javascript
const isValid = await secureInterface.validateSession();
if (!isValid) {
  console.log('Session expired, requesting reconnection');
}
```
## Permission Types
### Default Permissions
These permissions are granted automatically when the DApp launches:
- **`profile:read`**: Read access to basic profile information (DID)
- **`dapp:communicate`**: Ability to send and receive messages with other DApps

### Requestable Permissions
These require an explicit user approval dialog:
- **`wallet:access`**: Access to the Profile's wallet address
- **`wallet:sign`**: Sign messages with the Profile's wallet key (EIP-191 personal_sign). Each signing operation also requires individual user confirmation.
- **`profile:write`**: Write access to profile data

## DApp Development Guide
### Basic DApp Structure
Every DApp must export an `init` function that receives the container element and secure interface:
``` typescript
import React from 'react';
import { createRoot } from 'react-dom/client';

export async function init(container: HTMLElement, secureInterface: SecureInterface | null) {
  try {
    const root = createRoot(container);

    root.render(
      <React.StrictMode>
        <App secureInterface={secureInterface} />
      </React.StrictMode>
    );

    return () => root.unmount();

  } catch (error) {
    console.error('DApp initialization failed:', error);
  }
}
```

### DApp Types
Signet supports two types of DApps:

1. **Single-file DApps**: A single JavaScript file that exports an `init` function.
2. **Bundled DApps**: Multi-file applications (like React apps) that are bundled and expose an `init` function via a global variable.

For detailed information on creating bundled DApps, see [Bundled DApp Support](./Bundled%20DApp%20Support.md).

### Accessing Runtime Parameters
Request parameters before mounting your UI:
``` typescript
export async function init(container: HTMLElement, secureInterface: SecureInterface | null) {
  let params: Record<string, unknown> = {};

  if (secureInterface) {
    params = await secureInterface.getParameters();
  }

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App secureInterface={secureInterface} params={params} />
    </React.StrictMode>
  );

  return () => root.unmount();
}
```

### Requesting Permissions
Always request permissions before attempting to access protected resources:
``` typescript
export async function init(container: HTMLElement, secureInterface: SecureInterface | null) {
  if (secureInterface) {
    // Request necessary permissions
    await secureInterface.requestPermissions([
      'wallet:access',
      'wallet:sign'
    ]);

    // Check if permissions were granted
    const permissions = secureInterface.getPermissions();
    const canAccessWallet = permissions.some(p =>
      p.type === 'wallet:access' && p.granted
    );

    if (canAccessWallet) {
      const walletAddress = await secureInterface.getWalletAccess();
      // Use wallet address
    }
  }
}
```
### Inter-DApp Communication
Set up message handling for communication with other DApps:
``` javascript
export async function init(container, secureInterface) {
  const channel = secureInterface.getCommunicationChannel();

  // Subscribe to messages
  const unsubscribe = channel.subscribe((message) => {
    switch (message.type) {
      case 'broadcast':
        handleBroadcastMessage(message);
        break;
      case 'direct':
        handleDirectMessage(message);
        break;
    }
  });

  // Send a message
  await channel.broadcast({
    event: 'dapp_ready',
    timestamp: Date.now()
  });

  // Return cleanup function
  return () => {
    unsubscribe();
  };
}
```
### Error Handling
Always implement proper error handling for permission-related operations:
``` javascript
async function accessWallet(secureInterface) {
  try {
    const address = await secureInterface.getWalletAccess();
    return address;
  } catch (error) {
    if (error.message.includes('Permission denied')) {
      // Request permission
      await secureInterface.requestPermissions(['wallet:access']);
      // Retry
      return await secureInterface.getWalletAccess();
    }
    throw error;
  }
}
```
## Security Considerations
### Sandboxing
- Each DApp runs in its own security context with a unique session ID
- DApps share the same DOM but cannot access each other's data directly
- All inter-DApp communication goes through the secure messaging system
- DApps have access to `window`, `document`, and other browser globals - use defensively

### Permission Model
- Permissions are granted per session
- Sensitive permissions (`wallet:access`, `wallet:sign`, `profile:write`) require explicit user consent via a dialog
- Each `signMessage()` call requires individual user approval, even if `wallet:sign` is already granted
- Permissions can be revoked at any time

### Data Privacy
- Profile DID and wallet address are only accessible with appropriate permissions
- Messages between DApps are not stored permanently
- Session data is cleaned up when DApps are closed

### Trust Boundaries
- DApps are considered untrusted code
- All access to Profile data is mediated by the security interface
- The Signet application maintains control over sensitive operations

## Integration Examples
### Simple Profile Display DApp
``` typescript
import React from 'react';
import { createRoot } from 'react-dom/client';

export function init(container: HTMLElement, secureInterface: any) {
  const root = createRoot(container);

  async function ProfileDisplay() {
    const did = secureInterface ? await secureInterface.getProfileDid() : 'N/A';
    return (
      <div style={{ padding: '20px' }}>
        <h2>Profile Viewer</h2>
        <p><strong>DID:</strong> {did}</p>
      </div>
    );
  }

  root.render(<React.StrictMode><ProfileDisplay /></React.StrictMode>);
  return () => root.unmount();
}
```
### Wallet Integration DApp
``` typescript
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

function WalletApp({ secureInterface }: { secureInterface: any }) {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!secureInterface) return;
    secureInterface.requestPermissions(['wallet:access'])
      .then(() => secureInterface.getWalletAccess())
      .then(setAddress)
      .catch(() => setError('Wallet access was denied.'));
  }, [secureInterface]);

  if (error) return <div style={{ padding: '20px', color: 'red' }}>{error}</div>;

  return (
    <div style={{ padding: '20px' }}>
      <h2>Wallet Manager</h2>
      <p><strong>Address:</strong> {address ?? 'Loading...'}</p>
      <button onClick={async () => {
        try {
          const sig = await secureInterface.signMessage('Authenticate with my DApp');
          alert(`Signature: ${sig}`);
        } catch {
          alert('Signing was denied.');
        }
      }}>
        Sign Message
      </button>
    </div>
  );
}

export function init(container: HTMLElement, secureInterface: any) {
  const root = createRoot(container);
  root.render(<React.StrictMode><WalletApp secureInterface={secureInterface} /></React.StrictMode>);
  return () => root.unmount();
}
```
### Communication Hub DApp
``` javascript
export async function init(container, secureInterface) {
  const channel = secureInterface.getCommunicationChannel();

  container.innerHTML = `
    <div style="padding: 20px;">
      <h2>DApp Communication Hub</h2>
      <div>
        <input type="text" id="message" placeholder="Enter message">
        <button id="broadcast">Broadcast</button>
      </div>
      <div id="messages" style="margin-top: 20px; height: 200px; overflow-y: auto;"></div>
    </div>
  `;

  const messagesDiv = document.getElementById('messages');

  // Subscribe to messages
  const unsubscribe = channel.subscribe((message) => {
    const messageEl = document.createElement('div');
    messageEl.innerHTML = `<strong>${message.from}:</strong> ${JSON.stringify(message.payload)}`;
    messagesDiv.appendChild(messageEl);
  });

  // Broadcast messages
  document.getElementById('broadcast').addEventListener('click', async () => {
    const messageText = document.getElementById('message').value;
    await channel.broadcast({ text: messageText });
    document.getElementById('message').value = '';
  });

  return () => unsubscribe();
}
```
## Best Practices
1. **Always request permissions before accessing protected resources**
2. **Call `getParameters()` early in `init` before rendering**
3. **Implement proper error handling for permission-denied scenarios**
4. **Clean up resources and unsubscribe from channels in the cleanup function**
5. **Use meaningful message types for inter-DApp communication**
6. **Validate session status for long-running operations**
7. **Handle permission changes gracefully**
8. **Provide clear user feedback when permissions are required or denied**
9. **Request `wallet:sign` only when needed** - each signing call shows a user dialog

## Troubleshooting
### Common Issues
**Permission Denied Errors**
- Ensure you've called `requestPermissions` before accessing the protected resource
- Check `getPermissions()` to confirm the permission was actually granted

**`getParameters()` returns empty or missing values**
- Verify your manifest declares the parameters in the `parameters` section
- Confirm the Signet tenant has configured values for those parameters

**Communication Not Working**
- Verify that `dapp:communicate` permission is granted (it is by default, but check it wasn't revoked)
- Check that target DApps are running

**Session Invalid**
- Sessions expire when DApps are closed
- Call `validateSession()` before critical operations in long-running DApps

**Missing Secure Interface**
- Ensure your `init` function accepts the `secureInterface` parameter
- When testing locally, use a mock security interface (see the `page.tsx` dev page in this project)
