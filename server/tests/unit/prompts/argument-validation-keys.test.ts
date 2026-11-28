// @lifecycle canonical - An argument's `validation` block accepts the keys that are enforced and refuses every other key by name.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { validatePromptYaml } from '../../../src/modules/prompts/prompt-schema.js';
import { loadYamlPrompt } from '../../../src/modules/prompts/yaml-prompt-loader.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { YamlLoadContext } from '../../../src/modules/prompts/yaml-prompt-loader.js';

function promptWithValidation(validation: Record<string, unknown>) {
  return {
    id: 'validated',
    name: 'Validated',
    description: 'Carries an argument validation block',
    userMessageTemplate: 'Hello {{topic}}',
    arguments: [{ name: 'topic', type: 'string', validation }],
  };
}

const noop = (): void => undefined;
const logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
} as unknown as Logger;

function loadContext(): YamlLoadContext {
  return {
    logger,
    cache: new Map(),
    stats: { cacheHits: 0, cacheMisses: 0, loadErrors: 0 },
    enableCache: false,
    debug: false,
  };
}

describe('argument validation block keys', () => {
  it('accepts pattern, minLength and maxLength', () => {
    const result = validatePromptYaml(
      promptWithValidation({ pattern: '^a', minLength: 1, maxLength: 9 })
    );
    expect(result.valid).toBe(true);
    expect(result.data?.arguments[0]?.validation).toEqual({
      pattern: '^a',
      minLength: 1,
      maxLength: 9,
    });
  });

  it('refuses allowedValues, naming the key', () => {
    const result = validatePromptYaml(promptWithValidation({ allowedValues: ['low', 'high'] }));
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('validation.allowedValues');
  });

  it('refuses any other undeclared key, naming it', () => {
    const result = validatePromptYaml(promptWithValidation({ bogus: 1 }));
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('validation.bogus');
  });

  describe('through the file loader', () => {
    let root: string;

    beforeAll(() => {
      root = mkdtempSync(path.join(tmpdir(), 'argument-validation-keys-'));
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    function writePrompt(id: string, validationLines: string[]): string {
      const dir = path.join(root, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'prompt.yaml'),
        [
          `id: ${id}`,
          `name: ${id}`,
          'category: probe',
          'description: fixture',
          'userMessageTemplate: "Hello {{topic}}"',
          'arguments:',
          '  - name: topic',
          '    type: string',
          '    validation:',
          ...validationLines.map((line) => `      ${line}`),
          '',
        ].join('\n')
      );
      return dir;
    }

    it('loads a prompt whose validation block holds only enforced keys', () => {
      const dir = writePrompt('enforced_keys', ['pattern: "^a"', 'minLength: 1', 'maxLength: 9']);
      const loaded = loadYamlPrompt(dir, undefined, loadContext());
      expect(loaded?.promptData.arguments[0]?.validation).toEqual({
        pattern: '^a',
        minLength: 1,
        maxLength: 9,
      });
    });

    it('refuses a prompt that carries validation.allowedValues, naming the key and the file', () => {
      const dir = writePrompt('allowed_values', ['allowedValues: [low, high]']);
      const recorded: Array<{ error: string; path: string }> = [];
      const ctx: YamlLoadContext = {
        ...loadContext(),
        quarantine: {
          record: (entry: { error: string; path: string }) => recorded.push(entry),
        } as never,
      };
      expect(loadYamlPrompt(dir, undefined, ctx)).toBeNull();
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.error).toContain('validation.allowedValues');
      expect(recorded[0]?.path).toContain('allowed_values');
    });
  });
});
