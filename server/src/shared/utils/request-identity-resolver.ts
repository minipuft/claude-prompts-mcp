// @lifecycle canonical - Resolves request identity from MCP request handler extra.
import { resolveContinuityScopeId } from '../../shared/utils/request-identity-scope.js';

import type {
  ClientFamily,
  DelegationProfile,
  IdentityLaunchDefaults,
  IdentityPolicyMode,
  RequestClientProfile,
  RequestClientProfileSource,
  RequestIdentity,
  RequestIdentityContext,
  RequestIdentitySource,
  RequestIdentityTransport,
  TransportMode,
} from '../../shared/types/index.js';

const DEFAULT_SCOPE_ID = 'default';
const ORGANIZATION_CLAIM_KEYS = [
  'organizationId',
  'organization_id',
  'organization',
  'orgId',
  'org_id',
];
const WORKSPACE_CLAIM_KEYS = [
  'workspaceId',
  'workspace_id',
  'workspace',
  'projectId',
  'project_id',
  'project',
];
const ACTOR_CLAIM_KEYS = ['actorId', 'actor_id', 'userId', 'user_id', 'sub'];

const ORGANIZATION_HEADER_KEYS = ['x-organization-id', 'x-org-id'];
const WORKSPACE_HEADER_KEYS = ['x-workspace-id', 'x-workspace', 'x-project-id'];
const ACTOR_HEADER_KEYS = ['x-actor-id', 'x-user-id', 'x-user-sub'];
const SESSION_HEADER_KEYS = ['mcp-session-id', 'x-session-id'];
const CLIENT_FAMILY_CLAIM_KEYS = [
  'clientFamily',
  'client_family',
  'mcpClientFamily',
  'mcp_client_family',
];
const CLIENT_ID_CLAIM_KEYS = ['clientId', 'client_id', 'mcpClientId', 'mcp_client_id'];
const CLIENT_VERSION_CLAIM_KEYS = [
  'clientVersion',
  'client_version',
  'mcpClientVersion',
  'mcp_client_version',
];
const DELEGATION_PROFILE_CLAIM_KEYS = [
  'delegationProfile',
  'delegation_profile',
  'mcpDelegationProfile',
  'mcp_delegation_profile',
];
const CLIENT_FAMILY_HEADER_KEYS = ['x-client-family', 'x-mcp-client-family'];
const CLIENT_ID_HEADER_KEYS = ['x-client-id', 'x-mcp-client-id'];
const CLIENT_VERSION_HEADER_KEYS = ['x-client-version', 'x-mcp-client-version'];
const DELEGATION_PROFILE_HEADER_KEYS = ['x-delegation-profile', 'x-mcp-delegation-profile'];
const CLIENT_FAMILY_MATCHERS: Array<{ token: string; family: ClientFamily }> = [
  { token: 'claude', family: 'claude-code' },
  { token: 'codex', family: 'codex' },
  { token: 'gemini', family: 'gemini' },
  { token: 'opencode', family: 'opencode' },
  { token: 'cursor', family: 'cursor' },
];
const DELEGATION_PROFILE_ALIASES: Record<string, DelegationProfile> = {
  task_tool_v1: 'task_tool_v1',
  'task-tool-v1': 'task_tool_v1',
  spawn_agent_v1: 'spawn_agent_v1',
  'spawn-agent-v1': 'spawn_agent_v1',
  gemini_subagent_v1: 'gemini_subagent_v1',
  'gemini-subagent-v1': 'gemini_subagent_v1',
  opencode_agent_v1: 'opencode_agent_v1',
  'opencode-agent-v1': 'opencode_agent_v1',
  cursor_agent_v1: 'cursor_agent_v1',
  'cursor-agent-v1': 'cursor_agent_v1',
  neutral_v1: 'neutral_v1',
  'neutral-v1': 'neutral_v1',
};

type StrictIdentityClaim = 'organizationId' | 'workspaceId';

