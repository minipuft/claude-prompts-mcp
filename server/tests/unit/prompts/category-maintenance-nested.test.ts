/**
 * findYamlPromptInCategory — nested-prompt resolution.
 *
 * Regression guard for the delete-path sibling of the nested-id writer defect:
 * the one-level category scan cannot see {category}/{parent}/{child}/prompt.yaml,
 * so qualified ids must resolve by direct path.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { findYamlPromptInCategory } from '#modules/prompts/category-maintenance.js';

describe('findYamlPromptInCategory — nested ids', () => {
  let categoryDir: string;

  beforeEach(() => {
    categoryDir = mkdtempSync(path.join(tmpdir(), 'category-maintenance-'));
    // Flat directory-format prompt: {category}/parent_chain/prompt.yaml
    mkdirSync(path.join(categoryDir, 'parent_chain'));
    writeFileSync(path.join(categoryDir, 'parent_chain', 'prompt.yaml'), 'id: parent_chain\n');
    // Nested directory-format prompt: {category}/parent_chain/child_step/prompt.yaml
    mkdirSync(path.join(categoryDir, 'parent_chain', 'child_step'));
    writeFileSync(
      path.join(categoryDir, 'parent_chain', 'child_step', 'prompt.yaml'),
      'id: child_step\n'
    );
  });

  afterEach(() => {
    rmSync(categoryDir, { recursive: true, force: true });
  });

  it('resolves a flat id via the directory scan (unchanged behavior)', () => {
    const found = findYamlPromptInCategory(categoryDir, 'parent_chain');
    expect(found).not.toBeNull();
    expect(found?.format).toBe('directory');
    expect(found?.path).toBe(path.join(categoryDir, 'parent_chain'));
  });

  it('resolves a nested qualified id by direct path', () => {
    const found = findYamlPromptInCategory(categoryDir, 'parent_chain/child_step');
    expect(found).not.toBeNull();
    expect(found?.format).toBe('directory');
    expect(found?.id).toBe('parent_chain/child_step');
    expect(found?.path).toBe(path.join(categoryDir, 'parent_chain', 'child_step'));
  });

  it('returns null for a nested id that does not exist', () => {
    expect(findYamlPromptInCategory(categoryDir, 'parent_chain/missing_step')).toBeNull();
  });

  it('rejects traversal segments in qualified ids', () => {
    expect(findYamlPromptInCategory(categoryDir, '../outside/prompt')).toBeNull();
    expect(findYamlPromptInCategory(categoryDir, 'parent_chain/../parent_chain')).toBeNull();
    expect(findYamlPromptInCategory(categoryDir, 'parent_chain//child_step')).toBeNull();
  });
});
