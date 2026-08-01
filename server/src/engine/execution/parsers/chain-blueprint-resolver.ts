// @lifecycle canonical - Restores chain session blueprints for response-only execution.
import type { Logger } from '#infra/logging/index.js';
import type { ChainSessionService, SessionBlueprint } from '#shared/types/index.js';
import type { ExecutionContext, ParsedCommand } from '../context/index.js';
import type { ExecutionPlan } from '../types.js';

/**
 * Resolves stored chain blueprints for response-only mode.
 *
 * When a chain session resumes without a command (user_response only),
 * the blueprint is restored from the session store so downstream stages
 * see the same parsedCommand/executionPlan as the original invocation.
 *
 * Extracted from CommandParsingStage (pipeline stage 01).
 */
export class ChainBlueprintResolver {
  constructor(
    private readonly chainSessionStore: ChainSessionService,
    _logger: Logger
  ) {}

  /**
   * Restore parsedCommand + executionPlan from a stored session blueprint.
   *
   * Looks up blueprint by sessionId first, then falls back to chain_id lookup.
   * Deep-clones all restored data to prevent cross-request mutation.
   */
  restoreFromBlueprint(context: ExecutionContext): void {
    let sessionId = context.getSessionId();
    const scopeOptions = context.getScopeOptions();
    let blueprint = sessionId
      ? this.chainSessionStore.getSessionBlueprint(sessionId, scopeOptions)
      : undefined;

    if (!blueprint) {
      const requestedChainId = context.mcpRequest.chain_id;
      if (requestedChainId) {
        const session = this.chainSessionStore.getSessionByChainIdentifier(requestedChainId, {
          includeDormant: true,
          ...scopeOptions,
        });
        if (session) {
          sessionId = session.sessionId;
          context.state.session.resumeSessionId = session.sessionId;
          context.state.session.resumeChainId = session.chainId;
          blueprint = session.blueprint
            ? this.cloneBlueprint(session.blueprint)
            : this.chainSessionStore.getSessionBlueprint(session.sessionId, scopeOptions);
        }
      }
    }

    if (!blueprint || !sessionId) {
      throw new Error(
        'No stored execution blueprint found for the requested session or chain. Re-run the original command to continue.'
      );
    }

    context.parsedCommand = this.cloneParsedCommand(blueprint.parsedCommand as ParsedCommand);
    context.executionPlan = this.cloneExecutionPlan(blueprint.executionPlan);
    if (blueprint.gateInstructions) {
      context.gateInstructions = blueprint.gateInstructions;
    }
    context.state.session.resumeSessionId = sessionId;
    const resolvedResumeChainId =
      context.state.session.resumeChainId ?? blueprint.parsedCommand.chainId;
    if (resolvedResumeChainId !== undefined) {
      context.state.session.resumeChainId = resolvedResumeChainId;
    }
    context.state.session.isBlueprintRestored = true;
  }

  private cloneParsedCommand(parsedCommand: ParsedCommand): ParsedCommand {
    return JSON.parse(JSON.stringify(parsedCommand)) as ParsedCommand;
  }

  private cloneExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
    return JSON.parse(JSON.stringify(plan)) as ExecutionPlan;
  }

  private cloneBlueprint(blueprint: SessionBlueprint): SessionBlueprint {
    const cloned: SessionBlueprint = {
      parsedCommand: this.cloneParsedCommand(blueprint.parsedCommand as ParsedCommand),
      executionPlan: this.cloneExecutionPlan(blueprint.executionPlan),
    };

    if (blueprint.gateInstructions !== undefined) {
      cloned.gateInstructions = blueprint.gateInstructions;
    }

    return cloned;
  }
}
