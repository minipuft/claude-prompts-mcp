// @lifecycle test - P4.52/R47: equivalence proof before wiring a duplicate filter to the canonical method.
/**
 * `CategoryManager.getPromptsByCategory` was unreached and, for a while, deleted. A job-based
 * audit found two live sites independently reimplementing its exact filter:
 *   - `PromptAssetManager.logCategoryBreakdown` (server/src/modules/prompts/index.ts)
 *   - `ApiRouter`'s `/categories/:categoryId/prompts` route (server/src/mcp/http/api.ts)
 *
 * The planner ruled: swap a duplicate for a call to the canonical method only where the
 * semantics match EXACTLY (same match key, same case handling, same treatment of a missing
 * category), proven by a test over edge-case fixtures BEFORE swapping.
 *
 * This file proves that equivalence for `logCategoryBreakdown`'s duplicate — both sides read
 * `PromptData[]`, so no type widening is needed and the predicate is provably identical: strict
 * `===` on `category`, no normalization either side.
 *
 * Both duplicates are now wired. The `ApiRouter` one was left in place at the time because it
 * filters `ConvertedPrompt[]` (no `file` field) and holds a `string | undefined` route parameter,
 * which the `PromptData[]`/`string` signature could not accept; P4.91 made the method generic
 * over `{ category: string }` and tolerant of an undefined id, which is behaviour-preserving on
 * every case below, and swapped the route's copy for a call.
 */
import { describe, expect, it } from '@jest/globals';

import { CategoryManager } from '../../../src/modules/prompts/category-manager.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { PromptData } from '../../../src/shared/types/index.js';
import type { Logger } from '../../../src/shared/types/index.js';

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function prompt(id: string, category: string): PromptData {
  return {
    id,
    name: id,
    category,
    description: `${id} description`,
    file: `${id}.yaml`,
    arguments: [],
  };
}

/** The exact expression both `logCategoryBreakdown` and the API route used inline. */
function inlineFilter(prompts: PromptData[], categoryId: string | undefined): PromptData[] {
  return prompts.filter((p) => p.category === categoryId);
}

describe('CategoryManager.getPromptsByCategory equivalence with the inline duplicate filter', () => {
  const fixture: PromptData[] = [
    prompt('a1', 'analysis'),
    prompt('a2', 'Analysis'), // mixed case — must NOT match 'analysis' on either side
    prompt('d1', 'development'),
    prompt('d2', 'development'),
  ];

  it('matches on an ordinary category with multiple prompts', () => {
    const manager = new CategoryManager(silentLogger);
    const categoryId = 'development';

    expect(manager.getPromptsByCategory(fixture, categoryId)).toEqual(
      inlineFilter(fixture, categoryId)
    );
    expect(manager.getPromptsByCategory(fixture, categoryId).map((p) => p.id)).toEqual([
      'd1',
      'd2',
    ]);
  });

  it('is case-sensitive — mixed-case category ids do not cross-match', () => {
    const manager = new CategoryManager(silentLogger);

    expect(manager.getPromptsByCategory(fixture, 'analysis')).toEqual(
      inlineFilter(fixture, 'analysis')
    );
    expect(manager.getPromptsByCategory(fixture, 'analysis').map((p) => p.id)).toEqual(['a1']);

    expect(manager.getPromptsByCategory(fixture, 'Analysis')).toEqual(
      inlineFilter(fixture, 'Analysis')
    );
    expect(manager.getPromptsByCategory(fixture, 'Analysis').map((p) => p.id)).toEqual(['a2']);
  });

  it('returns an empty array for an unknown category — same as the inline filter', () => {
    const manager = new CategoryManager(silentLogger);
    const categoryId = 'does-not-exist';

    expect(manager.getPromptsByCategory(fixture, categoryId)).toEqual(
      inlineFilter(fixture, categoryId)
    );
    expect(manager.getPromptsByCategory(fixture, categoryId)).toEqual([]);
  });

  it('returns an empty array when the prompt list is empty', () => {
    const manager = new CategoryManager(silentLogger);

    expect(manager.getPromptsByCategory([], 'development')).toEqual(
      inlineFilter([], 'development')
    );
    expect(manager.getPromptsByCategory([], 'development')).toEqual([]);
  });

  it('treats a missing category id the same way the inline filter did: never matches', () => {
    const manager = new CategoryManager(silentLogger);
    const missing = undefined as unknown as string;

    expect(manager.getPromptsByCategory(fixture, missing)).toEqual(
      inlineFilter(fixture, undefined)
    );
    expect(manager.getPromptsByCategory(fixture, missing)).toEqual([]);
  });

  // The second duplicate, wired in P4.91. `ConvertedPrompt` has no `file` field, which is the
  // reason the route kept its own copy; the method is now generic over anything carrying a
  // `category`, so the route reaches it without widening `ConvertedPrompt` or narrowing the
  // route parameter. Same predicate, same results, and the returned element type is the input's
  // — a compile error here if the generic ever collapses back to `PromptData`.
  it('filters a ConvertedPrompt-shaped list, which is what the catalog route holds', () => {
    const manager = new CategoryManager(silentLogger);
    const converted: ConvertedPrompt[] = [
      {
        id: 'c1',
        name: 'c1',
        description: '',
        category: 'analysis',
        userMessageTemplate: 'x',
        arguments: [],
      },
      {
        id: 'c2',
        name: 'c2',
        description: '',
        category: 'development',
        userMessageTemplate: 'y',
        arguments: [],
      },
    ];

    const matched = manager.getPromptsByCategory(converted, 'development');

    expect(matched).toEqual(converted.filter((p) => p.category === 'development'));
    expect(matched.map((p) => p.userMessageTemplate)).toEqual(['y']);
  });
});
