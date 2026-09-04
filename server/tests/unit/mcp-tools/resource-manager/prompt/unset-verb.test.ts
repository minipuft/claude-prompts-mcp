/**
 * P2.1/P2.4 — the "remove" verb, and the chain-step operation that replaced a no-op.
 *
 * WHY THE ENUMERATION IS THE POINT
 * `unset` fails in a specific, quiet way: the writer has THREE independent preserve-on-omit
 * branches (`resolvePreservedPromptYamlFields` over six keys, the `tools` fallback, and the
 * `category` fallback), and for any field reached by one of them, deleting the key from
 * `promptData` is not enough — the writer reads the old value straight back off disk and writes
 * it again. The call returns success and the field is still there.
 *
 * Two of those branches were found by reading, which is exactly the method that misses the third.
 * So the load-bearing test here is table-driven over `UNSETTABLE_FIELDS` itself rather than over
 * a hand-written list: a field added to the vocabulary without a working clear path fails here
 * without anyone remembering to add a case. `dev-workflow.md`: a fix at the sites you found is
 * not a fix of the class.
 *
 * ASSERTIONS READ THE WRITTEN YAML, NOT THE PAYLOAD. A test that inspected the object handed to
 * `updatePromptImplementation` would pass against the defect, because the payload IS correct in
 * the broken version — the resurrection happens afterwards, inside the writer.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileOperations } from '../../../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import {
  UNSETTABLE_FIELDS,
  UPDATE_FIELDS,
  applyChainStepOperation,
  resolveUnsetFields,
} from '../../../../../src/mcp/tools/resource-manager/prompt/utils/validation.js';
import { parseYamlOrThrow } from '../../../../../src/shared/utils/yaml/yaml-parser.js';

import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

/** A representative non-empty value per unsettable data key, so "absent after" means something. */
const SEED_VALUES: Record<string, unknown> = {
  systemMessage: 'Seeded system message.',
  arguments: [{ name: 'topic', description: 'A topic', required: false }],
  chainSteps: [{ promptId: 'child', stepName: 'Child' }],
  tools: [
    { id: 'seeded_tool', name: 'Seeded tool', script: 'print("hi")', runtime: 'python' as const },
  ],
  gateConfiguration: { include: ['code-quality'] },
  // `composer.inputArgument` must name a DECLARED argument, so this seed carries one too.
  composer: { inputArgument: 'topic' },
  injection: { 'system-prompt': { enabled: false } },
  registerWithMcp: true,
  mcpPromptMode: 'expand',
  subagentModel: 'fast',
  agentType: 'general-purpose',
};