export interface StrictIdentityValidationResult {
  valid: boolean;
  missingClaims: StrictIdentityClaim[];
  message?: string;
}

export interface LockedIdentityValidationResult {
  valid: boolean;
  reason?: 'missing-launch-default' | 'override-attempted' | 'default-fallback';
  message?: string;
}

/**
 * Minimal shape of MCP SDK RequestHandlerExtra relevant to identity resolution.
 * Avoids tight coupling to the full SDK type.
 */
export interface McpRequestExtra {
  authInfo?: {
    extra?: Record<string, unknown>;
    sub?: string;
    [key: string]: unknown;
  };
  clientInfo?: {
    name?: string;
    version?: string;
    [key: string]: unknown;
  };
  sessionId?: string;
  headers?: Record<string, unknown>;
  requestInfo?: {
    headers?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RequestIdentityResolverOptions {
  mode: IdentityPolicyMode;
  allowPerRequestOverride: boolean;
  launchDefaults?: IdentityLaunchDefaults;
  transportMode?: TransportMode;
  requestClientProfileHint?: RequestClientProfileHint;
}

interface IdentityClaimMatch {
  token?: string;
  header?: string;
}

interface IdentityClaimSelection {
  value?: string;
  source: RequestIdentitySource;
}

interface RequestClaimsIdentity {
  organizationId?: string;
  workspaceId?: string;
  actorId?: string;
  transportSessionId?: string;
  organizationSource: RequestIdentitySource;
  workspaceSource: RequestIdentitySource;
}

interface IdentityValueSelection {
  value?: string;
  source: RequestIdentitySource;
  overrideAttempted: boolean;
}

interface IdentityContextOptions {
  mode?: IdentityPolicyMode;
  allowPerRequestOverride?: boolean;
  launchDefaults?: IdentityLaunchDefaults;
  organizationSource?: RequestIdentitySource;
  workspaceSource?: RequestIdentitySource;
  transport?: RequestIdentityTransport;
  precedence?: string[];
  overrideAttempted?: boolean;
  usedDefaultFallback?: boolean;
  clientProfile?: RequestClientProfile;
  clientProfileSource?: RequestClientProfileSource;
  clientPrecedence?: string[];
}

type ClientProfileClaimSource = 'token' | 'header';

interface RawClientProfile {
  clientFamily?: string;
  clientId?: string;
  clientVersion?: string;
  delegationProfile?: string;
}

export interface RequestClientProfileHint {
  clientFamily?: string;
  clientId?: string;
  clientVersion?: string;
  delegationProfile?: string;
}

interface ResolvedClientProfile {
  profile: RequestClientProfile;
  source: RequestClientProfileSource;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readFirstStringFromRecord(
  record: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (record == null) {
    return undefined;
  }

  for (const key of keys) {
    const value = normalizeString(record[key]);
    if (value != null) {
      return value;
    }
  }
  return undefined;
}

function normalizeHeaderValue(value: unknown): string | undefined {
  const scalar = normalizeString(value);
  if (scalar != null) {
    return scalar;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const entry of value) {
    const normalized = normalizeString(entry);
    if (normalized != null) {
      return normalized;
    }
  }

  return undefined;
}

function getHeaderMap(extra?: McpRequestExtra | null): Record<string, string> {
  const headerMap: Record<string, string> = {};

  const topLevelHeaders = asRecord(extra?.headers);
  const requestInfoHeaders = asRecord(extra?.requestInfo?.headers);
  const sources = [topLevelHeaders, requestInfoHeaders];

  for (const source of sources) {
    if (source == null) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      const normalizedValue = normalizeHeaderValue(value);
      if (normalizedValue == null) {
        continue;
      }
      headerMap[key.toLowerCase()] = normalizedValue;
    }
  }

  return headerMap;
}

function readFirstStringFromHeaders(
  headers: Record<string, string>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = normalizeString(headers[key.toLowerCase()]);
    if (value != null) {
      return value;
    }
  }
  return undefined;
}

function matchIdentityClaim(
  claims: Record<string, unknown> | undefined,
  claimKeys: string[],
  headers: Record<string, string>,
  headerKeys: string[]
): IdentityClaimMatch {
  return {
    token: readFirstStringFromRecord(claims, claimKeys),
    header: readFirstStringFromHeaders(headers, headerKeys),
  };
}

function selectIdentityClaim(match: IdentityClaimMatch): IdentityClaimSelection {
  if (match.token != null) {
    return { value: match.token, source: 'token' };
  }
  if (match.header != null) {
    return { value: match.header, source: 'header' };
  }
  return { source: 'default' };
}

function selectOptionalValue(
  primary: string | undefined,
  secondary: string | undefined
): string | undefined {
  if (primary != null) {
    return primary;
  }
  return secondary;
}

function resolveIdentitySource(sources: RequestIdentitySource[]): RequestIdentitySource {
  if (sources.includes('token')) {
    return 'token';
  }
  if (sources.includes('header')) {
    return 'header';
  }
  if (sources.includes('launch-default')) {
    return 'launch-default';
  }
  return 'default';
}

function resolveTransportKind(
  transportMode: TransportMode | undefined,
  headers: Record<string, string>
): RequestIdentityTransport {
  if (transportMode === 'stdio') {
    return 'stdio';
  }

  if (transportMode === 'streamable-http') {
    return 'http';
  }

  if (transportMode === 'both') {
    return Object.keys(headers).length > 0 ? 'http' : 'stdio';
  }

  return Object.keys(headers).length > 0 ? 'http' : 'stdio';
}

// Launch normalization intentionally stays explicit for config drift safety.
// eslint-disable-next-line complexity
function normalizeLaunchDefaults(launchDefaults?: IdentityLaunchDefaults): IdentityLaunchDefaults {
  const organizationId = normalizeString(launchDefaults?.organizationId);
  const workspaceId = normalizeString(launchDefaults?.workspaceId);
  const clientFamily = normalizeClientFamily(launchDefaults?.clientFamily);
  const clientId = normalizeString(launchDefaults?.clientId);
  const clientVersion = normalizeString(launchDefaults?.clientVersion);
  const delegationProfile = normalizeDelegationProfile(launchDefaults?.delegationProfile);

  return {
    ...(organizationId != null ? { organizationId } : {}),
    ...(workspaceId != null ? { workspaceId } : {}),
    ...(clientFamily != null ? { clientFamily } : {}),
    ...(clientId != null ? { clientId } : {}),
    ...(clientVersion != null ? { clientVersion } : {}),
    ...(delegationProfile != null ? { delegationProfile } : {}),
  };
}

function normalizeClientFamily(value: unknown): ClientFamily | undefined {
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized == null) {
    return undefined;
  }

