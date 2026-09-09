// @lifecycle canonical - Section builders for the self-contained delegation brief (R-1).
/**
 * The brief is the delegation contract: everything a spawned executor needs, rendered as text in
 * the SAME response as the delegated step (R-1, delegation plan implementation notes §Rulings).
 * Text is the only channel by design — the executor has no `mcp__` tools, so the chain resume
 * token never leaves the parent; these builders produce worker-facing sections the operator
 * embeds between {@link BRIEF_START} / {@link BRIEF_END}.
 *
 * Pure functions over plain data: `delegation/` is a rendering module and takes no pipeline
 * imports.
 */

import { buildHandoffResultSection, handoffNodeToken } from './handoff-contract.js';
import { renderDelegatedStepHandoff } from './renderer.js';

import type { RequestClientProfile } from '#shared/types/request-identity.js';

const BRIEF_DELIMITER = '═'.repeat(65);

export const BRIEF_START = `${BRIEF_DELIMITER}\nEXECUTION BRIEF (sub-agent prompt — pass everything between these delimiters)\n${BRIEF_DELIMITER}`;
export const BRIEF_END = `${BRIEF_DELIMITER}\nEND EXECUTION BRIEF\n${BRIEF_DELIMITER}`;

/**
 * `### Quality Gates` is load-bearing, not decoration: `hooks/lib/ralph_subagent_contract.py`
 * parses worker prompts for exactly this heading (S2 — the Python module API is the published
 * contract, so the TS side emits the heading that module already requires). Renaming it breaks
 * the published Python module contract.
 */
export const QUALITY_GATES_HEADING = '### Quality Gates';

/**
 * Gate section for the brief. Uses the PER-STEP gate text stage 11 already writes
 * (`step.metadata['gateInstructions']`) — S4's whole fix is reading the per-step field instead
 * of the run-scoped one that is never assigned for chains.
 *
 * Rendered independently of the gate-guidance injection toggle: the toggle governs inline
 * guidance verbosity for the parent, while this section is the delegation contract the worker
 * reviews against (R-2). A step with no gate text gets no section.
 */
export function buildQualityGatesSection(gateInstructions: string | undefined): string | null {
  if (gateInstructions === undefined || gateInstructions.trim().length === 0) {
    return null;
  }
  return `${QUALITY_GATES_HEADING}\n\n${gateInstructions.trim()}`;
}

/** One prior step's captured output, as the history section consumes it. */
export interface BriefHistoryEntry {
  readonly stepNumber: number;
  readonly stepName: string;
  readonly output: string;
}

/**
 * Chain-history section (S1): outputs of the steps BEFORE the previous one. The previous step's
 * output is not repeated here — it already reaches the worker through the rendered template's
 * `{{previous_step_output}}`, and `chain_history` / `previous_step_output` are distinct
 * {@link VisibilityItem}s precisely so an author can withhold one without the other.
 *
 * Caller applies the P5 visibility decision BEFORE calling (withheld history = do not call);
 * this builder only formats what the policy admitted.
 */
export function buildChainHistorySection(entries: readonly BriefHistoryEntry[]): string | null {
  if (entries.length === 0) {
    return null;
  }
  const parts = ['### Chain History (prior step outputs)'];
  for (const entry of entries) {
    parts.push('', `#### Step ${entry.stepNumber}: ${entry.stepName}`, '', entry.output.trim());
  }
  return parts.join('\n');
}

/**
 * Withheld-context manifest line for the brief (names only, never values — P5 OQ-P5-3).
 * Same wording as the envelope renderer used, so hooks or readers keying on the phrase see one
 * spelling.
 */
export function buildWithheldManifestLine(manifest: readonly string[]): string | null {
  if (manifest.length === 0) {
    return null;
  }
  return `CONTEXT WITHHELD (names only, values not provided): ${manifest.join(', ')}`;
}

/** Inputs for {@link assembleBriefBody}; the caller applies visibility BEFORE building these. */
export interface BriefBodyInputs {
  /** Already-rendered worker-facing sections (intent, framework, system message, template). */
  readonly workerLines: readonly string[];
  /** The delegated step's OWN gate text (stage 11's per-step field) — S4. */
  readonly stepGateText: string | undefined;
  /** Visibility-admitted prior outputs — empty when `chain_history` is withheld (S1). */
  readonly historyEntries: readonly BriefHistoryEntry[];
  /** Withheld item names for the manifest line. */
  readonly manifest: readonly string[];
  /** The delegated node's handoff token — the closing section's `HANDOFF RESULT` trailer. */
  readonly nodeToken: string;
}

