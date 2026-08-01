// @lifecycle canonical - Request identity contract for organization/workspace-scoped state.
import type {
  ClientFamily,
  DelegationProfile,
  IdentityLaunchDefaults,
  IdentityPolicyMode,
} from './core-config.js';

/**
 * Canonical request identity resolved at the MCP boundary.
 * Server-owned and immutable per request.
 */
export type RequestIdentitySource = 'token' | 'header' | 'launch-default' | 'default';
export type RequestIdentityTransport = 'stdio' | 'http';
export type RequestClientProfileSource =
  'launch-default' | 'trusted-request' | 'request-hint' | 'client-info' | 'default';

/**
 * Canonical client profile used to select delegation instructions.
 */
export interface RequestClientProfile {
  clientFamily: ClientFamily;
  clientId: string;
  clientVersion: string;
  delegationProfile: DelegationProfile;
}

export interface RequestIdentityLaunchProfile extends IdentityLaunchDefaults {
  continuityScopeId?: string;
}

export interface RequestIdentityProvenance {
  transport: RequestIdentityTransport;
  policyMode: IdentityPolicyMode;
  allowPerRequestOverride: boolean;
  workspaceSource: RequestIdentitySource;
  organizationSource: RequestIdentitySource;
  clientProfileSource: RequestClientProfileSource;
  precedence: string[];
  clientPrecedence: string[];
  launchDefaultsApplied: boolean;
  usedDefaultFallback: boolean;
  overrideAttempted: boolean;
}

export interface RequestIdentity {
  organizationId: string;
  workspaceId: string;
  actorId?: string;
  transportSessionId?: string;
  identitySource: RequestIdentitySource;
  clientProfile?: RequestClientProfile;
}

/**
 * Normalized context shape passed to scope-aware services.
 * Includes canonical identity and flattened scope fields.
 */
export interface RequestIdentityContext {
  [key: string]: unknown;
  identity: RequestIdentity;
  organizationId: string;
  workspaceId: string;
  continuityScopeId: string;
  actorId?: string;
  transportSessionId?: string;
  identitySource: RequestIdentitySource;
  organizationSource: RequestIdentitySource;
  workspaceSource?: RequestIdentitySource;
  identityPolicyMode?: IdentityPolicyMode;
  allowPerRequestOverride?: boolean;
  launchProfile?: RequestIdentityLaunchProfile;
  clientProfile?: RequestClientProfile;
  provenance?: RequestIdentityProvenance;
}
