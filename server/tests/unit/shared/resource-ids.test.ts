/**
 * The id convention, and the one property that made unifying two normalizers safe.
 *
 * `normalizePromptId` existed twice: here, and inline in `command-parser.ts` carrying an extra
 * `.replace(/[^a-z0-9_]/g, '')`. The two disagreed on nested chain-step ids — the parser's version
 * collapsed `deep_analysis/initial_scan` to `deep_analysisinitial_scan` — and the draft service
 * compares this function's output against every loaded prompt id, nested ones included. The strip
 * was unreachable at its own call site (the capture group already excluded those characters), so
 * it was dropped rather than adopted. `preserves a qualified id` is the case that would have
 * failed against the version that was removed; it is the reason this file exists.
 */

import { describe, expect, it } from '@jest/globals';

import {
  isCanonicalPromptId,
  isKebabId,
  normalizePromptId,
  slugifyCategoryDirectory,
} from '../../../src/shared/utils/resource-ids.js';

describe('normalizePromptId', () => {
  it('folds a kebab spelling onto the canonical snake id', () => {
    // The alias rule: `my-prompt` and `my_prompt` name the same prompt, so both cannot exist.
    expect(normalizePromptId('my-prompt')).toBe('my_prompt');
    expect(normalizePromptId('my_prompt')).toBe('my_prompt');
  });

  it('folds whitespace and case', () => {
    expect(normalizePromptId('  My Prompt  ')).toBe('my_prompt');
  });

  it('collapses runs and trims edge underscores', () => {
    expect(normalizePromptId('__my---prompt__')).toBe('my_prompt');
  });

  it('preserves a qualified id — the case the removed duplicate got wrong', () => {
    // A nested chain step is addressed as `parent/step`. Stripping `/` collapsed two segments
    // into one and could match an unrelated prompt.
    expect(normalizePromptId('deep_analysis/initial_scan')).toBe('deep_analysis/initial_scan');
    expect(normalizePromptId('implementation_plan/verification')).toBe(
      'implementation_plan/verification'
    );
  });

  it('is idempotent', () => {
    for (const id of ['my_prompt', 'deep_analysis/initial_scan', 'a']) {
      expect(normalizePromptId(normalizePromptId(id))).toBe(normalizePromptId(id));
    }
  });
});

describe('slugifyCategoryDirectory', () => {
  it('folds whitespace and case into a directory name', () => {
    expect(slugifyCategoryDirectory('My Category')).toBe('my-category');
  });

  it('leaves an underscore alone — folding it would relocate an existing write', () => {
    // Deliberate. `content_processing` is a real category; folding `_`→`-` here would send new
    // writes to `content-processing` and split one category into two directories. The violation
    // is REPORTED by validate:prompts and repaired by an explicit rename instead.
    expect(slugifyCategoryDirectory('content_processing')).toBe('content_processing');
  });

  it('is idempotent, which is what lets verification apply it to both sides', () => {
    expect(slugifyCategoryDirectory(slugifyCategoryDirectory('My Category'))).toBe('my-category');
  });
});

describe('the convention predicates', () => {
  it('accepts canonical prompt ids, flat and qualified', () => {
    expect(isCanonicalPromptId('my_prompt')).toBe(true);
    expect(isCanonicalPromptId('deep_analysis/initial_scan')).toBe(true);
  });

  it('rejects the two shapes actually found in the corpus', () => {
    expect(isCanonicalPromptId('strategicImplement')).toBe(false); // camelCase
    expect(isCanonicalPromptId('dev-workflow')).toBe(false); // kebab
  });

  it('accepts kebab ids and rejects snake ones', () => {
    expect(isKebabId('knowledge-capture')).toBe(true);
    expect(isKebabId('information-placement')).toBe(true);
    expect(isKebabId('content_processing')).toBe(false);
  });

  it('separates the two namespaces — a valid prompt id is not a valid kebab id', () => {
    // Both directions asserted. A predicate pair that agreed everywhere would not be enforcing
    // two conventions, and the gate that reads them would be checking one thing twice.
    expect(isCanonicalPromptId('my_prompt')).toBe(true);
    expect(isKebabId('my_prompt')).toBe(false);
    expect(isKebabId('my-prompt')).toBe(true);
    expect(isCanonicalPromptId('my-prompt')).toBe(false);
  });
});
