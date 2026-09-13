// @lifecycle test - Unit test for the shared single-file-prompt filename rule (plan row P4.22)
/**
 * The enumeration that closes the class.
 *
 * Three walks ask "is this file a prompt?" — the loader (which defines the served catalog),
 * `ResourceIndexer`, and `compareResourceBaseline` — and before this rule was shared they
 * disagreed. The baseline walk excluded only a leading `_`, so the shipped
 * `resources/prompts/guidance/category.yaml` was announced at every startup as an addition of a
 * prompt with the id `category`; the indexer skipped file entries outright and indexed no
 * single-file prompt at all.
 *
 * Each of those walks has its own integration test for the behaviour an operator sees. This file
 * holds the enumeration itself: every reserved name, named once, so that adding a fifth is a
 * change to a list rather than a change to three `if` chains that only look alike.
 *
 * Classification: Unit (pure predicate, no filesystem).
 */

import { describe, expect, it } from '@jest/globals';

import {
  isSingleFilePromptName,
  singleFilePromptBaseName,
} from '../../../src/shared/utils/prompt-layout.js';

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
