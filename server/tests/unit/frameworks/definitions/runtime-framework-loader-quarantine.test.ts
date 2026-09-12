// @lifecycle canonical - Unit tests for framework-file refusal records (P4.15)
/**
 * A framework file the loader refuses is recorded, not dropped.
 *
 * The sibling of `gate-definition-loader-quarantine.test.ts`, and the same defect: a
 * schema-invalid framework.yaml left nothing any surface could read, so `resource_manager` — the
 * only tool allowed to author a framework — answered `Framework '<id>' not found` for a file the
 * same process had just read and rejected.
 *
 * EVERY REFUSAL ASSERTION HERE HAS A POSITIVE CONTROL, for the reason the gate file states: a
 * collection that recorded every file it touched would satisfy the refusal assertions exactly as
 * well as a correct one.
 */

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuntimeFrameworkLoader } from '../../../../src/engine/frameworks/definitions/runtime-framework-loader.js';

/** A framework.yaml that passes `validateFrameworkSchema`. */
function validFramework(id: string): string {
  return [
    `id: ${id}`,
    `name: ${id} framework`,
    `type: ${id.toUpperCase()}`,
    `version: 1.0.0`,
    `enabled: true`,
    `description: a valid framework`,
    `systemPromptGuidance: FRAMEWORK_GUIDANCE_MARKER_${id}`,
    '',
  ].join('\n');
}

/** A framework.yaml the schema refuses: `enabled` must be a boolean. */
function schemaInvalidFramework(id: string): string {
  return [
    `id: ${id}`,
    `name: ${id} framework`,
    `type: ${id.toUpperCase()}`,
    `version: 1.0.0`,
    `enabled: "definitely"`,
    `description: schema-invalid on purpose`,
    `systemPromptGuidance: FRAMEWORK_GUIDANCE_MARKER_${id}`,
    '',
  ].join('\n');
}

function writeFramework(root: string, id: string, body: string): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'framework.yaml');
  writeFileSync(path, body);
  return path;
}

describe('RuntimeFrameworkLoader quarantine (P4.15)', () => {
  let primary: string;
  let overlay: string;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    primary = mkdtempSync(join(tmpdir(), 'fw-quarantine-primary-'));
    overlay = mkdtempSync(join(tmpdir(), 'fw-quarantine-overlay-'));
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    rmSync(primary, { recursive: true, force: true });
    rmSync(overlay, { recursive: true, force: true });
  });

  it('records the refused file, and leaves a valid sibling in the same root untouched', () => {
    writeFramework(primary, 'goodfw', validFramework('goodfw'));
    const brokenPath = writeFramework(primary, 'brokenfw', schemaInvalidFramework('brokenfw'));

    const loader = new RuntimeFrameworkLoader({ frameworksDir: primary });
    const loaded = loader.loadAllFrameworks();

    expect(loaded.has('brokenfw')).toBe(false);
    const records = loader.getQuarantine().byId('brokenfw');
    expect(records).toHaveLength(1);
    expect(records[0]?.type).toBe('framework');
    expect(records[0]?.path).toBe(brokenPath);
    expect(records[0]?.root).toBe(primary);
    expect(records[0]?.error).toContain('enabled');

    // POSITIVE CONTROL.
    expect(loaded.has('goodfw')).toBe(true);
    expect(loader.getQuarantine().byId('goodfw')).toHaveLength(0);
    expect(loader.getQuarantine().size).toBe(1);
  });

  it('never carries the authored body of a file that failed validation', () => {
    writeFramework(primary, 'brokenfw', schemaInvalidFramework('brokenfw'));

    const loader = new RuntimeFrameworkLoader({ frameworksDir: primary });
    loader.loadAllFrameworks();

    // `systemPromptGuidance` is instruction delivered to the client LLM, and this is the file
    // whose content has NOT been checked.
    const serialized = JSON.stringify(loader.getQuarantine().list());
    expect(serialized).not.toContain('FRAMEWORK_GUIDANCE_MARKER');
    expect(serialized).not.toContain('schema-invalid on purpose');
  });

  it('leaves the id served from the other root — a broken file never takes an id dark', () => {
    writeFramework(primary, 'sharedfw', schemaInvalidFramework('sharedfw'));
    writeFramework(overlay, 'sharedfw', validFramework('sharedfw'));

    const loader = new RuntimeFrameworkLoader({
      frameworksDir: primary,
      additionalFrameworksDirs: [overlay],
    });

    const definition = loader.loadFramework('sharedfw');
    expect(definition?.name).toBe('sharedfw framework');

    const records = loader.getQuarantine().byId('sharedfw');
    expect(records).toHaveLength(1);
    expect(records[0]?.root).toBe(primary);
  });

  it('does not record an id a root simply does not hold', () => {
    writeFramework(overlay, 'overlayonly', validFramework('overlayonly'));

    const loader = new RuntimeFrameworkLoader({
      frameworksDir: primary,
      additionalFrameworksDirs: [overlay],
    });
    expect(loader.loadFramework('overlayonly')).toBeDefined();

    expect(loader.getQuarantine().size).toBe(0);
  });

  it('drops the record when the same file loads on a later read', () => {
    const brokenPath = writeFramework(primary, 'brokenfw', schemaInvalidFramework('brokenfw'));

    const loader = new RuntimeFrameworkLoader({ frameworksDir: primary });
    loader.loadAllFrameworks();
    expect(loader.getQuarantine().isRefused(brokenPath)).toBe(true);

    writeFileSync(brokenPath, validFramework('brokenfw'));
    loader.clearCache('brokenfw');
    expect(loader.loadFramework('brokenfw')).toBeDefined();

    expect(loader.getQuarantine().isRefused(brokenPath)).toBe(false);
  });

  it('records a phases.yaml failure against the entry point the repair writes', () => {
    writeFramework(primary, 'goodfw', validFramework('goodfw'));
    const entryPath = writeFramework(
      primary,
      'phasefw',
      [validFramework('phasefw').trimEnd(), 'phasesFile: phases.yaml', ''].join('\n')
    );
    // `order` must be a positive integer — the phase-guard coherence check F1 wired up.
    writeFileSync(
      join(primary, 'phasefw', 'phases.yaml'),
      ['processingSteps:', '  - id: one', '    name: One', '    order: nope', ''].join('\n')
    );

    const loader = new RuntimeFrameworkLoader({ frameworksDir: primary });
    loader.loadAllFrameworks();

    const records = loader.getQuarantine().byId('phasefw');
    expect(records).toHaveLength(1);
    // Against framework.yaml, not phases.yaml: the entry point is what a repair rewrites and what
    // `resolveExistingFrameworkDir` locates. The error text still names the phases failure.
    expect(records[0]?.path).toBe(entryPath);
    expect(records[0]?.error).toContain('phases');

    // POSITIVE CONTROL for the phases branch specifically.
    expect(loader.getQuarantine().byId('goodfw')).toHaveLength(0);
  });
});
