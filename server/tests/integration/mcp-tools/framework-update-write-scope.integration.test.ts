/**
 * tutorial-rework B.65 (ruling OQ-8): a framework edit keeps everything it was not asked to change.
 *
 * Before the fix, `buildFrameworkYamlData` emitted `version: 1.0.0` on every call and the update
 * merge laid it over the stored value, so a description edit took CAGEERF from 2.0.0 to 1.0.0.
 * The same edit re-serialized `framework.yaml` and the phases file, including a phases file the
 * update never named, which dropped its comments and flow style.
 *
 * The fixture is HAND-AUTHORED, with comments, a key order no writer emits and flow-style
 * mappings. A fixture the writer seeds itself cannot show this, because rewriting it returns the
 * same bytes. That is why `preview-matches-write` stayed green through the defect: its
 * `seedFramework` writes through `FrameworkFileWriter`.
 *
 * Classification: integration. The real `FrameworkLifecycleProcessor`, `FrameworkVersioningProcessor`
 * and `FrameworkFileWriter` write into a temp directory. The registry and the version history
 * store are doubles: neither decides which files a write lands.
 */
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FrameworkFileWriter } from '../../../src/mcp/tools/framework-manager/services/framework-file-writer.js';
import { FrameworkLifecycleProcessor } from '../../../src/mcp/tools/framework-manager/services/framework-lifecycle-processor.js';
import { frameworkSnapshotContract } from '../../../src/mcp/tools/framework-manager/services/framework-snapshot-contract.js';
import { FrameworkVersioningProcessor } from '../../../src/mcp/tools/framework-manager/services/framework-versioning-processor.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { parseYamlOrThrow } from '../../../src/shared/utils/yaml/yaml-parser.js';

import type { FrameworkResourceContext } from '../../../src/mcp/tools/framework-manager/core/context.js';
import type { FrameworkManagerInput } from '../../../src/mcp/tools/framework-manager/core/types.js';
import type { ConfigManager, Logger, ToolResponse } from '../../../src/shared/types/index.js';

const FRAMEWORK_ID = 'hand-authored';
const STORED_VERSION = '3.1.4';

/** No writer emits these comments, this key order, or these flow-style mappings. */
const HAND_AUTHORED: Readonly<Record<string, string>> = {
  'framework.yaml': [
    '# Hand-authored B.65 fixture: no writer emits this comment, this key order,',
    '# or the flow-style mappings below.',
    `version: ${STORED_VERSION} # trailing comment on the version`,
    'enabled: true',
    'type: FIXTURE',
    'name: Hand Authored Framework',
    `id: ${FRAMEWORK_ID}`,
    'description: Original description',
    'gates: { include: [framework-compliance] }',
    'frameworkElements: { requiredSections: [Context, Plan], sectionDescriptions: { Context: Situational facts, Plan: Next steps } }',
    'phasesFile: phases.yaml',
    'judgePromptFile: judge-prompt.md',
    'systemPromptGuidance: >-',
    '  Establish context first,',
    '  then plan.',
    '',
  ].join('\n'),
  'phases.yaml': [
    '# Phases for the B.65 fixture. Flow style and comments on purpose.',
    "qualityIndicators: { context: { keywords: [situation, constraint], patterns: ['^## Context'] } }",
    'processingSteps:',
    '  - { id: context, name: Context, description: Establish context, frameworkBasis: Fixture, order: 1, required: true } # inline step',
    'executionFlow:',
    '  preProcessingSteps: [context]',
    '',
  ].join('\n'),
  // No trailing newline, on purpose: a rewrite that normalizes it shows up as a changed byte.
  'judge-prompt.md': 'Judge the response.\n\n    An indented line, and no trailing newline',
  'system-prompt.md': 'Fixture system prompt.\n',
};

/**
 * Every framework field an update can name, a value for it, and the ONLY files that value may
 * change. Every other file must come back byte-identical.
 *
 * Kept complete by the first test below, which reads the published `[Framework]` parameters from
 * the `resource_manager` contract. A new framework parameter with no row here fails that test.
 */
