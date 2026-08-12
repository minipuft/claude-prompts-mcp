// @lifecycle canonical - Renders delegation CTAs from semantic payload + client strategy.
import { resolveDelegationStrategy } from './strategy.js';

import type { DelegationStrategy } from './strategy.js';
import type { DelegationPayload, ExecutionEnvelope, RenderingHints } from './types.js';

const SECTION_DELIMITER = '\u2550'.repeat(65);

/**
 * Renders delegation CTAs from semantic payload + client strategy.
 *
 * Used by:
 * - ChainOperatorExecutor (full CTA with envelope)
 * - ResponseAssembler (delegation section with envelope)
 */
export class DelegationRenderer {
  constructor(
    private readonly strategy:
      DelegationStrategy | ((payload: DelegationPayload) => DelegationStrategy) = (
      payload: DelegationPayload
    ) => resolveDelegationStrategy(payload.clientProfile)
  ) {}

  /**
   * Full render: header + optional envelope + instructions + constraints.
   */
  render(payload: DelegationPayload, envelope?: ExecutionEnvelope, hints?: RenderingHints): string {
    const sections: string[] = [this.buildHeader(payload)];

    if (envelope != null && this.hasContent(envelope)) {
      sections.push('', this.buildEnvelope(envelope));
    }

    sections.push('', this.buildInstructions(payload, hints));
    return sections.join('\n');
  }

  private buildHeader(payload: DelegationPayload): string {
    return `\u26A1 HANDOFF: Execute Step ${payload.stepNumber} ("${payload.promptName}") via sub-agent for context isolation.`;
  }

  /**
   * Envelope rendering is strategy-INDEPENDENT: `DelegationStrategy` owns only
   * `resolveModel` / `formatToolCall` / `formatConstraints`, all of which are consumed by
   * {@link buildInstructions}. So the withheld-context manifest line added here reaches every
   * client profile (Claude, Codex, Gemini, OpenCode, Cursor, Neutral) through one code path —
   * there is no per-strategy envelope hook it could miss.
   */
  private buildEnvelope(envelope: ExecutionEnvelope): string {
    const parts: string[] = [SECTION_DELIMITER, 'EXECUTION CONTEXT', SECTION_DELIMITER];

    // Stated before the content it qualifies: a sub-agent must know what it is missing before
    // it reads what it was given. Names only, never values (P5 OQ-P5-3).
    if (envelope.withheldManifest != null && envelope.withheldManifest.length > 0) {
      parts.push(
        '',
        `CONTEXT WITHHELD (names only, values not provided): ${envelope.withheldManifest.join(', ')}`
      );
    }
    if (envelope.chainHistory != null && envelope.chainHistory.length > 0) {
      parts.push('', envelope.chainHistory);
    }
    if (envelope.frameworkGuidance != null && envelope.frameworkGuidance.length > 0) {
      parts.push('', envelope.frameworkGuidance);
    }
    if (envelope.gateInstructions != null && envelope.gateInstructions.length > 0) {
      parts.push('', envelope.gateInstructions);
    }

    return parts.join('\n');
  }

  private buildInstructions(payload: DelegationPayload, hints?: RenderingHints): string {
    const strategy = this.resolveStrategy(payload);
    const model = strategy.resolveModel(payload);
    const toolCall = strategy.formatToolCall(payload.agentType, model);
    const constraints = strategy.formatConstraints();

    const gateHint =
      hints?.gateGuidanceEnabled === true && payload.hasGates
        ? '. Sub-agent enforces gate criteria — include gate_verdict with result'
        : hints?.gateGuidanceEnabled === true
          ? ' (add gate_verdict if a gate asks you to self-review)'
          : '';
    const continueHint =
      payload.stepNumber < payload.totalSteps
        ? `so Step ${payload.stepNumber + 1} can begin`
        : 'to complete the chain';

    const parts: string[] = [
      SECTION_DELIMITER,
      'HANDOFF INSTRUCTIONS',
      SECTION_DELIMITER,
      '',
      toolCall,
      `\u2192 Prompt: Pass ALL content above as the agent's prompt`,
      `\u2192 Result: Include sub-agent's result in user_response${gateHint} ${continueHint}`,
      '',
      constraints,
    ];

    return parts.join('\n');
  }

  private hasContent(envelope: ExecutionEnvelope): boolean {
    return (
      // A manifest alone is content: withholding everything the envelope would have carried is
      // exactly the case where the sub-agent most needs to be told.
      (envelope.withheldManifest != null && envelope.withheldManifest.length > 0) ||
      (envelope.chainHistory != null && envelope.chainHistory.length > 0) ||
      (envelope.frameworkGuidance != null && envelope.frameworkGuidance.length > 0) ||
      (envelope.gateInstructions != null && envelope.gateInstructions.length > 0)
    );
  }

  private resolveStrategy(payload: DelegationPayload): DelegationStrategy {
    if (typeof this.strategy === 'function') {
      return this.strategy(payload);
    }
    return this.strategy;
  }
}
