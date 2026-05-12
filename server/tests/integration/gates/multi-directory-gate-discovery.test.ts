/**
 * Integration test for multi-directory gate discovery.
 *
 * Tests that GateDefinitionLoader correctly discovers and loads gates
 * from both primary (flat) and additional (flat + grouped) directories.
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
    `    required_patterns:`,
    `      - test`,
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
      validateOnLoad: false,
    });

    const ids = loader.discoverGates();
    expect(ids).toEqual(['code-quality', 'test-coverage']);
  });

  test('discovers gates from primary + additional directories', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: [additionalDir],
      validateOnLoad: false,
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
      validateOnLoad: false,
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
      validateOnLoad: false,
    });

    const gate = loader.loadGate('pre-flight-completion');
    expect(gate).toBeDefined();
    expect(gate!.guidance).toBe('# Pre-Flight Guidance');
  });

  test('primary gate wins on ID conflict', () => {
    // Create a conflicting gate in additional dir with same ID as primary
    const conflictDir = mkdtempSync(join(tmpdir(), 'gates-conflict-'));
    const cqDir = join(conflictDir, 'code-quality');
    mkdirSync(cqDir);
    writeFileSync(join(cqDir, 'gate.yaml'), gateYaml('code-quality', 'OVERRIDDEN Code Quality'));

    try {
      const loader = new GateDefinitionLoader({
        gatesDir: primaryDir,
        additionalGatesDirs: [conflictDir],
        validateOnLoad: false,
      });

      const gate = loader.loadGate('code-quality');
      expect(gate).toBeDefined();
      // Primary wins — name should be from primary, not additional
      expect(gate!.name).toBe('Code Quality');
    } finally {
      rmSync(conflictDir, { recursive: true, force: true });
    }
  });

  test('handles missing additional directory gracefully', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: ['/no/such/path'],
      validateOnLoad: false,
    });

    // Should not throw, should work with primary only
    const ids = loader.discoverGates();
    expect(ids).toEqual(['code-quality', 'test-coverage']);
  });

  test('getWatchDirectories returns primary + additional', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: [additionalDir],
      validateOnLoad: false,
    });

    const dirs = loader.getWatchDirectories();
    expect(dirs).toEqual([primaryDir, additionalDir]);
  });

  test('gateExists checks both primary and additional directories', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: [additionalDir],
      validateOnLoad: false,
    });

    // Primary gate
    expect(loader.gateExists('code-quality')).toBe(true);
    // Additional grouped gate
    expect(loader.gateExists('pre-flight-completion')).toBe(true);
    // Additional flat gate
    expect(loader.gateExists('standalone')).toBe(true);
    // Non-existent
    expect(loader.gateExists('no-such-gate')).toBe(false);
  });

  test('getStats includes additional directories', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: [additionalDir],
      validateOnLoad: false,
    });

    const stats = loader.getStats();
    expect(stats.gatesDir).toBe(primaryDir);
    expect(stats.additionalGatesDirs).toEqual([additionalDir]);
  });

  test('loads flat gate from additional directory', () => {
    const loader = new GateDefinitionLoader({
      gatesDir: primaryDir,
      additionalGatesDirs: [additionalDir],
      validateOnLoad: false,
    });

    const gate = loader.loadGate('standalone');
    expect(gate).toBeDefined();
    expect(gate!.id).toBe('standalone');
    expect(gate!.name).toBe('Standalone Gate');
  });
});
