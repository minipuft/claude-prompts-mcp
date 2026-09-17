/**
 * discoverYamlPromptsInCategory skips what the loader skips (plan row P4.48).
 *
 * The scan is one level deep, so a prompt's own `tools/` was out of its reach, and its private copy
 * of the skip rules looked harmless. That copy still disagreed with the loader: it listed a
 * `_`-prefixed file, `tool.yaml`, and a `tools/` or `_drafts/` directory holding a `prompt.yaml`.
 * The loader serves none of those. Every skipped entry has a twin that differs only in the name the
 * rule keys on, so an empty result cannot pass.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { discoverYamlPromptsInCategory } from '#modules/prompts/category-maintenance.js';

import { testScratchPath } from '../../helpers/scratch-path.js';

describe('discoverYamlPromptsInCategory — shared skip rules', () => {
  let categoryDir: string;

  const directoryPrompt = (name: string): void => {
    mkdirSync(path.join(categoryDir, name), { recursive: true });
    writeFileSync(path.join(categoryDir, name, 'prompt.yaml'), `id: ${name}\n`);
  };
  const filePrompt = (name: string): void => {
    writeFileSync(path.join(categoryDir, name), 'id: x\n');
  };

  beforeEach(() => {
    categoryDir = testScratchPath('category-maintenance-skip-rules');
    mkdirSync(categoryDir, { recursive: true });
    directoryPrompt('toolbox'); // twin of the reserved `tools`
    directoryPrompt('tools');
    directoryPrompt('drafts'); // twin of the ignored `_drafts`
    directoryPrompt('_drafts');
    filePrompt('loose.yaml'); // twin of the ignored `_loose.yaml`
    filePrompt('_loose.yaml');
    filePrompt('toolkit.yaml'); // twin of the reserved `tool.yaml`
    filePrompt('tool.yaml');
  });

  afterEach(() => {
    rmSync(categoryDir, { recursive: true, force: true });
  });

  it('lists each served twin and none of the skipped entries', () => {
    const ids = discoverYamlPromptsInCategory(categoryDir)
      .map((prompt) => prompt.id)
      .sort();
    expect(ids).toEqual(['drafts', 'loose', 'toolbox', 'toolkit']);
  });
});
