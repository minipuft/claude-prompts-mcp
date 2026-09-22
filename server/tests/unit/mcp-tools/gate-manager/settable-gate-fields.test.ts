/**
 * P4.4 — `severity` and `enforcementMode` are authorable through the tool.
 *
 * WHY THIS MEASURES THE FILE, NOT A TOOL RESPONSE. The natural home for this proof is the
 * conformance corpus, which drives a real server and asserts on what comes back. It cannot cover
 * these two: no `inspect` path surfaces either field, so the strongest available assertion would
 * be that the call returned ok — which is true of a create that wrote loader defaults. Asserting
 * the YAML is what distinguishes "the parameter was accepted" from "the parameter was written",
 * and those two came apart in this exact subsystem before (a gate created successfully, written
 * durably to disk, and unknown to every read path until restart).
 *
 * The gap is P4.6's: `format: 'json'` is declared, routed, and read by nothing, so there is no
 * lossless projection to assert through. When P4.6 lands, this belongs in the corpus.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { load as parseYaml } from 'js-yaml';

import {
  ALL_GATE_DATA_KEYS,
  callerSuppliedGateKeys,
  GateFileWriter,
  UNSETTABLE_GATE_DATA_KEYS,
} from '../../../../src/mcp/tools/gate-manager/services/index.js';

import type { GateManagerInput } from '../../../../src/mcp/tools/gate-manager/core/types.js';
import type { ConfigManager, Logger } from '../../../../src/shared/types/index.js';

describe('settable gate fields (P4.4)', () => {
  let workspaceDir: string;
  let gatesDir: string;
  let logger: Logger;
  let configManager: ConfigManager;

  const baseGate = {
    id: 'settable-fields-gate',
    name: 'Settable Fields Gate',
    type: 'validation' as const,
    description: 'proves severity and enforcementMode reach gate.yaml',
    guidance: 'Guidance text',
  };

  const readGateYaml = (): Record<string, unknown> =>
    parseYaml(readFileSync(join(gatesDir, baseGate.id, 'gate.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-settable-gate-'));
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
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('writes a caller-supplied severity and enforcementMode into gate.yaml', async () => {
    const service = new GateFileWriter({ logger, configManager });

    const result = await service.writeGateFiles({
      ...baseGate,
      severity: 'critical',
      enforcementMode: 'blocking',
    });

    expect(result.success).toBe(true);
    const yaml = readGateYaml();
    // `critical` and `blocking` are both NON-DEFAULT: the loader defaults severity to `medium`
    // and derives enforcementMode from severity when absent. Asserting a default value here
    // would pass against a writer that dropped the parameter entirely.
    expect(yaml['severity']).toBe('critical');
    expect(yaml['enforcementMode']).toBe('blocking');
  });

  it('omitting them writes neither key, leaving the loader defaults to apply', async () => {
    const service = new GateFileWriter({ logger, configManager });

    const result = await service.writeGateFiles(baseGate);

    expect(result.success).toBe(true);
    const yaml = readGateYaml();
    // The converse of the test above. Without it, a writer that hardcoded `critical` would pass
    // the first assertion, and settability would be indistinguishable from a new default.
    expect(yaml).not.toHaveProperty('severity');
    expect(yaml).not.toHaveProperty('enforcementMode');
  });

  it('preserves an existing value when a later update omits the field', async () => {
    const service = new GateFileWriter({ logger, configManager });

    await service.writeGateFiles({ ...baseGate, severity: 'critical' });
    // The update path rebuilds gate.yaml from scratch; `PRESERVED_GATE_YAML_KEYS` is what stops
    // that rebuild from silently resetting a value the caller is not touching. Settability must
    // not cost the carry-forward — that is why these two fields are preserved rather than
    // projected keys.
    const result = await service.writeGateFiles({
      ...baseGate,
      description: 'updated, saying nothing about severity',
    });

    expect(result.success).toBe(true);
    expect(readGateYaml()['severity']).toBe('critical');
  });

  // `subject` joins this class via `PRESERVED_GATE_YAML_KEYS`'s schema-driven derivation
  // (`GATE_YAML_DECLARED_KEYS = Object.keys(GateDefinitionSchema.shape)`) rather than a
  // hand-added entry — see the constant's own comment in gate-file-writer.ts. This proves the
  // derivation actually reaches disk, not just that the constant contains the key.
  it('writes a caller-supplied subject into gate.yaml', async () => {
    const service = new GateFileWriter({ logger, configManager });

    const result = await service.writeGateFiles({
      ...baseGate,
      subject: 'code-quality',
    });

    expect(result.success).toBe(true);
    expect(readGateYaml()['subject']).toBe('code-quality');
  });

  it('preserves an existing subject when a later update omits the field', async () => {
    const service = new GateFileWriter({ logger, configManager });

    await service.writeGateFiles({ ...baseGate, subject: 'code-quality' });
    const result = await service.writeGateFiles({
      ...baseGate,
      description: 'updated, saying nothing about subject',
    });

    expect(result.success).toBe(true);
    expect(readGateYaml()['subject']).toBe('code-quality');
  });

  // ── P4.100: `blockResponseOnFail`, the same class again ────────────────────
  //
  // It was preserved on update from the day `PRESERVED_GATE_YAML_KEYS` derived itself from the
  // schema, and unauthorable the whole time: no tool parameter carried it, so the only way to
  // declare a blocking gate was a hand edit of `gate.yaml`, which this repo forbids.

  it('writes a caller-supplied blockResponseOnFail into gate.yaml', async () => {
    const service = new GateFileWriter({ logger, configManager });

    const result = await service.writeGateFiles({ ...baseGate, blockResponseOnFail: true });

    expect(result.success).toBe(true);
    expect(readGateYaml()['blockResponseOnFail']).toBe(true);
  });

  it('writes an explicit blockResponseOnFail: false rather than treating it as absent', async () => {
    const service = new GateFileWriter({ logger, configManager });

    await service.writeGateFiles({ ...baseGate, blockResponseOnFail: true });
    const result = await service.writeGateFiles({ ...baseGate, blockResponseOnFail: false });

    expect(result.success).toBe(true);
    // The distinction the whole parameter turns on: `false` is how a caller CLEARS a blocking
    // gate. A truthiness test anywhere on the path would read it as an omission and carry the
    // `true` forward — the gate would be unclearable through the tool that set it.
    expect(readGateYaml()['blockResponseOnFail']).toBe(false);
  });

  it('preserves an existing blockResponseOnFail when a later update omits the field', async () => {
    const service = new GateFileWriter({ logger, configManager });

    await service.writeGateFiles({ ...baseGate, blockResponseOnFail: true });
    const result = await service.writeGateFiles({
      ...baseGate,
      description: 'updated, saying nothing about blocking',
    });

    expect(result.success).toBe(true);
    expect(readGateYaml()['blockResponseOnFail']).toBe(true);
  });
});

/**
 * The write-scope key set, bounded against the writer's own partition.
 *
 * `GateLifecycleProcessor.handleUpdate` narrows which files a write touches by the keys THIS call
 * supplied. That set used to be a hand-written literal and had already drifted: `gate_type` was
 * missing, so an update supplying only `gate_type` planned no `gate.yaml` write and still answered
 * `✅ Gate 'x' updated successfully / 📁 Files updated` over a byte-identical file (driven against
 * `dist/` on 2026-09-21, before P4.100). A settable key missing from this set is a silent no-op
 * under a success reply — the class this file's own subject belongs to.
 *
 * Both directions, so neither a new gate-data key nor a stale mapping entry can pass.
 */
