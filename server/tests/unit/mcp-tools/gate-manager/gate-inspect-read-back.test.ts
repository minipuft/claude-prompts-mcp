/**
 * Gate `inspect` and `list` read-back: `inspect` reads `severity`/`enforcementMode` from the
 * definition (`GateGuide.getDefinition()`), not from `gate.severity`/`gate.enforcementMode`; both
 * name the tier the criteria require; `inspect` renders the complete public criterion set.
 *
 * Each fixture is authored the way a `gate.yaml` is and then run through
 * `GateDefinitionSchema.parse`, so every double is an object `GateDefinitionLoader` could
 * actually hand back: `severity` carries the schema default when the file omits it, while
 * `enforcementMode` has no default and stays absent. Inspect therefore reports the EFFECTIVE
 * severity — the value the engine acts on — and there is no "author set it" vs "loader
 * defaulted it" distinction left to read off a parsed object. These tests drive
 * `GateDiscoveryProcessor.handleInspect`, the real render path, not a copy of its logic.
 */
import { describe, expect, it } from '@jest/globals';

import {
  GateDefinitionSchema,
  SemanticCriterionSchema,
} from '../../../../src/engine/gates/core/gate-schema.js';
import { GenericGateGuide } from '../../../../src/engine/gates/registry/generic-gate-guide.js';
import { GateDiscoveryProcessor } from '../../../../src/mcp/tools/gate-manager/services/index.js';
import {
  EMPTY_QUARANTINE_VIEW,
  ResourceQuarantine,
} from '../../../../src/shared/utils/resource-quarantine.js';

import type { GateDefinitionYaml } from '../../../../src/engine/gates/types/index.js';
import type { GateManager } from '../../../../src/engine/gates/gate-manager.js';
import type { GateResourceContext } from '../../../../src/mcp/tools/gate-manager/core/context.js';
import type { GateManagerInput } from '../../../../src/mcp/tools/gate-manager/core/types.js';

function buildProcessor(definitions: Map<string, GateDefinitionYaml>): GateDiscoveryProcessor {
  const guides = new Map(
    Array.from(definitions.entries()).map(([id, def]) => [
      id,
      // Through the schema, not around it: the loader parses, so a double built any other way
      // could assert about a definition no gate.yaml can produce.
      new GenericGateGuide(GateDefinitionSchema.parse(def)),
    ])
  );
  const gateManager = {
    get: (id: string) => guides.get(id),
    // `handleInspect` appends the shadowed-file note (P4.15), which reads the loader's quarantine
    // through the manager. An empty view is what a healthy process has, so these cases still
    // measure only the severity/enforcementMode read-back they were written for.
    getQuarantine: () => EMPTY_QUARANTINE_VIEW,
  } as unknown as GateManager;
  const ctx = { gateManager } as unknown as GateResourceContext;
  return new GateDiscoveryProcessor(ctx);
}

const baseDefinition: GateDefinitionYaml = {
  id: 'test-gate',
  name: 'Test Gate',
  type: 'validation',
  description: 'a gate used only to prove read-back',
};

