// @lifecycle canonical - Unit tests for gate-file refusal records (P4.15)
/**
 * A gate file the loader refuses is recorded, not dropped.
 *
 * P4.9 closed this for prompts. The gate loader had the identical shape — `console.error` plus a
 * counter — so a schema-invalid gate.yaml left no trace any surface could read, and
 * `resource_manager`, the only tool allowed to author a gate, answered `Gate '<id>' not found` for
 * a file the same process had just read and rejected.
 *
 * EVERY REFUSAL ASSERTION HERE HAS A POSITIVE CONTROL. A collection that recorded every file it
 * touched would satisfy "the broken one is quarantined" exactly as well as a correct one, so each
 * case also asserts a valid sibling in the SAME root is absent from the quarantine and still loads.
 */

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';

/** A gate.yaml that passes `validateGateSchema`. */
function validGate(id: string): string {
  return [
    `id: ${id}`,
    `name: ${id} gate`,
    `type: validation`,
    `description: a valid gate`,
    `guidance: GATE_GUIDANCE_MARKER_${id}`,
    '',
  ].join('\n');
}

/** A gate.yaml the schema refuses: `type` is not one of the two accepted values. */
function schemaInvalidGate(id: string): string {
  return [
    `id: ${id}`,
    `name: ${id} gate`,
    `type: not-a-gate-type`,
    `description: schema-invalid on purpose`,
    `guidance: GATE_GUIDANCE_MARKER_${id}`,
    '',
  ].join('\n');
}

function writeGate(root: string, id: string, body: string): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'gate.yaml');
  writeFileSync(path, body);
  return path;
}

describe('GateDefinitionLoader quarantine (P4.15)', () => {
  let primary: string;
  let overlay: string;
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    primary = mkdtempSync(join(tmpdir(), 'gate-quarantine-primary-'));
    overlay = mkdtempSync(join(tmpdir(), 'gate-quarantine-overlay-'));
    // The loader reports refusals on stderr by design (it must not write to stdout under STDIO).
    // Silenced so a deliberate failure does not read as a broken suite.
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    rmSync(primary, { recursive: true, force: true });
    rmSync(overlay, { recursive: true, force: true });
  });

  it('records the refused file, and leaves a valid sibling in the same root untouched', () => {
    writeGate(primary, 'good-gate', validGate('good-gate'));
    const brokenPath = writeGate(primary, 'broken-gate', schemaInvalidGate('broken-gate'));

    const loader = new GateDefinitionLoader({ gatesDir: primary });
    const loaded = loader.loadAllGates();

    expect(loaded.has('broken-gate')).toBe(false);
    const records = loader.getQuarantine().byId('broken-gate');
    expect(records).toHaveLength(1);
    expect(records[0]?.type).toBe('gate');
    expect(records[0]?.path).toBe(brokenPath);
    expect(records[0]?.root).toBe(primary);
    expect(records[0]?.error).toContain('type');

    // POSITIVE CONTROL. Without it, a collection that recorded every file it walked would pass the
    // four assertions above.
    expect(loaded.has('good-gate')).toBe(true);
    expect(loader.getQuarantine().byId('good-gate')).toHaveLength(0);
    expect(loader.getQuarantine().size).toBe(1);
  });

  it('never carries the authored body of a file that failed validation', () => {
    writeGate(primary, 'broken-gate', schemaInvalidGate('broken-gate'));

    const loader = new GateDefinitionLoader({ gatesDir: primary });
    loader.loadAllGates();

    // A gate's `guidance` and `description` are instruction delivered to the client LLM, and this
    // is the file whose content has NOT been checked — so the record must be structurally unable
    // to publish it. Serialized whole rather than field-by-field: a future field added to the
    // record type is caught by this without anyone remembering to extend the assertion.
    const serialized = JSON.stringify(loader.getQuarantine().list());
    expect(serialized).not.toContain('GATE_GUIDANCE_MARKER');
    expect(serialized).not.toContain('schema-invalid on purpose');
  });

  it('leaves the id served from the other root — a broken file never takes an id dark', () => {
    writeGate(primary, 'shared-gate', schemaInvalidGate('shared-gate'));
    writeGate(overlay, 'shared-gate', validGate('shared-gate'));

    const loader = new GateDefinitionLoader({
      gatesDir: primary,
      additionalGatesDirs: [overlay],
    });

    // The falsifier's second half: the refusal in the nearer root must not remove the id.
    const definition = loader.loadGate('shared-gate');
    expect(definition?.name).toBe('shared-gate gate');

    // …and the refusal is still ANNOUNCED, against the file that actually failed.
    const records = loader.getQuarantine().byId('shared-gate');
    expect(records).toHaveLength(1);
    expect(records[0]?.root).toBe(primary);
  });

  it('does not record an id a root simply does not hold', () => {
    writeGate(overlay, 'overlay-only', validGate('overlay-only'));

    const loader = new GateDefinitionLoader({
      gatesDir: primary,
      additionalGatesDirs: [overlay],
    });
    expect(loader.loadGate('overlay-only')).toBeDefined();

    // The primary root was consulted first and had no such directory. Recording that as a refusal
    // would quarantine every id the fall-through asks about, which is most of them.
    expect(loader.getQuarantine().size).toBe(0);
  });

  it('drops the record when the same file loads on a later read', () => {
    const brokenPath = writeGate(primary, 'broken-gate', schemaInvalidGate('broken-gate'));

    const loader = new GateDefinitionLoader({ gatesDir: primary });
    loader.loadAllGates();
    expect(loader.getQuarantine().isRefused(brokenPath)).toBe(true);

    // What a repair through `resource_manager` does: rewrite the file, clear the cache, re-read.
    writeFileSync(brokenPath, validGate('broken-gate'));
    loader.clearCache('broken-gate');
    expect(loader.loadGate('broken-gate')).toBeDefined();

    expect(loader.getQuarantine().isRefused(brokenPath)).toBe(false);
    expect(loader.getQuarantine().byId('broken-gate')).toHaveLength(0);
  });

  it('records a file that is present but does not parse as YAML', () => {
    writeGate(primary, 'good-gate', validGate('good-gate'));
    writeGate(primary, 'unparseable', 'id: [unterminated\n  - :: nope\n');

    const loader = new GateDefinitionLoader({ gatesDir: primary });
    loader.loadAllGates();

    expect(loader.getQuarantine().byId('unparseable')).toHaveLength(1);
    // POSITIVE CONTROL for the throwing branch specifically.
    expect(loader.getQuarantine().byId('good-gate')).toHaveLength(0);
  });
});
