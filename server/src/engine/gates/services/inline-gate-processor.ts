// @lifecycle canonical - Processes inline gate criteria from :: operator syntax.
import { formatCriteriaAsGuidance } from '../../execution/pipeline/criteria-guidance.js';
import { loadShellPresets } from '../config/index.js';
import { SHELL_VERIFY_DEFAULTS } from '../constants.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateScope } from '#shared/types/execution.js';
import type { GateReferenceResolver, GateReferenceResolution } from './gate-reference-resolver.js';
import type { ExecutionContext, ParsedCommand } from '../../execution/context/index.js';
import type { ChainStepPrompt } from '../../execution/operators/types.js';
import type { TemporaryGateRegistry } from '../core/temporary-gate-registry.js';
import type { PendingShellVerification, ShellVerifyGate } from '../shell/index.js';

/**
 * Scope information for inline gate creation.
 */
interface InlineGateScope {
  readonly promptId?: string;
  readonly stepNumber?: number;
}

/**
 * Internal result of processing gate criteria.
 */
interface GateProcessingResult {
  readonly registeredGateIds: string[];
  readonly temporaryGateId?: string;
}

/**
 * Result of processing all inline gates for a request.
 */
export interface InlineGateProcessingResult {
  /** IDs of newly created temporary gates */
  readonly createdIds: string[];
  /** IDs of existing registered gates that were referenced */
  readonly registeredIds: string[];
  /** Count of named inline gates processed */
  readonly namedCount: number;
}

type InlineGateTarget = { inlineGateIds?: string[] };

/**
 * Type guard for validating gate criteria.
 */