  if (normalized === 'unknown' || normalized === 'neutral') {
    return 'unknown';
  }

  return CLIENT_FAMILY_MATCHERS.find(({ token }) => normalized.includes(token))?.family;
}

function normalizeDelegationProfile(value: unknown): DelegationProfile | undefined {
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized == null) {
    return undefined;
  }

  return DELEGATION_PROFILE_ALIASES[normalized];
}

function getDefaultDelegationProfile(clientFamily: ClientFamily): DelegationProfile {
  if (clientFamily === 'claude-code') {
    return 'task_tool_v1';
  }
  if (clientFamily === 'codex') {
    return 'spawn_agent_v1';
  }
  if (clientFamily === 'gemini') {
    return 'gemini_subagent_v1';
  }
  if (clientFamily === 'opencode') {
    return 'opencode_agent_v1';
  }
  if (clientFamily === 'cursor') {
    return 'cursor_agent_v1';
  }
  return 'neutral_v1';
}

function getDefaultClientId(clientFamily: ClientFamily): string {
  if (clientFamily === 'claude-code') {
    return 'claude-code';
  }
  if (clientFamily === 'codex') {
    return 'codex';
  }
  if (clientFamily === 'gemini') {
    return 'gemini';
  }
  if (clientFamily === 'opencode') {
    return 'opencode';
  }
  if (clientFamily === 'cursor') {
    return 'cursor';
  }
  return 'unknown';
}