describe('unset — the remove verb (P2.1)', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let operations: FileOperations;

  const yamlFor = (id: string): Record<string, unknown> =>
    parseYamlOrThrow(
      readFileSync(join(promptsDir, 'general', id, 'prompt.yaml'), 'utf8')
    ) as Record<string, unknown>;

  const seed = async (id: string, extra: Record<string, unknown>): Promise<void> => {
    await operations.updatePromptImplementation({
      id,
      name: id,
      category: 'general',
      description: 'Seed prompt.',
      userMessageTemplate: 'Body.',
      ...extra,
    });
  };

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-unset-'));
    promptsDir = join(workspaceDir, 'prompts');
    const logger = {
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

  describe('the vocabulary itself', () => {
    it('agrees with UPDATE_FIELDS on every shared parameter', () => {
      // `tools` is the one entry with no UPDATE_FIELDS row, named in both places by design. Every
      // other entry must map to the SAME data key, or `unset` would clear a key nothing writes.
      for (const [parameter, dataKey] of Object.entries(UNSETTABLE_FIELDS)) {
        if (parameter === 'tools') continue;
        expect(UPDATE_FIELDS[parameter]).toBe(dataKey);
      }
    });

    it('refuses the four structural fields BY NAME, and says they stay settable', () => {
      for (const parameter of ['name', 'category', 'description', 'user_message_template']) {
        const result = resolveUnsetFields([parameter], new Set());
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.message).toContain(parameter);
        expect(result.message).toContain('settable');
      }
    });

    it('refuses an unknown field and lists what IS unsettable', () => {
      const result = resolveUnsetFields(['not_a_field'], new Set());
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.message).toContain('not_a_field');
      expect(result.message).toContain('system_message');
    });

    it('refuses a field this call is also writing, whatever parameter delivered it', () => {
      // `alreadyWritten` holds DATA keys, so this covers `argument_updates` (writes `arguments`)
      // and `patch` (writes `systemMessage`) without either name appearing here.
      const result = resolveUnsetFields(['arguments'], new Set(['arguments']));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.message).toContain('both written and listed');
    });

    it('resolves a valid list to its data keys', () => {
      const result = resolveUnsetFields(['system_message', 'tools'], new Set());
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect([...result.dataKeys].sort()).toEqual(['systemMessage', 'tools']);
    });
  });

  describe('every unsettable field actually clears — the class, not the instances', () => {
    it.each(Object.entries(UNSETTABLE_FIELDS))(
      '`unset: [%s]` removes %s from the written prompt.yaml',
      async (parameter, dataKey) => {
        const id = `unset_${parameter}`;
        // `composer` is the one field with a cross-field rule — its `inputArgument` must name a
        // declared argument — so its seed carries that argument alongside it.
        const companion = dataKey === 'composer' ? { arguments: SEED_VALUES['arguments'] } : {};
        await seed(id, { ...companion, [dataKey]: SEED_VALUES[dataKey] });

        // Positive control: the seed landed. Without this, a field that never wrote in the first
        // place would report a passing "removal" — the absence would be evidence about nothing.
        const before = yamlFor(id);
        const yamlKey = dataKey === 'systemMessage' ? 'systemMessageFile' : dataKey;
        expect(before[yamlKey]).toBeDefined();

        await operations.updatePromptImplementation(
          { id, name: id, category: 'general', description: 'Seed prompt.' },
          new Set([dataKey]),
          undefined,
          { unsetKeys: new Set([dataKey]), toolBinding: 'replace', removedToolIds: [] }
        );

        expect(yamlFor(id)[yamlKey]).toBeUndefined();
      }
    );

    it('leaves a field alone when it is not in the unset set — the negative control', async () => {
      // Proves the table above measures `unsetKeys` and not merely "an update happened". Same
      // call shape, same narrowed write scope, empty unset set: the field survives.
      await seed('unset_control', { subagentModel: 'fast', agentType: 'general-purpose' });

      await operations.updatePromptImplementation(
        { id: 'unset_control', name: 'unset_control', category: 'general', description: 'Seed.' },
        new Set(['subagentModel']),
        undefined,
        { unsetKeys: new Set(['subagentModel']), toolBinding: 'replace', removedToolIds: [] }
      );

      const after = yamlFor('unset_control');
      expect(after['subagentModel']).toBeUndefined();
      expect(after['agentType']).toBe('general-purpose');
    });
  });

  describe('system_message is two operations, not one', () => {
    it('deletes system-message.md as well as dropping the key', async () => {
      await seed('unset_sysmsg', { systemMessage: 'Seeded system message.' });
      const messagePath = join(promptsDir, 'general', 'unset_sysmsg', 'system-message.md');
      expect(existsSync(messagePath)).toBe(true);

      await operations.updatePromptImplementation(
        {
          id: 'unset_sysmsg',
          name: 'unset_sysmsg',
          category: 'general',
          description: 'Seed prompt.',
        },
        new Set(['systemMessage']),
        undefined,
        { unsetKeys: new Set(['systemMessage']), toolBinding: 'replace', removedToolIds: [] }
      );

      expect(yamlFor('unset_sysmsg')['systemMessageFile']).toBeUndefined();
      // The half that a key-only removal leaves behind: an orphan file no loader reads.
      expect(existsSync(messagePath)).toBe(false);
    });

    it('is a successful no-op on a prompt that never had one', async () => {
      await seed('unset_nosysmsg', {});

      const result = await operations.updatePromptImplementation(
        {
          id: 'unset_nosysmsg',
          name: 'unset_nosysmsg',
          category: 'general',
          description: 'Seed prompt.',
        },
        new Set(['systemMessage']),
        undefined,
        { unsetKeys: new Set(['systemMessage']), toolBinding: 'replace', removedToolIds: [] }
      );

      expect(result.message).toBeTruthy();
      expect(existsSync(join(promptsDir, 'general', 'unset_nosysmsg', 'prompt.yaml'))).toBe(true);
    });
  });
});

describe('chain_step_operation: update (P2.4)', () => {
  const steps = (): unknown[] => [
    { promptId: 'first', stepName: 'First', outputKey: 'a' },
    { promptId: 'second', stepName: 'Second', outputKey: 'b' },
  ];

  it('overlays supplied fields onto the step at the index and keeps the rest', () => {
    const result = applyChainStepOperation(steps(), {
      operation: 'update',
      index: 1,
      stepData: { stepName: 'Renamed' },
    });

    // The overlay half: the untouched field survives rather than being dropped.
    expect(result[1]).toEqual({ promptId: 'second', stepName: 'Renamed', outputKey: 'b' });
    // And the sibling step is not disturbed.
    expect(result[0]).toEqual({ promptId: 'first', stepName: 'First', outputKey: 'a' });
  });

  it('does not mutate the input array', () => {
    const input = steps();
    applyChainStepOperation(input, { operation: 'update', index: 0, stepData: { stepName: 'X' } });
    expect(input[0]).toEqual({ promptId: 'first', stepName: 'First', outputKey: 'a' });
  });

  it('requires an index', () => {
    expect(() => applyChainStepOperation(steps(), { operation: 'update', stepData: {} })).toThrow(
      /chain_step_index required/
    );
  });

  it('requires step data', () => {
    expect(() => applyChainStepOperation(steps(), { operation: 'update', index: 0 })).toThrow(
      /chain_step_data required/
    );
  });

  it('refuses an out-of-range index rather than appending', () => {
    expect(() =>
      applyChainStepOperation(steps(), { operation: 'update', index: 5, stepData: {} })
    ).toThrow(/out of range/);
  });

  it('no longer accepts the removed replace member', () => {
    // The vestigial member returned `currentSteps` untouched, which is what omitting the parameter
    // already does. Now it falls to the default arm and is named as unknown.
    expect(() =>
      applyChainStepOperation(steps(), {
        operation: 'replace' as unknown as 'update',
      })
    ).toThrow(/Unknown chain_step_operation/);
  });
});

