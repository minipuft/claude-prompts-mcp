/**
 * P4.67 — a `gate.yaml` update that changes one key must leave every other key alone, including
 * one `GateDefinitionSchema` does not declare at all.
 *
 * WHAT WENT WRONG
 * `GateDefinitionSchema` is `.passthrough()`, but `GateFileWriter.buildGateYaml` rebuilt
 * `gate.yaml` from an empty object populated only with the projected fields (P4.67's own row) and
 * the schema-declared preserved fields (`PRESERVED_GATE_YAML_KEYS`, P4.4). A key the schema does
 * not model at all — the passthrough case the schema comment says it exists to allow — had no
 * path onto that object, so a description-only update deleted it. `PRESERVED_GATE_YAML_KEYS`
 * already carries every SCHEMA-DECLARED key forward; this row is the layer under that: a document
 * REBUILT from those two sources instead of the file on disk drops anything the schema was never
 * told about.
 *
 * WHY THE FIXTURE IS HAND-AUTHORED
 * A file seeded through `GateFileWriter` already has the writer's own key order, so an update over
 * it can only prove idempotence. The fixture below is written as YAML text with a key order the
 * writer would not produce, plus a key the schema never declares.
 *
 * WHY THE UPDATE CALL RE-SUPPLIES PROJECTED VALUES EXPLICITLY
 * `buildGateYaml` decides PROJECTED keys from `GateCreationData` alone — never from the
 * file on disk. In production `GateLifecycleProcessor.handleUpdate` re-supplies each one from
 * `existingGate.getDefinition()` before calling the writer (`pass_criteria: pass_criteria ??
 * existingDefinition.pass_criteria`, and so on) precisely so an update that does not mention them
 * does not lose them. This test calls `GateFileWriter` directly, one layer under that processor, so
 * it reproduces the same re-supply by hand rather than asserting a survival the writer itself never
 * promises for these keys, including authored `calibration_suite_id` and `evaluation`.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GateDefinitionSchema } from '../../../../src/engine/gates/core/gate-schema.js';
import {
  GATE_YAML_PROJECTED_KEYS,
  PRESERVED_GATE_YAML_KEYS,
} from '../../../../src/engine/gates/core/gate-yaml-keys.js';
import { GATE_SNAPSHOT_PROJECTED_KEYS } from '../../../../src/modules/versioning/projections/gate-snapshot.js';
import { projectGateSnapshot } from '../../../../src/modules/versioning/projections/gate-snapshot.js';
import { gateSnapshotContract } from '../../../../src/mcp/tools/gate-manager/services/gate-snapshot-contract.js';
import {
  callerSuppliedGateKeys,
  GateFileWriter,
} from '../../../../src/mcp/tools/gate-manager/services/gate-file-writer.js';
import { parseYamlOrThrow } from '../../../../src/shared/utils/yaml/yaml-parser.js';

import type { GateCreationData } from '../../../../src/mcp/tools/gate-manager/core/types.js';
import type { SemanticCriterionInput } from '../../../../src/shared/types/gate-evaluation.js';
import type { ConfigManager, Logger } from '../../../../src/shared/types/index.js';

describe('gate.yaml keys survive an update that did not name them (P4.67)', () => {
  let workspaceDir: string;
  let gatesDir: string;
  let logger: Logger;
  let configManager: ConfigManager;
  let writer: GateFileWriter;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-gate-yamlkeep-'));
    gatesDir = join(workspaceDir, 'gates');
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    configManager = {
      getGatesDirectory: () => gatesDir,
      getBundledResourceDirectory: () => undefined,
    } as unknown as ConfigManager;
    writer = new GateFileWriter({ logger, configManager });
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 5 });
  });

  const gateDir = (id: string): string => join(gatesDir, id);
  const yamlPath = (id: string): string => join(gateDir(id), 'gate.yaml');

  function writeFixture(id: string, gateYaml: string, guidance = 'Guidance.\n'): void {
    mkdirSync(gateDir(id), { recursive: true });
    writeFileSync(yamlPath(id), gateYaml, 'utf8');
    writeFileSync(join(gateDir(id), 'guidance.md'), guidance, 'utf8');
  }

  const readYaml = (id: string): Record<string, unknown> =>
    parseYamlOrThrow<Record<string, unknown>>(readFileSync(yamlPath(id), 'utf8'));

  describe('the hand-authored shape', () => {
    const id = 'keep_probe';
    // Deliberate: a passthrough key the schema never declares, and a top-level order the writer
    // does not use (`severity` before `name`, `guidanceFile` last).
    const AUTHORED = [
      'id: keep_probe',
      'severity: critical',
      'name: Keep Probe',
      'x-authorNote: kept by whoever wrote it',
      'description: Original description.',
      'type: validation',
      'guidanceFile: guidance.md',
      '',
    ].join('\n');

    beforeEach(() => writeFixture(id, AUTHORED));

    async function updateDescriptionOnly(description: string): Promise<void> {
      const result = await writer.writeGateFiles(
        {
          id,
          name: 'Keep Probe',
          type: 'validation',
          description,
          guidance: 'Guidance.\n',
        },
        new Set(['description'])
      );
      expect(result.success).toBe(true);
    }

    it('applies the description it was asked to change', async () => {
      await updateDescriptionOnly('Patched description.');

      expect(readYaml(id)['description']).toBe('Patched description.');
    });

    // MUTATION TARGET: reverting `planGateWrite` to `serializeYaml(this.buildGateYaml(...))`
    // (dropping the `overlayDecidedYamlKeys` wrap) turns this red — `x-authorNote` has no field
    // anywhere in `GateCreationData` or `PRESERVED_GATE_YAML_KEYS`, so nothing else carries it.
    it('keeps the passthrough key the schema does not declare', async () => {
      await updateDescriptionOnly('Patched description.');

      expect(readYaml(id)['x-authorNote']).toBe('kept by whoever wrote it');
    });

    // Contrast case: this one is already covered by `PRESERVED_GATE_YAML_KEYS` (P4.4) and stays
    // green even with the mutation above reverted — included so the passthrough case above is
    // read against a schema-declared key that already worked.
    it('keeps the preserved severity it was not asked to change', async () => {
      await updateDescriptionOnly('Patched description.');

      expect(readYaml(id)['severity']).toBe('critical');
    });

    // MUTATION TARGET: same revert as above turns this red too — the rebuilt document uses the
    // writer's own key order (id, name, type, description, guidanceFile, then preserved keys),
    // not the file's.
    it('keeps the authored top-level key order', async () => {
      await updateDescriptionOnly('Patched description.');

      expect(Object.keys(readYaml(id))).toEqual([
        'id',
        'severity',
        'name',
        'x-authorNote',
        'description',
        'type',
        'guidanceFile',
      ]);
    });
  });

  /**
   * The class, not the instance: every key `GateDefinitionSchema` accepts survives an update that
   * did not name it, plus one key the schema only passes through. `guidance` is excluded by
   * design (`GATE_YAML_EXCLUDED_KEYS`) — it lives in `guidance.md`, and a stale inline value is
   * deliberately superseded rather than preserved. A preserved field omitted from this call
   * survives via the on-disk fallback even when `GateCreationData` can supply it — exactly what
   * this file checks.
   */
  describe('every key the schema accepts', () => {
    const id = 'every_key';

    const NOT_SEEDED: Record<string, string> = {
      guidance: 'lives in guidance.md; GATE_YAML_EXCLUDED_KEYS deliberately never round-trips it',
    };

    const SEEDS: Record<string, string> = {
      id: `id: ${id}`,
      name: 'name: Every Key',
      type: 'type: validation',
      description: 'description: Original description.',
      subject: 'subject: code-quality',
      calibration_suite_id: 'calibration_suite_id: suite:opaque-v1',
      severity: 'severity: critical',
      enforcementMode: 'enforcementMode: blocking',
      gate_type: 'gate_type: framework',
      guidanceFile: 'guidanceFile: guidance.md',
      pass_criteria: 'pass_criteria:\n  - type: inline_guidance',
      retry_config: 'retry_config:\n  max_attempts: 3',
      activation: 'activation:\n  prompt_categories: [code]',
      blockResponseOnFail: 'blockResponseOnFail: true',
      evaluation: 'evaluation:\n  mode: judge',
    };

    /** The schema is `.passthrough()`, so an unknown key loads — and must survive a write too. */
    const PASSTHROUGH_SEED = 'x-authorNote: kept by whoever wrote it';

    // The projected keys `buildGateYaml` decides from `GateCreationData` alone (never from disk) — the
    // update below has to re-supply matching values for these, exactly as
    // `GateLifecycleProcessor.handleUpdate` does from `existingGate.getDefinition()`.
    const PROJECTED_UPDATE_DATA: Pick<
      GateCreationData,
      | 'name'
      | 'type'
      | 'pass_criteria'
      | 'activation'
      | 'retry_config'
      | 'calibration_suite_id'
      | 'evaluation'
    > = {
      name: 'Every Key',
      type: 'validation',
      pass_criteria: [{ type: 'inline_guidance' }],
      activation: { prompt_categories: ['code'] },
      retry_config: { max_attempts: 3 },
      calibration_suite_id: 'suite:opaque-v1',
      evaluation: { mode: 'judge' },
    };

    it('seeds every schema key, or says why it cannot', () => {
      const schemaKeys = Object.keys(GateDefinitionSchema.shape).sort();
      const covered = [...Object.keys(SEEDS), ...Object.keys(NOT_SEEDED)].sort();

      expect(covered).toEqual(schemaKeys);
    });

    it.each([...Object.keys(SEEDS), 'x-authorNote'])(
      'keeps %s through a description-only update',
      async (key) => {
        writeFixture(id, `${[...Object.values(SEEDS), PASSTHROUGH_SEED].join('\n')}\n`);
        const before = readYaml(id);

        const result = await writer.writeGateFiles(
          {
            id,
            description: 'Patched description.',
            guidance: 'Guidance.\n',
            ...PROJECTED_UPDATE_DATA,
          },
          new Set(['description'])
        );
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

  describe('opaque calibration suite metadata uses the generic writer route', () => {
    const id = 'association_probe';
    const data: GateCreationData = {
      id,
      name: 'Association Probe',
      type: 'validation',
      description: 'Original description.',
      guidance: 'Guidance.\n',
    };

    it('creates an opaque identifier and reads back the exact YAML value', async () => {
      const opaque = '  suite:opaque/id?revision=1  ';
      const result = await writer.writeGateFiles({ ...data, calibration_suite_id: opaque });
      expect(result.success).toBe(true);
      expect(readYaml(id)['calibration_suite_id']).toBe(opaque);
    });

    it('replaces an existing identifier with a metadata-only write', async () => {
      expect(
        (await writer.writeGateFiles({ ...data, calibration_suite_id: 'suite:original' })).success
      ).toBe(true);
      const guidanceBefore = readFileSync(join(gateDir(id), 'guidance.md'));
      const opaque = '../opaque/id:replacement';
      const result = await writer.writeGateFiles(
        { ...data, calibration_suite_id: opaque },
        callerSuppliedGateKeys({ action: 'update', id, calibration_suite_id: opaque })
      );
      expect(result.success).toBe(true);
      expect(readYaml(id)['calibration_suite_id']).toBe(opaque);
      expect(readFileSync(join(gateDir(id), 'guidance.md'))).toEqual(guidanceBefore);
    });

    it('preserves a scoped omission when its caller re-supplies the loaded association', async () => {
      const opaque = 'suite:keep/exact#revision';
      writeFixture(
        id,
        [
          'id: association_probe',
          'name: Association Probe',
          'type: validation',
          'description: Original description.',
          `calibration_suite_id: ${JSON.stringify(opaque)}`,
          'guidanceFile: guidance.md',
          '',
        ].join('\n')
      );
      const result = await writer.writeGateFiles(
        {
          ...data,
          description: 'Changed description.',
          calibration_suite_id: readYaml(id)['calibration_suite_id'] as string,
        },
        callerSuppliedGateKeys({ action: 'update', id, description: 'Changed description.' })
      );
      expect(result.success).toBe(true);
      expect(readYaml(id)['description']).toBe('Changed description.');
      expect(readYaml(id)['calibration_suite_id']).toBe(opaque);
    });

    it('plans a metadata-only YAML change and applies the same value on disk', async () => {
      expect((await writer.writeGateFiles(data)).success).toBe(true);
      const opaque = 'suite:metadata-only';
      const keys = callerSuppliedGateKeys({ action: 'update', id, calibration_suite_id: opaque });
      const changes = await writer.projectGateWrite(
        { ...data, calibration_suite_id: opaque },
        keys
      );
      expect(changes.map((change) => change.path)).toEqual([`${id}/gate.yaml`]);
      expect(
        parseYamlOrThrow<Record<string, unknown>>(changes[0]!.after!)['calibration_suite_id']
      ).toBe(opaque);
      expect(readYaml(id)['calibration_suite_id']).toBeUndefined();
      const result = await writer.writeGateFiles({ ...data, calibration_suite_id: opaque }, keys);
      expect(result.success).toBe(true);
      expect(readYaml(id)['calibration_suite_id']).toBe(opaque);
      expect(readFileSync(yamlPath(id), 'utf8')).toBe(changes[0]!.after);
    });

    it('derives authored snapshot membership from the canonical YAML partition', () => {
      expect(GATE_YAML_PROJECTED_KEYS).toContain('calibration_suite_id');
      expect(PRESERVED_GATE_YAML_KEYS).not.toContain('calibration_suite_id');
      expect(GATE_SNAPSHOT_PROJECTED_KEYS).toContain('calibration_suite_id');
    });

    it('a whole-state write without the association removes the current identifier', async () => {
      expect(
        (await writer.writeGateFiles({ ...data, calibration_suite_id: 'suite:current' })).success
      ).toBe(true);
      expect(readYaml(id)['calibration_suite_id']).toBe('suite:current');
      const result = await writer.writeGateFiles(data);
      expect(result.success).toBe(true);
      expect(Object.hasOwn(readYaml(id), 'calibration_suite_id')).toBe(false);
      expect(readYaml(id)['description']).toBe(data.description);
    });
  });

  describe('authored evaluation whole-state projection', () => {
    const id = 'evaluation_probe';
    const data: GateCreationData = {
      id,
      name: 'Evaluation Probe',
      type: 'validation',
      description: 'Authored state',
      guidance: 'Public guidance.\n',
    };
    const evaluation = { mode: 'judge' as const, model: 'declared-model', strict: false };

    it('includes the authored evaluation block in the derived snapshot', async () => {
      expect((await writer.writeGateFiles({ ...data, evaluation })).success).toBe(true);
      expect(GATE_YAML_PROJECTED_KEYS).toContain('evaluation');
      expect(PRESERVED_GATE_YAML_KEYS).not.toContain('evaluation');
      expect(GATE_SNAPSHOT_PROJECTED_KEYS).toContain('evaluation');
      const snapshot = projectGateSnapshot(id, {
        name: data.name,
        type: data.type,
        description: data.description,
        guidance: data.guidance,
        definition: readYaml(id),
      });
      expect(snapshot['evaluation']).toEqual(evaluation);
    });

    it('removes stale evaluation when restoring an explicit whole state without it', async () => {
      expect((await writer.writeGateFiles({ ...data, evaluation })).success).toBe(true);
      expect(readYaml(id)['evaluation']).toEqual(evaluation);
      const restored = gateSnapshotContract.restore(id, { ...data });
      if (!restored.ok) throw new Error('Valid whole-state fixture was refused');
      expect(restored.writeModel).not.toHaveProperty('evaluation');
      expect((await writer.writeGateFiles(restored.writeModel)).success).toBe(true);
      expect(readYaml(id)).not.toHaveProperty('evaluation');
    });
  });

  describe('passive staged semantic authoring remains refused by live writes', () => {
    const id = 'staged_semantic_probe';
    const data: GateCreationData = {
      id,
      name: 'Staged Semantic Probe',
      type: 'validation',
      description: 'Public draft',
      guidance: 'Public guidance.\n',
    };
    const criteria: SemanticCriterionInput[] = [
      {
        type: 'semantic_evaluation',
        id: 'public-boolean',
        target: { kind: 'step_output' },
        question: 'Does the output retain the public contract?',
        result: { kind: 'boolean' },
        acceptance: { kind: 'equals', value: true },
        evidence_requirements: { min_items: 1 },
      },
      {
        type: 'semantic_evaluation',
        id: 'public-category',
        target: { kind: 'artifact', id: 'public-reference' },
        question: 'Classify public evidence.',
        result: { kind: 'category', options: ['supported', 'unknown'] },
        acceptance: { kind: 'one_of', values: ['supported'] },
        evidence_requirements: { min_items: 2 },
        allow_not_applicable: true,
      },
      {
        type: 'semantic_evaluation',
        id: 'public-score',
        target: { kind: 'step_output' },
        question: 'Score public evidence.',
        result: {
          kind: 'score',
          min: 0,
          max: 2,
          anchors: [
            { value: 0, description: 'None' },
            { value: 2, description: 'Complete' },
          ],
        },
        acceptance: { kind: 'gte', value: 2 },
        evidence_requirements: { min_items: 1 },
        allow_not_applicable: false,
      },
    ];
    const mixedCriteria: NonNullable<GateCreationData['pass_criteria']> = [
      ...criteria,
      { type: 'shell_verify', shell_command: ['node', '--version'] },
    ];
    const evaluation = { mode: 'judge' as const, model: 'declared-model', strict: false };

    it('passively projects every public semantic field and evaluation without writing', async () => {
      expect((await writer.writeGateFiles(data)).success).toBe(true);
      const before = readFileSync(yamlPath(id));
      const guidanceBefore = readFileSync(join(gateDir(id), 'guidance.md'));
      const changes = await writer.projectGateWrite(
        { ...data, pass_criteria: mixedCriteria, evaluation },
        new Set(['pass_criteria', 'evaluation'])
      );
      expect(changes.map((change) => change.path)).toEqual([`${id}/gate.yaml`]);
      const projected = parseYamlOrThrow<Record<string, unknown>>(changes[0]!.after!);
      expect(projected['pass_criteria']).toEqual(mixedCriteria);
      expect(projected['evaluation']).toEqual(evaluation);
      expect(readFileSync(yamlPath(id))).toEqual(before);
      expect(readFileSync(join(gateDir(id), 'guidance.md'))).toEqual(guidanceBefore);
    });

    it('passive criterion omission preserves a re-supplied public draft and replacement replaces it', async () => {
      writeFixture(
        id,
        JSON.stringify({
          ...data,
          guidanceFile: 'guidance.md',
          pass_criteria: mixedCriteria,
          evaluation,
        })
      );
      const before = readFileSync(yamlPath(id));
      const retained = await writer.projectGateWrite(
        { ...data, description: 'Changed description', pass_criteria: mixedCriteria, evaluation },
        new Set(['description'])
      );
      expect(
        parseYamlOrThrow<Record<string, unknown>>(retained[0]!.after!)['pass_criteria']
      ).toEqual(mixedCriteria);
      const replacement = [
        { ...criteria[0]!, id: 'replacement', question: 'Replacement public question.' },
      ];
      const replaced = await writer.projectGateWrite(
        { ...data, pass_criteria: replacement, evaluation },
        new Set(['pass_criteria'])
      );
      expect(
        parseYamlOrThrow<Record<string, unknown>>(replaced[0]!.after!)['pass_criteria']
      ).toEqual(replacement);
      expect(readFileSync(yamlPath(id))).toEqual(before);
    });

    it('real live verification refuses a staged semantic write and restores existing bytes', async () => {
      expect((await writer.writeGateFiles({ ...data, evaluation: { mode: 'self' } })).success).toBe(
        true
      );
      const before = readFileSync(yamlPath(id));
      const guidanceBefore = readFileSync(join(gateDir(id), 'guidance.md'));
      const result = await writer.writeGateFiles({
        ...data,
        guidance: 'Changed guidance',
        pass_criteria: mixedCriteria,
        evaluation,
      });
      expect(result.success).toBe(false);
      expect(result.verificationFailure?.rolledBack).toBe(true);
      expect(readFileSync(yamlPath(id))).toEqual(before);
      expect(readFileSync(join(gateDir(id), 'guidance.md'))).toEqual(guidanceBefore);
    });
  });
});
