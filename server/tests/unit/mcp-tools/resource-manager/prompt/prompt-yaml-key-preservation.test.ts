/**
 * P4.57 — an `update` that changes one `prompt.yaml` key must leave every other key alone.
 *
 * WHAT WENT WRONG
 * A `resource_manager` `update` patching only `description` on `development/strategic_worker`
 * rebuilt `prompt.yaml` from the fields the writer models and serialized that, so the file lost
 * (1) its top-level `artifacts:` block — the writer had no field for it —, (2) a comment,
 * (3) the authored key order inside `arguments`, and (4) the authored layout of keys it was not
 * asked to change. P1.2 fixed the same shape at the FILE level (a write carries the resource's
 * whole subtree); this is that shape one level down, at the KEY level.
 *
 * WHY THE FIXTURE IS HAND-AUTHORED
 * A file seeded through the writer already has the writer's shape, so an update over it can only
 * prove idempotence. Every fixture below is written as text, with the things a writer normalizes
 * away: a comment, flow style, and key orders the writer would not produce.
 *
 * WHY promptData IS BUILT THROUGH THE LOADER
 * The processor hands the writer `canonicalPromptSnapshot(loadedPrompt)` plus the patch. Building
 * the same payload here, rather than writing one by hand, means a key the loaded prompt does not
 * carry is absent from the payload exactly as it is in production — which is the whole defect.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileOperations } from '../../../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { canonicalPromptSnapshot } from '../../../../../src/mcp/tools/resource-manager/prompt/utils/validation.js';
import { PromptYamlSchema } from '../../../../../src/modules/prompts/prompt-schema.js';
import {
  loadYamlPrompt,
  type YamlLoadContext,
} from '../../../../../src/modules/prompts/yaml-prompt-loader.js';
import { parseYamlOrThrow } from '../../../../../src/shared/utils/yaml/yaml-parser.js';

import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

const CATEGORY = 'general';

describe('prompt.yaml keys survive an update that did not name them (P4.57)', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let logger: Logger;
  let operations: FileOperations;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-yamlkeep-'));
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

  function writeFixture(id: string, promptYaml: string): void {
    mkdirSync(promptDir(id), { recursive: true });
    writeFileSync(yamlPath(id), promptYaml, 'utf8');
    writeFileSync(join(promptDir(id), 'user-message.md'), 'Work on {{files}}.\n', 'utf8');
  }

  /** `resource_manager update id:<id> description:<text>` — the payload the processor builds. */
  async function updateDescriptionOnly(id: string, description: string): Promise<void> {
    const ctx: YamlLoadContext = {
      logger,
      cache: new Map(),
      stats: { cacheHits: 0, cacheMisses: 0, loadErrors: 0 },
      enableCache: false,
      debug: false,
    };
    const loaded = loadYamlPrompt(promptDir(id), undefined, ctx);
    if (loaded === null) throw new Error(`fixture ${id} did not load`);
    // The registry's prompt is the loader's metadata with its message files inlined, which is
    // what `loadedContent` carries.
    const promptData = {
      ...canonicalPromptSnapshot(id, {
        ...loaded.promptData,
        ...loaded.loadedContent,
        category: CATEGORY,
      }),
      tools: undefined,
      description,
    };
    const result = await operations.updatePromptImplementation(
      promptData,
      new Set(['description'])
    );
    expect(result.message).not.toMatch(/fail|error/i);
  }

  const readYaml = (id: string): Record<string, unknown> =>
    parseYamlOrThrow<Record<string, unknown>>(readFileSync(yamlPath(id), 'utf8'));

  describe('the strategic_worker shape', () => {
    const id = 'keep_probe';
    // Deliberate: a comment, a flow-style mapping, a top-level order the writer does not use
    // (`category` last, `artifacts` before `arguments`), argument keys in reverse of the
    // converter's order, and a long plain scalar js-yaml would fold at 80 columns.
    const AUTHORED = [
      '# Hand-authored. An update that did not name a key must not touch it.',
      'id: keep_probe',
      'name: Keep Probe',
      'description: Original description.',
      'userMessageTemplateFile: user-message.md',
      'artifacts: { fromArgument: files, produces: [source] }',
      'arguments:',
      '  - required: true',
      '    type: string',
      '    description: Every path this run is about to touch, one per line, relative to the repository root.',
      '    name: files',
      'category: general',
      '',
    ].join('\n');

    beforeEach(() => writeFixture(id, AUTHORED));

    it('applies the description it was asked to change', async () => {
      await updateDescriptionOnly(id, 'Patched description.');

      expect(readYaml(id)['description']).toBe('Patched description.');
    });

    it('(1) keeps the top-level artifacts declaration', async () => {
      await updateDescriptionOnly(id, 'Patched description.');

      expect(readYaml(id)['artifacts']).toEqual({ fromArgument: 'files', produces: ['source'] });
    });

    it('(3) keeps the authored key order inside each argument', async () => {
      await updateDescriptionOnly(id, 'Patched description.');

      const [argument] = readYaml(id)['arguments'] as Array<Record<string, unknown>>;
      expect(Object.keys(argument ?? {})).toEqual(['required', 'type', 'description', 'name']);
    });

    it('(3) keeps the authored top-level key order', async () => {
      await updateDescriptionOnly(id, 'Patched description.');

      expect(Object.keys(readYaml(id))).toEqual([
        'id',
        'name',
        'description',
        'userMessageTemplateFile',
        'artifacts',
        'arguments',
        'category',
      ]);
    });

    /**
     * CLOSED 2026-09-20 (row P4.64). This was `it.failing` while the writer re-serialized a
     * parsed object through `js-yaml`, which discards (2) the comment and (4) the folded long
     * scalar and flow-style `artifacts` before the writer ever sees them.
     *
     * `yaml` is now a declared dependency and the writer edits the file's own source tokens, so
     * the marker flipped exactly as it said it would and this is an ordinary assertion again.
     */
    it('(2)(4) leaves every line it was not asked to change byte-identical', async () => {
      await updateDescriptionOnly(id, 'Patched description.');

      expect(readFileSync(yamlPath(id), 'utf8')).toBe(
        AUTHORED.replace('Original description.', 'Patched description.')
      );
    });
  });

  /**
   * The class, not the instance: EVERY key `PromptYamlSchema` accepts survives an update that did
   * not name it, plus one key the schema only passes through. The seed table is checked against
   * the schema's own shape first, so a key added to the schema without a seed value here fails
   * this file instead of being silently uncovered — the list is derived, not remembered.
   */
  describe('every key the schema accepts', () => {
    const id = 'every_key';

    /** Inline-content keys: a directory prompt declares the `*File` pointer instead. */
    const NOT_CO_DECLARABLE: Record<string, string> = {
      systemMessage: 'inline alternative to systemMessageFile, which this fixture declares',
      userMessageTemplate:
        'inline alternative to userMessageTemplateFile, which this fixture declares',
    };

    const SEEDS: Record<string, string> = {
      id: `id: ${id}`,
      name: 'name: Every Key',
      category: `category: ${CATEGORY}`,
      description: 'description: Original description.',
      systemMessageFile: 'systemMessageFile: system-message.md',
      userMessageTemplateFile: 'userMessageTemplateFile: user-message.md',
      arguments: 'arguments:\n  - name: files\n    type: string\n    required: false',
      composer: 'composer:\n  inputArgument: files',
      gateConfiguration: 'gateConfiguration:\n  include: [code-quality]',
      artifacts: 'artifacts:\n  fromArgument: files',
      injection: 'injection:\n  system-prompt:\n    enabled: false',
      chainSteps: [
        'chainSteps:',
        '  - id: first',
        '    promptId: step_a',
        '    stepName: First',
        '  - id: second',
        '    promptId: step_b',
        '    stepName: Second',
      ].join('\n'),
      edges: 'edges:\n  - from: first\n    to: second',
      budget: 'budget:\n  maxNodes: 4',
      registerWithMcp: 'registerWithMcp: false',
      mcpPromptMode: 'mcpPromptMode: launch',
      tools: 'tools: [probe_tool]',
      subagentModel: 'subagentModel: fast',
      agentType: 'agentType: general-purpose',
    };

    /** The schema is `.passthrough()`, so an unknown key loads — and must survive a write too. */
    const PASSTHROUGH_SEED = 'x-authorNote: kept by whoever wrote it';

    it('seeds every schema key, or says why it cannot', () => {
      const schemaKeys = Object.keys(PromptYamlSchema.shape).sort();
      const covered = [...Object.keys(SEEDS), ...Object.keys(NOT_CO_DECLARABLE)].sort();

      expect(covered).toEqual(schemaKeys);
    });

    it.each([...Object.keys(SEEDS), 'x-authorNote'])(
      'keeps %s through a description-only update',
      async (key) => {
        writeFixture(id, `${[...Object.values(SEEDS), PASSTHROUGH_SEED].join('\n')}\n`);
        writeFileSync(join(promptDir(id), 'system-message.md'), 'System.\n', 'utf8');
        const before = readYaml(id);

        await updateDescriptionOnly(id, 'Patched description.');

        const after = readYaml(id);
        if (key === 'description') {
          expect(after[key]).toBe('Patched description.');
        } else {
          expect(after[key]).toEqual(before[key]);
        }
      }
    );
  });
});
