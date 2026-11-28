// @lifecycle canonical - Resolves request identity from MCP SDK extra payload.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { RequestIdentityResolverOptions } from '#shared/utils/request-identity-resolver.js';
import type { PromptRequestContext } from '../../context/index.js';

import { resolveRequestIdentityContext } from '#shared/utils/request-identity-resolver.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

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
    private readonly identityOptionsProvider: () => RequestIdentityResolverOptions,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: PromptRequestContext): Promise<void> {
    this.logEntry(context);

    const sdkExtra = context.mcpRequest._extra ?? undefined;
    const identityContext = resolveRequestIdentityContext(sdkExtra, this.identityOptionsProvider());
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