/**
 * Compose the full worker-facing brief body: worker lines, then history, gates, manifest, and
 * the result contract. Section ORDER is part of the contract — the result contract closes the
 * brief so the worker's last instruction is what to return.
 */
export function assembleBriefBody(inputs: BriefBodyInputs): string {
  const parts: string[] = [...inputs.workerLines];

  const history = buildChainHistorySection(inputs.historyEntries);
  if (history !== null) parts.push(history);

  const gates = buildQualityGatesSection(inputs.stepGateText);
  if (gates !== null) parts.push(gates);

  const manifestLine = buildWithheldManifestLine(inputs.manifest);
  if (manifestLine !== null) parts.push(manifestLine);

  parts.push(buildHandoffResultSection(inputs.nodeToken, gates !== null));
  return parts.filter(Boolean).join('\n\n');
}

/**
 * The step fields a delegated payload reads, structurally — so this module keeps taking plain
 * data and takes no operator import. `ChainStepPrompt` satisfies it as written.
 */
interface DelegatedStepFacts {
  readonly stepNumber: number;
  readonly nodeId?: string;
  readonly agentType?: string;
  readonly subagentModel?: 'heavy' | 'standard' | 'fast';
  readonly inlineGateIds?: readonly string[];
  readonly metadata?: Record<string, unknown>;
  readonly convertedPrompt?: {
    readonly agentType?: string;
    readonly subagentModel?: 'heavy' | 'standard' | 'fast';
  };
}

/** Inputs for {@link buildDelegatedStepLines}; the caller applies visibility BEFORE building. */
export interface DelegatedStepPayloadInputs {
  readonly step: DelegatedStepFacts;
  readonly totalSteps: number;
  readonly promptName: string;
  readonly clientProfile: RequestClientProfile | undefined;
  readonly historyEntries: readonly BriefHistoryEntry[];
  readonly manifest: readonly string[];
  /** Already-rendered worker-facing sections — what belongs to the worker on THIS render path. */
  readonly workerLines: readonly string[];
  readonly gateGuidanceEnabled: boolean;
}

/**
 * The whole worker-facing payload of a delegated step: the brief between its delimiters, then
 * the handoff instructions that point at it.
 *
 * ONE assembly, TWO render paths. `renderNormalStep` composes it on a delegated step's ordinary
 * render; `renderGateReviewStep` composes it when the step under review IS the delegated one and
 * this is its first attempt — that render replaces the normal one (stage 18 skips on a pending
 * review, and stage 20 overwrites `executionResults` when the review is raised the same turn), so
 * without it the parent was handed a delegated step with nothing to hand a worker. Only the
 * worker lines differ between the two; everything after them is identical and lives here.
 *
 * `hasGates` is returned rather than recomputed by callers: it is `buildQualityGatesSection`'s own
 * verdict, the same one {@link assembleBriefBody} renders the section on, so the handoff's gate
 * wording and the brief's gate section cannot disagree.
 */
export function buildDelegatedStepLines(inputs: DelegatedStepPayloadInputs): {
  readonly lines: readonly string[];
  readonly hasGates: boolean;
} {
  const { step } = inputs;
  const stepGateText =
    typeof step.metadata?.['gateInstructions'] === 'string'
      ? step.metadata['gateInstructions']
      : undefined;
  const hasGates = buildQualityGatesSection(stepGateText) !== null;
  const nodeToken = handoffNodeToken(step);
  return {
    lines: [
      BRIEF_START,
      assembleBriefBody({
        workerLines: inputs.workerLines,
        stepGateText,
        historyEntries: inputs.historyEntries,
        manifest: inputs.manifest,
        nodeToken,
      }),
      BRIEF_END,
      renderDelegatedStepHandoff({
        stepNumber: step.stepNumber,
        totalSteps: inputs.totalSteps,
        promptName: inputs.promptName,
        agentType: step.agentType ?? step.convertedPrompt?.agentType,
        subagentModel: step.subagentModel ?? step.convertedPrompt?.subagentModel,
        clientProfile: inputs.clientProfile,
        inlineGateCount: step.inlineGateIds?.length,
        hasGates,
        gateGuidanceEnabled: inputs.gateGuidanceEnabled,
        nodeToken,
      }),
    ],
    hasGates,
  };
}
