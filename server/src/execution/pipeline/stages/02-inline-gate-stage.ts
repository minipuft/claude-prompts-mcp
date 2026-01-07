// @lifecycle canonical - Evaluates inline gates before heavy execution work.
import { SHELL_VERIFY_DEFAULTS } from '../../../gates/constants.js';
import { formatCriteriaAsGuidance } from '../criteria-guidance.js';
import { BasePipelineStage } from '../stage.js';

import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type {
  GateReferenceResolver,
  GateReferenceResolution,
} from '../../../gates/services/gate-reference-resolver.js';
import type { PendingShellVerification, ShellVerifyGate } from '../../../gates/shell/index.js';
import type { Logger } from '../../../logging/index.js';
import type { GateScope } from '../../../types/execution.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ChainStepPrompt } from '../../operators/types.js';

/**
 * Scope information for inline gate creation
 */
interface InlineGateScope {
  readonly promptId?: string;
  readonly stepNumber?: number;
}

/**
 * Type guard for validating gate criteria
 */
function isValidGateCriteria(criteria: unknown): criteria is readonly string[] {
  return (
    Array.isArray(criteria) &&
    criteria.length > 0 &&
    criteria.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

/**
 * Type guard for validating step has inline gate criteria
 */
function hasInlineGateCriteria(step: ChainStepPrompt): step is ChainStepPrompt & {
  inlineGateCriteria: readonly string[];
} {
  return isValidGateCriteria(step.inlineGateCriteria);
}

/**
 * Pipeline Stage 2: Inline Gate Extraction
 *
 * Extracts inline quality criteria from commands and chain steps,
 * registering them as temporary gates for validation.
 *
 * Dependencies: context.parsedCommand
 * Output: context.parsedCommand.inlineGateIds, registered temporary gates
 * Can Early Exit: No
 */
interface GateProcessingResult {
  readonly registeredGateIds: string[];
  readonly temporaryGateId?: string;
}

type InlineGateTarget = { inlineGateIds?: string[] };

export class InlineGateExtractionStage extends BasePipelineStage {
  readonly name = 'InlineGateExtraction';

  constructor(
    private readonly temporaryGateRegistry: TemporaryGateRegistry,
    private readonly gateReferenceResolver: GateReferenceResolver,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.state.session.isBlueprintRestored) {
      this.logExit({ skipped: 'Session blueprint restored' });
      return;
    }

    // Stage 02 focuses on inline gate extraction from :: operator
    // Temporary gates from 'gates' parameter are handled by Stage 05 (GateEnhancementStage)
    // which has comprehensive canonical resolution and normalization

    const parsedCommand = context.parsedCommand;
    if (!parsedCommand) {
      this.logExit({ skipped: 'Parsed command missing' });
      return;
    }

    const createdIds: string[] = [];
    const registeredIds: string[] = [];

    // Process named inline gates (e.g., `:: security:"no secrets"`)
    // These have explicit IDs from the symbolic parser
    // Shell verification gates (:: verify:"command") are handled specially
    if (
      Array.isArray(parsedCommand.namedInlineGates) &&
      parsedCommand.namedInlineGates.length > 0
    ) {
      // DEBUG: Trace what arrives in namedInlineGates
      this.logger.debug('[InlineGateExtractionStage] Processing namedInlineGates:', {
        count: parsedCommand.namedInlineGates.length,
        gates: parsedCommand.namedInlineGates.map((g) => ({
          gateId: g.gateId,
          hasShellVerify: Boolean(g.shellVerify),
          shellVerifyCommand: g.shellVerify?.command,
          criteriaCount: g.criteria?.length,
          criteria: g.criteria,
        })),
      });

      for (const namedGate of parsedCommand.namedInlineGates) {
        // DEBUG: Trace each gate individually
        this.logger.debug('[InlineGateExtractionStage] Processing gate:', {
          gateId: namedGate.gateId,
          shellVerifyExists: 'shellVerify' in namedGate,
          shellVerifyValue: namedGate.shellVerify,
          shellVerifyTruthy: Boolean(namedGate.shellVerify),
          willTriggerShellPath: Boolean(namedGate.shellVerify && namedGate.gateId),
        });

        // Handle shell verification gates (:: verify:"command")
        if (namedGate.shellVerify && namedGate.gateId) {
          // DEBUG: INFO level for visibility
          this.logger.info('[InlineGateExtractionStage] SHELL VERIFY detected - setting up:', {
            gateId: namedGate.gateId,
            command: namedGate.shellVerify.command,
          });
          this.setupShellVerification(context, namedGate.gateId, namedGate.shellVerify);
          // Shell verification gates don't create regular inline gates
          // They are validated by the ShellVerificationStage (08b)
          continue;
        }

        if (namedGate.gateId && isValidGateCriteria(namedGate.criteria)) {
          const gateId = this.createNamedInlineGate(context, namedGate.gateId, namedGate.criteria, {
            promptId: parsedCommand.promptId,
          });
          if (gateId) {
            parsedCommand.inlineGateIds = this.appendGateId(parsedCommand.inlineGateIds, gateId);
            createdIds.push(gateId);
          }
        }
      }
    }

    // Validate and create inline gate for the main command (anonymous criteria)
    if (isValidGateCriteria(parsedCommand.inlineGateCriteria)) {
      const result = await this.applyGateCriteria(context, parsedCommand.inlineGateCriteria, {
        promptId: parsedCommand.promptId,
      });
      this.applyGateResult(parsedCommand, result, createdIds, registeredIds);
    }

    // Validate and create inline gates for chain steps
    if (Array.isArray(parsedCommand.steps) && parsedCommand.steps.length > 0) {
      for (const step of parsedCommand.steps) {
        if (hasInlineGateCriteria(step)) {
          const result = await this.applyGateCriteria(context, step.inlineGateCriteria, {
            promptId: step.promptId,
            stepNumber: step.stepNumber,
          });
          this.applyGateResult(step, result, createdIds, registeredIds);
        }
      }
    }

    if (createdIds.length > 0) {
      const existing = context.state.gates.temporaryGateIds ?? [];
      context.state.gates.temporaryGateIds = Array.from(new Set([...existing, ...createdIds]));
    }

    if (registeredIds.length > 0) {
      const existing = context.state.gates.registeredInlineGateIds ?? [];
      context.state.gates.registeredInlineGateIds = Array.from(
        new Set([...existing, ...registeredIds])
      );
    }

    this.logExit({
      temporaryInlineGates: createdIds.length,
      namedInlineGates: parsedCommand.namedInlineGates?.length ?? 0,
      registeredInlineGates: registeredIds.length,
    });
  }

  private async applyGateCriteria(
    context: ExecutionContext,
    criteria: readonly string[],
    scope: InlineGateScope
  ): Promise<GateProcessingResult> {
    const partitioned = await this.partitionGateCriteria(criteria);
    let temporaryGateId: string | undefined;

    if (partitioned.inlineCriteria.length > 0) {
      const gateId = this.createInlineGate(context, partitioned.inlineCriteria, scope);
      if (gateId) {
        temporaryGateId = gateId;
      }
    }

    if (temporaryGateId !== undefined) {
      return {
        registeredGateIds: partitioned.registeredGateIds,
        temporaryGateId,
      };
    }

    return {
      registeredGateIds: partitioned.registeredGateIds,
    };
  }

  private applyGateResult(
    target: InlineGateTarget,
    result: GateProcessingResult,
    createdIds: string[],
    registeredIds: string[]
  ): void {
    for (const gateId of result.registeredGateIds) {
      target.inlineGateIds = this.appendGateId(target.inlineGateIds, gateId);
      registeredIds.push(gateId);
    }

    if (result.temporaryGateId) {
      target.inlineGateIds = this.appendGateId(target.inlineGateIds, result.temporaryGateId);
      createdIds.push(result.temporaryGateId);
    }
  }

  private appendGateId(existing: string[] | undefined, gateId: string): string[] {
    if (!gateId) {
      return existing ?? [];
    }

    if (!Array.isArray(existing)) {
      return [gateId];
    }

    if (existing.includes(gateId)) {
      return existing;
    }

    return [...existing, gateId];
  }

  /**
   * Creates an inline gate with auto-generated ID for anonymous criteria.
   */
  private createInlineGate(
    context: ExecutionContext,
    criteria: readonly string[],
    scope: InlineGateScope
  ): string | null {
    // Validate criteria using type guard
    if (!isValidGateCriteria(criteria)) {
      this.logger.warn('[InlineGateExtractionStage] Invalid gate criteria', {
        criteria,
        scope,
      });
      return null;
    }

    const guidance = formatCriteriaAsGuidance(criteria);
    const description = scope.stepNumber
      ? `Inline criteria for step ${scope.stepNumber}`
      : 'Inline criteria for symbolic command';

    // Determine scope based on step number
    const gateScope: GateScope = scope.stepNumber !== undefined ? 'step' : 'execution';

    const scopeId = this.getScopeId(context, scope.stepNumber);

    try {
      const gateId = this.temporaryGateRegistry.createTemporaryGate(
        {
          name: 'Inline Validation Criteria',
          type: 'validation',
          scope: gateScope,
          description,
          guidance,
          pass_criteria: [...criteria], // Convert readonly to mutable for compatibility
          source: 'automatic',
        },
        scopeId
      );

      this.trackTemporaryGateScope(context, gateScope, scopeId);
      return gateId;
    } catch (error) {
      this.logger.warn('[InlineGateExtractionStage] Failed to register inline gate', {
        error,
        criteria,
        scope,
      });
      return null;
    }
  }

  /**
   * Creates a named inline gate with explicit ID from symbolic syntax.
   * Name is derived from ID for display (e.g., "security" displays as "security").
   */
  private createNamedInlineGate(
    context: ExecutionContext,
    explicitId: string,
    criteria: readonly string[],
    scope: InlineGateScope
  ): string | null {
    if (!explicitId || !isValidGateCriteria(criteria)) {
      this.logger.warn('[InlineGateExtractionStage] Invalid named gate input', {
        explicitId,
        criteria,
        scope,
      });
      return null;
    }

    const guidance = formatCriteriaAsGuidance(criteria);
    const description = `Named inline gate "${explicitId}" from symbolic syntax`;
    const gateScope: GateScope = scope.stepNumber !== undefined ? 'step' : 'execution';
    const scopeId = this.getScopeId(context, scope.stepNumber);

    try {
      // Pass explicit ID - registry will use it as-is if valid
      const gateId = this.temporaryGateRegistry.createTemporaryGate(
        {
          id: explicitId, // Explicit ID from symbolic syntax
          name: explicitId, // Use ID as display name (will be enhanced by Stage 05 normalization)
          type: 'validation',
          scope: gateScope,
          description,
          guidance,
          pass_criteria: [...criteria],
          source: 'automatic',
        } as any, // Cast needed because facade type doesn't include optional id
        scopeId
      );

      this.logger.debug('[InlineGateExtractionStage] Created named inline gate', {
        requestedId: explicitId,
        actualId: gateId,
        criteria,
      });

      this.trackTemporaryGateScope(context, gateScope, scopeId);
      return gateId;
    } catch (error) {
      this.logger.warn('[InlineGateExtractionStage] Failed to create named inline gate', {
        error,
        explicitId,
        criteria,
        scope,
      });
      return null;
    }
  }

  private async partitionGateCriteria(
    criteria: readonly string[]
  ): Promise<{ inlineCriteria: string[]; registeredGateIds: string[] }> {
    const inlineCriteria: string[] = [];
    const registeredGateIds: string[] = [];

    for (const entry of criteria) {
      const trimmed = typeof entry === 'string' ? entry.trim() : '';
      if (!trimmed) {
        continue;
      }

      const registryGateId = this.lookupTemporaryGateId(trimmed);
      if (registryGateId) {
        registeredGateIds.push(registryGateId);
        continue;
      }

      try {
        const resolution = await this.gateReferenceResolver.resolve(trimmed);
        this.applyResolution(resolution, inlineCriteria, registeredGateIds);
      } catch (error) {
        this.logger.warn('[InlineGateExtractionStage] Failed to resolve gate reference', {
          entry: trimmed,
          error,
        });
        inlineCriteria.push(trimmed);
      }
    }

    return {
      inlineCriteria,
      registeredGateIds: Array.from(new Set(registeredGateIds)),
    };
  }

  private lookupTemporaryGateId(reference: string): string | undefined {
    if (!reference || !this.temporaryGateRegistry) {
      return undefined;
    }

    const gate = this.temporaryGateRegistry.getTemporaryGate(reference);
    if (gate) {
      this.logger.debug('[InlineGateExtractionStage] Resolved inline reference to temporary gate', {
        reference,
        gateId: gate.id,
      });
      return gate.id;
    }

    return undefined;
  }

  private applyResolution(
    resolution: GateReferenceResolution,
    inlineCriteria: string[],
    registeredGateIds: string[]
  ): void {
    if (resolution.referenceType === 'registered') {
      registeredGateIds.push(resolution.gateId);
      return;
    }

    // Log fuzzy match suggestions if available (helps users discover typos)
    if (resolution.suggestions && resolution.suggestions.length > 0) {
      this.logger.warn(
        `[InlineGateExtractionStage] Unknown gate "${resolution.criteria}". ` +
          `Did you mean: ${resolution.suggestions.join(', ')}?`
      );
    }

    if (resolution.criteria) {
      inlineCriteria.push(resolution.criteria);
    }
  }

  private getScopeId(context: ExecutionContext, stepNumber?: number): string {
    const baseScope =
      context.state.session.executionScopeId ||
      context.getSessionId?.() ||
      context.mcpRequest.chain_id ||
      context.mcpRequest.command ||
      'execution';

    if (typeof stepNumber === 'number') {
      return `${baseScope}:step_${stepNumber}`;
    }

    return `${baseScope}:command`;
  }

  private trackTemporaryGateScope(
    context: ExecutionContext,
    scope: GateScope,
    scopeId: string
  ): void {
    if (!scopeId) {
      return;
    }

    const scopes = context.state.gates.temporaryGateScopes ?? [];

    if (!context.state.gates.temporaryGateScopes) {
      context.state.gates.temporaryGateScopes = scopes;
    }

    const exists = scopes.some((entry) => entry.scope === scope && entry.scopeId === scopeId);
    if (!exists) {
      scopes.push({ scope, scopeId });
    }
  }

  /**
   * Sets up shell verification state for Ralph Wiggum loops.
   * Called when a `:: verify:"command"` gate is detected.
   */
  private setupShellVerification(
    context: ExecutionContext,
    gateId: string,
    shellVerifyConfig: { command: string; timeout?: number; workingDir?: string }
  ): void {
    const shellVerify: ShellVerifyGate = {
      command: shellVerifyConfig.command,
      timeout: shellVerifyConfig.timeout ?? SHELL_VERIFY_DEFAULTS.defaultTimeout,
      workingDir: shellVerifyConfig.workingDir,
    };

    const pending: PendingShellVerification = {
      gateId,
      shellVerify,
      attemptCount: 0,
      maxAttempts: SHELL_VERIFY_DEFAULTS.maxAttempts,
      previousResults: [],
    };

    context.state.gates.pendingShellVerification = pending;

    this.logger.info('[InlineGateExtractionStage] Shell verification gate configured', {
      gateId,
      command: shellVerify.command,
      timeout: shellVerify.timeout,
      maxAttempts: pending.maxAttempts,
    });
  }

  // NOTE: registerTemporaryGatesFromRequest() was removed as part of consolidation.
  // All temporary gate registration from the 'gates' parameter is now handled by
  // Stage 05 (GateEnhancementStage.registerTemporaryGates()) which provides:
  // - Comprehensive canonical gate resolution
  // - Unified normalization logic
  // - Better deduplication and validation
}
