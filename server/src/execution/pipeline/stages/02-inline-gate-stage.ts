// @lifecycle canonical - Evaluates inline gates before heavy execution work.
import { formatCriteriaAsGuidance } from '../criteria-guidance.js';
import { BasePipelineStage } from '../stage.js';

import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type {
  GateReferenceResolver,
  GateReferenceResolution,
} from '../../../gates/services/gate-reference-resolver.js';
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

    // Register temporary gates from MCP request BEFORE resolving gate references
    // This ensures gates are available when the gate reference resolver tries to find them
    // Uses shared formatCriteriaAsGuidance() utility for proper criteria formatting
    await this.registerTemporaryGatesFromRequest(context);

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
   * Register temporary gates from MCP request before gate reference resolution.
   * Uses shared formatCriteriaAsGuidance() utility for proper criteria formatting.
   * This ensures gates are available when the gate reference resolver tries to find them.
   *
   * Uses normalized gates from metadata (supports unified 'gates' parameter and legacy parameters).
   */
  private async registerTemporaryGatesFromRequest(context: ExecutionContext): Promise<void> {
    // Use normalized gates from metadata (already merged by normalization stage)
    const overrides = context.state.gates.requestedOverrides as Record<string, any> | undefined;
    const normalizedGates = overrides?.gates as
      | import('../../../types/execution.js').GateSpecification[]
      | undefined;

    if (!normalizedGates || normalizedGates.length === 0 || !this.temporaryGateRegistry) {
      return;
    }

    const scopeId =
      context.getSessionId?.() ||
      context.mcpRequest.chain_id ||
      context.mcpRequest.command ||
      'execution';

    for (const gate of normalizedGates) {
      try {
        // Handle string shorthand (gate ID references) - skip these
        if (typeof gate === 'string') {
          this.logger.debug('[InlineGateExtractionStage] Skipping shorthand gate reference', {
            gate,
          });
          continue;
        }

        // Handle CustomCheck objects (simple name/description pairs)
        if (
          typeof gate === 'object' &&
          gate !== null &&
          'name' in gate &&
          'description' in gate &&
          !('id' in gate)
        ) {
          this.logger.debug(
            '[InlineGateExtractionStage] Skipping CustomCheck (will be converted to temporary gate)',
            { gate }
          );
          continue;
        }

        // Handle template-based gates - skip these
        if (typeof gate === 'object' && gate !== null && 'template' in gate) {
          this.logger.debug('[InlineGateExtractionStage] Skipping template-based gate', { gate });
          continue;
        }

        // Register full gate definitions with proper criteria formatting
        if (typeof gate === 'object' && gate !== null && 'id' in gate && gate.id) {
          const criteria = Array.from(gate.pass_criteria || gate.criteria || []);

          // Use shared utility to format criteria as guidance (if not explicitly provided)
          const effectiveGuidance =
            gate.guidance ||
            (criteria.length > 0 ? formatCriteriaAsGuidance(criteria) : undefined) ||
            gate.description ||
            `Review output against ${gate.id} criteria`;

          const registeredId = this.temporaryGateRegistry.createTemporaryGate(
            {
              id: gate.id, // Preserve user-provided ID
              name: gate.name || gate.id,
              type: (gate.type as 'validation' | 'guidance') || 'validation',
              scope: (gate.scope as GateScope) || 'execution',
              description: gate.description || `Temporary gate: ${gate.id}`,
              guidance: effectiveGuidance,
              pass_criteria: criteria,
              source: 'manual',
            },
            scopeId
          );

          this.logger.debug(
            '[InlineGateExtractionStage] Registered temporary gate with formatted guidance',
            {
              requestedId: gate.id,
              registeredId: registeredId,
              scopeId,
              criteriaCount: criteria.length,
              guidanceLength: effectiveGuidance.length,
            }
          );
        }
      } catch (error) {
        this.logger.warn('[InlineGateExtractionStage] Failed to register temporary gate', {
          error,
          gate,
        });
      }
    }
  }
}