const FIELD_WRITE_SCOPE: ReadonlyArray<{
  field: string;
  value: unknown;
  changes: readonly string[];
}> = [
  { field: 'name', value: 'Renamed Framework', changes: ['framework.yaml'] },
  { field: 'framework', value: 'FIXTURE_RENAMED', changes: ['framework.yaml'] },
  { field: 'description', value: 'Updated description', changes: ['framework.yaml'] },
  { field: 'enabled', value: false, changes: ['framework.yaml'] },
  {
    field: 'system_prompt_guidance',
    value: 'A new system prompt.\n',
    changes: ['framework.yaml', 'system-prompt.md'],
  },
  { field: 'gates', value: { exclude: ['framework-compliance'] }, changes: ['framework.yaml'] },
  {
    field: 'tool_descriptions',
    value: { prompt_engine: { description: 'Fixture overlay.' } },
    changes: ['framework.yaml'],
  },
  {
    field: 'framework_gates',
    value: [
      {
        id: 'plan_quality',
        name: 'Plan Quality',
        description: 'The plan names its steps',
        frameworkArea: 'Plan',
        priority: 'high',
        validationCriteria: ['Steps are numbered'],
      },
    ],
    changes: ['framework.yaml'],
  },
  {
    field: 'template_suggestions',
    value: [
      {
        section: 'system',
        type: 'addition',
        description: 'Add plan guidance',
        content: 'Plan before acting.',
        frameworkJustification: 'The fixture plans',
        impact: 'low',
      },
    ],
    changes: ['framework.yaml'],
  },
  {
    field: 'framework_elements',
    value: { requiredSections: ['Context'], sectionDescriptions: { Context: 'Facts only' } },
    changes: ['framework.yaml'],
  },
  {
    field: 'argument_suggestions',
    value: [
      {
        name: 'topic',
        type: 'string',
        description: 'What to plan',
        frameworkReason: 'A plan needs a subject',
        examples: ['a release'],
      },
    ],
    changes: ['framework.yaml'],
  },
  // `judgePromptFile` is already declared with this name, so framework.yaml does not change.
  { field: 'judge_prompt', value: 'A new judge prompt.\n', changes: ['judge-prompt.md'] },
  // `phasesFile` is already declared, so every phases field changes the phases file alone.
  {
    field: 'phases',
    value: [{ id: 'plan', name: 'Plan', description: 'Lay out the steps' }],
    changes: ['phases.yaml'],
  },
  {
    field: 'processing_steps',
    value: [
      {
        id: 'plan',
        name: 'Plan',
        description: 'Lay out the steps',
        frameworkBasis: 'Fixture',
        order: 2,
        required: false,
      },
    ],
    changes: ['phases.yaml'],
  },
  {
    field: 'execution_steps',
    value: [
      {
        id: 'run',
        name: 'Run',
        action: 'Carry out the plan',
        frameworkPhase: 'Plan',
        dependencies: [],
        expected_output: 'A finished plan',
      },
    ],
    changes: ['phases.yaml'],
  },
  {
    field: 'execution_type_enhancements',
    value: { chain: { simpleChain: { plan: ['Keep it short'] } } },
    changes: ['phases.yaml'],
  },
  {
    field: 'template_enhancements',
    value: { contextualHints: ['Cite sources'] },
    changes: ['phases.yaml'],
  },
  { field: 'execution_flow', value: { postProcessingSteps: ['plan'] }, changes: ['phases.yaml'] },
  {
    field: 'quality_indicators',
    value: { plan: { keywords: ['plan'], patterns: ['^## Plan'] } },
    changes: ['phases.yaml'],
  },
];

/**
 * `[Framework]` parameters that no `update` writes. `persist` belongs to `switch`. `name` and
 * `description` carry no tag because every resource type shares them, so the enumeration adds
 * them by name.
 */
const NOT_WRITTEN_BY_UPDATE = new Set(['persist']);
const SHARED_WRITTEN_BY_UPDATE = ['name', 'description'];

