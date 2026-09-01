// @lifecycle canonical - Sole owner of the base+overlay prompt load, shared by startup and reload.

import { stat } from 'node:fs/promises';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { Logger } from '#shared/types/index.js';
import type { PromptAssetManager } from './index.js';
import type { Category, PromptData } from './types.js';

/**
 * Every root a prompt catalog is assembled from, in precedence order.
 *
 * Resolved by the CALLER, not here. `PathResolver` lives in `runtime/` and this module is in
 * `modules/`, which may not import it — the same constraint that put `getBundledResourceDir` on
 * the `ResourcePathSource` port. Passing a resolved set keeps one loader usable from both layers.
 */
export interface PromptRootSet {
  /** The writable/primary root. */
  primary: string;
  /** Base path for id derivation — the primary directory, or its parent for a file path. */
  basePath: string;
  /** The package-shipped tree. Lowest precedence, always read, never written. */
  bundled?: string | undefined;
  /** Workspace overlays. Highest precedence, applied in order. */
  overlays: readonly string[];
}

export interface PromptRootLoadResult {
  promptsData: PromptData[];
  categories: Category[];
  convertedPrompts: ConvertedPrompt[];
  /** Prompts a higher-precedence root replaced — a subtraction the inventory must name. */
  overridden: number;
  /** Prompts that failed schema validation and were dropped. */
  invalid: number;
  /** The bundled base, when one contributed. */
  base?: string | undefined;
}

/**
 * Load a prompt catalog across every root, bundle → primary → overlays.
 *
 * WHY THIS IS SHARED RATHER THAN DUPLICATED
 * Startup and hot reload were two derivations of one question, and they disagreed. Startup merged
 * the bundled base and every overlay; `reloadPromptData` loaded a single directory. So under a
 * workspace with overlays, the FIRST hot reload silently rebuilt the live catalog from the primary
 * root alone — dropping the bundled tree and every overlay — then published the change with no
 * error. Measured 2026-08-30 (issue #229 follow-up R-HR1): an edit to a bundled-only prompt under
 * an external `MCP_RESOURCES_PATH` was never observed, held 60s, against a positive control where
 * an external-tree edit appeared at t+5s.
 *
 * A COUNT-BASED CHECK CANNOT SEE IT. `prompts/list` reported 113 before and after, because binding
 * is deduped per shell — the entries survive while their content stops tracking the file. Any gate
 * for this asserts on served CONTENT, never on catalog size.
 *
 * Precedence is the call order: `mergePromptResults` lets a later result win on a duplicate id, so
 * bundle → primary → overlays yields the documented "same ID = custom wins".
 */
