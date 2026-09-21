/**
 * P4.67 — a `category.yaml` update that changes one key must leave every other key alone,
 * including one `CategorySchema` does not declare at all.
 *
 * WHAT WENT WRONG
 * `CategorySchema` has no explicit `.passthrough()`, but its default Zod "strip" parse mode never
 * REJECTS an unrecognized key — `validateCategorySchema` only checks `.success`, never `.data` —
 * so a hand-authored `category.yaml` may carry one and the writer's own post-write verification
 * accepts it. `CategoryFileWriter.buildCategoryYaml` rebuilt the document from an empty object
 * populated only with the three required fields plus `PRESERVED_CATEGORY_YAML_KEYS` (P4.7), so a
 * key neither list names had no path onto that object and a description-only update deleted it.
 *
 * WHY THE FIXTURE IS HAND-AUTHORED
 * A file seeded through `CategoryFileWriter` already has the writer's own key order, so an update
 * over it can only prove idempotence. The fixture below is written as YAML text with a key order
 * the writer would not produce, plus a key the schema never declares.
 *
 * `writeCategoryFiles` takes no `suppliedKeys` — a category write has one file and nothing to
 * narrow to (`CategoryFileWriter`'s own doc comment) — so "an update that named only description"
 * here means a call that repeats `id`/`name` unchanged and omits the two optional fields, relying
 * on `resolvePreservedCategoryYamlFields`'s on-disk fallback for those exactly as
 * `CategoryLifecycleProcessor`'s own update path does.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CategoryFileWriter } from '../../../../src/mcp/tools/category-manager/services/category-file-writer.js';
import { CategorySchema } from '../../../../src/modules/prompts/prompt-schema.js';
import { parseYamlOrThrow } from '../../../../src/shared/utils/yaml/yaml-parser.js';

import type { ConfigManager, Logger } from '../../../../src/shared/types/index.js';

describe('category.yaml keys survive an update that did not name them (P4.67)', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let logger: Logger;
  let configManager: ConfigManager;
  let writer: CategoryFileWriter;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-category-yamlkeep-'));
    promptsDir = join(workspaceDir, 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    logger = {
      info: (): void => undefined,
      warn: (): void => undefined,
      error: (): void => undefined,
      debug: (): void => undefined,
    } as unknown as Logger;
    configManager = {
      getResolvedPromptsDirectory: () => promptsDir,
      getBundledResourceDirectory: () => undefined,
      getOverlayResourceDirectories: () => [],
    } as unknown as ConfigManager;
    writer = new CategoryFileWriter({ logger, configManager });
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 5 });
  });

  const categoryDir = (id: string): string => join(promptsDir, id);
  const yamlPath = (id: string): string => join(categoryDir(id), 'category.yaml');

  function writeFixture(id: string, categoryYaml: string): void {
    mkdirSync(categoryDir(id), { recursive: true });
    writeFileSync(yamlPath(id), categoryYaml, 'utf8');
  }

  const readYaml = (id: string): Record<string, unknown> =>
    parseYamlOrThrow<Record<string, unknown>>(readFileSync(yamlPath(id), 'utf8'));

  describe('the hand-authored shape', () => {
    const id = 'keep_probe';
    // Deliberate: a passthrough key the schema never declares, and a top-level order the writer
    // does not use (`mcpPromptMode` before `name`, `registerWithMcp` last).
    const AUTHORED = [
      'id: keep_probe',
      'mcpPromptMode: launch',
      'name: Keep Probe',
      'x-authorNote: kept by whoever wrote it',
      'description: Original description.',
      'registerWithMcp: false',
      '',
    ].join('\n');

    beforeEach(() => writeFixture(id, AUTHORED));

    async function updateDescriptionOnly(description: string): Promise<void> {
      const result = await writer.writeCategoryFiles({ id, name: 'Keep Probe', description });
      expect(result.success).toBe(true);
    }

    it('applies the description it was asked to change', async () => {
      await updateDescriptionOnly('Patched description.');

      expect(readYaml(id)['description']).toBe('Patched description.');
    });

    // MUTATION TARGET: reverting `planCategoryWrite` to
    // `serializeYaml(this.buildCategoryYaml(...))` (dropping the `overlayDecidedYamlKeys` wrap)
    // turns this red — `x-authorNote` has no field anywhere in `CategoryCreationData` or
    // `PRESERVED_CATEGORY_YAML_KEYS`, so nothing else carries it.
    it('keeps the passthrough key the schema does not declare', async () => {
      await updateDescriptionOnly('Patched description.');

      expect(readYaml(id)['x-authorNote']).toBe('kept by whoever wrote it');
    });

    // Contrast case: already covered by `PRESERVED_CATEGORY_YAML_KEYS` (P4.7) and stays green even
    // with the mutation above reverted — read against a schema-declared key that already worked.
    it('keeps the preserved mcpPromptMode it was not asked to change', async () => {
      await updateDescriptionOnly('Patched description.');

      expect(readYaml(id)['mcpPromptMode']).toBe('launch');
    });

    // MUTATION TARGET: same revert as above turns this red too — the rebuilt document uses the
    // writer's own key order (id, name, description, then preserved keys), not the file's.
    it('keeps the authored top-level key order', async () => {
      await updateDescriptionOnly('Patched description.');

      expect(Object.keys(readYaml(id))).toEqual([
        'id',
        'mcpPromptMode',
        'name',
        'x-authorNote',
        'description',
        'registerWithMcp',
      ]);
    });
  });

  /**
   * The class, not the instance: every key `CategorySchema` accepts survives an update that did
   * not name it, plus one key the schema only passes through.
   */
  describe('every key the schema accepts', () => {
    const id = 'every_key';

    const SEEDS: Record<string, string> = {
      id: `id: ${id}`,
      name: 'name: Every Key',
      description: 'description: Original description.',
      registerWithMcp: 'registerWithMcp: false',
      mcpPromptMode: 'mcpPromptMode: launch',
    };

    /** The default "strip" parse mode never rejects an unknown key — it must survive a write too. */
    const PASSTHROUGH_SEED = 'x-authorNote: kept by whoever wrote it';

    it('seeds every schema key, or says why it cannot', () => {
      const schemaKeys = Object.keys(CategorySchema.shape).sort();
      const covered = Object.keys(SEEDS).sort();

      expect(covered).toEqual(schemaKeys);
    });

    it.each([...Object.keys(SEEDS), 'x-authorNote'])(
      'keeps %s through a description-only update',
      async (key) => {
        writeFixture(id, `${[...Object.values(SEEDS), PASSTHROUGH_SEED].join('\n')}\n`);
        const before = readYaml(id);

        const result = await writer.writeCategoryFiles({
          id,
          name: 'Every Key',
          description: 'Patched description.',
        });
        expect(result.success).toBe(true);

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