export function isValidGateCriteria(criteria: unknown): criteria is readonly string[] {
  return (
    Array.isArray(criteria) &&
    criteria.length > 0 &&
    criteria.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

/**
 * Type guard for validating step has inline gate criteria.
 */
export function hasInlineGateCriteria(step: ChainStepPrompt): step is ChainStepPrompt & {
  inlineGateCriteria: readonly string[];
} {
  return isValidGateCriteria(step.inlineGateCriteria);
}

/**
 * Processes inline gate criteria from symbolic command syntax.
 *
 * Creates temporary gates for anonymous criteria (`:: "criteria"`),
 * registers named gates (`:: security:"criteria"`),
 * and sets up shell verification for `:: verify:"command"` syntax.
 *
 * Extracted from InlineGateExtractionStage (pipeline stage 02).
 */
export class InlineGateProcessor {
  constructor(
    private readonly temporaryGateRegistry: TemporaryGateRegistry,
    private readonly gateReferenceResolver: GateReferenceResolver,
    private readonly logger: Logger
  ) {}

  /**
   * Process all inline gate criteria from a parsed command.
   *
   * Handles named inline gates, anonymous criteria on the main command,
   * and per-step criteria on chain steps. Updates `parsedCommand.inlineGateIds`
   * and step-level `inlineGateIds` as a side effect.
   */
  async processInlineGates(
    context: ExecutionContext,
    parsedCommand: ParsedCommand
  ): Promise<InlineGateProcessingResult> {
    const createdIds: string[] = [];
    const registeredIds: string[] = [];

    // Process named inline gates (e.g., `:: security:"no secrets"`)
    if (
      Array.isArray(parsedCommand.namedInlineGates) &&
      parsedCommand.namedInlineGates.length > 0
    ) {
      this.logger.debug('[InlineGateProcessor] Processing namedInlineGates:', {
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
        this.logger.debug('[InlineGateProcessor] Processing gate:', {
          gateId: namedGate.gateId,
          shellVerifyExists: 'shellVerify' in namedGate,
          shellVerifyValue: namedGate.shellVerify,
          shellVerifyTruthy: Boolean(namedGate.shellVerify),
          willTriggerShellPath: Boolean(namedGate.shellVerify && namedGate.gateId),
        });

        // Handle shell verification gates (:: verify:"command")
        if (namedGate.shellVerify && namedGate.gateId) {
          this.logger.info('[InlineGateProcessor] Shell verify gate detected', {
            gateId: namedGate.gateId,
            command: namedGate.shellVerify.command,
            timeout: namedGate.shellVerify.timeout,
          });
          this.setupShellVerification(context, namedGate.gateId, namedGate.shellVerify);
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

    return {
      createdIds,
      registeredIds,
      namedCount: parsedCommand.namedInlineGates?.length ?? 0,
    };
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
    if (!isValidGateCriteria(criteria)) {
      this.logger.warn('[InlineGateProcessor] Invalid gate criteria', {
        criteria,
        scope,
      });
      return null;
    }

    const guidance = formatCriteriaAsGuidance(criteria);
    const description = scope.stepNumber
      ? `Inline criteria for step ${scope.stepNumber}`
      : 'Inline criteria for symbolic command';

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
          pass_criteria: [...criteria],
          source: 'automatic',
        },
        scopeId
      );

      this.trackTemporaryGateScope(context, gateScope, scopeId);
      return gateId;
    } catch (error) {
      this.logger.warn('[InlineGateProcessor] Failed to register inline gate', {
        error,
        criteria,
        scope,
      });
      return null;
    }
  }

  /**
   * Creates a named inline gate with explicit ID from symbolic syntax.
   */
  private createNamedInlineGate(
    context: ExecutionContext,
    explicitId: string,
    criteria: readonly string[],
    scope: InlineGateScope
  ): string | null {
    if (!explicitId || !isValidGateCriteria(criteria)) {
      this.logger.warn('[InlineGateProcessor] Invalid named gate input', {
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
      const gateId = this.temporaryGateRegistry.createTemporaryGate(
        {
          id: explicitId,
          name: explicitId,
          type: 'validation',
          scope: gateScope,
          description,
          guidance,
          pass_criteria: [...criteria],
          source: 'automatic',
        } as any,
        scopeId
      );

      this.logger.debug('[InlineGateProcessor] Created named inline gate', {
        requestedId: explicitId,
        actualId: gateId,
        criteria,
      });

      this.trackTemporaryGateScope(context, gateScope, scopeId);
      return gateId;
    } catch (error) {
      this.logger.warn('[InlineGateProcessor] Failed to create named inline gate', {
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
        this.logger.warn('[InlineGateProcessor] Failed to resolve gate reference', {
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
      this.logger.debug('[InlineGateProcessor] Resolved inline reference to temporary gate', {
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

    if (resolution.suggestions && resolution.suggestions.length > 0) {
      this.logger.warn(
        `[InlineGateProcessor] Unknown gate "${resolution.criteria}". ` +
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
   * Supports presets (:fast, :full, :extended) that expand to max/timeout values.
   */
  private setupShellVerification(
    context: ExecutionContext,
    gateId: string,
    shellVerifyConfig: ShellVerifyGate
  ): void {
    const shellPresets = loadShellPresets();
    const presetValues = shellVerifyConfig.preset
      ? shellPresets[shellVerifyConfig.preset]
      : undefined;

    const resolvedMaxIterations =
      shellVerifyConfig.maxIterations ??
      presetValues?.maxIterations ??
      SHELL_VERIFY_DEFAULTS.maxAttempts;

    const resolvedTimeout =
      shellVerifyConfig.timeout ?? presetValues?.timeout ?? SHELL_VERIFY_DEFAULTS.defaultTimeout;

    const shellVerify: ShellVerifyGate = {
      command: shellVerifyConfig.command,
      timeout: resolvedTimeout,
      workingDir: shellVerifyConfig.workingDir,
      loop: shellVerifyConfig.loop,
      maxIterations: resolvedMaxIterations,
      preset: shellVerifyConfig.preset,
    };

    const originalGoal =
      context.parsedCommand?.metadata?.originalCommand ??
      context.mcpRequest.command ??
      context.parsedCommand?.promptId ??
      'Fix verification failures';

    const pending: PendingShellVerification = {
      gateId,
      shellVerify,
      attemptCount: 0,
      maxAttempts: resolvedMaxIterations,
      previousResults: [],
      originalGoal,
    };

    context.state.gates.pendingShellVerification = pending;

    this.logger.info('[InlineGateProcessor] Shell verification gate configured', {
      gateId,
      command: shellVerify.command,
      timeout: shellVerify.timeout,
      maxAttempts: pending.maxAttempts,
      loop: shellVerify.loop,
      preset: shellVerify.preset,
    });
  }
}