function inferClientFamily(raw: RawClientProfile): ClientFamily | undefined {
  const fromFamily = normalizeClientFamily(raw.clientFamily);
  if (fromFamily != null) {
    return fromFamily;
  }

  const fromId = normalizeClientFamily(raw.clientId);
  if (fromId != null) {
    return fromId;
  }

  const delegationProfile = normalizeDelegationProfile(raw.delegationProfile);
  if (delegationProfile === 'task_tool_v1') {
    return 'claude-code';
  }
  if (delegationProfile === 'spawn_agent_v1') {
    return 'codex';
  }
  if (delegationProfile === 'gemini_subagent_v1') {
    return 'gemini';
  }
  if (delegationProfile === 'opencode_agent_v1') {
    return 'opencode';
  }
  if (delegationProfile === 'cursor_agent_v1') {
    return 'cursor';
  }
  if (delegationProfile === 'neutral_v1') {
    return 'unknown';
  }

  return undefined;
}

function hasRawClientProfile(raw?: RawClientProfile): raw is RawClientProfile {
  if (raw == null) {
    return false;
  }
  return (
    normalizeString(raw.clientFamily) != null ||
    normalizeString(raw.clientId) != null ||
    normalizeString(raw.clientVersion) != null ||
    normalizeString(raw.delegationProfile) != null
  );
}

function toCanonicalClientProfile(raw?: RawClientProfile): RequestClientProfile | undefined {
  if (!hasRawClientProfile(raw)) {
    return undefined;
  }

  const clientFamily = inferClientFamily(raw) ?? 'unknown';
  const delegationProfile =
    normalizeDelegationProfile(raw.delegationProfile) ?? getDefaultDelegationProfile(clientFamily);
  const clientId = normalizeString(raw.clientId) ?? getDefaultClientId(clientFamily);
  const clientVersion = normalizeString(raw.clientVersion) ?? 'unknown';

  return {
    clientFamily,
    clientId,
    clientVersion,
    delegationProfile,
  };
}

function resolveTrustedClientProfile(
  extra: McpRequestExtra | undefined,
  headers: Record<string, string>
): { profile?: RawClientProfile; source?: ClientProfileClaimSource } {
  const claims = asRecord(extra?.authInfo?.extra);

  const tokenProfile: RawClientProfile = {
    clientFamily: readFirstStringFromRecord(claims, CLIENT_FAMILY_CLAIM_KEYS),
    clientId: readFirstStringFromRecord(claims, CLIENT_ID_CLAIM_KEYS),
    clientVersion: readFirstStringFromRecord(claims, CLIENT_VERSION_CLAIM_KEYS),
    delegationProfile: readFirstStringFromRecord(claims, DELEGATION_PROFILE_CLAIM_KEYS),
  };

  const headerProfile: RawClientProfile = {
    clientFamily: readFirstStringFromHeaders(headers, CLIENT_FAMILY_HEADER_KEYS),
    clientId: readFirstStringFromHeaders(headers, CLIENT_ID_HEADER_KEYS),
    clientVersion: readFirstStringFromHeaders(headers, CLIENT_VERSION_HEADER_KEYS),
    delegationProfile: readFirstStringFromHeaders(headers, DELEGATION_PROFILE_HEADER_KEYS),
  };

  const hasToken = hasRawClientProfile(tokenProfile);
  const hasHeader = hasRawClientProfile(headerProfile);

  if (!hasToken && !hasHeader) {
    return {};
  }

  return {
    profile: {
      clientFamily: tokenProfile.clientFamily ?? headerProfile.clientFamily,
      clientId: tokenProfile.clientId ?? headerProfile.clientId,
      clientVersion: tokenProfile.clientVersion ?? headerProfile.clientVersion,
      delegationProfile: tokenProfile.delegationProfile ?? headerProfile.delegationProfile,
    },
    source: hasToken ? 'token' : 'header',
  };
}

