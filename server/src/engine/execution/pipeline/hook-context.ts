// @lifecycle canonical - Builds the read-only context handed to hook consumers.

import type { PipelineHookContext } from '#shared/types/index.js';
import type { ExecutionContext } from '../context/index.js';

/**
 * Project the live execution state onto the read-only shape a hook consumer sees.
 *
 * One function rather than a private method per emitter: the services that emit hook events
 * sit in different modules (`engine/gates` for the gate events, `engine/execution/capture`
 * for the chain step event) and a private copy in each is invisible to `rg`, so the copies
 * drift without anything failing. A consumer that groups two events by `executionId` needs
 * them to have been derived the same way.
 */
export function buildPipelineHookContext(context: ExecutionContext): PipelineHookContext {
  const executionId =
    context.sessionContext?.sessionId ??
    context.state.session.executionScopeId ??
    `exec-${Date.now().toString(36)}`;

  const frameworkDecision = context.frameworkAuthority.getCachedDecision();

  return {
    executionId,
    executionType: context.sessionContext?.isChainExecution ? 'chain' : 'single',
    chainId: context.sessionContext?.sessionId,
    currentStep: context.sessionContext?.currentStep,
    frameworkEnabled: frameworkDecision?.shouldApply ?? false,
    frameworkId: frameworkDecision?.frameworkId,
  };
}
