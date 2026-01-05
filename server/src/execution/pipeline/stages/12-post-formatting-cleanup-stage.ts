// @lifecycle canonical - Cleans up formatting artifacts before returning output.
import { BasePipelineStage } from '../stage.js';

import type { ChainSessionService, SessionBlueprint } from '../../../chain-session/types.js';
import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';

type TrackedScope = {
  scope: 'execution' | 'session' | 'chain' | 'step';
  scopeId: string;
};

/**
 * Pipeline Stage 12: Post-Formatting Cleanup
 *
 * Persists inline gate metadata back into the session blueprint and cleans up
 * temporary gates so resumed executions rebuild the same inline requirements.
 *
 * Dependencies: context.executionPlan, context.parsedCommand
 * Output: Updated session blueprint + cleaned temporary gate scopes
 * Can Early Exit: Yes (for non-session executions)
 */
export class PostFormattingCleanupStage extends BasePipelineStage {
  readonly name = 'PostFormattingCleanup';

  constructor(
    private readonly chainSessionManager: ChainSessionService | null,
    private readonly temporaryGateRegistry: TemporaryGateRegistry | null,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const sessionId = context.sessionContext?.sessionId;
    if (sessionId && this.chainSessionManager && context.executionPlan && context.parsedCommand) {
      this.persistBlueprint(sessionId, context);
    }

    if (this.temporaryGateRegistry) {
      this.cleanupTemporaryGates(context);
    }

    this.logExit({
      blueprintPersisted: Boolean(sessionId && this.chainSessionManager),
      gatesCleaned: Boolean(this.temporaryGateRegistry),
    });
  }

  private persistBlueprint(sessionId: string, context: ExecutionContext): void {
    const blueprint: SessionBlueprint = {
      parsedCommand: this.clone(context.parsedCommand!),
      executionPlan: this.clone(context.executionPlan!),
    };

    if (context.gateInstructions !== undefined) {
      blueprint.gateInstructions = context.gateInstructions;
    }

    try {
      this.chainSessionManager!.updateSessionBlueprint(sessionId, blueprint);
    } catch (error) {
      this.logger.warn('[PostFormattingCleanupStage] Failed to update session blueprint', {
        sessionId,
        error,
      });
    }
  }

  private cleanupTemporaryGates(context: ExecutionContext): void {
    const scopeId = context.state.session.executionScopeId;
    if (scopeId) {
      this.temporaryGateRegistry!.cleanupScope('execution', scopeId);
    }

    const trackedScopes = this.getTrackedScopes(context);
    for (const { scope, scopeId: trackedScopeId } of trackedScopes) {
      this.temporaryGateRegistry!.cleanupScope(scope, trackedScopeId);
    }
  }

  private getTrackedScopes(context: ExecutionContext): TrackedScope[] {
    const scopesMetadata = context.state.gates.temporaryGateScopes;
    if (!Array.isArray(scopesMetadata)) {
      return [];
    }

    const uniqueScopes: TrackedScope[] = [];
    for (const entry of scopesMetadata as TrackedScope[]) {
      if (!entry?.scope || !entry.scopeId) {
        continue;
      }

      const exists = uniqueScopes.some(
        (item) => item.scope === entry.scope && item.scopeId === entry.scopeId
      );
      if (!exists) {
        uniqueScopes.push(entry);
      }
    }
    return uniqueScopes;
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