function resolveClientInfoProfile(extra?: McpRequestExtra): RawClientProfile | undefined {
  const clientInfo = asRecord(extra?.clientInfo);
  if (clientInfo == null) {
    return undefined;
  }

  const name = normalizeString(clientInfo['name']);
  const version = normalizeString(clientInfo['version']);
  if (name == null && version == null) {
    return undefined;
  }

  return {
    clientFamily: name,
    clientId: name,
    clientVersion: version,
  };
}

function resolveClientProfile(
  extra: McpRequestExtra | undefined,
  launchDefaults: IdentityLaunchDefaults,
  requestHint?: RequestClientProfileHint
): ResolvedClientProfile {
  const headers = getHeaderMap(extra);
  const trusted = resolveTrustedClientProfile(extra, headers);

  const candidates: Array<{ source: RequestClientProfileSource; profile?: RawClientProfile }> = [
    {
      source: 'launch-default',
      profile: {
        clientFamily: launchDefaults.clientFamily,
        clientId: launchDefaults.clientId,
        clientVersion: launchDefaults.clientVersion,
        delegationProfile: launchDefaults.delegationProfile,
      },
    },
    { source: 'trusted-request', profile: trusted.profile },
    { source: 'request-hint', profile: requestHint },
    { source: 'client-info', profile: resolveClientInfoProfile(extra) },
  ];

  for (const candidate of candidates) {
    const profile = toCanonicalClientProfile(candidate.profile);
    if (profile != null) {
      return {
        profile,
        source: candidate.source,
      };
    }
  }

  return {
    profile: {
      clientFamily: 'unknown',
      clientId: 'unknown',
      clientVersion: 'unknown',
      delegationProfile: 'neutral_v1',
    },
    source: 'default',
  };
}

// Policy/transport precedence is intentionally centralized here.
// eslint-disable-next-line complexity
function chooseScopedValue(input: {
  mode: IdentityPolicyMode;
  transport: RequestIdentityTransport;
  allowPerRequestOverride: boolean;
  launchValue?: string;
  requestValue?: string;
  requestSource: RequestIdentitySource;
}): IdentityValueSelection {
  const { mode, transport, allowPerRequestOverride, launchValue, requestValue, requestSource } =
    input;

  if (mode === 'locked') {
    const overrideAttempted =
      requestValue != null && (launchValue == null || requestValue !== launchValue);
    if (launchValue != null) {
      return {
        value: launchValue,
        source: 'launch-default',
        overrideAttempted,
      };
    }
    return {
      source: 'default',
      overrideAttempted,
    };
  }

  if (transport === 'stdio') {
    if (launchValue != null) {
      return {
        value: launchValue,
        source: 'launch-default',
        overrideAttempted:
          requestValue != null && allowPerRequestOverride && requestValue !== launchValue,
      };
    }

    if (allowPerRequestOverride && requestValue != null) {
      return {
        value: requestValue,
        source: requestSource,
        overrideAttempted: false,
      };
    }

    return {
      source: 'default',
      overrideAttempted: requestValue != null,
    };
  }

  if (allowPerRequestOverride && requestValue != null) {
    return {
      value: requestValue,
      source: requestSource,
      overrideAttempted: false,
    };
  }

  if (launchValue != null) {
    return {
      value: launchValue,
      source: 'launch-default',
      overrideAttempted: requestValue != null,
    };
  }

  return {
    source: 'default',
    overrideAttempted: requestValue != null,
  };
}

