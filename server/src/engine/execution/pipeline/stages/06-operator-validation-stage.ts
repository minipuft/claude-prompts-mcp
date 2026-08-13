// @lifecycle canonical - Validates operator metadata and arguments.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { FrameworkValidator } from '../../../frameworks/framework-validator.js';
import type { ExecutionContext } from '../../context/index.js';
import type { ChainStepPrompt } from '../../operators/types.js';
import type { ChainOperator, SymbolicOperator } from '../../parsers/types/operator-types.js';

/**
 * Pipeline Stage 06: Operator Validation
 *
 * Validates and normalizes symbolic operators from parsed commands,
 * ensuring framework overrides are valid before execution planning.
 *
 * Dependencies: context.parsedCommand, context.parsedCommand.operators
 * Output: Validated operators (framework names normalized) + delegation flags normalized
 * Can Early Exit: Yes — FOUR exits, in order (measured 2026-08-12; this block read
 * `Can Early Exit: No` until then, and the stale marker sat directly above the exit that hid
 * P5-F5 for two phases — P6-F5):
 *   1. `context.state.session.isBlueprintRestored` — a resumed run replays a blueprint cloned
 *      AFTER this stage ran on the original invocation, so its flags are already set.
 *   2. `context.parsedCommand` missing — nothing to validate.
 *   3. operator set empty — nothing left to normalize. This exit now runs BELOW
 *      `normalizeDelegation`, not above it: the direct (non-symbolic) invocation path always has
 *      an empty operator set, so exiting first made YAML-declared `subagentModel` inert on every
 *      `>>chain` that did not spell `==>` (P5-F5).
 *   4. `frameworkValidator` unavailable — framework normalization is skipped; delegation
 *      normalization has already run above it.
 */
export class OperatorValidationStage extends BasePipelineStage {
  readonly name = 'OperatorValidation';

  constructor(
    private readonly frameworkValidator: FrameworkValidator | null,
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

    const parsedCommand = context.parsedCommand;
    if (!parsedCommand) {
      this.logExit({ skipped: 'Parsed command missing' });
      return;
    }

    const operatorSet = parsedCommand?.operators?.operators;
    const operators: SymbolicOperator[] = Array.isArray(operatorSet) ? operatorSet : [];

    // Delegation normalization runs ABOVE the operators-empty check, not below it.
    // `operators` is populated only by the symbolic parse path; the direct (`>>chain`) path
    // leaves it empty while still writing per-step `subagentModel` onto parsedCommand.steps.
    // Returning on an empty operator set therefore left YAML-declared delegation inert on every
    // direct invocation (P5-F5). `normalizeDelegation` carries its own empty-set guard, so both
    // halves are safe to call here.
    this.normalizeDelegation(parsedCommand, operators);

    if (operators.length === 0) {
      this.logExit({ skipped: 'No operators detected' });
      return;
    }

    if (!this.frameworkValidator) {
      this.logExit({ skipped: 'Framework validator unavailable' });
      return;
    }

    try {
      const normalizedFrameworkOperators = this.normalizeFrameworkOperators(
        parsedCommand,
        operators
      );

      if (normalizedFrameworkOperators > 0) {
        // Diagnostic only — nothing downstream branches on this count.
        context.diagnostics.debug(this.name, 'Normalized framework operators', {
          normalizedFrameworkOperators,
        });
      }

      this.logExit({ normalizedFrameworkOperators });
    } catch (error) {
      this.handleError(error, 'Operator validation failed');
    }
  }

  private normalizeFrameworkOperators(
    parsedCommand: ExecutionContext['parsedCommand'],
    operators: SymbolicOperator[]
  ): number {
    let normalizedCount = 0;

    for (const operator of operators) {
      if (operator.type !== 'framework') {
        continue;
      }

      const { normalizedId } = this.frameworkValidator!.validateAndNormalize(operator.frameworkId, {
        requireEnabled: true,
        stage: this.name,
        context: {
          action: 'operator_validation',
          userInput: { frameworkId: operator.frameworkId },
        },
      });

      operator.normalizedId = normalizedId;
      normalizedCount++;

      const symbolicPlan = parsedCommand?.executionPlan;
      if (symbolicPlan?.frameworkOverride) {
        const matches =
          symbolicPlan.frameworkOverride.toUpperCase() === operator.frameworkId.toUpperCase();

        if (matches) {
          symbolicPlan.frameworkOverride = normalizedId;
        }
      }
    }

    return normalizedCount;
  }

  /**
   * Normalize delegation flags on chain steps.
   *
   * Delegation has one source: a step's own `subagentModel`, which implies sub-agent
   * execution. A prompt-wide flag was read here until Tier 15B; the prompt YAML schema
   * carried no key that could set it, so it was never anything but false. Reinstating
   * prompt-wide delegation means adding the schema key and the converter that writes it,
   * not restoring this read.
   *
   * Propagates to both parsedCommand.steps (ChainStepPrompt) and operator steps (ChainStep).
   *
   * Callable with an empty operator set: `markDelegatedStepPrompts` reads only
   * `parsedCommand.steps`, and `syncDelegationToOperators` guards on the set being empty. That is
   * what lets the whole normalization sit above the operators-empty exit (P5-F5).
   *
   * `syncDelegationToOperators` writes `ChainStep.delegated` and `ChainOperator.hasDelegation`,
   * neither of which has a reader downstream of this stage — the observable output of this
   * method is `ChainStepPrompt.delegated`, read by `chain-operator-executor.ts` (delegation CTA)
   * and `response-assembler.ts` (handoff section + visibility envelope).
   */
  private normalizeDelegation(
    parsedCommand: ExecutionContext['parsedCommand'],
    operators: SymbolicOperator[]
  ): void {
    this.markDelegatedStepPrompts(parsedCommand);
    this.syncDelegationToOperators(parsedCommand, operators);
  }

  /** Mark ChainStepPrompt[] entries as delegated based on per-step subagentModel. */
  private markDelegatedStepPrompts(parsedCommand: ExecutionContext['parsedCommand']): void {
    if (parsedCommand?.steps == null) return;
    for (const step of parsedCommand.steps) {
      if (step.subagentModel != null) {
        step.delegated = true;
      }
    }
  }

  /**
   * Propagate delegation from ChainStepPrompt[] to positionally-aligned operator ChainStep[].
   *
   * Owns the empty-set guard that used to be a stage-level early exit. The direct invocation path
   * has no operators to sync to, and that is a no-op here rather than a reason to skip
   * `markDelegatedStepPrompts`.
   */
  private syncDelegationToOperators(
    parsedCommand: ExecutionContext['parsedCommand'],
    operators: SymbolicOperator[]
  ): void {
    if (operators.length === 0) return;
    const stepPrompts = parsedCommand?.steps;
    for (const operator of operators) {
      if (operator.type !== 'chain') continue;
      this.applyDelegationToChainOp(operator, stepPrompts);
    }
  }

  private applyDelegationToChainOp(
    operator: ChainOperator,
    stepPrompts: ChainStepPrompt[] | undefined
  ): void {
    for (let i = 0; i < operator.steps.length; i++) {
      const step = operator.steps[i];
      if (!step) continue;
      if (stepPrompts?.[i]?.delegated === true) {
        step.delegated = true;
      }
    }
    if (operator.steps.some((s) => s.delegated === true)) {
      operator.hasDelegation = true;
    }
  }
}
