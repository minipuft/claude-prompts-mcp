import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';
import { GateLoader } from '../../../../src/engine/gates/core/gate-loader.js';
import { validateGateSchema } from '../../../../src/engine/gates/core/gate-schema.js';

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
// LightweightGateDefinition GateLoader normalizes into (`toLightweightGate` builds that shape
// field by field — a field with no copy line there is silently dropped).
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

// Row 0.6 measured that nothing ran the 26 registry gate.yaml files through
// GateDefinitionSchema, so a malformed `subject:` there (or any other schema violation)
// passed silently — a per-instance fix (row 0.6's own edits) does not close a per-CLASS
// gap. This closes the class: every registry gate is validated, not just the ones a test
// happens to name.
describe('every registry gate.yaml satisfies GateDefinitionSchema', () => {
  const registryGatesDir = join(__dirname, '../../../../resources/gates');
  const registryLoader = new GateDefinitionLoader({
    gatesDir: registryGatesDir,
    validateOnLoad: false,
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