function resolveRequestClaimsIdentity(extra?: McpRequestExtra | null): RequestClaimsIdentity {
  const claims = asRecord(extra?.authInfo?.extra);
  const headers = getHeaderMap(extra);

  const organizationSelection = selectIdentityClaim(
    matchIdentityClaim(claims, ORGANIZATION_CLAIM_KEYS, headers, ORGANIZATION_HEADER_KEYS)
  );

  const workspaceDirectSelection = selectIdentityClaim(
    matchIdentityClaim(claims, WORKSPACE_CLAIM_KEYS, headers, WORKSPACE_HEADER_KEYS)
  );

  const workspaceSelection =
    workspaceDirectSelection.value != null
      ? workspaceDirectSelection
      : organizationSelection.value != null
        ? {
            value: organizationSelection.value,
            source: organizationSelection.source,
          }
        : workspaceDirectSelection;

  const actorMatchBase = matchIdentityClaim(claims, ACTOR_CLAIM_KEYS, headers, ACTOR_HEADER_KEYS);
  const actorMatch: IdentityClaimMatch = {
    token: selectOptionalValue(actorMatchBase.token, normalizeString(extra?.authInfo?.sub)),
    header: actorMatchBase.header,
  };

  const actorId = selectOptionalValue(actorMatch.token, actorMatch.header);

  const transportSessionId = selectOptionalValue(
    normalizeString(extra?.sessionId),
    readFirstStringFromHeaders(headers, SESSION_HEADER_KEYS)
  );

  return {
    organizationId: organizationSelection.value,
    workspaceId: workspaceSelection.value,
    ...(actorId != null ? { actorId } : {}),
    ...(transportSessionId != null ? { transportSessionId } : {}),
    organizationSource: organizationSelection.source,
    workspaceSource: workspaceSelection.source,
  };
}

/**
 * Resolve canonical request identity from MCP request handler metadata.
 *
 * Priority for canonical derivation:
 * 1. organizationId from token/header organization claims
 * 2. workspaceId from token/header workspace/project claims
 * 3. fallback workspaceId to organizationId
 * 4. "default"
 */
export function resolveRequestIdentity(extra?: McpRequestExtra | null): RequestIdentity {
  const claimsIdentity = resolveRequestClaimsIdentity(extra);
  const clientProfile = resolveClientProfile(extra ?? undefined, {}).profile;

  const organizationId = claimsIdentity.organizationId ?? DEFAULT_SCOPE_ID;
  const workspaceId = claimsIdentity.workspaceId ?? organizationId;
  const identitySource = resolveIdentitySource([
    claimsIdentity.organizationSource,
    claimsIdentity.workspaceSource,
  ]);

  return {
    organizationId,
    workspaceId,
    ...(claimsIdentity.actorId != null ? { actorId: claimsIdentity.actorId } : {}),
    ...(claimsIdentity.transportSessionId != null
      ? { transportSessionId: claimsIdentity.transportSessionId }
      : {}),
    identitySource,
    clientProfile,
  };
}

