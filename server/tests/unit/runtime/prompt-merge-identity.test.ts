/**
 * Overlay merge keys on identity, not on display name.
 *
 * `name` is a human-readable label and nothing enforces its uniqueness. Three collide in this
 * repo's own catalog once a personal library is overlaid: "Content Analysis", "Deep Analysis",
 * "Initial Scan". Keyed on `name`, merging an overlay EVICTS an unrelated bundled prompt that
 * merely shares its label.
 *
 * Measured 2026-08-29 against a live server: a personal `analysis/initial_scan` removed the
 * bundled `examples/deep_analysis/initial_scan` from the served catalog. `promptsData` still
 * reported both — it keys on id — so the startup count looked correct while the tool could not
 * resolve the prompt. That asymmetry is why this is a unit test on the merge itself and not an
 * assertion about a count.
 */

import { describe, expect, it } from '@jest/globals';

import { mergePromptResults } from '../../../src/modules/prompts/prompt-root-loader.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Category, PromptData } from '../../../src/modules/prompts/types.js';

function converted(category: string, id: string, name: string): ConvertedPrompt {
  return {
    id,
    name,
    description: `${id} description`,
    category,
    userMessageTemplate: 'body',
    arguments: [],
  } as ConvertedPrompt;
}

function data(category: string, id: string, name: string): PromptData {
  return {
    id,
    name,
    category,
    description: `${id} description`,
    file: `${id}/prompt.yaml`,
    arguments: [],
  } as PromptData;
}

function category(id: string, name: string, mcpPromptMode?: 'expand' | 'launch'): Category {
  return {
    id,
    name,
    description: `${id} description`,
    ...(mcpPromptMode !== undefined ? { mcpPromptMode } : {}),
  };
}

function categoryTarget(categories: Category[]): {
  promptsData: PromptData[];
  categories: Category[];
  convertedPrompts: ConvertedPrompt[];
} {
  return { promptsData: [], categories: [...categories], convertedPrompts: [] };
}

function target(prompts: ConvertedPrompt[]): {
  promptsData: PromptData[];
  categories: Category[];
  convertedPrompts: ConvertedPrompt[];
} {
  return {
    promptsData: prompts.map((p) => data(p.category, p.id, p.name)),
    categories: [],
    convertedPrompts: [...prompts],
  };
}

describe('mergePromptResults identity', () => {
  it('keeps a bundled prompt whose display name collides with an overlay prompt', () => {
    // The measured case: a nested chain step is path-qualified to `deep_analysis/initial_scan`,
    // while the personal prompt is plain `initial_scan` in a different category. Different
    // prompts, same label.
    const base = target([converted('examples', 'deep_analysis/initial_scan', 'Initial Scan')]);
    const overlay = target([converted('analysis', 'initial_scan', 'Initial Scan')]);

    mergePromptResults(base, overlay);

    const identities = base.convertedPrompts.map((p) => `${p.category}/${p.id}`).sort();
    expect(identities).toEqual(['analysis/initial_scan', 'examples/deep_analysis/initial_scan']);
  });

  it('still replaces a prompt with the same category and id', () => {
    // The overlay must WIN where identity genuinely matches — the documented "same ID = custom
    // wins". A key that never replaces would pass the test above and break the feature.
    const base = target([converted('analysis', 'initial_scan', 'Bundled Label')]);
    const overlay = target([converted('analysis', 'initial_scan', 'Personal Label')]);

    mergePromptResults(base, overlay);

    expect(base.convertedPrompts).toHaveLength(1);
    expect(base.convertedPrompts[0]?.name).toBe('Personal Label');
  });

  it('does not conflate the same id across different categories', () => {
    // `examples/deep_analysis` and `analysis/deep_analysis` are distinct prompts that share an id.
    const base = target([converted('examples', 'deep_analysis', 'Deep Analysis')]);
    const overlay = target([converted('analysis', 'deep_analysis', 'Deep Analysis')]);

    mergePromptResults(base, overlay);

    expect(base.convertedPrompts).toHaveLength(2);
  });
});

/**
 * The CATEGORY half of the same two rules, added at P4.7.
 *
 * Both defects lived in one line — `if (!target.categories.some((c) => c.name === overlayCat.name))
 * push` — and both are the ones the prompt cases above already cover at the sibling site:
 *
 *  1. Keyed on `name`, a free-text label nothing enforces the uniqueness of, so two categories
 *     with different ids and one display name collapsed into whichever root loaded first.
 *  2. Never replacing, while `loadPromptsAcrossRoots` passes the BUNDLED result as the merge
 *     TARGET — so the lowest-precedence root had the final say over category metadata. A
 *     workspace `category.yaml` for a category that also ships bundled was written correctly,
 *     loaded correctly, and discarded here. P4.7 gave `category.yaml` its first writer, and this
 *     is what makes a write to it observable in the configuration a personal library runs in.
 */
describe('mergePromptResults category identity', () => {
  it('lets an overlay category replace the bundled one with the same id', () => {
    const base = categoryTarget([category('examples', 'Examples')]);
    const overlay = categoryTarget([category('examples', 'My Examples', 'launch')]);

    mergePromptResults(base, overlay);

    // MUTATION KILLED, both halves measured separately so neither rides the other: keeping the
    // id key but restoring "never replace" (`if (existingIdx === -1) push`) reds THIS case alone
    // (1 of 6). Restoring the whole pre-P4.7 body reds this case and the next. Confirmed by
    // applying each, re-running this file, and reverting.
    expect(base.categories).toHaveLength(1);
    expect(base.categories[0]?.name).toBe('My Examples');
    expect(base.categories[0]?.mcpPromptMode).toBe('launch');
  });

  it('keeps two categories whose display names collide but whose ids differ', () => {
    const base = categoryTarget([category('examples', 'Analysis')]);
    const overlay = categoryTarget([category('analysis', 'Analysis')]);

    mergePromptResults(base, overlay);

    // MUTATION KILLED: keying the merge on `c.name === overlayCat.name` while KEEPING the
    // replacement reds this case and the one above (2 of 6) — `analysis` is dropped because an
    // unrelated category already wears its label, and `My Examples` no longer matches `Examples`
    // so the replacement stops firing too. Confirmed by applying it, re-running this file, and
    // reverting.
    expect(base.categories.map((c) => c.id).sort()).toEqual(['analysis', 'examples']);
  });

  it('still adds an overlay category the target does not have', () => {
    // The positive control for both cases above: a merge that replaced everything, or one that
    // never matched at all, would satisfy one of them while breaking this.
    const base = categoryTarget([category('examples', 'Examples')]);
    const overlay = categoryTarget([category('personal', 'Personal')]);

    mergePromptResults(base, overlay);

    expect(base.categories.map((c) => c.id).sort()).toEqual(['examples', 'personal']);
  });
});