describe('callerSuppliedGateKeys covers every settable gate-data key (P4.100)', () => {
  /**
   * Every gate-data key a caller can address, minus the ones deliberately without a parameter.
   * The exception list is read from the source rather than restated, so retiring an entry there
   * fails here until the mapping gains it.
   */
  const settableKeys = (): string[] =>
    [...ALL_GATE_DATA_KEYS].filter((key) => !UNSETTABLE_GATE_DATA_KEYS.includes(key)).sort();

  /** One value per key, under the TOOL's spelling of it. */
  const everyKeySupplied: GateManagerInput = {
    action: 'update',
    id: 'covered',
    name: 'covered',
    type: 'validation',
    description: 'd',
    guidance: 'g',
    pass_criteria: [],
    activation: {},
    retry_config: {},
    severity: 'high',
    enforcementMode: 'blocking',
    gate_type: 'framework',
    subject: 'code-quality',
    blockResponseOnFail: true,
  };

  it('reports every gate-data key when the caller supplies every one of them', () => {
    expect([...callerSuppliedGateKeys(everyKeySupplied)].sort()).toEqual(settableKeys());
  });

  it('reports nothing a write path does not narrow by', () => {
    // The other direction: a mapping entry naming a key the writer has no scope for would make
    // `writesYaml` true for a field that lives nowhere, re-serializing a file nobody edited.
    for (const key of callerSuppliedGateKeys(everyKeySupplied)) {
      expect(ALL_GATE_DATA_KEYS.has(key)).toBe(true);
    }
  });

  it('reports gate_type on a gate_type-only update — the drifted entry', () => {
    expect([
      ...callerSuppliedGateKeys({ action: 'update', id: 'covered', gate_type: 'custom' }),
    ]).toEqual(['gate_type']);
  });

  it('reports blockResponseOnFail when it is false', () => {
    expect([
      ...callerSuppliedGateKeys({ action: 'update', id: 'covered', blockResponseOnFail: false }),
    ]).toEqual(['blockResponseOnFail']);
  });

  it('reports nothing when the call supplies nothing — the positive control for the four above', () => {
    // Without this, every assertion above would pass against a function that returned every key
    // unconditionally.
    expect([...callerSuppliedGateKeys({ action: 'update', id: 'covered' })]).toEqual([]);
  });
});
