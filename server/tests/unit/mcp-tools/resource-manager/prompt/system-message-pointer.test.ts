/**
 * A `system_message`-only update on a prompt that has no system message writes the file AND the
 * `systemMessageFile:` pointer in one write, and a write whose files the yaml does not point at
 * records no version.
 *
 * WHAT WENT WRONG
 * `system-message.md` is not a `PROMPT_YAML_RESIDENT_KEYS` member, so `planPromptFiles` left
 * `prompt.yaml` unopened for a call supplying only `systemMessage`. For a prompt that already had
 * a pointer that is right; for one that never had a system message there was no pointer to leave
 * alone, so the file landed beside a yaml that did not name it, the loader kept serving "no
 * system message", and the receipt answered `post-write verification FAILED (mismatched:
 * systemMessage)` — after the version record had already been committed (measured 2026-10-18 on
 * 18 of 21 updates). Repeating the call with a yaml-resident key rewrote the yaml and succeeded.
 *
 * ASSERTIONS READ THE WRITTEN FILES AND THE LOADER, NOT THE PAYLOAD: the payload is correct in
 * the broken version too; the defect is what lands on disk beside it.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileOperations } from '../../../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import {
  loadYamlPrompt,
  type LoadedPromptFile,
  type YamlLoadContext,
} from '../../../../../src/modules/prompts/yaml-prompt-loader.js';
import { parseYamlOrThrow } from '../../../../../src/shared/utils/yaml/yaml-parser.js';

import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

const CATEGORY = 'general';

describe('a system_message-only update (row 3, R3)', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let logger: Logger;
  let operations: FileOperations;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-sysptr-'));
    promptsDir = join(workspaceDir, 'prompts');
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    operations = new FileOperations({
      logger,
      configManager: {
        getResolvedPromptsDirectory: () => promptsDir,
      } as unknown as ConfigManager,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 5 });
  });

  const promptDir = (id: string): string => join(promptsDir, CATEGORY, id);
  const readYamlText = (id: string): string =>
    readFileSync(join(promptDir(id), 'prompt.yaml'), 'utf8');
  const readYaml = (id: string): Record<string, unknown> =>
    parseYamlOrThrow<Record<string, unknown>>(readYamlText(id));

  function reload(id: string): LoadedPromptFile {
    const context: YamlLoadContext = {
      logger,
      cache: new Map(),
      stats: { cacheHits: 0, cacheMisses: 0, loadErrors: 0 },
      enableCache: false,
      debug: false,
    };
    const loaded = loadYamlPrompt(promptDir(id), undefined, context);
    if (loaded === null) throw new Error(`fixture ${id} did not load`);
    return loaded.loadedContent;
  }

  const base = (id: string): Record<string, unknown> => ({
    id,
    name: id,
    category: CATEGORY,
    description: 'Seed prompt.',
    userMessageTemplate: 'Body.',
  });

  /** The payload the processor builds for `update id:<id> system_message:<text>`. */
  const updateSystemMessageOnly = (
    id: string,
    text: string,
    commit?: () => Promise<void>
  ): ReturnType<FileOperations['updatePromptImplementation']> =>
    operations.updatePromptImplementation(
      { ...base(id), systemMessage: text },
      new Set(['systemMessage']),
      undefined,
      undefined,
      commit === undefined ? {} : { commit }
    );

  describe('on a prompt that has no system message', () => {
    const id = 'no_system_probe';

    beforeEach(async () => {
      await operations.updatePromptImplementation(base(id));
      expect(readYaml(id)['systemMessageFile']).toBeUndefined();
    });

    it('writes the pointer in the same write, so the loader serves the new message', async () => {
      await updateSystemMessageOnly(id, 'You are terse.');

      expect(readYaml(id)['systemMessageFile']).toBe('system-message.md');
      expect(readFileSync(join(promptDir(id), 'system-message.md'), 'utf8')).toBe('You are terse.');
      expect(reload(id).systemMessage).toBe('You are terse.');
    });

    it('runs the version commit exactly once, after the pointer is on disk', async () => {
      let pointerAtCommit: unknown;
      const commit = jest.fn(async () => {
        pointerAtCommit = readYaml(id)['systemMessageFile'];
      });

      await updateSystemMessageOnly(id, 'You are terse.', commit);

      expect(commit).toHaveBeenCalledTimes(1);
      expect(pointerAtCommit).toBe('system-message.md');
    });
  });

  describe('control: a prompt that already has a system message', () => {
    const id = 'has_system_probe';

    beforeEach(async () => {
      await operations.updatePromptImplementation({ ...base(id), systemMessage: 'Original.' });
    });

    it('leaves prompt.yaml byte-identical — the narrowed write scope is unchanged', async () => {
      const before = readYamlText(id);

      await updateSystemMessageOnly(id, 'Replaced.');

      expect(readYamlText(id)).toBe(before);
      expect(reload(id).systemMessage).toBe('Replaced.');
    });
  });

  describe('planted defect: a message file the yaml does not point at', () => {
    const id = 'planted_probe';

    beforeEach(async () => {
      await operations.updatePromptImplementation(base(id));
    });

    it('is refused inside the transaction: no commit, files restored', async () => {
      // The pre-fix writer, planted: the yaml is built without the pointer.
      const buildYaml = jest
        .spyOn(
          operations as unknown as { buildPromptYamlData: (...args: unknown[]) => unknown },
          'buildPromptYamlData'
        )
        .mockImplementation(() => ({
          id,
          name: id,
          description: 'Seed prompt.',
          userMessageTemplateFile: 'user-message.md',
        }));
      const yamlBefore = readYamlText(id);
      const commit = jest.fn(async () => undefined);

      await expect(updateSystemMessageOnly(id, 'You are terse.', commit)).rejects.toThrow(
        /message_file_unreferenced|systemMessageFile/
      );

      expect(buildYaml).toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(readYamlText(id)).toBe(yamlBefore);
      expect(readdirSync(promptDir(id))).not.toContain('system-message.md');
    });
  });
});