const CONTRACT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tooling/contracts/resource-manager.json'
);

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function seedHandAuthored(): string {
  const frameworksDir = mkdtempSync(join(tmpdir(), 'cpm-b65-'));
  tempRoots.push(frameworksDir);
  const dir = join(frameworksDir, FRAMEWORK_ID);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(HAND_AUTHORED)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return frameworksDir;
}

/** Every file in the framework's directory, as raw bytes. */
function readFrameworkDir(frameworksDir: string): Record<string, Buffer> {
  const dir = join(frameworksDir, FRAMEWORK_ID);
  return Object.fromEntries(
    readdirSync(dir)
      .sort()
      .map((name) => [name, readFileSync(join(dir, name))])
  );
}

/** The files whose bytes differ between two reads, compared byte for byte. */
function changedFiles(before: Record<string, Buffer>, after: Record<string, Buffer>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((name) => {
      const prior = before[name];
      const next = after[name];
      return prior === undefined || next === undefined || !prior.equals(next);
    })
    .sort();
}

function storedVersion(frameworksDir: string): unknown {
  const yaml = parseYamlOrThrow<Record<string, unknown>>(
    readFileSync(join(frameworksDir, FRAMEWORK_ID, 'framework.yaml'), 'utf8')
  );
  return yaml['version'];
}

const textOf = (response: ToolResponse): string =>
  (response.content[0] as { text: string } | undefined)?.text ?? '';

interface Harness {
  writer: FrameworkFileWriter;
  lifecycle: FrameworkLifecycleProcessor;
  versioning: FrameworkVersioningProcessor;
  resolveRollbackTarget: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
}

function createHarness(frameworksDir: string): Harness {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const configManager = {
    getFrameworksDirectory: () => frameworksDir,
    getBundledResourceDirectory: () => undefined,
  } as unknown as ConfigManager;
  const writer = new FrameworkFileWriter({ logger, configManager });
  const resolveRollbackTarget: Harness['resolveRollbackTarget'] = jest.fn(async () => ({
    ok: false,
    error: 'no rollback target configured for this test',
  }));
  const context = {
    logger,
    frameworkManager: {
      getFramework: (id: string) => (id === FRAMEWORK_ID ? { id } : undefined),
      getFrameworkRegistry: () => ({ getRuntimeLoader: () => ({ clearCache: () => undefined }) }),
      registerFramework: () => Promise.resolve(true),
    },
    configManager,
    fileService: writer,
    textDiffService: new ObjectDiffGenerator(),
    versionHistoryService: {
      isAutoVersionEnabled: () => true,
      recordEditResult: jest.fn(async () => ({ version: 2, success: true, bridged: false })),
      resolveRollbackTarget,
      commitEdit: jest.fn(async () => ({ version: 3, bridged: false })),
    },
    onRefresh: jest.fn(async () => {}),
  } as unknown as FrameworkResourceContext;

  return {
    writer,
    // `handleUpdate` never reaches the draft validator; only `handleCreate` does.
    lifecycle: new FrameworkLifecycleProcessor(
      context,
      {} as unknown as ConstructorParameters<typeof FrameworkLifecycleProcessor>[1]
    ),
    versioning: new FrameworkVersioningProcessor(context),
    resolveRollbackTarget,
  };
}

