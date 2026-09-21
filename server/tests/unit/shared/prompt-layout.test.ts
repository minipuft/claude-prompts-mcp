// @lifecycle test - Unit test for the shared prompt layout rules (plan rows P4.22, P4.28)
/**
 * The enumeration that closes the class.
 *
 * Three walks ask what a prompt is — the loader (which defines the served catalog),
 * `ResourceIndexer`, and `compareResourceBaseline` — and before these rules were shared they
 * disagreed, in two rounds. On FILENAMES (P4.22): the baseline walk excluded only a leading `_`,
 * so the shipped `resources/prompts/guidance/category.yaml` was announced at every startup as an
 * addition of a prompt with the id `category`, while the indexer skipped file entries outright and
 * indexed no single-file prompt at all. On LOCATION AND ID (P4.28): the baseline walk stopped
 * descending at any directory holding `prompt.yaml`, so the 15 step prompts that ship below that
 * line reached it as nothing at all — and reaching them under their own directory name rather than
 * the loader's qualified `chain/step` would have traded that absence for a disagreement.
 *
 * Each of those walks has its own integration test for the behaviour an operator sees. This file
 * holds the enumerations themselves: every reserved name and every declined position, named once,
 * so that adding one is a change to a list rather than a change to three `if` chains that only
 * look alike.
 *
 * Classification: Unit (pure predicates, no filesystem — the paths below are strings).
 */

import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  isIgnoredPromptEntryName,
  isReservedPromptDirectoryName,
  isSingleFilePromptName,
  promptIdFromDirectory,
  promptIdFromSingleFile,
  singleFilePromptBaseName,
} from '../../../src/shared/utils/prompt-layout.js';

const ROOT = join('srv', 'resources', 'prompts');

describe('isSingleFilePromptName', () => {
  it.each(['prompt.yaml', 'prompts.yaml', 'category.yaml', 'tool.yaml'])(
    'refuses the reserved name %s',
    (name) => {
      expect(isSingleFilePromptName(name)).toBe(false);
    }
  );

  it.each(['_draft.yaml', '.hidden.yaml'])('refuses the skipped prefix in %s', (name) => {
    expect(isSingleFilePromptName(name)).toBe(false);
  });

  it.each(['guidance.md', 'script.py', 'notes.txt', 'config.yml'])(
    'refuses %s, which is not a YAML prompt file',
    (name) => {
      // `.yml` is refused deliberately: the loader accepts `.yaml` only, so accepting it here
      // would make the index promise an id `prompt_engine` cannot answer.
      expect(isSingleFilePromptName(name)).toBe(false);
    }
  );

  it.each(['analysis.yaml', 'deep_analysis.yaml', 'category_review.yaml', 'tools.yaml'])(
    'accepts %s',
    (name) => {
      // The last two are the positive control for the reserved list being matched WHOLE rather
      // than by prefix or substring — `category_review` and `tools` are ordinary prompt ids.
      expect(isSingleFilePromptName(name)).toBe(true);
    }
  );
});

describe('singleFilePromptBaseName', () => {
  it('drops the extension and nothing else', () => {
    expect(singleFilePromptBaseName('deep_analysis.yaml')).toBe('deep_analysis');
    expect(singleFilePromptBaseName('a.yaml.yaml')).toBe('a.yaml');
  });
});

describe('isIgnoredPromptEntryName', () => {
  it.each(['_drafts', '.git', '_draft.yaml', '.hidden.yaml'])('skips %s', (name) => {
    expect(isIgnoredPromptEntryName(name)).toBe(true);
  });

  it.each(['tools', 'deep_analysis', 'implementation_plan'])('does not skip %s', (name) => {
    // The positive control for the prefix being a PREFIX: an id containing an underscore is
    // ordinary, and a walk that matched anywhere in the name would skip most of the shipped tree.
    expect(isIgnoredPromptEntryName(name)).toBe(false);
  });
});

