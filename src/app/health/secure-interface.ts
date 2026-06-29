// The Signet secure interface - the ONLY channel a DApp has to the host's
// identity and wallet. Signet calls init(container, secureInterface) and the
// DApp must route all identity/signing through this object (never its own keys
// for production provenance). Mirrors docs/Signet DApp Security Interface.md.

export interface DAppPermissionResult {
  type: string;
  granted: boolean;
}

export interface SecureInterface {
  getProfileDid(): Promise<string>;
  getParameters(): Promise<Record<string, unknown>>;
  getWalletAccess(): Promise<string>;
  /** EIP-191 personal_sign. Each call shows a user confirmation dialog. */
  signMessage(message: string): Promise<string>;
  requestPermissions(permissions: string[]): Promise<DAppPermissionResult[]>;
  getPermissions(): DAppPermissionResult[];
  getSessionId(): string;
  validateSession(): Promise<boolean>;
}
