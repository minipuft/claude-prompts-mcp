// @lifecycle canonical - Implements two-phase client-driven judge selection for resource enhancement.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { ConfigManager } from '#shared/types/index.js';
import type { JudgeMenuFormatter } from '../../../gates/judge/judge-menu-formatter.js';
import type { JudgeResourceCollector } from '../../../gates/judge/judge-resource-collector.js';
import type { ExecutionContext } from '../../context/index.js';

/**
 * Pipeline Stage 10: Judge Selection (Two-Phase Client-Driven Flow)
 *
 * Judge Phase (triggered by `%judge`):
 * - Collects all available resources (styles, frameworks, gates)
 * - Returns a judge prompt with resource menu for Claude to analyze
 * - Pipeline terminates early with the judge response
 *
 * Execution Phase (follow-up call with operators):
 * - Client reruns prompt_engine with inline operators (@framework, ::gates, #style)
 * - Pipeline continues with normal execution using operator-derived selections
 *
 * Domain logic delegated to:
 * - JudgeResourceCollector: gathers styles, frameworks, gates
 * - JudgeMenuFormatter: builds response menu and operator context
 *
 * Dependencies: context.mcpRequest, context.executionPlan
 * Output: context.response (early return on judge phase)
 */
export class JudgeSelectionStage extends BasePipelineStage {
  readonly name = 'JudgeSelection';

  constructor(
    private readonly resourceCollector: JudgeResourceCollector,
    private readonly menuFormatter: JudgeMenuFormatter,
    private readonly configManager: ConfigManager | null,
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

    const inlineStyleApplied = this.applyInlineStyleSelection(context);

    const isJudgePhase = this.shouldTriggerJudgePhase(context);
    if (!isJudgePhase) {
      this.logExit({ skipped: 'Not judge phase', inlineStyleApplied });
      return;
    }

    const isJudgeEnabled = this.configManager?.isJudgeEnabled() ?? true;
    if (!isJudgeEnabled) {
      this.logExit({ skipped: 'Judge system disabled in config' });
      return;
    }

    try {
      const resources = await this.resourceCollector.collectAllResources();
      const totalResources =
        resources.styles.length + resources.frameworks.length + resources.gates.length;

      if (totalResources === 0) {
        this.logger.warn('[JudgeSelectionStage] No resources available for selection');
        this.logExit({ skipped: 'No resources available' });
        return;
      }

      const judgeResponse = this.menuFormatter.buildJudgeResponse(resources, context);

      context.setResponse(judgeResponse);
      context.state.framework.judgePhaseTriggered = true;

      this.logExit({
        judgePhaseTriggered: true,
        stylesCount: resources.styles.length,
        frameworksCount: resources.frameworks.length,
        gatesCount: resources.gates.length,
        totalResources,
        inlineStyleApplied,
      });
    } catch (error) {
      this.handleError(error, 'Judge phase resource collection failed');
    }
  }

  private applyInlineStyleSelection(context: ExecutionContext): boolean {
    const styleFromCommand =
      context.parsedCommand?.styleSelection ?? context.parsedCommand?.executionPlan?.styleSelection;

    if (!styleFromCommand) {
      return false;
    }

    const normalizedStyle = styleFromCommand.toLowerCase();
    if (context.state.framework.clientSelectedStyle === normalizedStyle) {
      return true;
    }

    context.state.framework.clientSelectedStyle = normalizedStyle;
    context.diagnostics.info(this.name, 'Inline style selection applied from command', {
      style: normalizedStyle,
    });
    return true;
  }

  private shouldTriggerJudgePhase(context: ExecutionContext): boolean {
    const modifiers = context.getExecutionModifiers();
    return modifiers?.judge === true;
  }
}
