/**
 * P4.66 — a `user_message_template` patch/update on a prompt whose `prompt.yaml` declares the
 * template INLINE (no `*File` pointer) must change what the prompt renders.
 *
 * WHAT WENT WRONG
 * `userMessageTemplate` is not a `PROMPT_YAML_RESIDENT_KEYS` member — its text lives in its own
 * file for every prompt the writer itself produces — so `planPromptFiles`'s `writesYaml` gate
 * left `prompt.yaml` untouched for a call that supplied only `userMessageTemplate`. That is
 * correct for the ordinary (file-pointer) shape, but a hand-authored prompt that declares the
 * template inline has no pointer for the write to leave alone: the write rewrote
 * `user-message.md` with the new text, `prompt.yaml` kept its stale inline value, and the loader
 * (`yaml-prompt-loader.ts`: `userMessageTemplateFile` wins when present, else the inline
 * `userMessageTemplate`) kept rendering the OLD text. Found by the P4.57 worker, confirmed by a
 * live drive (see the P4.59/P4.66 worker handoff) before this regression test was written.
 *
 * THE FIX
 * `planPromptFiles` now also opens `prompt.yaml` when a supplied `userMessageTemplate`/
 * `systemMessage` finds the CURRENT file declaring that field inline. `overlayDecidedYamlKeys`
 * (already shared with the gate/category writers) then does the rest: `buildPromptYamlData`
 * always emits the `*File` pointer once it touches the yaml, so the inline key — never present in
 * its output — is deleted by the overlay's own "decided but unwritten" rule. This mirrors what
 * the writer already does for `systemMessage` (`buildPromptYamlData` never emits an inline
 * `systemMessage` key either): the design choice is "move to file", not "keep inline".
 *
 * WHY THE FIXTURES ARE HAND-AUTHORED
 * A file seeded through the writer already has file-pointer shape, so an update over it can only
 * prove the (already-passing) file-pointer twin. The inline fixture below is written as text,
 * the one shape the writer itself never produces.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileOperations } from '../../../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { canonicalPromptSnapshot } from '../../../../../src/modules/versioning/projections/prompt-snapshot.js';
import {
  loadYamlPrompt,
  type LoadedPromptFile,
  type YamlLoadContext,
} from '../../../../../src/modules/prompts/yaml-prompt-loader.js';
import { parseYamlOrThrow } from '../../../../../src/shared/utils/yaml/yaml-parser.js';

import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

const CATEGORY = 'general';

describe('a userMessageTemplate patch on an inline-form prompt (P4.66)', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let logger: Logger;
  let operations: FileOperations;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-inlinepatch-'));
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
    rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 5 });
  });

  const promptDir = (id: string): string => join(promptsDir, CATEGORY, id);
  const yamlPath = (id: string): string => join(promptDir(id), 'prompt.yaml');
  const readYaml = (id: string): Record<string, unknown> =>
    parseYamlOrThrow<Record<string, unknown>>(readFileSync(yamlPath(id), 'utf8'));

  function loadContext(): YamlLoadContext {
    return {
      logger,
      cache: new Map(),
      stats: { cacheHits: 0, cacheMisses: 0, loadErrors: 0 },
      enableCache: false,
      debug: false,
    };
  }

  function reload(id: string): { promptData: unknown; loadedContent: LoadedPromptFile } {
    const loaded = loadYamlPrompt(promptDir(id), undefined, loadContext());
    if (loaded === null) throw new Error(`fixture ${id} did not load`);
    return loaded;
  }

  /** `resource_manager update id:<id> user_message_template:<text>` — the payload the processor builds. */
  async function patchUserMessageTemplate(id: string, template: string): Promise<void> {
    const loaded = reload(id);
    const promptData = {
      ...canonicalPromptSnapshot(id, {
        ...(loaded.promptData as Record<string, unknown>),
        ...loaded.loadedContent,
        category: CATEGORY,
      }),
      tools: undefined,
      userMessageTemplate: template,
    };
    const result = await operations.updatePromptImplementation(
      promptData,
      new Set(['userMessageTemplate'])
    );
    expect(result.message).not.toMatch(/fail|error/i);
  }

  describe('hand-authored with an inline userMessageTemplate (no file pointer)', () => {
    const id = 'inline_probe';
    // Deliberately not writer-shaped: a comment, and an inline `userMessageTemplate:` key with
    // no `userMessageTemplateFile` pointer — the one shape the writer itself never produces.
    const AUTHORED = [
      '# Hand-authored. Declares the template inline, with no file pointer.',
      'id: inline_probe',
      'name: Inline Probe',
      'description: Says hello, inline.',
      'userMessageTemplate: "Hello, {{name}}. Original."',
      'category: general',
      '',
    ].join('\n');

    beforeEach(() => {
      mkdirSync(promptDir(id), { recursive: true });
      writeFileSync(yamlPath(id), AUTHORED, 'utf8');
    });

    it('renders the patched text after the patch — the falsifier this row exists to fix', async () => {
      await patchUserMessageTemplate(id, 'Hello, {{name}}. Patched.');

      const loaded = reload(id);
      expect(loaded.loadedContent.userMessageTemplate).toBe('Hello, {{name}}. Patched.');
    });

    it('moves the template to file form: pointer set, inline key removed, file written', async () => {
      await patchUserMessageTemplate(id, 'Hello, {{name}}. Patched.');

      const yaml = readYaml(id);
      expect(yaml['userMessageTemplateFile']).toBe('user-message.md');
      expect(yaml['userMessageTemplate']).toBeUndefined();
      expect(readFileSync(join(promptDir(id), 'user-message.md'), 'utf8')).toBe(
        'Hello, {{name}}. Patched.'
      );
    });

    it('keeps every other authored key untouched by the conversion', async () => {
      await patchUserMessageTemplate(id, 'Hello, {{name}}. Patched.');

      const yaml = readYaml(id);
      expect(yaml['description']).toBe('Says hello, inline.');
      expect(yaml['name']).toBe('Inline Probe');
    });
  });

  describe('twin: a file-pointer prompt behaves exactly as before', () => {
    const id = 'file_probe';
    const AUTHORED = [
      '# Hand-authored. Declares the template via a file pointer already.',
      'id: file_probe',
      'name: File Probe',
      'description: Says hello, from a file.',
      'userMessageTemplateFile: user-message.md',
      'category: general',
      '',
    ].join('\n');

    beforeEach(() => {
      mkdirSync(promptDir(id), { recursive: true });
      writeFileSync(yamlPath(id), AUTHORED, 'utf8');
      writeFileSync(join(promptDir(id), 'user-message.md'), 'Hello, {{name}}. Original.\n', 'utf8');
    });

    it('renders the patched text after the patch', async () => {
      await patchUserMessageTemplate(id, 'Hello, {{name}}. Patched.');

      const loaded = reload(id);
      expect(loaded.loadedContent.userMessageTemplate).toBe('Hello, {{name}}. Patched.');
    });

    it('leaves prompt.yaml byte-identical — the write-scope table this fix must not break', async () => {
      const before = readFileSync(yamlPath(id), 'utf8');

      await patchUserMessageTemplate(id, 'Hello, {{name}}. Patched.');

      expect(readFileSync(yamlPath(id), 'utf8')).toBe(before);
    });
  });
});
