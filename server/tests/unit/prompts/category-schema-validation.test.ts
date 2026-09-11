/**
 * P4.7 — `validateCategorySchema` is the ONLY thing that validates a `category.yaml`.
 *
 * `loader.ts:164` reads the file with `loadYamlFileSync(categoryYamlPath) as Partial<Category>` —
 * a bare cast, no schema, no error. A malformed document therefore degrades silently to the
 * loader's derived defaults rather than failing, so the writer cannot delegate its check to the
 * loader the way every other resource writer effectively can. These cases exercise the validator
 * the writer calls, including the id-vs-directory rule, which matters more here than for gates:
 * the loader NEVER reads the `id` key and names a category by its directory, so a document whose
 * `id` has drifted is served under a name it does not claim and nothing downstream can notice.
 */
import { describe, expect, it } from '@jest/globals';

import { validateCategorySchema } from '../../../src/modules/prompts/prompt-schema.js';

describe('validateCategorySchema', () => {
  it('accepts a minimal document and returns the parsed value', () => {
    const result = validateCategorySchema(
      { id: 'analysis', name: 'Analysis', description: 'Analytical prompts' },
      'analysis'
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data?.id).toBe('analysis');
  });

  it('accepts the two optional inheritance defaults', () => {
    const result = validateCategorySchema(
      {
        id: 'analysis',
        name: 'Analysis',
        description: 'Analytical prompts',
        registerWithMcp: false,
        mcpPromptMode: 'launch',
      },
      'analysis'
    );

    expect(result.valid).toBe(true);
    expect(result.data?.registerWithMcp).toBe(false);
    expect(result.data?.mcpPromptMode).toBe('launch');
  });

  it('names the missing field rather than reporting a bare failure', () => {
    const result = validateCategorySchema({ id: 'analysis', name: 'Analysis' }, 'analysis');

    // The whole reason the writer calls this rather than `isValidCategory`: a boolean cannot
    // tell an operator WHICH key is wrong, and a refusal that cannot is a refusal they have to
    // guess their way out of.
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('description');
  });

  it('rejects an empty name — `.min(1)` is the rule, not mere presence', () => {
    const result = validateCategorySchema(
      { id: 'analysis', name: '', description: 'Analytical prompts' },
      'analysis'
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('name');
  });

  it('rejects a document whose id disagrees with its directory', () => {
    const result = validateCategorySchema(
      { id: 'anaylsis', name: 'Analysis', description: 'Analytical prompts' },
      'analysis'
    );

    // MUTATION KILLED: deleting the `expectedId` comparison in `validateCategorySchema` makes
    // this the only red case in the file — every other case passes without it. Confirmed by
    // removing the `if (expectedId !== undefined && ...)` block, re-running this file (red on
    // this case alone), and reverting.
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain("does not match directory 'analysis'");
  });

  it('skips the directory rule when no directory is supplied', () => {
    // The positive control for the case above: without it, that assertion proves only that the
    // validator rejects something, not that it rejects the DIVERGENCE.
    const result = validateCategorySchema({
      id: 'anaylsis',
      name: 'Analysis',
      description: 'Analytical prompts',
    });

    expect(result.valid).toBe(true);
  });

  it('rejects a non-object document', () => {
    expect(validateCategorySchema('analysis', 'analysis').valid).toBe(false);
    expect(validateCategorySchema(null, 'analysis').valid).toBe(false);
  });
});