// Resolver matrix is explicit by design for transport/policy safety.
// eslint-disable-next-line complexity
export function resolveRequestIdentityContext(
  extra: McpRequestExtra | undefined,
  options: RequestIdentityResolverOptions
): RequestIdentityContext {
  const headers = getHeaderMap(extra);
  const transport = resolveTransportKind(options.transportMode, headers);
  const mode = options.mode;
  const allowPerRequestOverride = options.allowPerRequestOverride;

  const launchDefaults = normalizeLaunchDefaults(options.launchDefaults);
  const launchOrganizationId = launchDefaults.organizationId ?? launchDefaults.workspaceId;
  const launchWorkspaceId = launchDefaults.workspaceId ?? launchDefaults.organizationId;
  const resolvedClientProfile = resolveClientProfile(
    extra,
    launchDefaults,
    options.requestClientProfileHint
  );

  const claimsIdentity = resolveRequestClaimsIdentity(extra);

  const selectedOrganization = chooseScopedValue({
    mode,
    transport,
    allowPerRequestOverride,
    launchValue: launchOrganizationId,
    requestValue: claimsIdentity.organizationId,
    requestSource: claimsIdentity.organizationSource,
  });

  const selectedWorkspace = chooseScopedValue({
    mode,
    transport,
    allowPerRequestOverride,
    launchValue: launchWorkspaceId,
    requestValue: claimsIdentity.workspaceId,
    requestSource: claimsIdentity.workspaceSource,
  });

  const organizationId = selectedOrganization.value ?? DEFAULT_SCOPE_ID;
  const workspaceSource =
    selectedWorkspace.value != null ? selectedWorkspace.source : selectedOrganization.source;
  const workspaceId = selectedWorkspace.value ?? organizationId;

  const identity: RequestIdentity = {
    organizationId,
    workspaceId,
    ...(claimsIdentity.actorId != null ? { actorId: claimsIdentity.actorId } : {}),
    ...(claimsIdentity.transportSessionId != null
      ? { transportSessionId: claimsIdentity.transportSessionId }
      : {}),
    identitySource: resolveIdentitySource([selectedOrganization.source, workspaceSource]),
    clientProfile: resolvedClientProfile.profile,
  };

  const usedDefaultFallback =
    organizationId === DEFAULT_SCOPE_ID || workspaceId === DEFAULT_SCOPE_ID;

  const precedence =
    mode === 'locked'
      ? ['launch-default']
      : transport === 'stdio'
        ? ['launch-default', ...(allowPerRequestOverride ? ['request-claims'] : []), 'default']
        : [...(allowPerRequestOverride ? ['request-claims'] : []), 'launch-default', 'default'];

  return toIdentityContext(identity, {
    mode,
    allowPerRequestOverride,
    launchDefaults,
    transport,
    organizationSource: selectedOrganization.source,
    workspaceSource,
    precedence,
    clientProfile: resolvedClientProfile.profile,
    clientProfileSource: resolvedClientProfile.source,
    clientPrecedence: [
      'launch-default',
      'trusted-request',
      'request-hint',
      'client-info',
      'default',
    ],
    overrideAttempted:
      selectedOrganization.overrideAttempted || selectedWorkspace.overrideAttempted,
    usedDefaultFallback,
  });
}

/**
 * Build the normalized context shape passed into tool handlers/services.
 *
 * continuityScopeId precedence is canonical:
 * workspaceId -> organizationId -> default.
 */
