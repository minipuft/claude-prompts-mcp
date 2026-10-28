/**
 * Integration test for multi-directory gate discovery.
 *
 * Tests that GateDefinitionLoader correctly discovers and loads gates
 * from both primary (flat) and additional (flat + grouped) directories, and that the primary
 * outranks an overlay on a same-id conflict.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';

/** Minimal valid gate YAML content */
function gateYaml(id: string, name: string, opts?: { guidanceFile?: string }): string {
  const lines = [
    `id: ${id}`,
    `name: ${name}`,
    `type: validation`,
    `severity: medium`,
    `description: Test gate ${id}`,
    `pass_criteria:`,
    `  - type: inline_guidance`,
  ];
  if (opts?.guidanceFile) {
    lines.push(`guidanceFile: ${opts.guidanceFile}`);
  }
  return lines.join('\n');
}

describe('Multi-Directory Gate Discovery', () => {
  let primaryDir: string;
  let additionalDir: string;

  beforeAll(() => {
    // Create primary gates directory (flat structure)
    primaryDir = mkdtempSync(join(tmpdir(), 'gates-primary-'));

    // Primary gate: code-quality
    const cqDir = join(primaryDir, 'code-quality');
    mkdirSync(cqDir);
    writeFileSync(
      join(cqDir, 'gate.yaml'),
      gateYaml('code-quality', 'Code Quality', { guidanceFile: 'guidance.md' })
    );
    writeFileSync(join(cqDir, 'guidance.md'), '# Code Quality Guidance');

    // Primary gate: test-coverage
    const tcDir = join(primaryDir, 'test-coverage');
    mkdirSync(tcDir);
    writeFileSync(join(tcDir, 'gate.yaml'), gateYaml('test-coverage', 'Test Coverage'));

    // Create additional gates directory (grouped structure)
    additionalDir = mkdtempSync(join(tmpdir(), 'gates-additional-'));

    // Grouped gate: workflow/pre-flight-completion
    const workflowDir = join(additionalDir, 'workflow');
    mkdirSync(workflowDir);
    const pfDir = join(workflowDir, 'pre-flight-completion');
    mkdirSync(pfDir);
    writeFileSync(
      join(pfDir, 'gate.yaml'),
      gateYaml('pre-flight-completion', 'Pre-Flight Completion', { guidanceFile: 'guidance.md' })
    );
    writeFileSync(join(pfDir, 'guidance.md'), '# Pre-Flight Guidance');

    // Grouped gate: workflow/growth-capture
    const gcDir = join(workflowDir, 'growth-capture');
    mkdirSync(gcDir);
    writeFileSync(join(gcDir, 'gate.yaml'), gateYaml('growth-capture', 'Growth Capture'));

    // Flat additional gate: additional-flat/standalone
    const standaloneDir = join(additionalDir, 'standalone');
    mkdirSync(standaloneDir);
    writeFileSync(join(standaloneDir, 'gate.yaml'), gateYaml('standalone', 'Standalone Gate'));
  });

  afterAll(() => {
    rmSync(primaryDir, { recursive: true, force: true });
    rmSync(additionalDir, { recursive: true, force: true });
  });

  test('discovers gates from primary directory only (regression)', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
    });

    const ids = loader.discoverGates();
    expect(ids).toEqual(['code-quality', 'test-coverage']);
  });

  test('discovers gates from primary + additional directories', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: [additionalDir],
    });

    const ids = loader.discoverGates();
    expect(ids).toEqual([
      'code-quality',
      'growth-capture',
      'pre-flight-completion',
      'standalone',
      'test-coverage',
    ]);
  });

  test('loads a gate from additional directory', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: [additionalDir],
    });

    const gate = loader.loadGate('pre-flight-completion');
    expect(gate).toBeDefined();
    expect(gate!.id).toBe('pre-flight-completion');
    expect(gate!.name).toBe('Pre-Flight Completion');
  });

  test('inlines guidance.md from additional directory', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: [additionalDir],
    });

    const gate = loader.loadGate('pre-flight-completion');
    expect(gate).toBeDefined();
    expect(gate!.guidance).toBe('# Pre-Flight Guidance');
  });

  /**
   * The primary gate wins on ID conflict, as it does for prompts: one order for every kind,
   * stated in `resourceRootPrecedence` — primary, overlays, bundled. (This case asserted the
   * opposite from P4.27, when an overlay outranked the primary; a loader configured by hand with
   * only `gatesDir` and `additionalGatesDirs` reads the same order as the composition root.)
   */
  test('the primary gate wins on ID conflict', () => {
    // A conflicting gate in an overlay dir with the same ID as one in the primary
    const conflictDir = mkdtempSync(join(tmpdir(), 'gates-conflict-'));
    const cqDir = join(conflictDir, 'code-quality');
    mkdirSync(cqDir);
    writeFileSync(join(cqDir, 'gate.yaml'), gateYaml('code-quality', 'OVERRIDDEN Code Quality'));

    try {
      const loader = new GateDefinitionLoader({
        gatesDir: primaryDir,
        additionalGatesDirs: [conflictDir],
      });

      const gate = loader.loadGate('code-quality');
      expect(gate).toBeDefined();
      // The primary wins — the name comes from the primary, not the overlay.
      expect(gate!.name).toBe('Code Quality');
      // …and it is the primary the definition reports itself as served from.
      expect(gate!.sourceRoot).toBe(primaryDir);

      // POSITIVE CONTROL, same loader: an id only the overlay defines still comes from it, so the
      // lines above are not passing because the overlay stopped being consulted.
      const overlayOnlyDir = join(conflictDir, 'overlay-only');
      mkdirSync(overlayOnlyDir);
      writeFileSync(join(overlayOnlyDir, 'gate.yaml'), gateYaml('overlay-only', 'Overlay Only'));
      expect(loader.loadGate('overlay-only')?.name).toBe('Overlay Only');
      expect(loader.loadGate('overlay-only')?.sourceRoot).toBe(conflictDir);
    } finally {
      rmSync(conflictDir, { recursive: true, force: true });
    }
  });

  test('handles missing additional directory gracefully', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: ['/no/such/path'],
    });

    // Should not throw, should work with primary only
    const ids = loader.discoverGates();
    expect(ids).toEqual(['code-quality', 'test-coverage']);
  });

  test('getWatchDirectories returns primary + additional', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: [additionalDir],
    });

    const dirs = loader.getWatchDirectories();
    expect(dirs).toEqual([primaryDir, additionalDir]);
  });

  test('loads flat gate from additional directory', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: [additionalDir],
    });

    const gate = loader.loadGate('standalone');
    expect(gate).toBeDefined();
    expect(gate!.id).toBe('standalone');
    expect(gate!.name).toBe('Standalone Gate');
  });
});
