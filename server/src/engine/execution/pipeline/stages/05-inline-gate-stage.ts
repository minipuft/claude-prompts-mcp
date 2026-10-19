// @lifecycle canonical - Evaluates inline gates before heavy execution work.
import { BasePipelineStage } from '../stage.js';
import { buildWorkflowRejectionResponse } from '../workflow-rejection-response.js';

import type { Logger } from '#infra/logging/index.js';
import type { WorkflowRejection } from '#modules/workflow-ir/types.js';
import type { InlineGateProcessor } from '../../../gates/services/inline-gate-processor.js';
import type { RequestGateAdmission } from '../../../gates/services/request-gate-admission.js';
import type { PromptRequestContext } from '../../context/index.js';

/**
 * Pipeline Stage 05: Inline Gate Extraction
 *
 * Thin orchestrator that delegates inline gate processing to the InlineGateProcessor.
 *
 * Dependencies: context.parsedCommand
 * Output: context.parsedCommand.inlineGateIds, registered temporary gates
 * Can Early Exit: Yes (a named inline gate carrying a canonical gate's id, R100; an inline gate
 *   whose criteria cannot register, R11.8; any gate request {@link RequestGateAdmission} refuses)
 *
 * Every refusal of the call's own gate requests lands here, before stage 08 runs a script tool:
 * the refusal says nothing was executed, and a script that already ran would make that false.
 */
export class InlineGateExtractionStage extends BasePipelineStage {
  readonly name = 'InlineGateExtraction';

  constructor(
    private readonly inlineGateProcessor: InlineGateProcessor,
    logger: Logger,
    private readonly requestGateAdmission: RequestGateAdmission
  ) {
    super(logger);
  }

  async execute(context: PromptRequestContext): Promise<void> {
    this.logEntry(context);

    const parsedCommand = context.parsedCommand;
    if (!parsedCommand) {
      this.logExit({ skipped: 'Parsed command missing' });
      return;
    }

    // A restored blueprint was processed by the call that started the run; its gates are
    // re-registered only where this process does not hold them (R54: a claimed run, or one whose
    // gates a full registry released while it sat idle).
    if (context.state.session.isBlueprintRestored) {
      const restoredIds = await this.inlineGateProcessor.restoreRunGates(context, parsedCommand);
      context.state.gates.temporaryGateIds = Array.from(
        new Set([...context.state.gates.temporaryGateIds, ...restoredIds])
      );
      // After the restore: a resume re-sending a gate the run holds is that gate, and a claimed
      // run holds its gates in this process only once they are restored.
      if (this.refuse(context, await this.requestGateAdmission.refusals(context))) {
        this.logExit({ restoredRunGates: restoredIds.length, refusedRequestGates: true });
        return;
      }
      this.logExit({ restoredRunGates: restoredIds.length });
      return;
    }

    // Refused before any gate registers, in the rejection shape every refusing stage shares: a
    // criterion that cannot register (R11.8) and a named gate under a canonical id (R100). All at
    // once, so the client fixes its command in one pass.
    const refusals = [
      ...this.inlineGateProcessor
        .invalidCriteria(parsedCommand)
        .map((refusal) => ({ reason: 'gate-criteria-invalid' as const, ...refusal })),
      ...this.inlineGateProcessor
        .canonicalIdCollisions(parsedCommand)
        .map((refusal) => ({ reason: 'gate-id-canonical' as const, ...refusal })),
    ];
    if (this.refuse(context, refusals)) {
      this.logExit({ refusedInlineGates: refusals.length });
      return;
    }
    if (this.refuse(context, await this.requestGateAdmission.refusals(context))) {
      this.logExit({ refusedRequestGates: true });
      return;
    }

    const result = await this.inlineGateProcessor.processInlineGates(context, parsedCommand);

    if (result.createdIds.length > 0) {
      const existing = context.state.gates.temporaryGateIds ?? [];
      context.state.gates.temporaryGateIds = Array.from(
        new Set([...existing, ...result.createdIds])
      );
    }

    if (result.registeredIds.length > 0) {
      const existing = context.state.gates.registeredInlineGateIds;
      context.state.gates.registeredInlineGateIds = Array.from(
        new Set([...existing, ...result.registeredIds])
      );
    }

    this.logExit({
      temporaryInlineGates: result.createdIds.length,
      namedInlineGates: result.namedCount,
      registeredInlineGates: result.registeredIds.length,
    });
  }

  /** Answer the call with `refusals` in the shared rejection shape; false when there are none. */
  private refuse(context: PromptRequestContext, refusals: readonly WorkflowRejection[]): boolean {
    if (refusals.length === 0) return false;
    context.diagnostics.warn(this.name, 'Gate request refused', { count: refusals.length });
    context.setResponse(
      buildWorkflowRejectionResponse(refusals, context.state.session.resumeChainId)
    );
    return true;
  }
}
