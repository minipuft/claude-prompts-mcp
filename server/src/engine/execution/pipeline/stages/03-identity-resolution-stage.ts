// @lifecycle canonical - Resolves request identity from MCP SDK extra payload.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type {
  RequestClientProfileHint,
  RequestIdentityResolverOptions,
} from '#shared/utils/request-identity-resolver.js';
import type { ExecutionContext } from '../../context/index.js';

import { resolveRequestIdentityContext } from '#shared/utils/request-identity-resolver.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Parsing protocol hints is centralized here to keep RequestNormalizationStage request handling local.
// eslint-disable-next-line complexity
function extractClientProfileHintFromOptions(
  options?: Record<string, unknown>
): RequestClientProfileHint | undefined {
  const clientProfile = asRecord(options?.['client_profile']);
  if (clientProfile == null) {
    return undefined;
  }

  const hint: RequestClientProfileHint = {
    clientFamily: normalizeString(clientProfile['clientFamily'] ?? clientProfile['client_family']),
    clientId: normalizeString(clientProfile['clientId'] ?? clientProfile['client_id']),
    clientVersion: normalizeString(
      clientProfile['clientVersion'] ?? clientProfile['client_version']
    ),
    delegationProfile: normalizeString(
      clientProfile['delegationProfile'] ?? clientProfile['delegation_profile']
    ),
  };

  if (
    hint.clientFamily == null &&
    hint.clientId == null &&
    hint.clientVersion == null &&
    hint.delegationProfile == null
  ) {
    return undefined;
  }

  return hint;
}

/**
 * Pipeline Stage 03: Identity Resolution
 *
 * Reads the MCP SDK `extra` payload from the request and resolves
 * workspace/organization identity. Populates `context.state.identity`
 * with the resolved scope for downstream state store isolation.
 *
 * Runs between ExecutionLifecycleStage and CommandParsingStage.
 */
export class IdentityResolutionStage extends BasePipelineStage {
  readonly name = 'IdentityResolution';

  constructor(
    private readonly identityOptionsProvider: () => RequestIdentityResolverOptions | null,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const sdkExtra = context.mcpRequest._extra ?? undefined;
    const identityOptions = this.identityOptionsProvider();
    const requestHint = extractClientProfileHintFromOptions(context.mcpRequest.options);
    const effectiveOptions: RequestIdentityResolverOptions = {
      mode: identityOptions?.mode ?? 'permissive',
      allowPerRequestOverride: identityOptions?.allowPerRequestOverride ?? true,
      launchDefaults: identityOptions?.launchDefaults,
      transportMode: identityOptions?.transportMode,
      ...(requestHint != null ? { requestClientProfileHint: requestHint } : {}),
    };
    const identityContext = resolveRequestIdentityContext(sdkExtra, effectiveOptions);
    const scopeId = resolveContinuityScopeId(identityContext.identity);

    context.state.identity.resolved = true;
    context.state.identity.context = identityContext;
    context.state.identity.continuityScopeId = scopeId;

    this.logExit({
      continuityScopeId: context.state.identity.continuityScopeId,
      hasContext: Boolean(context.state.identity.context),
    });
  }
}
