// @lifecycle canonical - Applies a P5 visibility decision to a delegation ExecutionEnvelope.

import type { VisibilityItem } from '#shared/types/chain-execution.js';
import type { ExecutionEnvelope } from './types.js';

/**
 * The projection of a `VisibilityDecision` this module reads.
 *
 * Structurally satisfied by `VisibilityDecision` from
 * `engine/execution/pipeline/decisions/visibility`, but declared here rather than imported:
 * `delegation/` is a rendering module and takes plain data, the same reasoning
 * `decisions/visibility/types.ts` gives for declaring `VisibilityDeclaration` instead of
 * importing `ChainStepPrompt`. Importing the decision module would also give `delegation/` a
 * dependency on `pipeline/` that no other file in this directory has.
 *
 * Both fields are read, and they are NOT interchangeable even though v1 aliases them:
 * `withheld` decides what is removed from the envelope, `manifest` decides what is named on the
 * manifest line. A future decision that withholds an item without reporting it changes only the
 * second.
 */
export interface EnvelopeVisibility {
  readonly withheld: readonly VisibilityItem[];
  readonly manifest: readonly VisibilityItem[];
}

/**
 * Remove withheld items from a delegation envelope and attach the withheld manifest.
 *
 * Returns the input untouched when nothing is withheld and nothing is manifested — the
 * load-bearing no-declarations guarantee: a chain with no `visibility:` anywhere must render
 * byte-identically to a build without P5.
 *
 * `chainHistory` is the only envelope field a `VisibilityItem` names today. `frameworkGuidance`
 * and `gateInstructions` have no item in the vocabulary (`VisibilityItem` is
 * `previous_step_output | chain_history | unknowns_ledger`) and are therefore never filtered
 * here; `previous_step_output` and `unknowns_ledger` are withheld upstream, at the step render
 * that produces the text the envelope would otherwise carry.
 */
export function applyVisibilityToEnvelope(
  envelope: ExecutionEnvelope | null | undefined,
  visibility: EnvelopeVisibility
): ExecutionEnvelope | null {
  const hasEffect = visibility.withheld.length > 0 || visibility.manifest.length > 0;
  if (!hasEffect) {
    return envelope ?? null;
  }

  const withheld = new Set<VisibilityItem>(visibility.withheld);
  const base: ExecutionEnvelope = envelope ?? {};
  const chainHistory = withheld.has('chain_history') ? undefined : base.chainHistory;

  return {
    ...(chainHistory !== undefined ? { chainHistory } : {}),
    ...(base.frameworkGuidance !== undefined ? { frameworkGuidance: base.frameworkGuidance } : {}),
    ...(base.gateInstructions !== undefined ? { gateInstructions: base.gateInstructions } : {}),
    ...(visibility.manifest.length > 0 ? { withheldManifest: [...visibility.manifest] } : {}),
  };
}
