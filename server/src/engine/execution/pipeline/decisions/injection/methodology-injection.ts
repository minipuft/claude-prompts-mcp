// @lifecycle canonical - Pre-injection projection of whether a methodology is injected.

import { DISABLE_INJECT_MODIFIERS, FORCE_INJECT_MODIFIERS, MODIFIER_EFFECTS } from './constants.js';

import type { PromptInjectionConfig } from './types.js';

/**
 * The signals this projection reads. Both are available to every caller that resolves a gate
 * set, which is what lets one definition serve all of them.
 */
export interface FrameworkInjectionSignals {
  /** Command modifiers for this execution. */
  readonly modifiers?:
    | { clean?: boolean | undefined; lean?: boolean | undefined; judge?: boolean | undefined }
    | undefined;
  /** The prompt's own `injection` block, from its YAML. */
  readonly promptInjection?: PromptInjectionConfig | undefined;
}

/**
 * Whether a methodology system prompt is injected for this execution, judged from the signals
 * available BEFORE the injection stage runs.
 *
 * ## Why a projection and not the decision
 *
 * `InjectionDecisionService` writes the authoritative decision to `context.state.injection` in
 * stage 07b. Gate resolution happens in stages 04 and 05 — measured from the stage list in
 * `prompt-execution-pipeline.ts`, injection control runs after both, because it needs the
 * `currentStep` that the session stage supplies. So a gate-resolution caller reading
 * `state.injection` would read a value that does not exist yet.
 *
 * This function therefore answers the same question from the subset of signals already settled
 * at that point: command modifiers, and the prompt's own declaration about itself.
 *
 * ## Direction of error is deliberate
 *
 * Tiers this cannot see — runtime session overrides, chain/category/global `enabled` flags, and
 * frequency rules — can only make the real answer MORE restrictive, never less. Returning `true`
 * when they are unknown means the nesting veto withholds methodology gates only on positive
 * suppression: an author or caller who explicitly turned the methodology off. A gate is never
 * withheld on a guess, so this cannot silently drop a gate someone was relying on.
 *
 * Consequence to know: under a config where a methodology is disabled at the chain or global
 * tier, methodology gates are still scheduled. That is the same behavior as before this
 * function existed, so it is a remaining gap rather than a regression.
 */
export function isMethodologyInjected(signals: FrameworkInjectionSignals): boolean {
  const forced = hasForcingModifier(signals.modifiers);
  if (forced) {
    return true;
  }

  if (hasSuppressingModifier(signals.modifiers)) {
    return false;
  }

  // An explicit `false` suppresses; `true` and `undefined` both leave the methodology injected,
  // so an author who declares only `frequency` or `target` does not change gate scheduling.
  return signals.promptInjection?.['system-prompt']?.enabled !== false;
}

/**
 * Whether a modifier forces the methodology in regardless of configuration.
 *
 * Mirrors `InjectionDecisionService.checkModifiers`, which special-cases `%judge` for
 * `system-prompt` so the judge selection phase always sees the methodology.
 */
function hasForcingModifier(modifiers: FrameworkInjectionSignals['modifiers']): boolean {
  if (modifiers === undefined) {
    return false;
  }

  return FORCE_INJECT_MODIFIERS.some(
    (modifier) => modifiers[modifier as keyof typeof modifiers] === true
  );
}

/**
 * Whether an active modifier suppresses system-prompt injection.
 *
 * Reads `MODIFIER_EFFECTS` rather than naming `%clean`/`%lean` directly: that table is the
 * single statement of which modifier suppresses which injection type, so changing it changes
 * gate nesting in step, instead of leaving a second list to remember.
 */
function hasSuppressingModifier(modifiers: FrameworkInjectionSignals['modifiers']): boolean {
  if (modifiers === undefined) {
    return false;
  }

  for (const modifier of DISABLE_INJECT_MODIFIERS) {
    if (modifiers[modifier as keyof typeof modifiers] !== true) {
      continue;
    }
    if (MODIFIER_EFFECTS[modifier]?.includes('system-prompt') === true) {
      return true;
    }
  }

  return false;
}