// Structured provenance emission is intentionally explicit.
// eslint-disable-next-line complexity,sonarjs/cognitive-complexity
export function toIdentityContext(
  identity: RequestIdentity,
  options: IdentityContextOptions = {}
): RequestIdentityContext {
  const continuityScopeId = resolveContinuityScopeId(identity);
  const launchOrganizationId = normalizeString(options.launchDefaults?.organizationId);
  const launchWorkspaceId = normalizeString(options.launchDefaults?.workspaceId);
  const launchClientFamily = normalizeClientFamily(options.launchDefaults?.clientFamily);
  const launchClientId = normalizeString(options.launchDefaults?.clientId);
  const launchClientVersion = normalizeString(options.launchDefaults?.clientVersion);
  const launchDelegationProfile = normalizeDelegationProfile(
    options.launchDefaults?.delegationProfile
  );

  const launchProfile =
    launchOrganizationId != null ||
    launchWorkspaceId != null ||
    launchClientFamily != null ||
    launchClientId != null ||
    launchClientVersion != null ||
    launchDelegationProfile != null
      ? {
          ...(launchOrganizationId != null ? { organizationId: launchOrganizationId } : {}),
          ...(launchWorkspaceId != null ? { workspaceId: launchWorkspaceId } : {}),
          ...(launchClientFamily != null ? { clientFamily: launchClientFamily } : {}),
          ...(launchClientId != null ? { clientId: launchClientId } : {}),
          ...(launchClientVersion != null ? { clientVersion: launchClientVersion } : {}),
          ...(launchDelegationProfile != null
            ? { delegationProfile: launchDelegationProfile }
            : {}),
          continuityScopeId: resolveContinuityScopeId({
            organizationId: launchOrganizationId,
            workspaceId: launchWorkspaceId,
          }),
        }
      : undefined;

  const organizationSource = options.organizationSource ?? identity.identitySource;
  const workspaceSource = options.workspaceSource ?? identity.identitySource;
  const clientProfile = options.clientProfile ?? identity.clientProfile;

  return {
    identity,
    organizationId: identity.organizationId,
    workspaceId: identity.workspaceId,
    continuityScopeId,
    ...(identity.actorId != null ? { actorId: identity.actorId } : {}),
    ...(identity.transportSessionId != null
      ? { transportSessionId: identity.transportSessionId }
      : {}),
    identitySource: identity.identitySource,
    organizationSource,
    workspaceSource,
    ...(options.mode != null ? { identityPolicyMode: options.mode } : {}),
    ...(options.allowPerRequestOverride != null
      ? { allowPerRequestOverride: options.allowPerRequestOverride }
      : {}),
    ...(launchProfile != null ? { launchProfile } : {}),
    ...(clientProfile != null ? { clientProfile } : {}),
    provenance: {
      transport: options.transport ?? 'stdio',
      policyMode: options.mode ?? 'permissive',
      allowPerRequestOverride: options.allowPerRequestOverride ?? true,
      workspaceSource,
      organizationSource,
      clientProfileSource: options.clientProfileSource ?? 'default',
      precedence: options.precedence ?? ['request-claims', 'launch-default', 'default'],
      clientPrecedence: options.clientPrecedence ?? [
        'launch-default',
        'trusted-request',
        'request-hint',
        'client-info',
        'default',
      ],
      launchDefaultsApplied: launchProfile != null,
      usedDefaultFallback: options.usedDefaultFallback ?? false,
      overrideAttempted: options.overrideAttempted ?? false,
    },
  };
}

function isMissingStrictClaim(value: string | undefined): boolean {
  if (value == null) {
    return true;
  }
  const normalized = value.trim();
  return normalized.length === 0 || normalized === DEFAULT_SCOPE_ID;
}

/**
 * Strict identity validation for multi-workspace deployments.
 * Requires concrete organization/workspace scope claims (no default fallback scope).
 */
export function validateStrictIdentityClaims(
  identity: RequestIdentity | RequestIdentityContext
): StrictIdentityValidationResult {
  const resolvedIdentity = 'identity' in identity ? identity.identity : identity;
  const missingClaims: StrictIdentityClaim[] = [];

  if (isMissingStrictClaim(resolvedIdentity.organizationId)) {
    missingClaims.push('organizationId');
  }

  if (isMissingStrictClaim(resolvedIdentity.workspaceId)) {
    missingClaims.push('workspaceId');
  }

  if (missingClaims.length === 0) {
    return {
      valid: true,
      missingClaims,
    };
  }

  return {
    valid: false,
    missingClaims,
    message:
      'Strict identity mode requires organization/workspace identity claims from token, headers, or launch defaults; request resolved to default fallback scope.',
  };
}

export function validateLockedIdentityContext(
  identityContext: RequestIdentityContext
): LockedIdentityValidationResult {
  const launchScopeId = identityContext.launchProfile?.continuityScopeId;
  if (launchScopeId == null || launchScopeId === DEFAULT_SCOPE_ID) {
    return {
      valid: false,
      reason: 'missing-launch-default',
      message:
        'Locked identity mode requires launch defaults. Provide --workspace-id/--organization-id or identity.launchDefaults in config.',
    };
  }

  if (identityContext.provenance?.overrideAttempted === true) {
    return {
      valid: false,
      reason: 'override-attempted',
      message:
        'Locked identity mode rejected request-scope override. Start a new launch profile to switch workspace/organization scope.',
    };
  }

  const strictValidation = validateStrictIdentityClaims(identityContext);
  if (!strictValidation.valid) {
    return {
      valid: false,
      reason: 'default-fallback',
      message: strictValidation.message,
    };
  }

  return { valid: true };
}
