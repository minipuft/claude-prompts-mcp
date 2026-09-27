// @lifecycle canonical - Evaluates inline gates before heavy execution work.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { InlineGateProcessor } from '../../../gates/services/inline-gate-processor.js';
import type { ExecutionContext } from '../../context/index.js';

/**
 * Pipeline Stage 05: Inline Gate Extraction
 *
 * Thin orchestrator that delegates inline gate processing to the InlineGateProcessor.
 *
 * Dependencies: context.parsedCommand
 * Output: context.parsedCommand.inlineGateIds, registered temporary gates
 * Can Early Exit: No
 */
export class InlineGateExtractionStage extends BasePipelineStage {
  readonly name = 'InlineGateExtraction';

  constructor(
    private readonly inlineGateProcessor: InlineGateProcessor,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const parsedCommand = context.parsedCommand;
    if (!parsedCommand) {
      this.logExit({ skipped: 'Parsed command missing' });
      return;
    }

    // A restored blueprint was processed by the call that started the run; its gates are
    // re-registered only where this process does not hold them (R54: a claimed run).
    if (context.state.session.isBlueprintRestored) {
      const restoredIds = await this.inlineGateProcessor.restoreRunGates(context, parsedCommand);
      context.state.gates.temporaryGateIds = Array.from(
        new Set([...context.state.gates.temporaryGateIds, ...restoredIds])
      );
      this.logExit({ restoredRunGates: restoredIds.length });
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
}
