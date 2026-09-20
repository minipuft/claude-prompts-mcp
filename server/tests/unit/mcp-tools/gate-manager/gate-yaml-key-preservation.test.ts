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
 * WHY THE UPDATE CALL SUPPLIES `pass_criteria`/`activation`/`retry_config`/`name`/`type` EXPLICITLY
 * `buildGateYaml` decides these five PROJECTED keys from `GateCreationData` alone — never from the
 * file on disk. In production `GateLifecycleProcessor.handleUpdate` re-supplies each one from
 * `existingGate.getDefinition()` before calling the writer (`pass_criteria: pass_criteria ??
 * existingDefinition.pass_criteria`, and so on) precisely so an update that does not mention them
 * does not lose them. This test calls `GateFileWriter` directly, one layer under that processor, so
 * it reproduces the same re-supply by hand rather than asserting a survival the writer itself never
 * promises for these five keys.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GateDefinitionSchema } from '../../../../src/engine/gates/core/gate-schema.js';
import { GateFileWriter } from '../../../../src/mcp/tools/gate-manager/services/gate-file-writer.js';
import { parseYamlOrThrow } from '../../../../src/shared/utils/yaml/yaml-parser.js';

import type { GateCreationData } from '../../../../src/mcp/tools/gate-manager/core/types.js';
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
   * deliberately superseded rather than preserved. `blockResponseOnFail` and `evaluation` have no
   * field in `GateCreationData` at all, so they can only ever survive via the on-disk fallback —
   * exactly what this file checks.
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

    // The five keys `buildGateYaml` decides from `GateCreationData` alone (never from disk) — the
    // update below has to re-supply matching values for these, exactly as
    // `GateLifecycleProcessor.handleUpdate` does from `existingGate.getDefinition()`.
    const PROJECTED_UPDATE_DATA: Pick<
      GateCreationData,
      'name' | 'type' | 'pass_criteria' | 'activation' | 'retry_config'
    > = {
      name: 'Every Key',
      type: 'validation',
      pass_criteria: [{ type: 'inline_guidance' }],
      activation: { prompt_categories: ['code'] },
      retry_config: { max_attempts: 3 },
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
});
