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

import type { FrameworkResourceDefinition } from '../../../../src/engine/frameworks/definitions/framework-definition-types.js';

/**
 * Discover then load every id, the same shape `FrameworkRegistry.loadBuiltInGuides` runs in
 * production (`registry.ts`) rather than the loader's own `loadAllFrameworks`, which nothing
 * calls (R36, unreached-methods baseline) — the quarantine behaviour below is still exercised
 * through the two methods that ARE live: `discoverFrameworks` and `loadFramework`.
 */
function loadAll(loader: RuntimeFrameworkLoader): Map<string, FrameworkResourceDefinition> {
  const results = new Map<string, FrameworkResourceDefinition>();
  for (const id of loader.discoverFrameworks()) {
    const definition = loader.loadFramework(id);
    if (definition) {
      results.set(id, definition);
    }
  }
  return results;
}

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
    const loaded = loadAll(loader);

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
    loadAll(loader);

    // `systemPromptGuidance` is instruction delivered to the client LLM, and this is the file
    // whose content has NOT been checked.
    const serialized = JSON.stringify(loader.getQuarantine().list());
    expect(serialized).not.toContain('FRAMEWORK_GUIDANCE_MARKER');
    expect(serialized).not.toContain('schema-invalid on purpose');
  });

  it('leaves the id served from the other root — a broken file never takes an id dark', () => {
    // Broken file in the HIGHER-precedence root (P4.27: an overlay outranks the primary) — the
    // only arrangement that reaches a refusal at all, since a root the loader never opens records
    // nothing. Here that also keeps the server startable: `loadBuiltInGuides` throws FATAL on an
    // id it cannot resolve, so one malformed overlay must not be able to refuse the boot.
    writeFramework(overlay, 'sharedfw', schemaInvalidFramework('sharedfw'));
    writeFramework(primary, 'sharedfw', validFramework('sharedfw'));

    const loader = new RuntimeFrameworkLoader({
      frameworksDir: primary,
      additionalFrameworksDirs: [overlay],
    });

    const definition = loader.loadFramework('sharedfw');
    expect(definition?.name).toBe('sharedfw framework');

    const records = loader.getQuarantine().byId('sharedfw');
    expect(records).toHaveLength(1);
    expect(records[0]?.root).toBe(overlay);
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
    loadAll(loader);
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
    loadAll(loader);

    const records = loader.getQuarantine().byId('phasefw');
    expect(records).toHaveLength(1);
    // Against framework.yaml, not phases.yaml: the entry point is what a repair rewrites and what
    // `resolveExistingFrameworkDir` locates. The error text still names the phases failure.
    expect(records[0]?.path).toBe(entryPath);
    expect(records[0]?.error).toContain('phases');

    // POSITIVE CONTROL for the phases branch specifically.
    expect(loader.getQuarantine().byId('goodfw')).toHaveLength(0);
  });

  // ==========================================================================
  // P4.18 — provenance
  // ==========================================================================

  /**
   * The loader stamps the root it READ the file from — the gate loader's twin.
   *
   * Asserted at the loader rather than at the renderer (ruling R7): the quarantine report must
   * carry this value through, never work it out, because resolving the roots a second time is how
   * two answers to one question start disagreeing.
   */
  it('stamps the root a definition was read from, not the root that was asked first', () => {
    writeFramework(overlay, 'sharedfw', schemaInvalidFramework('sharedfw'));
    writeFramework(primary, 'sharedfw', validFramework('sharedfw'));
    writeFramework(primary, 'primaryfw', validFramework('primaryfw'));

    const loader = new RuntimeFrameworkLoader({
      frameworksDir: primary,
      additionalFrameworksDirs: [overlay],
    });

    // The shadow case: `overlay` outranks the primary, was consulted first, and refused — so the
    // root that SERVES is the one below it.
    expect(loader.loadFramework('sharedfw')?.sourceRoot).toBe(primary);
    // POSITIVE CONTROL, same probe: a framework only the primary holds also stamps the primary.
    expect(loader.loadFramework('primaryfw')?.sourceRoot).toBe(primary);
  });

  it('stamps the serving root while the refusal record keeps the refused root', () => {
    writeFramework(overlay, 'sharedfw', schemaInvalidFramework('sharedfw'));
    writeFramework(primary, 'sharedfw', validFramework('sharedfw'));

    const loader = new RuntimeFrameworkLoader({
      frameworksDir: primary,
      additionalFrameworksDirs: [overlay],
    });

    // Both halves of the shadow line, from one load: the file to repair is in one root, the
    // definition being served is from the other.
    expect(loader.loadFramework('sharedfw')?.sourceRoot).toBe(primary);
    expect(loader.getQuarantine().byId('sharedfw')[0]?.root).toBe(overlay);
  });

  it('overwrites a sourceRoot the file itself declared', () => {
    // `sourceRoot` is not in `FrameworkSchema`, whose `.passthrough()` would otherwise carry an
    // authored one onto the definition. The stamp runs after validation so a framework file cannot
    // claim a provenance it does not have.
    writeFramework(
      primary,
      'liarfw',
      [validFramework('liarfw').trimEnd(), 'sourceRoot: /somewhere/else', ''].join('\n')
    );

    const loader = new RuntimeFrameworkLoader({ frameworksDir: primary });

    expect(loader.loadFramework('liarfw')?.sourceRoot).toBe(primary);
  });
});
