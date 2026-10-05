import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PromptMutationReceiptService } from '../../../../../src/mcp/tools/resource-manager/prompt/services/prompt-mutation-receipt-service.js';
import { PromptConverter } from '../../../../../src/modules/prompts/converter.js';
import { loadYamlPrompt } from '../../../../../src/modules/prompts/yaml-prompt-loader.js';
import { parseYaml, serializeYaml } from '../../../../../src/shared/utils/yaml/yaml-parser.js';

import type { PromptResourceContext } from '../../../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConvertedPrompt } from '../../../../../src/engine/execution/types.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(storedBudget?: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'budget-receipt-'));
  roots.push(root);
  const prompts = join(root, 'prompts');
  const category = join(prompts, 'examples');
  const parent = join(category, 'receipt_chain');
  mkdirSync(parent, { recursive: true });
  const yamlPath = join(parent, 'prompt.yaml');
  const base = {
    id: 'receipt_chain',
    name: 'Receipt Chain',
    category: 'examples',
    description: 'A budget receipt probe',
    userMessageTemplate: 'Do work.',
    arguments: [],
    registerWithMcp: false,
    mcpPromptMode: 'expand',
    chainSteps: [{ id: 'research', promptId: 'receipt_chain/research', stepName: 'Research' }],
  };
  const yaml = { ...base, ...(storedBudget !== undefined ? { budget: storedBudget } : {}) };
  writeFileSync(yamlPath, serializeYaml(yaml));
  const logger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  let converted: ConvertedPrompt[] = [];
  const refresh = async () => {
    const result = loadYamlPrompt(parent, category, {
      logger,
      cache: new Map(),
      stats: { cacheHits: 0, cacheMisses: 0, loadErrors: 0 },
      enableCache: false,
      debug: false,
    });
    expect(result).not.toBeNull();
    converted = await new PromptConverter(logger).convertMarkdownPromptsToJson(
      [result!.promptData],
      category
    );
    expect(converted).toHaveLength(1);
  };
  const context = {
    dependencies: {
      logger,
      configManager: {
        getConfigPath: () => join(root, 'config.json'),
        getServerRoot: () => root,
        getResolvedPromptsDirectory: () => prompts,
      },
    },
    versionHistoryService: { loadHistory: async () => undefined },
    getData: () => ({ convertedPrompts: converted }),
  } as unknown as PromptResourceContext;
  const complete = (
    expectedBudget?: Record<string, unknown>,
    action: 'create' | 'update' = 'create',
    affectedFiles = [yamlPath]
  ) =>
    new PromptMutationReceiptService(context).complete({
      action,
      id: base.id,
      expectedPrompt: {
        ...base,
        ...(expectedBudget !== undefined ? { budget: expectedBudget } : {}),
      },
      operation: { message: 'written', affectedFiles },
      fullRestart: false,
      refresh,
      reason: 'receipt probe',
    });
  return { complete, yamlPath, parent, getLoaded: () => converted[0] };
}

const mixed = { maxNodes: 2, maxFanOut: 1, maxInsertions: 0, pauseOnBlocking: false };

describe('Prompt mutation receipts verify authored and loaded budgets', () => {
  test('accepts a mixed budget after a real YAML write and refresh', async () => {
    const f = fixture(mixed);
    const result = await f.complete(mixed);
    expect(result.verified).toBe(true);
    expect(result.receipt.refresh_status).toBe('loaded');
    expect(f.getLoaded()?.budget).toEqual({ maxInsertions: 0, pauseOnBlocking: false });
  });

  test('accepts a structural-only declaration absent from the runtime budget', async () => {
    const budget = { maxNodes: 2, maxFanOut: 1 };
    const f = fixture(budget);
    expect((await f.complete(budget)).verified).toBe(true);
    expect(f.getLoaded()?.budget).toBeUndefined();
  });

  test.each(['maxNodes', 'maxFanOut'])(
    'refuses missing stored %s even when the loaded budget matches',
    async (field) => {
      const stored: Record<string, unknown> = { ...mixed };
      delete stored[field];
      const f = fixture(stored);
      const result = await f.complete(mixed);
      expect(result.verified).toBe(false);
      expect(result.error).toContain(`authored budget mismatch: ${field}`);
    }
  );

  test.each(['maxNodes', 'maxFanOut'])(
    'refuses changed stored %s even when the loaded budget matches',
    async (field) => {
      const f = fixture({ ...mixed, [field]: 3 });
      const result = await f.complete(mixed);
      expect(result.verified).toBe(false);
      expect(result.error).toContain(`authored budget mismatch: ${field}`);
    }
  );

  test.each([{ maxInsertions: 1 }, { pauseOnBlocking: true }])(
    'refuses changed durable budget fields: %j',
    async (change) => {
      const f = fixture({ ...mixed, ...change });
      const result = await f.complete(mixed);
      expect(result.verified).toBe(false);
      expect(result.error).toContain('mismatched: budget');
    }
  );

  test('does not accept a scaffold as proof of the affected parent', async () => {
    const f = fixture(mixed);
    const child = join(f.parent, 'research');
    mkdirSync(child);
    const childYaml = join(child, 'prompt.yaml');
    writeFileSync(childYaml, serializeYaml({ id: 'research', budget: mixed }));
    const result = await f.complete(mixed, 'create', [childYaml]);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('affected files do not name the authored parent');
  });

  test('finds the actual parent even when a scaffold precedes it in affected files', async () => {
    const f = fixture(mixed);
    const child = join(f.parent, 'research');
    mkdirSync(child);
    const childYaml = join(child, 'prompt.yaml');
    writeFileSync(childYaml, serializeYaml({ id: 'research', budget: { maxNodes: 1 } }));
    expect((await f.complete(mixed, 'create', [childYaml, f.yamlPath])).verified).toBe(true);
  });

  test('does not reject retained authored caps on an unrelated update of the normalized runtime view', async () => {
    const f = fixture(mixed);
    expect(
      (await f.complete({ maxInsertions: 0, pauseOnBlocking: false }, 'update')).verified
    ).toBe(true);
    const stored = parseYaml<Record<string, unknown>>(readFileSync(f.yamlPath, 'utf8'));
    expect(stored.data?.['budget']).toEqual(mixed);
  });

  test('refuses a parent file whose YAML identity changed', async () => {
    const f = fixture(mixed);
    const raw = readFileSync(f.yamlPath, 'utf8');
    writeFileSync(f.yamlPath, raw.replace('id: receipt_chain', 'id: different_chain'));
    const result = await f.complete(mixed);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('does not identify this prompt');
  });

  test('accepts updated budget declarations', async () => {
    const updated = { maxNodes: 3, maxFanOut: 2, maxInsertions: 1, pauseOnBlocking: true };
    const f = fixture(updated);
    expect((await f.complete(updated, 'update')).verified).toBe(true);
    expect(f.getLoaded()?.budget).toEqual({ maxInsertions: 1, pauseOnBlocking: true });
  });

  test('accepts budget unset with no authored or loaded budget remaining', async () => {
    const f = fixture(mixed);
    const parsed = parseYaml<Record<string, unknown>>(readFileSync(f.yamlPath, 'utf8'));
    expect(parsed.success).toBe(true);
    const updated = { ...parsed.data };
    delete updated['budget'];
    writeFileSync(f.yamlPath, serializeYaml(updated));
    expect((await f.complete(undefined, 'update')).verified).toBe(true);
    expect(f.getLoaded()?.budget).toBeUndefined();
    expect(
      parseYaml<Record<string, unknown>>(readFileSync(f.yamlPath, 'utf8')).data?.['budget']
    ).toBeUndefined();
  });
});
