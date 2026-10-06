// @lifecycle canonical - Unit tests for B.91: a shipped category survives extraction unchanged.
import { describe, expect, jest, test } from '@jest/globals';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CategoryExtractor } from '../../../../src/engine/execution/planning/category-extractor.js';

import type { Logger } from '../../../../src/shared/types/index.js';

/**
 * B.91. `isValidCategory` held eight category names typed into the source. The prompts root ships
 * nine directories. They agreed on three, so six real categories were rewritten to `general`
 * before gate guidance was rendered — a gate scoped to one of them was selected, named in the
 * `**Gates**:` attestation footer, and then had its guidance dropped.
 *
 * THE FIRST TEST GOVERNS THE LIST, NOT ITS MEMBERS. It reads the shipped category directories off
 * disk and requires every one of them to survive extraction unchanged. A test naming the nine
 * names would be a third copy of the enumeration, and would pass unchanged on the day a tenth
 * category directory is added and starts being rewritten to `general` — which is exactly the
 * failure being fixed. `scripts/validate-category-enumerations.js` guards the same property from
 * the other side, by failing when a hardcoded list reappears under `src/`.
 */

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const PROMPTS_ROOT = path.join(SERVER_ROOT, 'resources', 'prompts');

const shippedCategories = (): string[] =>
  readdirSync(PROMPTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);

const createLogger = () =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) as unknown as Logger;

const extract = (prompt: unknown) => new CategoryExtractor(createLogger()).extractCategory(prompt);

describe('CategoryExtractor — the prompt declares its category (B.91)', () => {
  const categories = shippedCategories();

  /**
   * The positive control for the enumeration above: a run against an empty or unrecognisable
   * prompts root would make every `test.each` below vacuous, and `workflow` is the name that
   * demonstrates the defect — a real category directory, with three prompts and a gate scoped to
   * it, that the deleted allow-list did not contain.
   */
  test('the shipped prompts root is readable and holds the category the defect was measured on', () => {
    expect(categories.length).toBeGreaterThanOrEqual(3);
    expect(categories).toContain('workflow');
    expect(categories).toContain('examples');
  });

  test.each(categories)('a prompt in the shipped category "%s" keeps it', (category) => {
    const result = extract({ id: `probe_${category}`, category, file: `${category}/probe.md` });

    expect(result.category).toBe(category);
    expect(result.source).toBe('metadata');
  });

  test('a declared category is normalised, not validated', () => {
    expect(extract({ id: 'p', category: '  Codebase-Setup  ' }).category).toBe('codebase-setup');
  });

  test('a category no directory holds is still reported as declared', () => {
    // The loader stamps the directory name on every prompt it loads, so this shape reaches the
    // extractor only from a hand-built prompt object. Reporting it as given keeps selection and
    // render asking the same question; rewriting it to `general` is what B.91 was.
    expect(extract({ id: 'p', category: 'invented' }).category).toBe('invented');
  });
});

describe('CategoryExtractor — fallbacks, with nothing invented', () => {
  test('a prompt with no category takes the directory under the prompts root', () => {
    const result = extract({
      id: 'capture',
      file: '/srv/resources/prompts/knowledge-capture/capture/prompt.yaml',
    });

    expect(result.category).toBe('knowledge-capture');
    expect(result.source).toBe('path');
  });

  test('a file directly under the prompts root yields no category, not its own name', () => {
    const result = extract({ id: 'notes', file: '/srv/resources/prompts/notes.md' });

    expect(result.category).toBe('general');
    expect(result.source).toBe('fallback');
  });

  test('a path with no prompts segment is left to the declared category', () => {
    const result = extract({ id: 'notes', file: 'analysis/notes.md' });

    expect(result.category).toBe('general');
    expect(result.source).toBe('fallback');
  });

  /**
   * The deleted third strategy matched `^debug_|_debug$|troubleshoot` and six more patterns
   * against the prompt ID. Four of the seven names it could return name no category directory,
   * so a guessed category reproduced B.91's split for a prompt that declared nothing.
   */
  test('a prompt id that reads like a category no longer donates one', () => {
    expect(extract({ id: 'debug_application' }).category).toBe('general');
    expect(extract({ id: 'readme_documentation' }).category).toBe('general');
    expect(extract({ id: 'teach_learning' }).category).toBe('general');
  });

  test('a prompt object with nothing on it falls back rather than throwing', () => {
    expect(extract(undefined).category).toBe('general');
    expect(extract({}).source).toBe('fallback');
  });
});
