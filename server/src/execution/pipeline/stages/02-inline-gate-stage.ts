// @lifecycle canonical - Evaluates inline gates before heavy execution work.
import { BasePipelineStage } from '../stage.js';

import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { Logger } from '../../../logging/index.js';
import type { GateScope } from '../../../types/execution.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ChainStepPrompt } from '../../operators/chain-operator-executor.js';
import type { GateReferenceResolver, GateReferenceResolution } from '../../../gates/services/gate-reference-resolver.js';

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
  return Array.isArray(criteria) &&
         criteria.length > 0 &&
         criteria.every(item => typeof item === 'string' && item.trim().length > 0);
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

    if (context.metadata['sessionBlueprintRestored']) {
      this.logExit({ skipped: 'Session blueprint restored' });
      return;
    }

    const parsedCommand = context.parsedCommand;
    if (!parsedCommand) {
      this.logExit({ skipped: 'Parsed command missing' });
      return;
    }

    const createdIds: string[] = [];
    const registeredIds: string[] = [];

    // Validate and create inline gate for the main command
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

    this.appendGateMetadata(context, 'temporaryGateIds', createdIds);
    this.appendGateMetadata(context, 'registeredInlineGateIds', registeredIds);

    this.logExit({
      temporaryInlineGates: createdIds.length,
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

    return {
      registeredGateIds: partitioned.registeredGateIds,
      temporaryGateId,
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

  private appendGateMetadata(context: ExecutionContext, key: string, values: string[]): void {
    if (values.length === 0) {
      return;
    }

    const existing = Array.isArray(context.metadata[key])
      ? (context.metadata[key] as string[])
      : [];
    const combined = new Set([...existing, ...values]);
    context.metadata[key] = Array.from(combined);
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

    const guidance = this.generateGuidance(criteria);
    const description = scope.stepNumber
      ? `Inline criteria for step ${scope.stepNumber}`
      : 'Inline criteria for symbolic command';

    // Determine scope based on step number
    const gateScope: GateScope = scope.stepNumber !== undefined ? 'step' : 'execution';

    const scopeId = this.getScopeId(context, scope.stepNumber);

    try {
      const gateId = this.temporaryGateRegistry.createTemporaryGate({
        name: 'Inline Quality Criteria',
        type: 'quality',
        scope: gateScope,
        description,
        guidance,
        pass_criteria: [...criteria], // Convert readonly to mutable for compatibility
        source: 'automatic',
      }, scopeId);

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

  private applyResolution(
    resolution: GateReferenceResolution,
    inlineCriteria: string[],
    registeredGateIds: string[]
  ): void {
    if (resolution.referenceType === 'registered') {
      registeredGateIds.push(resolution.gateId);
      return;
    }

    if (resolution.criteria) {
      inlineCriteria.push(resolution.criteria);
    }
  }

  private getScopeId(context: ExecutionContext, stepNumber?: number): string {
    const baseScope =
      (context.metadata['executionScopeId'] as string | undefined) ||
      context.getSessionId?.() ||
      context.mcpRequest.chain_id ||
      context.mcpRequest.command ||
      'execution';

    if (typeof stepNumber === 'number') {
      return `${baseScope}:step_${stepNumber}`;
    }

    return `${baseScope}:command`;
  }

  private generateGuidance(criteria: readonly string[]): string {
    if (criteria.length === 0) {
      return 'Evaluate the output against the inline criteria.';
    }

    const lines = [
      'Evaluate the output against these criteria:',
      ...criteria.map((item, index) => `${index + 1}. ${item}`),
    ];

    return lines.join('\n');
  }

  private trackTemporaryGateScope(
    context: ExecutionContext,
    scope: GateScope,
    scopeId: string
  ): void {
    if (!scopeId) {
      return;
    }

    const scopes = Array.isArray(context.metadata['temporaryGateScopes'])
      ? (context.metadata['temporaryGateScopes'] as Array<{ scope: GateScope; scopeId: string }>)
      : [];

    if (!Array.isArray(context.metadata['temporaryGateScopes'])) {
      context.metadata['temporaryGateScopes'] = scopes;
    }

    const exists = scopes.some((entry) => entry.scope === scope && entry.scopeId === scopeId);
    if (!exists) {
      scopes.push({ scope, scopeId });
    }
  }
}