/**
 * THE RESERVED DIRECTORY (P4.33/P4.32).
 *
 * `tools/` was documented reserved in the shared module while only `ResourceIndexer` enforced it,
 * from a literal of its own. The two walks that did not — the loader and the startup baseline —
 * served and announced `{prompt}/tools/{toolId}` as a prompt id, which is the id a script tool
 * already answers to.
 */
describe('isReservedPromptDirectoryName', () => {
  it('reserves a prompt directory\u2019s tools/', () => {
    expect(isReservedPromptDirectoryName('tools')).toBe(true);
  });

  it.each(['tool', 'toolsy', 'my_tools', 'helpers', 'step_one'])('does not reserve %s', (name) => {
    // Whole-name match, not prefix or substring: `tools` appears inside ordinary prompt ids, and
    // a looser rule would un-serve real prompts.
    expect(isReservedPromptDirectoryName(name)).toBe(false);
  });

  it('matches case exactly, as the script tool loader does', () => {
    // `ScriptDefinitionLoader` reads `join(promptDir, 'tools', id)` — an exact-case segment — so a
    // case-insensitive rule here would reserve a directory that loader never looks in.
    expect(isReservedPromptDirectoryName('TOOLS')).toBe(false);
  });
});

/**
 * WHERE A PROMPT MAY SIT AND WHAT IT IS CALLED (P4.28).
 *
 * The category is the first segment below the root and is never part of the id; everything below
 * it is. A directory that holds `prompt.yaml` is a prompt AND a container, which is the rule the
 * startup baseline walk contradicted — it stopped descending there, and 15 shipped step prompts
 * sit below that line.
 */
describe('promptIdFromDirectory', () => {
  it('drops the category and keeps everything below it', () => {
    expect(promptIdFromDirectory(ROOT, join(ROOT, 'examples', 'deep_analysis'))).toBe(
      'deep_analysis'
    );
    expect(promptIdFromDirectory(ROOT, join(ROOT, 'examples', 'deep_analysis', 'deep_dive'))).toBe(
      'deep_analysis/deep_dive'
    );
  });

  it('joins with a forward slash whatever the platform separator is', () => {
    // The id is a wire value — `>>chain/step`, a `resource_changes` key — not a path, so a
    // Windows walk must produce the same string a POSIX one does.
    expect(promptIdFromDirectory(ROOT, join(ROOT, 'a', 'b', 'c'))).toBe('b/c');
  });

  it('declines a directory directly under the root, which is a category and not a prompt', () => {
    expect(promptIdFromDirectory(ROOT, join(ROOT, 'examples'))).toBeUndefined();
  });

  it('declines the root itself and anything outside it', () => {
    expect(promptIdFromDirectory(ROOT, ROOT)).toBeUndefined();
    expect(promptIdFromDirectory(ROOT, join('srv', 'resources', 'gates', 'shell-verify'))).toBe(
      undefined
    );
  });
});

describe('promptIdFromSingleFile', () => {
  it('qualifies a nested single-file prompt exactly as the directory form is qualified', () => {
    expect(promptIdFromSingleFile(ROOT, join(ROOT, 'examples', 'inline.yaml'))).toBe('inline');
    expect(promptIdFromSingleFile(ROOT, join(ROOT, 'examples', 'chain', 'step.yaml'))).toBe(
      'chain/step'
    );
  });

  it('declines a reserved filename wherever it sits', () => {
    // The filename question and the location question, answered in one call so a caller cannot
    // ask one and forget the other.
    expect(promptIdFromSingleFile(ROOT, join(ROOT, 'guidance', 'category.yaml'))).toBeUndefined();
    expect(
      promptIdFromSingleFile(ROOT, join(ROOT, 'examples', 'demo', 'tools', 'wc', 'tool.yaml'))
    ).toBeUndefined();
  });

  it('declines a YAML file at the prompts root, which no loader serves', () => {
    expect(promptIdFromSingleFile(ROOT, join(ROOT, 'stray.yaml'))).toBeUndefined();
  });
});