describe('a framework edit keeps everything it was not asked to change (tutorial-rework B.65)', () => {
  test('the write-scope table covers every framework field resource_manager publishes', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as {
      parameters: Array<{ name: string; description?: string }>;
    };
    const published = contract.parameters
      .filter((parameter) => (parameter.description ?? '').startsWith('[Framework]'))
      .map((parameter) => parameter.name)
      .filter((name) => !NOT_WRITTEN_BY_UPDATE.has(name));

    // Positive control: the tag filter reads real parameters, so an empty match cannot pass.
    expect(published).toContain('system_prompt_guidance');
    expect(FIELD_WRITE_SCOPE.map((row) => row.field).sort()).toEqual(
      [...published, ...SHARED_WRITTEN_BY_UPDATE].sort()
    );
  });

  test.each(FIELD_WRITE_SCOPE)(
    'an update naming only $field changes $changes and leaves every other file byte-identical',
    async ({ field, value, changes }) => {
      const frameworksDir = seedHandAuthored();
      const before = readFrameworkDir(frameworksDir);
      const harness = createHarness(frameworksDir);

      const result = await harness.lifecycle.handleUpdate({
        action: 'update',
        id: FRAMEWORK_ID,
        [field]: value,
      } as unknown as FrameworkManagerInput);
      expect({ field, isError: result.isError, text: textOf(result) }).toMatchObject({
        field,
        isError: false,
      });

      // Both directions in one comparison: the named files DID change (the positive control) and
      // no other file did. MUTATION KILLED: restoring the pre-B.65 phases planner (a stored
      // phases file was merged and planned whether or not the merge changed it) turns the 11
      // framework.yaml rows and the judge_prompt row red, because phases.yaml comes back
      // re-serialized. Measured: 16 of 26 tests red, the 12 rows plus the description, rollback
      // and both naming-nothing tests.
      expect(changedFiles(before, readFrameworkDir(frameworksDir))).toEqual([...changes].sort());

      // MUTATION KILLED: restoring `yamlData['version'] ??= '1.0.0'` in `buildFrameworkYamlData`
      // turns all 19 rows red. The rows that write framework.yaml read 1.0.0 here, and the rest
      // fail the comparison above, because the reset puts framework.yaml into their plan.
      // Measured: 23 of 26 tests red; the contract-coverage, create and disabled-framework tests
      // pass.
      expect(storedVersion(frameworksDir)).toBe(STORED_VERSION);
    }
  );

  test('a description edit re-serializes framework.yaml and nothing else: the hand-authored bytes before and after', async () => {
    const frameworksDir = seedHandAuthored();
    const harness = createHarness(frameworksDir);

    await harness.lifecycle.handleUpdate({
      action: 'update',
      id: FRAMEWORK_ID,
      description: 'Updated description',
    } as FrameworkManagerInput);

    const after = readFrameworkDir(frameworksDir);
    for (const name of ['phases.yaml', 'judge-prompt.md', 'system-prompt.md']) {
      expect({ name, content: after[name]?.toString('utf8') }).toEqual({
        name,
        content: HAND_AUTHORED[name],
      });
    }
    const frameworkYaml = parseYamlOrThrow<Record<string, unknown>>(
      after['framework.yaml']?.toString('utf8') ?? ''
    );
    expect(frameworkYaml).toMatchObject({
      version: STORED_VERSION,
      enabled: true,
      description: 'Updated description',
      frameworkElements: { requiredSections: ['Context', 'Plan'] },
    });
  });

  test.each([true, false])(
    'an update naming nothing plans no file at all (stored enabled: %s)',
    async (enabled) => {
      const frameworksDir = seedHandAuthored();
      const frameworkYamlPath = join(frameworksDir, FRAMEWORK_ID, 'framework.yaml');
      writeFileSync(
        frameworkYamlPath,
        readFileSync(frameworkYamlPath, 'utf8').replace('enabled: true', `enabled: ${enabled}`),
        'utf8'
      );
      const { writer } = createHarness(frameworksDir);
      const existing = await writer.loadExistingFramework(FRAMEWORK_ID);
      if (existing === null) throw new Error('the hand-authored framework did not load');
      expect(existing.framework['enabled']).toBe(enabled);

      // Closes the class rather than the site: any value the writer supplies on its own (a
      // default, a re-asserted id, a reference already declared) makes this plan a file.
      // MUTATION KILLED: restoring `data.enabled ?? true` turns the `false` case red, and restoring
      // the version default turns both red. With `enabled: true` stored, the old default merged
      // `true` over `true` and changed nothing, which is why the `false` case exists.
      expect(await writer.projectFrameworkWrite({ id: FRAMEWORK_ID }, existing)).toEqual([]);
    }
  );

  test('a description edit leaves a disabled framework disabled', async () => {
    const frameworksDir = seedHandAuthored();
    const frameworkYamlPath = join(frameworksDir, FRAMEWORK_ID, 'framework.yaml');
    writeFileSync(
      frameworkYamlPath,
      readFileSync(frameworkYamlPath, 'utf8').replace('enabled: true', 'enabled: false'),
      'utf8'
    );
    const harness = createHarness(frameworksDir);

    const result = await harness.lifecycle.handleUpdate({
      action: 'update',
      id: FRAMEWORK_ID,
      description: 'Updated description',
    } as FrameworkManagerInput);
    expect(result.isError).toBe(false);

    // MUTATION KILLED: restoring `data.enabled ?? true` re-enables the framework here.
    const updated = parseYamlOrThrow<Record<string, unknown>>(
      readFileSync(frameworkYamlPath, 'utf8')
    );
    expect(updated).toMatchObject({ enabled: false, description: 'Updated description' });
  });

  test('a rollback restores the recorded fields without resetting the version or touching the phases and judge files', async () => {
    const frameworksDir = seedHandAuthored();
    const harness = createHarness(frameworksDir);
    const seeded = await harness.writer.loadExistingFramework(FRAMEWORK_ID);
    if (seeded === null) throw new Error('the hand-authored framework did not load');
    const recorded = frameworkSnapshotContract.project(FRAMEWORK_ID, seeded);

    // Edited by hand rather than through `handleUpdate`, so the phases and judge files are still
    // the hand-authored bytes when the rollback runs. After an update the rollback would only be
    // shown files a writer had already rewritten, and rewriting those again returns the same bytes.
    const frameworkYamlPath = join(frameworksDir, FRAMEWORK_ID, 'framework.yaml');
    const handAuthoredYaml = readFileSync(frameworkYamlPath, 'utf8');
    const handEdited = handAuthoredYaml.replace(
      'description: Original description',
      'description: Edited after the recorded version'
    );
    expect(handEdited).not.toBe(handAuthoredYaml);
    writeFileSync(frameworkYamlPath, handEdited, 'utf8');
    const beforeRollback = readFrameworkDir(frameworksDir);

    harness.resolveRollbackTarget.mockResolvedValue({ ok: true, entry: { snapshot: recorded } });
    const rollback = await harness.versioning.handleRollback({
      action: 'rollback',
      id: FRAMEWORK_ID,
      version: 1,
      confirm: true,
    } as FrameworkManagerInput);
    expect({ isError: rollback.isError, text: textOf(rollback) }).toMatchObject({
      isError: false,
    });

    // MUTATION KILLED: the phases-planner mutation noted in the table test turns this red
    // (phases.yaml comes back re-serialized), and the version mutation turns the version check
    // below red.
    expect(changedFiles(beforeRollback, readFrameworkDir(frameworksDir))).toEqual([
      'framework.yaml',
    ]);
    expect(storedVersion(frameworksDir)).toBe(STORED_VERSION);
    const restored = parseYamlOrThrow<Record<string, unknown>>(
      readFileSync(join(frameworksDir, FRAMEWORK_ID, 'framework.yaml'), 'utf8')
    );
    expect(restored['description']).toBe('Original description');
  });

  test('a create still gets version 1.0.0 and enabled: true when it names neither', async () => {
    const frameworksDir = mkdtempSync(join(tmpdir(), 'cpm-b65-create-'));
    tempRoots.push(frameworksDir);
    const { writer } = createHarness(frameworksDir);

    const result = await writer.writeFrameworkFiles({
      id: FRAMEWORK_ID,
      name: 'Created Framework',
      type: 'CREATED',
      system_prompt_guidance: 'Created guidance.\n',
    });
    expect(result.success).toBe(true);

    const created = parseYamlOrThrow<Record<string, unknown>>(
      readFileSync(join(frameworksDir, FRAMEWORK_ID, 'framework.yaml'), 'utf8')
    );
    expect(created).toMatchObject({ id: FRAMEWORK_ID, version: '1.0.0', enabled: true });
  });
});
