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
