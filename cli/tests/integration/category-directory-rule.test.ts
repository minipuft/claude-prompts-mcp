/**
 * The CLI's category rule matches the server's, and its prompts walk applies it (plan row P4.53).
 *
 * `cli/src/lib/workspace.ts` restates `isExcludedCategoryDirectoryName` from
 * `server/src/shared/utils/prompt-layout.ts`. The first block compares the two name by name, so a
 * change to either one alone fails here. The second block drives the real walk over twins that
 * differ only in the name the rule keys on, so an empty result cannot pass.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isExcludedCategoryDirectoryName as canonical } from '../../../server/src/shared/utils/prompt-layout.js';
import { discoverResourcePaths, isExcludedCategoryDirectoryName as mirror } from '../../src/lib/workspace.js';

const PROBE_NAMES = [
  'general',
  'tools',
  'backup',
  'backups',
  'node_modules',
  'node_module',
  '_drafts',
  'drafts',
  '.git',
  'git',
];

describe('category directory rule — cli mirror', () => {
  it.each(PROBE_NAMES)('answers %s as the server does', (name) => {
    expect(mirror(name)).toBe(canonical(name));
  });

  it('the probe covers both answers', () => {
    const answers = new Set(PROBE_NAMES.map((name) => canonical(name)));
    expect(answers).toEqual(new Set([true, false]));
  });
});

describe('discoverResourcePaths — excluded categories', () => {
  let root: string;

  const writePrompt = (category: string, id: string): void => {
    mkdirSync(join(root, category, id), { recursive: true });
    writeFileSync(join(root, category, id, 'prompt.yaml'), `id: ${id}\n`);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cpm-category-rule-'));
    writePrompt('backups', 'in_backups'); // twin of `backup`
    writePrompt('backup', 'in_backup');
    writePrompt('node_module', 'in_node_module'); // twin of `node_modules`
    writePrompt('node_modules', 'in_node_modules');
    writePrompt('drafts', 'in_drafts'); // twin of `_drafts`
    writePrompt('_drafts', 'in_hidden');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists each twin and nothing from an excluded category', () => {
    const ids = discoverResourcePaths(root, 'prompt.yaml', true)
      .map((entry) => entry.id)
      .sort();
    expect(ids).toEqual(['in_backups', 'in_drafts', 'in_node_module']);
  });

  it('applies no category rule to a flat layout', () => {
    for (const name of ['backup', 'backups']) {
      mkdirSync(join(root, 'flat', name), { recursive: true });
      writeFileSync(join(root, 'flat', name, 'gate.yaml'), `id: ${name}\n`);
    }
    const ids = discoverResourcePaths(join(root, 'flat'), 'gate.yaml', false)
      .map((entry) => entry.id)
      .sort();
    expect(ids).toEqual(['backup', 'backups']);
  });
});
