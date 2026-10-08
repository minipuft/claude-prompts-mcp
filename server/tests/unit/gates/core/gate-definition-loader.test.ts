import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadYaml } from 'js-yaml';

import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';
import { GateLoader } from '../../../../src/engine/gates/core/gate-loader.js';
import {
  GateDefinitionSchema,
  SemanticCriterionSchema,
  validateGateSchema,
} from '../../../../src/engine/gates/core/gate-schema.js';

import type { SemanticCriterionInput } from '../../../../src/shared/types/gate-evaluation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function minimalGate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'probe',
    name: 'Probe',
    type: 'validation',
    description: 'load probe',
    ...overrides,
  };
}

describe('standalone SemanticCriterionSchema draft contract', () => {
  const booleanDraft = {
    type: 'semantic_evaluation',
    id: 'supports-claim',
    target: { kind: 'step_output' },
    question: 'Does the output support its claim with evidence?',
    evidence_requirements: { min_items: 1 },
    result: { kind: 'boolean' },
    acceptance: { kind: 'equals', value: true },
  } satisfies SemanticCriterionInput;
  const category = { kind: 'category', options: ['supported', 'unsupported'] } as const;
  const score = {
    kind: 'score',
    min: 0,
    max: 2,
    anchors: [
      { value: 0, description: 'No support' },
      { value: 1, description: 'Partial support' },
      { value: 2, description: 'Complete support' },
    ],
  } as const;

  test.each([
    ['boolean true', booleanDraft],
    ['boolean false', { ...booleanDraft, acceptance: { kind: 'equals', value: false } }],
    [
      'category equals',
      { ...booleanDraft, result: category, acceptance: { kind: 'equals', value: 'supported' } },
    ],
    [
      'category one_of',
      {
        ...booleanDraft,
        result: category,
        acceptance: { kind: 'one_of', values: ['supported', 'unsupported'] },
      },
    ],
    ['score gte', { ...booleanDraft, result: score, acceptance: { kind: 'gte', value: 1 } }],
    ['score lte', { ...booleanDraft, result: score, acceptance: { kind: 'lte', value: 1 } }],
    ['score minimum', { ...booleanDraft, result: score, acceptance: { kind: 'gte', value: 0 } }],
    ['score maximum', { ...booleanDraft, result: score, acceptance: { kind: 'lte', value: 2 } }],
    ['artifact target', { ...booleanDraft, target: { kind: 'artifact', id: 'report' } }],
  ])('accepts %s with a defaulted N/A policy', (_name, draft) => {
    expect(SemanticCriterionSchema.parse(draft)).toEqual({ ...draft, allow_not_applicable: false });
  });

  test('preserves explicit N/A permission', () => {
    expect(
      SemanticCriterionSchema.parse({ ...booleanDraft, allow_not_applicable: true })
        .allow_not_applicable
    ).toBe(true);
  });

  test('live gate schema accepts a valid semantic criterion', () => {
    expect(SemanticCriterionSchema.safeParse(booleanDraft).success).toBe(true);
    const result = validateGateSchema(minimalGate({ pass_criteria: [booleanDraft] }), 'probe');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test.each([
    ['missing id', { id: undefined }, ['id']],
    ['blank id', { id: ' ' }, ['id']],
    ['missing question', { question: undefined }, ['question']],
    ['blank question', { question: '\n' }, ['question']],
    ['missing target', { target: undefined }, ['target']],
    ['artifact missing id', { target: { kind: 'artifact' } }, ['target', 'id']],
    ['artifact blank id', { target: { kind: 'artifact', id: ' ' } }, ['target', 'id']],
    [
      'missing evidence requirements',
      { evidence_requirements: undefined },
      ['evidence_requirements'],
    ],
    [
      'missing evidence minimum',
      { evidence_requirements: {} },
      ['evidence_requirements', 'min_items'],
    ],
    [
      'zero evidence',
      { evidence_requirements: { min_items: 0 } },
      ['evidence_requirements', 'min_items'],
    ],
    [
      'negative evidence',
      { evidence_requirements: { min_items: -1 } },
      ['evidence_requirements', 'min_items'],
    ],
    [
      'fractional evidence',
      { evidence_requirements: { min_items: 1.5 } },
      ['evidence_requirements', 'min_items'],
    ],
    [
      'infinite evidence',
      { evidence_requirements: { min_items: Infinity } },
      ['evidence_requirements', 'min_items'],
    ],
    ['missing result', { result: undefined }, ['result']],
    ['missing acceptance', { acceptance: undefined }, ['acceptance']],
    ['wrong N/A type', { allow_not_applicable: 'true' }, ['allow_not_applicable']],
    ['empty categories', { result: { kind: 'category', options: [] } }, ['result', 'options']],
    ['blank category', { result: { kind: 'category', options: [' '] } }, ['result', 'options', 0]],
    [
      'duplicate categories',
      { result: { kind: 'category', options: ['supported', 'supported'] } },
      ['result', 'options'],
    ],
    [
      'string predicate for boolean',
      { acceptance: { kind: 'equals', value: 'true' } },
      ['acceptance'],
    ],
    ['numeric predicate for boolean', { acceptance: { kind: 'gte', value: 1 } }, ['acceptance']],
    [
      'one_of for boolean',
      { acceptance: { kind: 'one_of', values: ['supported'] } },
      ['acceptance'],
    ],
    ['boolean predicate for category', { result: category }, ['acceptance']],
    [
      'unknown category equals',
      { result: category, acceptance: { kind: 'equals', value: 'invented' } },
      ['acceptance'],
    ],
    [
      'unknown category one_of',
      { result: category, acceptance: { kind: 'one_of', values: ['supported', 'invented'] } },
      ['acceptance'],
    ],
    [
      'duplicate one_of labels',
      { result: category, acceptance: { kind: 'one_of', values: ['supported', 'supported'] } },
      ['acceptance', 'values'],
    ],
    [
      'empty one_of labels',
      { result: category, acceptance: { kind: 'one_of', values: [] } },
      ['acceptance', 'values'],
    ],
    [
      'blank one_of label',
      { result: category, acceptance: { kind: 'one_of', values: [' '] } },
      ['acceptance', 'values', 0],
    ],
    [
      'score predicate for category',
      { result: category, acceptance: { kind: 'lte', value: 1 } },
      ['acceptance'],
    ],
    ['equals for score', { result: score }, ['acceptance']],
    [
      'one_of for score',
      { result: score, acceptance: { kind: 'one_of', values: ['supported'] } },
      ['acceptance'],
    ],
    [
      'numeric equals for score',
      { result: score, acceptance: { kind: 'equals', value: 1 } },
      ['acceptance', 'value'],
    ],
    [
      'score below range',
      { result: score, acceptance: { kind: 'gte', value: -1 } },
      ['acceptance'],
    ],
    ['score above range', { result: score, acceptance: { kind: 'lte', value: 3 } }, ['acceptance']],
    [
      'infinite score predicate',
      { result: score, acceptance: { kind: 'gte', value: Infinity } },
      ['acceptance', 'value'],
    ],
    [
      'NaN score predicate',
      { result: score, acceptance: { kind: 'lte', value: NaN } },
      ['acceptance', 'value'],
    ],
    [
      'executable predicate',
      { acceptance: { kind: 'expression', expression: 'value === true' } },
      ['acceptance', 'kind'],
    ],
  ])('rejects %s at the affected path', (_name, overrides, path) => {
    const result = SemanticCriterionSchema.safeParse({ ...booleanDraft, ...overrides });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Malformed draft unexpectedly parsed');
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual(path);
  });

  test.each([
    ['nonfinite minimum', { min: -Infinity }, ['result', 'min']],
    ['nonfinite maximum', { max: Infinity }, ['result', 'max']],
    ['NaN minimum', { min: NaN }, ['result', 'min']],
    ['NaN maximum', { max: NaN }, ['result', 'max']],
    ['equal bounds', { max: 0 }, ['result', 'max']],
    ['reversed bounds', { min: 3 }, ['result', 'max']],
    ['missing anchors', { anchors: undefined }, ['result', 'anchors']],
    ['empty anchors', { anchors: [] }, ['result', 'anchors']],
    ['one anchor', { anchors: [score.anchors[0]] }, ['result', 'anchors']],
    ['reversed anchors', { anchors: [...score.anchors].reverse() }, ['result', 'anchors']],
    [
      'duplicate anchors',
      { anchors: [score.anchors[0], score.anchors[0], score.anchors[2]] },
      ['result', 'anchors'],
    ],
    [
      'missing minimum anchor',
      { anchors: [score.anchors[1], score.anchors[2]] },
      ['result', 'anchors'],
    ],
    [
      'missing maximum anchor',
      { anchors: [score.anchors[0], score.anchors[1]] },
      ['result', 'anchors'],
    ],
    [
      'out-of-bounds anchor',
      { anchors: [score.anchors[0], { value: 3, description: 'Outside' }, score.anchors[2]] },
      ['result', 'anchors'],
    ],
    [
      'nonfinite anchor',
      {
        anchors: [score.anchors[0], { value: Infinity, description: 'Outside' }, score.anchors[2]],
      },
      ['result', 'anchors', 1, 'value'],
    ],
    [
      'NaN anchor',
      { anchors: [score.anchors[0], { value: NaN, description: 'Unknown' }, score.anchors[2]] },
      ['result', 'anchors', 1, 'value'],
    ],
    [
      'blank anchor description',
      { anchors: [score.anchors[0], { value: 1, description: ' ' }, score.anchors[2]] },
      ['result', 'anchors', 1, 'description'],
    ],
    [
      'missing anchor description',
      { anchors: [score.anchors[0], { value: 1 }, score.anchors[2]] },
      ['result', 'anchors', 1, 'description'],
    ],
  ])('rejects malformed score: %s', (_name, overrides, path) => {
    const result = SemanticCriterionSchema.safeParse({
      ...booleanDraft,
      result: { ...score, ...overrides },
      acceptance: { kind: 'gte', value: 1 },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Malformed score unexpectedly parsed');
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual(path);
  });

  test.each([
    ['expression', { expression: 'run()' }],
    ['target.expression', { target: { kind: 'step_output', expression: 'run()' } }],
    ['target.id', { target: { kind: 'step_output', id: 'undeclared' } }],
    [
      'evidence_requirements.expression',
      { evidence_requirements: { min_items: 1, expression: 'run()' } },
    ],
    ['result.expression', { result: { kind: 'boolean', expression: 'run()' } }],
    ['result.extra', { result: { ...category, extra: true } }],
    [
      'result.anchors[0].expression',
      {
        result: {
          ...score,
          anchors: [{ ...score.anchors[0], expression: 'run()' }, score.anchors[2]],
        },
      },
    ],
    ['acceptance.expression', { acceptance: { kind: 'equals', value: true, expression: 'run()' } }],
    ['acceptance.extra', { acceptance: { kind: 'one_of', values: ['supported'], extra: true } }],
    ['acceptance.extra', { acceptance: { kind: 'gte', value: 1, extra: true } }],
    ['acceptance.extra', { acceptance: { kind: 'lte', value: 1, extra: true } }],
  ])('refuses unknown key %s with its address', (path, overrides) => {
    const result = SemanticCriterionSchema.safeParse({ ...booleanDraft, ...overrides });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Unknown key unexpectedly parsed');
    expect(
      result.error.issues.some(
        (issue) => issue.code === 'unrecognized_keys' && issue.message.includes(path)
      )
    ).toBe(true);
  });
});

/**
 * Root-cause coverage for the guidance.md trailing-newline defect
 * (tutorial-rework B.18): `inlineReferencedFiles` used to `.trim()` the
 * content it read from `guidance.md`, so every loaded gate's `getGuidance()` — and anything that
 * falls back to it, like an update omitting `guidance` — disagreed with the file on disk by
 * exactly its leading/trailing whitespace. The prompt loader's equivalent inlining
 * (`yaml-prompt-loader.ts`, `systemMessageFile`/`userMessageTemplateFile`) never trimmed; this
 * brings the gate loader in line with that sibling.
 */
describe('GateDefinitionLoader guidance.md inlining', () => {
  let workspaceDir: string;
  let gatesDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-gate-def-loader-'));
    gatesDir = join(workspaceDir, 'gates');
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  function writeGate(id: string, guidanceContent: string): string {
    const gateDir = join(gatesDir, id);
    mkdirSync(gateDir, { recursive: true });
    writeFileSync(
      join(gateDir, 'gate.yaml'),
      [
        `id: ${id}`,
        'name: Newline Gate',
        'type: validation',
        'description: Exercises guidance.md inlining',
        'guidanceFile: guidance.md',
        '',
      ].join('\n'),
      'utf8'
    );
    writeFileSync(join(gateDir, 'guidance.md'), guidanceContent, 'utf8');
    return gateDir;
  }

  test('inlines guidance.md verbatim, trailing newline included', () => {
    const guidanceContent = 'Check the thing.\n';
    writeGate('newline-gate', guidanceContent);

    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('newline-gate');

    expect(definition).toBeDefined();
    // MUTATION KILLED: reverting the fix (`content.trim()` instead of `content`) drops the
    // trailing `\n` and this becomes `'Check the thing.'` — confirmed by applying the mutation,
    // re-running this file (red), and reverting.
    expect(definition?.guidance).toBe(guidanceContent);
  });

  test('inlines guidance.md verbatim when the file has no trailing newline', () => {
    const guidanceContent = 'Check the thing without a trailing newline.';
    writeGate('no-newline-gate', guidanceContent);

    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('no-newline-gate');

    expect(definition?.guidance).toBe(guidanceContent);
  });

  test('preserves leading whitespace too — inlining is verbatim, not just trailing-newline-safe', () => {
    const guidanceContent = '\n  Indented first line.\nSecond line.\n';
    writeGate('leading-whitespace-gate', guidanceContent);

    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('leading-whitespace-gate');

    expect(definition?.guidance).toBe(guidanceContent);
  });

  test('the guidanceFile reference itself is still removed after inlining', () => {
    writeGate('cleans-up-gate', 'Guidance body.\n');

    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('cleans-up-gate');

    expect(definition?.guidanceFile).toBeUndefined();
  });
});

describe('GateDefinitionSchema `subject` and removed `llm_self_check` type', () => {
  test('rejects `llm_self_check` with a message naming the fix', () => {
    const result = validateGateSchema(
      minimalGate({ pass_criteria: [{ type: 'llm_self_check' }] }),
      'probe'
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('never had a runner');
  });

  test('rejects a `subject` that is not kebab-case', () => {
    const result = validateGateSchema(minimalGate({ subject: 'Not Kebab' }), 'probe');

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('subject');
  });

  test('accepts a kebab-case `subject`', () => {
    const result = validateGateSchema(minimalGate({ subject: 'code-quality' }), 'probe');

    expect(result.valid).toBe(true);
    expect(result.data?.subject).toBe('code-quality');
  });

  test('rejects a criterion carrying a pattern/length field, naming the field and the fix', () => {
    const result = validateGateSchema(
      minimalGate({
        pass_criteria: [{ type: 'inline_guidance', required_patterns: ['^export'] }],
      }),
      'probe'
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('pass_criteria[0].required_patterns');
    expect(result.errors.join('\n')).toContain('guidance.md');
  });
});

// `subject` on disk must reach BOTH the raw definition GateDefinitionLoader hands back and the
// LightweightGateDefinition GateLoader normalizes into (`toGateDefinition` builds that shape
// from an exhaustive key table — a key the table does not name is not carried).
describe('subject propagates from gate.yaml to the loaded definition', () => {
  let workspaceDir: string;
  let gatesDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-gate-subject-'));
    gatesDir = join(workspaceDir, 'gates');
    const gateDir = join(gatesDir, 'subject-gate');
    mkdirSync(gateDir, { recursive: true });
    writeFileSync(
      join(gateDir, 'gate.yaml'),
      [
        'id: subject-gate',
        'name: Subject Gate',
        'type: validation',
        'description: Exercises subject propagation',
        'subject: security',
        '',
      ].join('\n'),
      'utf8'
    );
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('GateDefinitionLoader.loadGate carries subject through from the raw YAML', () => {
    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('subject-gate');

    expect(definition?.subject).toBe('security');
  });

  test('GateLoader.loadGate carries subject into the normalized LightweightGateDefinition', async () => {
    const gateLoader = new GateLoader(mockLogger as any, gatesDir);
    const gate = await gateLoader.loadGate('subject-gate');

    expect(gate?.subject).toBe('security');
  });
});

describe('opaque calibration suite association propagates without private lookup', () => {
  let workspaceDir: string;
  let gatesDir: string;
  let gatePath: string;

  function writeGate(value?: unknown): void {
    writeFileSync(
      gatePath,
      [
        'id: association-gate',
        'name: Association Gate',
        'type: validation',
        'description: Inert association metadata',
        ...(value === undefined ? [] : [`calibration_suite_id: ${JSON.stringify(value)}`]),
        '',
      ].join('\n'),
      'utf8'
    );
  }

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-gate-association-'));
    gatesDir = join(workspaceDir, 'gates');
    mkdirSync(join(gatesDir, 'association-gate'), { recursive: true });
    gatePath = join(gatesDir, 'association-gate', 'gate.yaml');
  });
  afterEach(() => rmSync(workspaceDir, { recursive: true, force: true }));

  test('raw and normalized loaders retain the exact opaque value', async () => {
    const opaque = '  suite:opaque/id?revision=1  ';
    writeGate(opaque);
    expect(
      new GateDefinitionLoader({ gatesDir }).loadGate('association-gate')?.calibration_suite_id
    ).toBe(opaque);
    expect(
      (await new GateLoader(mockLogger as any, gatesDir).loadGate('association-gate'))
        ?.calibration_suite_id
    ).toBe(opaque);
  });

  test('absence remains accepted by both loaders', async () => {
    writeGate();
    const raw = new GateDefinitionLoader({ gatesDir }).loadGate('association-gate');
    const normalized = await new GateLoader(mockLogger as any, gatesDir).loadGate(
      'association-gate'
    );
    expect(raw).toBeDefined();
    expect(normalized).not.toBeNull();
    expect(raw?.calibration_suite_id).toBeUndefined();
    expect(normalized?.calibration_suite_id).toBeUndefined();
  });

  test.each(['', '   ', 1, false, null, ['suite'], { id: 'suite' }])(
    'refuses invalid association %p at its schema path',
    async (value) => {
      const parsed = GateDefinitionSchema.safeParse(minimalGate({ calibration_suite_id: value }));
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error('Invalid association unexpectedly parsed');
      expect(parsed.error.issues.map((issue) => issue.path)).toContainEqual([
        'calibration_suite_id',
      ]);
      writeGate(value);
      expect(new GateDefinitionLoader({ gatesDir }).loadGate('association-gate')).toBeUndefined();
      expect(
        await new GateLoader(mockLogger as any, gatesDir).loadGate('association-gate')
      ).toBeNull();
    }
  );

  test('a private-file-looking identifier is carried without filesystem lookup or execution', () => {
    const privateFile = join(workspaceDir, 'private-suite.mjs');
    const marker = join(workspaceDir, 'executed');
    writeFileSync(
      privateFile,
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed');\n`
    );
    writeGate(privateFile);
    const serverRoot = resolve(__dirname, '../../../..');
    const probe = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const privateFile = ${JSON.stringify(privateFile)};
      const touched = [];
      for (const name of ['existsSync', 'readFileSync', 'statSync']) {
        const original = fs[name];
        fs[name] = (...args) => { if (String(args[0]) === privateFile) touched.push(name); return original(...args); };
      }
      syncBuiltinESMExports();
      const { GateDefinitionLoader } = await import(${JSON.stringify(join(serverRoot, 'src/engine/gates/core/gate-definition-loader.ts'))});
      const { GateLoader } = await import(${JSON.stringify(join(serverRoot, 'src/engine/gates/core/gate-loader.ts'))});
      const raw = new GateDefinitionLoader({ gatesDir: ${JSON.stringify(gatesDir)} }).loadGate('association-gate');
      const logger = { debug(){}, info(){}, warn(){}, error(){} };
      const normalized = await new GateLoader(logger, ${JSON.stringify(gatesDir)}).loadGate('association-gate');
      assert.equal(raw.calibration_suite_id, privateFile);
      assert.equal(normalized.calibration_suite_id, privateFile);
      assert.deepEqual(touched, []);
      fs.existsSync(privateFile); // Positive control: the observer can see the prohibited lookup.
      assert.deepEqual(touched, ['existsSync']);
    `;
    execFileSync(
      process.execPath,
      [
        '--import',
        join(serverRoot, 'node_modules/tsx/dist/loader.mjs'),
        '--input-type=module',
        '--eval',
        probe,
      ],
      { timeout: 15_000 }
    );
    expect(existsSync(marker)).toBe(false);
  });
});

// Row 0.6 measured that nothing ran the 26 registry gate.yaml files through
// GateDefinitionSchema, so a malformed `subject:` there (or any other schema violation)
// passed silently — a per-instance fix (row 0.6's own edits) does not close a per-CLASS
// gap. This closes the class: every registry gate is validated, not just the ones a test
// happens to name.
describe('every registry gate.yaml satisfies GateDefinitionSchema', () => {
  const registryGatesDir = join(__dirname, '../../../../resources/gates');
  const registryLoader = new GateDefinitionLoader({
    gatesDir: registryGatesDir,
    enableCache: false,
  });
  const gateIds = readdirSync(registryGatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'config')
    .map((entry) => entry.name)
    .sort();

  test('the registry has not silently lost or gained gates', () => {
    // Guards the fixture itself: a count assertion below only means something if this
    // enumeration still finds all 26 directories carrying a `subject:` (25 from row 0.6,
    // plus `handoff-artifacts`).
    expect(gateIds.length).toBe(26);
  });

  test.each(gateIds)('%s: valid against the schema, with a kebab-case subject', (gateId) => {
    const raw = registryLoader.loadGate(gateId);
    expect(raw).toBeDefined();

    const result = validateGateSchema(raw, gateId);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data?.subject).toBeDefined();
    expect(result.data?.subject).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

// Ruling B17 — the loader parses instead of casting, so the schema's `.default()` values reach
// the object a consumer holds. Before this, `loadGate` returned the raw YAML and threw away
// `validateGateSchema`'s `result.data`, which left every default decorative and made six
// hand-written `?? 'medium'` / `?? 'custom'` guards do the schema's job at each read site.
describe('GateDefinitionLoader applies schema defaults to what it returns', () => {
  let workspaceDir: string;
  let gatesDir: string;
  let gateYamlText: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-gate-defaults-'));
    gatesDir = join(workspaceDir, 'gates');
    const gateDir = join(gatesDir, 'defaults-gate');
    mkdirSync(gateDir, { recursive: true });
    // No `severity`, no `gate_type`. `retry_config` is present but empty: zod applies a nested
    // object's field defaults only when the object itself is present, because
    // `GateRetryConfigSchema` is `.optional()` on the parent.
    gateYamlText = [
      'id: defaults-gate',
      'name: Defaults Gate',
      'type: validation',
      'description: Exercises schema defaults on load',
      'retry_config: {}',
      'pass_criteria:',
      '  - type: inline_guidance',
      '',
    ].join('\n');
    writeFileSync(join(gateDir, 'gate.yaml'), gateYamlText, 'utf8');
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('severity, gate_type and retry_config.max_attempts come back defaulted', () => {
    // POSITIVE CONTROL: the file itself declares none of these. Without this the assertions
    // below would pass just as well against a loader that returned the raw YAML of a fixture
    // that happened to spell the defaults out.
    const onDisk = loadYaml(gateYamlText) as Record<string, unknown>;
    expect(onDisk['severity']).toBeUndefined();
    expect(onDisk['gate_type']).toBeUndefined();
    expect(onDisk['retry_config']).toEqual({});

    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('defaults-gate');

    expect(definition).toBeDefined();
    // MUTATION KILLED: making `loadFromYamlDir` return the raw object again instead of
    // `validation.data` turns each of these into `undefined` — confirmed by applying the
    // mutation, re-running this file (red), and reverting.
    expect(definition?.severity).toBe('medium');
    expect(definition?.gate_type).toBe('custom');
    expect(definition?.retry_config?.max_attempts).toBe(2);
  });

  test('guidance.md is still inlined, and guidanceFile is gone, now that inlining happens pre-parse', () => {
    const gateDir = join(gatesDir, 'defaults-gate');
    writeFileSync(
      join(gateDir, 'gate.yaml'),
      gateYamlText.replace('retry_config: {}', 'guidanceFile: guidance.md'),
      'utf8'
    );
    writeFileSync(join(gateDir, 'guidance.md'), 'Inlined before the parse.\n', 'utf8');

    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('defaults-gate');

    expect(definition?.guidance).toBe('Inlined before the parse.\n');
    expect(definition?.guidanceFile).toBeUndefined();
  });
});
