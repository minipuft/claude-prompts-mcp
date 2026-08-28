// @lifecycle canonical - Renders delegation CTAs from semantic payload + client strategy.
import { resolveDelegationStrategy } from './strategy.js';

import type { DelegationStrategy } from './strategy.js';
import type { DelegationPayload, RenderingHints } from './types.js';
import type { RequestClientProfile } from '#shared/types/request-identity.js';

const SECTION_DELIMITER = '\u2550'.repeat(65);

/**
 * Renders delegation handoffs from semantic payload + client strategy (R-1: two modes only —
 * the current-step handoff that points at the EXECUTION BRIEF, and the next-step advisory).
 *
 * Used by:
 * - ChainOperatorExecutor (current-step handoff via renderDelegatedStepHandoff; advisory)
 * - ResponseAssembler (next-step advisory)
 */
export class DelegationRenderer {
  constructor(
    private readonly strategy:
      DelegationStrategy | ((payload: DelegationPayload) => DelegationStrategy) = (
      payload: DelegationPayload
    ) => resolveDelegationStrategy(payload.clientProfile)
  ) {}

  private buildHeader(payload: DelegationPayload): string {
    return `\u26A1 HANDOFF: Execute Step ${payload.stepNumber} ("${payload.promptName}") via sub-agent for context isolation.`;
  }

  /**
   * Handoff instructions for a CURRENT delegated step whose content is rendered as an
   * EXECUTION BRIEF in the same response (R-1). Fires (S7) in in the response that CONTAINS the step's
   * content, and the prompt line points at the delimited brief rather than "ALL content above"
   * (which, on the old path, was the PREVIOUS step's content).
   *
   * `agentType` here is advisory (R-1: content over identity) \u2014 the brief is self-contained, so
   * any executor can run it; the type names the author's Tier-17 selection and is undefined
   * when none was declared — the strategy then renders its host's default agent.
   */
  renderCurrentStepHandoff(payload: DelegationPayload, hints?: RenderingHints): string {
    const strategy = this.resolveStrategy(payload);
    const model = strategy.resolveModel(payload);
    const toolCall = strategy.formatToolCall(payload.agentType, model);
    const constraints = strategy.formatConstraints();

    const verdictHint = payload.hasGates
      ? `\u2192 Review: the worker's "Proposed Gate Review" is INPUT to your gate_verdict \u2014 review it against the criteria, override what you disagree with, then submit`
      : undefined;
    const gateHint =
      hints?.gateGuidanceEnabled === true && payload.hasGates
        ? ' along with your ratified gate_verdict'
        : '';

    const parts: string[] = [
      this.buildHeader(payload),
      '',
      SECTION_DELIMITER,
      'HANDOFF INSTRUCTIONS',
      SECTION_DELIMITER,
      '',
      toolCall,
      `\u2192 Prompt: Pass the EXECUTION BRIEF above (everything between the BRIEF delimiters) as the agent's prompt`,
      `\u2192 Result: Include the sub-agent's result in user_response${gateHint} to continue the chain`,
      ...(verdictHint !== undefined ? [verdictHint] : []),
      '',
      constraints,
    ];
    return parts.join('\n');
  }

  /**
   * One-line preview that the NEXT step is delegated. Replaces the full CTA the old path
   * rendered here (S7): a full handoff in step N's response described step N+1 while pointing
   * at step N's content \u2014 an obedient parent handed the sub-agent the wrong step's prompt. The
   * authoritative handoff now arrives WITH step N+1's brief; this line only sets expectation.
   */
  renderNextStepAdvisory(payload: DelegationPayload): string {
    return `\u26A1 Note: Step ${payload.stepNumber} ("${payload.promptName}") is delegated. Resume with your step output; the response will carry an EXECUTION BRIEF and handoff instructions for the sub-agent.`;
  }

  private resolveStrategy(payload: DelegationPayload): DelegationStrategy {
    if (typeof this.strategy === 'function') {
      return this.strategy(payload);
    }
    return this.strategy;
  }
}

/** Inputs for {@link renderDelegatedStepHandoff}; the operator resolves fields, this renders. */
export interface DelegatedStepHandoffInputs {
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly promptName: string;
  /** Tier-17 selection (`step ?? prompt`); undefined when neither declared one. */
  readonly agentType: string | undefined;
  readonly subagentModel: string | undefined;
  readonly clientProfile: RequestClientProfile | undefined;
  readonly inlineGateCount: number | undefined;
  readonly hasGates: boolean;
  readonly gateGuidanceEnabled: boolean;
}

/**
 * Render the handoff instructions for a delegated CURRENT step (R-1/S7). Free function rather
 * than an operator method: everything it needs arrives as plain data. No default agent is
 * applied here: that is host vocabulary and lives in the strategy.
 */
export function renderDelegatedStepHandoff(inputs: DelegatedStepHandoffInputs): string {
  const payload: DelegationPayload = {
    stepNumber: inputs.stepNumber,
    totalSteps: inputs.totalSteps,
    promptName: inputs.promptName,
    ...(inputs.agentType != null ? { agentType: inputs.agentType } : {}),
    ...(inputs.clientProfile != null ? { clientProfile: inputs.clientProfile } : {}),
    ...(inputs.subagentModel != null ? { subagentModel: inputs.subagentModel } : {}),
    gateCount: inputs.inlineGateCount ?? (inputs.hasGates ? 1 : 0),
    hasGates: inputs.hasGates,
  };
  return new DelegationRenderer().renderCurrentStepHandoff(payload, {
    gateGuidanceEnabled: inputs.gateGuidanceEnabled,
    frameworkInjectionEnabled: true,
  });
}