/**
 * P2.3 — the tool binding's remove verb.
 *
 * The row's whole point is a DISTINCTION, so both arms are asserted against the same fixture:
 * a narrowed `tools` array unbinds and leaves the files, an explicit `remove` deletes them. A test
 * that only covered the deletion would pass equally against an implementation that deleted on
 * every narrowing — which is the destructive reading of the same feature.
 */
describe('tool_operation (P2.3)', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let operations: FileOperations;

  const TOOLS = [
    { id: 'alpha', name: 'Alpha', script: 'print("a")', runtime: 'python' as const },
    { id: 'beta', name: 'Beta', script: 'print("b")', runtime: 'python' as const },
  ];

  const boundIds = (): unknown =>
    (
      parseYamlOrThrow(
        readFileSync(join(promptsDir, 'general', 'tooled', 'prompt.yaml'), 'utf8')
      ) as Record<string, unknown>
    )['tools'];

  const toolDir = (id: string): string => join(promptsDir, 'general', 'tooled', 'tools', id);

  beforeEach(async () => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-toolop-'));
    promptsDir = join(workspaceDir, 'prompts');
    operations = new FileOperations({
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as unknown as Logger,
      configManager: {
        getResolvedPromptsDirectory: () => promptsDir,
      } as unknown as ConfigManager,
    });

    await operations.updatePromptImplementation({
      id: 'tooled',
      name: 'tooled',
      category: 'general',
      description: 'Has tools.',
      userMessageTemplate: 'Body.',
      tools: TOOLS,
    });
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('seeds both tools bound and both directories present — the shared control', () => {
    expect(boundIds()).toEqual(['alpha', 'beta']);
    expect(existsSync(toolDir('alpha'))).toBe(true);
    expect(existsSync(toolDir('beta'))).toBe(true);
  });

  it('a narrowed tools array unbinds WITHOUT deleting the directory', async () => {
    await operations.updatePromptImplementation(
      {
        id: 'tooled',
        name: 'tooled',
        category: 'general',
        description: 'Has tools.',
        tools: [TOOLS[0]],
      },
      new Set(['tools']),
      undefined,
      { unsetKeys: new Set(), toolBinding: 'replace', removedToolIds: [] }
    );

    expect(boundIds()).toEqual(['alpha']);
    // The load-bearing half: the files survive, so the unbinding is reversible.
    expect(existsSync(toolDir('beta'))).toBe(true);
  });

  it('an explicit remove unbinds AND deletes the directory', async () => {
    await operations.updatePromptImplementation(
      { id: 'tooled', name: 'tooled', category: 'general', description: 'Has tools.' },
      new Set(['tools']),
      undefined,
      { unsetKeys: new Set(), toolBinding: 'replace', removedToolIds: ['beta'] }
    );

    expect(boundIds()).toEqual(['alpha']);
    expect(existsSync(toolDir('beta'))).toBe(false);
    expect(existsSync(toolDir('alpha'))).toBe(true);
  });

  it('add unions with the existing binding rather than replacing it', async () => {
    const gamma = { id: 'gamma', name: 'Gamma', script: 'print("g")', runtime: 'python' as const };

    await operations.updatePromptImplementation(
      {
        id: 'tooled',
        name: 'tooled',
        category: 'general',
        description: 'Has tools.',
        tools: [gamma],
      },
      new Set(['tools']),
      undefined,
      { unsetKeys: new Set(), toolBinding: 'add', removedToolIds: [] }
    );

    // Replace semantics would leave `['gamma']` alone — that is the mutation this kills.
    expect(boundIds()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('add does not duplicate an id that is already bound', async () => {
    await operations.updatePromptImplementation(
      {
        id: 'tooled',
        name: 'tooled',
        category: 'general',
        description: 'Has tools.',
        tools: [TOOLS[0]],
      },
      new Set(['tools']),
      undefined,
      { unsetKeys: new Set(), toolBinding: 'add', removedToolIds: [] }
    );

    expect(boundIds()).toEqual(['alpha', 'beta']);
  });
});
