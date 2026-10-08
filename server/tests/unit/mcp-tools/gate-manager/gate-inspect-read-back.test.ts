/**
 * P4.11 — gate `inspect` reads `severity`/`enforcementMode` from the definition
 * (`GateGuide.getDefinition()`), not from `gate.severity`/`gate.enforcementMode`.
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
import { formatPublicPassCriteria } from '../../../../src/mcp/tools/gate-manager/services/gate-discovery-processor.js';
import { EMPTY_QUARANTINE_VIEW } from '../../../../src/shared/utils/resource-quarantine.js';

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
    'canonical-schema-validated semantic draft preserves complete definition %j without claiming loader activation',
    (variant) => {
      const criterion = SemanticCriterionSchema.parse({
        type: 'semantic_evaluation',
        id: 'public-criterion',
        question: 'Does the output preserve the public contract?',
        evidence_requirements: { min_items: 2 },
        ...variant,
      });
      expect(readPublicCriteria(formatPublicPassCriteria([criterion]))).toEqual([criterion]);
      expect(
        GateDefinitionSchema.safeParse({ ...baseDefinition, pass_criteria: [criterion] }).success
      ).toBe(false);
    }
  );
});
