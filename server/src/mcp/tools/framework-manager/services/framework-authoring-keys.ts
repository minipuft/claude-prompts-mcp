// @lifecycle canonical - Pure fold from pre-rename authoring keys onto their canonical spellings.

import type { FrameworkCreationData } from '../core/types.js';

/**
 * Collapse pre-rename authoring keys onto their canonical spellings, in place.
 *
 * The `resource_manager` input schema is `.passthrough()`, so a client sending
 * `methodology_gates` gets a clean parse and the key survives on the object — but every typed
 * consumer reads `framework_gates` and sees `undefined`. Nothing errors; the draft simply scores
 * as though it declared no gates. This fold runs after field assignment and before validation so
 * a draft authored with the old keys scores identically to a new one.
 *
 * Pure apart from mutating the target it is handed. Extracted from the lifecycle processor so the
 * fold itself is directly testable rather than reachable only through a constructed processor.
 *
 * Retire once no shipped or workspace framework draft uses the pre-rename keys (plan row 5.7).
 */
export function foldDeprecatedAuthoringKeys(target: FrameworkCreationData): void {
  if (target.framework_gates === undefined && target.methodology_gates !== undefined) {
    target.framework_gates = target.methodology_gates;
  }
  if (target.framework_elements === undefined && target.methodology_elements !== undefined) {
    target.framework_elements = target.methodology_elements;
  }
}