describe('GateDiscoveryProcessor.handleInspect — P4.11 severity/enforcementMode rendering', () => {
  it.each(['suite-opaque', '  unresolved:../fixture.json #opaque  ', 'Ω\nidentifier'])(
    'renders the exact declared opaque association %j as a JSON string',
    async (value) => {
      const processor = buildProcessor(
        new Map([['test-gate', { ...baseDefinition, calibration_suite_id: value }]])
      );
      const result = await processor.handleInspect({ action: 'inspect', id: 'test-gate' });
      const text = (result.content[0] as { text: string }).text;
      expect(result.isError).toBe(false);
      const line = text.split('\n').find((entry) => entry.startsWith('  - Calibration Suite ID: '));
      expect(line).toBe(`  - Calibration Suite ID: ${JSON.stringify(value)}`);
      expect(JSON.parse(line!.slice('  - Calibration Suite ID: '.length))).toBe(value);
    }
  );

  it('omits the association detail when the definition has no association', async () => {
    const processor = buildProcessor(new Map([['test-gate', baseDefinition]]));
    const result = await processor.handleInspect({ action: 'inspect', id: 'test-gate' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('ID: test-gate');
    expect(text).not.toContain('Calibration Suite ID:');
  });

  it('renders severity and enforcementMode when the definition sets them', async () => {
    const processor = buildProcessor(
      new Map([['test-gate', { ...baseDefinition, severity: 'low', enforcementMode: 'blocking' }]])
    );

    const result = await processor.handleInspect({
      action: 'inspect',
      id: 'test-gate',
    } satisfies GateManagerInput);
    const text = (result.content[0] as { text: string }).text;

    // MUTATION KILLED: dropping `${severityLine}` from the template in
    // gate-discovery-processor.ts makes this assertion fail. Confirmed by applying the deletion,
    // re-running this file (red), and reverting.
    expect(text).toContain('Severity: low');
    expect(text).toContain('Enforcement Mode: blocking');
  });

  it('renders the defaulted severity, and still omits enforcementMode, when the gate.yaml sets neither', async () => {
    const processor = buildProcessor(new Map([['test-gate', baseDefinition]]));

    const result = await processor.handleInspect({
      action: 'inspect',
      id: 'test-gate',
    } satisfies GateManagerInput);
    const text = (result.content[0] as { text: string }).text;

    // 'medium' is the schema default, not a literal in the fixture above — inspect shows the
    // severity the engine will use.
    expect(text).toContain('Severity: medium');
    // MUTATION KILLED: inverting `definition.enforcementMode !== undefined` to `=== undefined`
    // makes this print 'Enforcement Mode: undefined'. Confirmed by applying the inversion,
    // re-running this file (red), and reverting.
    expect(text).not.toContain('Enforcement Mode:');
  });
});

function readPublicCriteria(text: string): unknown {
  const block = /📑 Public Pass Criteria:\n```json\n([\s\S]*?)\n```/.exec(text)?.[1];
  if (block === undefined) throw new Error('Public criteria block missing');
  return JSON.parse(block);
}

describe('complete public criterion read-back', () => {
  it('real legacy handleInspect preserves tool/reminder fields and exact opaque association without private extras', async () => {
    const criteria = [
      {
        type: 'shell_verify' as const,
        shell_command: ['node', '--version'],
        shell_timeout: 5000,
        shell_working_dir: './work',
        shell_env: { PUBLIC_FLAG: 'value' },
        shell_preset: 'full' as const,
        shell_stdin_source: 'agent_response' as const,
        shell_response_env_var: 'PUBLIC_RESPONSE',
        private_cases: ['PRIVATE_SENTINEL_CASE'],
        private_label: 'PRIVATE_SENTINEL_LABEL',
      },
      {
        type: 'script_tool' as const,
        script_tool_id: 'public-tool',
        script_tool_input: { public: true },
        script_tool_timeout: 9000,
        script_tool_working_dir: './tools',
      },
      {
        type: 'framework_compliance' as const,
        framework: 'CAGEERF',
        min_compliance_score: 0.8,
        severity: 'warn' as const,
        quality_indicators: { public: { keywords: ['proof'], patterns: ['public.*'] } },
      },
      { type: 'inline_guidance' as const },
    ];
    const definition = {
      ...baseDefinition,
      calibration_suite_id: ' unresolved:../private.json #opaque ',
      evaluation: { mode: 'judge' as const, model: 'public-hint', strict: false },
      pass_criteria: criteria,
    };
    const result = await buildProcessor(new Map([['test-gate', definition]])).handleInspect({
      action: 'inspect',
      id: 'test-gate',
    });
    const text = (result.content[0] as { text: string }).text;
    expect(result.isError).toBe(false);
    const { private_cases: _cases, private_label: _label, ...publicShell } = criteria[0];
    expect(readPublicCriteria(text)).toEqual([publicShell, ...criteria.slice(1)]);
    expect(text).toContain('Evaluation: judge (model: public-hint, strict: false)');
    expect(text).toContain(
      `Calibration Suite ID: ${JSON.stringify(definition.calibration_suite_id)}`
    );
    expect(text).not.toContain('PRIVATE_SENTINEL');
  });

  it('legacy inspect with no criteria emits no criteria block', async () => {
    const result = await buildProcessor(new Map([['test-gate', baseDefinition]])).handleInspect({
      action: 'inspect',
      id: 'test-gate',
    });
    expect((result.content[0] as { text: string }).text).not.toContain('Public Pass Criteria');
  });

  it.each([
    {
      result: { kind: 'boolean' },
      acceptance: { kind: 'equals', value: true },
      target: { kind: 'step_output' },
      allow_not_applicable: false,
    },
    {
      result: { kind: 'category', options: ['accurate', 'inaccurate'] },
      acceptance: { kind: 'one_of', values: ['accurate'] },
      target: { kind: 'step_output' },
      allow_not_applicable: true,
    },
    {
      result: {
        kind: 'score',
        min: 1,
        max: 5,
        anchors: [
          { value: 1, description: 'Public minimum' },
          { value: 5, description: 'Public maximum' },
        ],
      },
      acceptance: { kind: 'gte', value: 4 },
      target: { kind: 'artifact', id: 'public-artifact' },
      allow_not_applicable: false,
    },
  ])(
    'real canonical-loaded semantic inspect retains declared public definition %j without claiming artifact capture or grading',
    async (variant) => {
      const criterion = SemanticCriterionSchema.parse({
        type: 'semantic_evaluation',
        id: 'public-criterion',
        question: 'Does the output preserve the public contract?',
        evidence_requirements: { min_items: 2 },
        ...variant,
      });
      const declared = {
        ...baseDefinition,
        pass_criteria: [criterion],
        calibration_suite_id: ' unresolved:../private.json #opaque ',
        evaluation: { mode: 'judge' as const, model: 'public-hint', strict: false },
      };
      const loaded = GateDefinitionSchema.safeParse(declared);
      expect(loaded.success).toBe(true);
      if (!loaded.success) throw loaded.error;
      // A real guide holds the canonical parsed definition. No provider bypass activates SEM.
      const processor = buildProcessor(new Map([['test-gate', loaded.data]]));
      const response = await processor.handleInspect({ action: 'inspect', id: 'test-gate' });
      const text = (response.content[0] as { text: string }).text;
      expect(response.isError).toBe(false);
      expect(readPublicCriteria(text)).toEqual([criterion]);
      expect(text).toContain('Evaluation: judge (model: public-hint, strict: false)');
      expect(text).toContain(
        `Calibration Suite ID: ${JSON.stringify(declared.calibration_suite_id)}`
      );
      expect(text).not.toContain('PRIVATE_SENTINEL');
      expect(text).not.toContain('target_digest');
      expect(text).not.toContain('definition_digest');
    }
  );
});

// The tier comes from the criteria; the authored `type` keeps its own label, because a
// semantic-only gate declared `validation` runs no check.
describe('inspect names the tier the criteria require', () => {
  const semantic = SemanticCriterionSchema.parse({
    type: 'semantic_evaluation',
    id: 'public-criterion',
    question: 'Does the output preserve the public contract?',
    evidence_requirements: { min_items: 1 },
    result: { kind: 'boolean' },
    acceptance: { kind: 'equals', value: true },
    target: { kind: 'step_output' },
    allow_not_applicable: false,
  });
  const shell = { type: 'shell_verify' as const, shell_command: ['true'] };

  it.each([
    ['evaluation', [semantic]],
    ['check', [shell]],
    ['check + evaluation', [shell, semantic]],
    ['reminder', []],
  ] as const)('reads Tier: %s', async (tier, criteria) => {
    const processor = buildProcessor(
      new Map([['test-gate', { ...baseDefinition, pass_criteria: [...criteria] }]])
    );
    const result = await processor.handleInspect({ action: 'inspect', id: 'test-gate' });
    const lines = (result.content[0] as { text: string }).text.split('\n');
    expect(lines).toContain(`  - Tier: ${tier}`);
    expect(lines).toContain('  - Declared Type: validation');
    expect(lines.some((line) => line.startsWith('  - Type:'))).toBe(false);
  });
});

// List derives the tier through the same function inspect does, so a semantic-only gate declared
// `validation` is not listed with the check icon.
describe('list names the tier the criteria require', () => {
  const semantic = SemanticCriterionSchema.parse({
    type: 'semantic_evaluation',
    id: 'public-criterion',
    question: 'Does the output preserve the public contract?',
    evidence_requirements: { min_items: 1 },
    result: { kind: 'boolean' },
    acceptance: { kind: 'equals', value: true },
    target: { kind: 'step_output' },
    allow_not_applicable: false,
  });
  const shell = { type: 'shell_verify' as const, shell_command: ['true'] };

  function buildListProcessor(definitions: GateDefinitionYaml[]): GateDiscoveryProcessor {
    const guides = definitions.map((def) => new GenericGateGuide(GateDefinitionSchema.parse(def)));
    const gateManager = {
      list: () => guides,
      getStats: () => ({ totalGates: guides.length, enabledGates: guides.length }),
      getQuarantine: () => EMPTY_QUARANTINE_VIEW,
    } as unknown as GateManager;
    return new GateDiscoveryProcessor({ gateManager } as unknown as GateResourceContext);
  }

  it('lists each gate under the tier its criteria require, not its authored type', async () => {
    const processor = buildListProcessor([
      { ...baseDefinition, id: 'sem-gate', name: 'Sem', pass_criteria: [semantic] },
      { ...baseDefinition, id: 'mixed-gate', name: 'Mixed', pass_criteria: [shell, semantic] },
      { ...baseDefinition, id: 'guide-gate', name: 'Guide', type: 'guidance' },
    ]);
    const result = await processor.handleList({ action: 'list' } as GateManagerInput);
    const lines = (result.content[0] as { text: string }).text.split('\n');
    expect(lines).toContain('  sem-gate: Sem [evaluation]');
    expect(lines).toContain('  mixed-gate: Mixed [check + evaluation]');
    expect(lines).toContain('  guide-gate: Guide [reminder]');
    expect(lines.some((line) => line.includes('✓') || line.includes('📖'))).toBe(false);
  });
});

// The refusals and renderings `list` and `inspect` hand to a `resource_manager` caller. Each
// drives the real `GateDiscoveryProcessor`; the only doubles are the registry's `list`/`get`/
// `getStats` answers, and the quarantine is a real `ResourceQuarantine` the way a loader fills it.
describe('GateDiscoveryProcessor — list and inspect boundaries', () => {
  const BUNDLED_ROOT = '/srv/bundled/gates';
  const WORKSPACE_ROOT = '/srv/workspace/gates';

  interface DiscoveryFixture {
    definitions?: GateDefinitionYaml[];
    disabledIds?: string[];
    refused?: Array<{ id: string; root: string; error: string }>;
  }

  function buildDiscovery(fixture: DiscoveryFixture = {}): GateDiscoveryProcessor {
    const guides = (fixture.definitions ?? []).map(
      (def) =>
        new GenericGateGuide({
          ...GateDefinitionSchema.parse(def),
          sourceRoot: BUNDLED_ROOT,
        })
    );
    const disabled = new Set(fixture.disabledIds ?? []);
    const quarantine = new ResourceQuarantine();
    for (const refusal of fixture.refused ?? []) {
      quarantine.sinkFor('gate', refusal.root).record({
        id: refusal.id,
        path: `${refusal.root}/${refusal.id}/gate.yaml`,
        error: refusal.error,
      });
    }
    const gateManager = {
      list: (enabledOnly: boolean) =>
        guides.filter((guide) => !enabledOnly || !disabled.has(guide.gateId)),
      get: (id: string) => guides.find((guide) => guide.gateId === id),
      getStats: () => ({
        totalGates: guides.length,
        enabledGates: guides.length - disabled.size,
      }),
      getQuarantine: () => quarantine,
    } as unknown as GateManager;
    return new GateDiscoveryProcessor({ gateManager } as unknown as GateResourceContext);
  }

  const textOf = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

  describe('list', () => {
    it('says no gates were found and names the enabled-only filter that was applied', async () => {
      const processor = buildDiscovery();
      const filtered = textOf(await processor.handleList({ action: 'list' }));
      const unfiltered = textOf(
        await processor.handleList({ action: 'list', enabled_only: false })
      );

      expect(filtered).toContain('No gates found (enabled only)');
      expect(filtered).toContain('action:"create"');
      // Positive control: the suffix tracks the filter rather than being constant text.
      expect(unfiltered).toContain('No gates found');
      expect(unfiltered).not.toContain('(enabled only)');
    });

    it('names a refused gate file on the empty list instead of a bare "no gates"', async () => {
      const processor = buildDiscovery({
        refused: [
          { id: 'broken-gate', root: WORKSPACE_ROOT, error: 'missing required field: name' },
        ],
      });
      const result = await processor.handleList({ action: 'list' });

      expect(result.isError).toBe(false);
      const text = textOf(result);
      expect(text).toContain('No gates found');
      expect(text).toContain('Quarantined');
      expect(text).toContain(`${WORKSPACE_ROOT}/broken-gate/gate.yaml`);
      expect(text).toContain('missing required field: name');
      // Nothing serves this id, so it is not reported as shadowed.
      expect(text).not.toContain('shadowed');
    });

    it('counts disabled gates and lists them only when enabled_only is false', async () => {
      const processor = buildDiscovery({
        definitions: [
          { ...baseDefinition, id: 'on-gate', name: 'On' },
          { ...baseDefinition, id: 'off-gate', name: 'Off' },
        ],
        disabledIds: ['off-gate'],
      });

      const enabledOnly = textOf(await processor.handleList({ action: 'list' }));
      expect(enabledOnly).toContain('Gates (1 total)');
      expect(enabledOnly).toContain('on-gate: On');
      expect(enabledOnly).not.toContain('off-gate');
      expect(enabledOnly).toContain('Total gates: 2');
      expect(enabledOnly).toContain('Enabled: 1');
      expect(enabledOnly).toContain('Disabled: 1');

      const all = textOf(await processor.handleList({ action: 'list', enabled_only: false }));
      expect(all).toContain('Gates (2 total)');
      expect(all).toContain('off-gate: Off');
    });

    it('marks a refused file whose id another root still serves as shadowed, naming that root', async () => {
      const processor = buildDiscovery({
        definitions: [{ ...baseDefinition, id: 'shared-gate', name: 'Shared' }],
        refused: [{ id: 'shared-gate', root: WORKSPACE_ROOT, error: 'bad yaml' }],
      });
      const text = textOf(await processor.handleList({ action: 'list' }));

      expect(text).toContain('shared-gate: Shared');
      expect(text).toContain('Quarantined');
      expect(text).toContain(`currently served from ${BUNDLED_ROOT}`);
    });
  });

  describe('inspect', () => {
    it('refuses a call with no id', async () => {
      const result = await buildDiscovery().handleInspect({ action: 'inspect' });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('❌ Gate ID is required for inspect action');
    });

    it('answers "not found" for an id nothing serves and nothing quarantined', async () => {
      const result = await buildDiscovery({
        refused: [{ id: 'other-gate', root: WORKSPACE_ROOT, error: 'bad yaml' }],
      }).handleInspect({ action: 'inspect', id: 'missing-gate' });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("❌ Gate 'missing-gate' not found");
    });

    it('reports the refused file, case-insensitively, instead of "not found" for a quarantined id', async () => {
      const processor = buildDiscovery({
        refused: [{ id: 'broken-gate', root: WORKSPACE_ROOT, error: 'unknown key: foo' }],
      });
      const result = await processor.handleInspect({ action: 'inspect', id: 'Broken-Gate' });

      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).not.toContain('not found');
      expect(text).toContain('Quarantined');
      expect(text).toContain(`${WORKSPACE_ROOT}/broken-gate/gate.yaml`);
      expect(text).toContain('unknown key: foo');
    });

    it('appends the shadowed-file note to a healthy gate whose namesake file was refused', async () => {
      const processor = buildDiscovery({
        definitions: [baseDefinition],
        refused: [{ id: 'test-gate', root: WORKSPACE_ROOT, error: 'bad yaml' }],
      });
      const result = await processor.handleInspect({ action: 'inspect', id: 'test-gate' });

      expect(result.isError).toBe(false);
      const text = textOf(result);
      expect(text).toContain('Another file for this id failed to load');
      expect(text).toContain(`served from ${BUNDLED_ROOT}`);
      // Positive control: the same gate with no refused namesake carries no note.
      const clean = textOf(
        await buildDiscovery({ definitions: [baseDefinition] }).handleInspect({
          action: 'inspect',
          id: 'test-gate',
        })
      );
      expect(clean).not.toContain('Another file');
    });

    it('truncates guidance past 500 characters and leaves a 500-character guide whole', async () => {
      const long = 'g'.repeat(501);
      const exact = 'e'.repeat(500);
      const inspectGuidance = async (guidance: string): Promise<string> => {
        const text = textOf(
          await buildDiscovery({ definitions: [{ ...baseDefinition, guidance }] }).handleInspect({
            action: 'inspect',
            id: 'test-gate',
          })
        );
        return text.slice(text.indexOf('📝 Guidance:\n') + '📝 Guidance:\n'.length);
      };

      expect(await inspectGuidance(long)).toBe('g'.repeat(500) + '...');
      expect(await inspectGuidance(exact)).toBe(exact);
    });

    it('reads back an authored blockResponseOnFail:false and gate_type, and omits the former when undeclared', async () => {
      const declared = textOf(
        await buildDiscovery({
          definitions: [{ ...baseDefinition, blockResponseOnFail: false, gate_type: 'framework' }],
        }).handleInspect({ action: 'inspect', id: 'test-gate' })
      );
      expect(declared).toContain('Blocks Response On Fail: false');
      expect(declared).toContain('Classification: framework');

      const silent = textOf(
        await buildDiscovery({ definitions: [baseDefinition] }).handleInspect({
          action: 'inspect',
          id: 'test-gate',
        })
      );
      expect(silent).not.toContain('Blocks Response On Fail');
      // The schema defaults `gate_type`, so an undeclared gate reads back the default, never `undefined`.
      expect(silent).toContain('Classification: custom');
    });

    it.each([
      [{ mode: 'self' as const }, '  - Evaluation: self'],
      [{ mode: 'judge' as const, model: 'haiku' }, '  - Evaluation: judge (model: haiku)'],
      [{ mode: 'judge' as const, strict: true }, '  - Evaluation: judge (strict: true)'],
      [
        { mode: 'judge' as const, model: 'haiku', strict: false },
        '  - Evaluation: judge (model: haiku, strict: false)',
      ],
    ])('reads back only the evaluation keys the author declared: %j', async (evaluation, line) => {
      const result = await buildDiscovery({
        definitions: [{ ...baseDefinition, evaluation }],
      }).handleInspect({ action: 'inspect', id: 'test-gate' });

      expect(textOf(result).split('\n')).toContain(line);
    });
  });
});