export async function loadPromptsAcrossRoots(
  promptManager: PromptAssetManager,
  roots: PromptRootSet,
  mergeResults: (
    target: {
      promptsData: PromptData[];
      categories: Category[];
      convertedPrompts: ConvertedPrompt[];
    },
    overlay: {
      promptsData: PromptData[];
      categories: Category[];
      convertedPrompts: ConvertedPrompt[];
    }
  ) => number,
  logger?: Logger
): Promise<PromptRootLoadResult> {
  const primary = await promptManager.loadAndConvertPrompts(roots.primary, roots.basePath);

  let overridden = 0;
  let invalid = primary.invalid;
  let base: string | undefined;
  let accumulated: {
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
  } = primary;

  // The bundled root only contributes when it is a REAL, distinct directory. Skipping this check
  // would make an absent bundled path load as an empty catalog and merge nothing — silent, and
  // indistinguishable from a healthy start.
  const bundledContributes =
    roots.bundled !== undefined &&
    roots.bundled !== roots.primary &&
    (await directoryExists(roots.bundled));

  if (bundledContributes && roots.bundled !== undefined) {
    const bundled = await promptManager.loadAndConvertPrompts(roots.bundled, roots.bundled);
    overridden += mergeResults(bundled, primary);
    invalid += bundled.invalid;
    base = roots.bundled;
    accumulated = bundled;
  }

  for (const overlayDir of roots.overlays) {
    try {
      const overlay = await promptManager.loadAndConvertPrompts(overlayDir, overlayDir);
      overridden += mergeResults(accumulated, overlay);
      invalid += overlay.invalid;
    } catch (error) {
      // One unreadable overlay must not cost the whole catalog — the roots that DID load are
      // still correct, and failing the load would take the served prompts down with it.
      logger?.warn(
        `Failed to load overlay prompts from ${overlayDir}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return {
    promptsData: accumulated.promptsData,
    categories: accumulated.categories,
    convertedPrompts: accumulated.convertedPrompts,
    overridden,
    invalid,
    base,
  };
}

/**
 * Moved here from `runtime/data-loader.ts` on 2026-09-01.
 *
 * It belongs beside the loader that calls it. The reload path lives in `modules/`, so reaching
 * back into `runtime/` for this would invert the layer direction; startup imports it from here
 * instead, which is the legal way round and keeps one definition.
 */
/**
 * Merge overlay prompt results into the primary arrays.
 * Overlay prompts with matching IDs override primary ones (standard overlay semantics).
 *
 * Returns how many primary prompts the overlay replaced. That number is a subtraction the startup
 * inventory has to name: without it, `119 served` against `123 on disk` looks like loss, when four
 * of the four are accounted for (three unloadable, one deliberately overridden).
 *
 * Exported for direct testing. The merge key is the kind of thing that regresses silently — a
 * wrong key still produces a plausible catalog, just one missing an entry nobody asked about —
 * so it gets a unit test rather than only end-to-end coverage.
 */
export function mergePromptResults(
  target: {
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
  },
  overlay: {
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
  }
): number {
  // Merge categories (ensure overlay categories exist, don't replace existing metadata)
  for (const overlayCat of overlay.categories) {
    const exists = target.categories.some((c) => c.name === overlayCat.name);
    if (!exists) {
      target.categories.push(overlayCat);
    }
  }

  // Merge prompts (overlay wins on identity conflict).
  //
  // Keyed on `category/id`, the same identity `convertedPrompts` uses below. Keyed on bare `id`
  // these two arrays disagreed about what the catalog contains: measured 2026-08-29, 120 converted
  // prompts against 119 `promptsData` entries, because `general/resume_variant_build` and
  // `resume/resume_variant_build` are one prompt to one array and two to the other. Every consumer
  // then depends on which array it happened to read.
  const promptIdentityOf = (prompt: PromptData): string => `${prompt.category}/${prompt.id}`;
  for (const overlayPrompt of overlay.promptsData) {
    const overlayIdentity = promptIdentityOf(overlayPrompt);
    const existingIdx = target.promptsData.findIndex(
      (p) => promptIdentityOf(p) === overlayIdentity
    );
    if (existingIdx !== -1) {
      target.promptsData[existingIdx] = overlayPrompt;
    } else {
      target.promptsData.push(overlayPrompt);
    }
  }

  // Merge converted prompts, keyed on category + id — the same identity `promptsData` uses above,
  // not the display name.
  //
  // `name` is a human-readable label and nothing enforces its uniqueness. Three collide in this
  // repo's own catalog once a workspace overlay is present: "Content Analysis", "Deep Analysis",
  // "Initial Scan". Keyed on `name`, adding an overlay prompt EVICTS an unrelated bundled prompt
  // that merely shares its label — measured 2026-08-29, where a personal `analysis/initial_scan`
  // silently removed the bundled `examples/deep_analysis/initial_scan` from the served catalog
  // while `promptsData` still reported both, so the count looked right and the tool could not
  // resolve the prompt.
  //
  // Category is part of the key because a nested chain step's id is path-qualified relative to its
  // category root (`deep_analysis/initial_scan`), so id alone is unique only within a category.
  const identityOf = (prompt: ConvertedPrompt): string => `${prompt.category}/${prompt.id}`;
  let overridden = 0;
  for (const overlayConverted of overlay.convertedPrompts) {
    const overlayIdentity = identityOf(overlayConverted);
    const existingIdx = target.convertedPrompts.findIndex((c) => identityOf(c) === overlayIdentity);
    if (existingIdx !== -1) {
      target.convertedPrompts[existingIdx] = overlayConverted;
      overridden++;
    } else {
      target.convertedPrompts.push(overlayConverted);
    }
  }
  return overridden;
}

/** Whether a path exists and is a directory. Absent and not-a-directory are the same answer here. */
async function directoryExists(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}
