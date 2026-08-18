// @lifecycle canonical - Single source for the phase-guard declared section header vocabulary.
/**
 * Declared Sections
 *
 * `phase-guard-evaluator.ts` grades model output against `section_header` strings declared in
 * `resources/frameworks/<id>/phases.yaml`. This module is the one place that reads those phases
 * back out of a framework's guide, so every consumer — the evaluation stage AND the prompt-time
 * declaration renderers — reads the same source instead of re-deriving it.
 *
 * Two shapes are exported:
 *
 * - `resolveGuardedProcessingSteps` returns the full `ProcessingStep[]` phase-guard evaluation
 *   needs (min_length, contains_any, matches_pattern, ...). This is the extracted replacement for
 *   the private `getPhasesWithGuards` method `19-phase-guard-verification-stage.ts` used to own
 *   alone — invisible to `rg`, unreachable by a second consumer.
 * - `resolveDeclaredSections` derives the narrower `{header, required, phaseId}` vocabulary that
 *   prompt-time declaration consumers (`chain-operator-executor`, `response-assembler`) need.
 *
 * No cache: both read through the framework guide provider on every call, so framework hot-reload
 * keeps working — a construction-time cache would freeze the header vocabulary at boot.
 */

import { declareCriteria } from './phase-guards/criteria.js';

import type { FrameworkGuide, ProcessingStep } from './types/framework-types.js';

/** One declared section header a guarded phase requires the model to emit. */
export interface DeclaredSection {
  /** Verbatim `phases.yaml` `section_header`, e.g. '## Context'. */
  header: string;
  /** From `guards.required` — the only field that can block advancement (phase-guard-evaluator.ts). */
  required: boolean;
  /** Phase id, for diagnostics and retry hints. */
  phaseId: string;
  /**
   * Prompt-time declarations for this phase's content criteria, from the criteria registry.
   * Empty when the phase configures only criteria that are deliberately undeclared, or only
   * negative ones — which are structurally undeclarable (`criteria.ts`).
   */
  criteria: string[];
}

/**
 * Narrow provider shape — matches what the pipeline stage already supplies
 * (`() => deps.frameworkManager` in `pipeline-builder.ts`). `FrameworkManager` satisfies this
 * structurally; this module does not depend on the wider `FrameworkManager` type so a caller
 * cannot reach unrelated framework-manager methods through this seam.
 */
export type FrameworkGuideProvider = () =>
  { getFrameworkGuide(id: string): FrameworkGuide | undefined } | undefined;

/**
 * Fetch the processing steps for `frameworkId` that declare both a `section_header` and `guards`
 * — the phases phase-guard evaluation checks. Single source for this lookup; do not re-implement
 * it in a consumer (that recreates the drift this module exists to remove).
 */
export function resolveGuardedProcessingSteps(
  frameworkGuideProvider: FrameworkGuideProvider,
  frameworkId: string
): ProcessingStep[] {
  const registry = frameworkGuideProvider();
  if (!registry) return [];

  const guide = registry.getFrameworkGuide(frameworkId);
  if (!guide) return [];

  const enhancement = guide.enhanceWithFramework(
    { id: 'phase-guard-check', name: '', description: '', category: '' } as any,
    {}
  );

  return (enhancement?.processingEnhancements ?? []).filter(
    (step) => step.section_header && step.guards
  );
}

/**
 * Resolve the declared header vocabulary for a framework's guarded phases — pure derivation of
 * `resolveGuardedProcessingSteps`. One entry per guarded phase; `required` comes from
 * `guards.required`, the only field that can block (`phase-guard-evaluator.ts:85`).
 */
export function resolveDeclaredSections(
  frameworkGuideProvider: FrameworkGuideProvider,
  frameworkId: string
): DeclaredSection[] {
  return resolveGuardedProcessingSteps(frameworkGuideProvider, frameworkId)
    .filter((step): step is ProcessingStep & { section_header: string } => !!step.section_header)
    .map((step) => ({
      header: step.section_header,
      required: step.guards?.required === true,
      phaseId: step.id,
      criteria: declareCriteria(step.guards),
    }));
}
