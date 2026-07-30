import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { discoverNestedYamlDirectories } from '../../../../src/shared/utils/yaml/index.js';

describe('discoverNestedYamlDirectories', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'discover-nested-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty array for non-existent directory', () => {
    const result = discoverNestedYamlDirectories('/no/such/path', 'gate.yaml');
    expect(result).toEqual([]);
  });

  it('returns empty array for empty directory', () => {
    const result = discoverNestedYamlDirectories(tempDir, 'gate.yaml');
    expect(result).toEqual([]);
  });

  it('discovers flat structure: {id}/{entryPoint}', () => {
    // Create flat structure: tempDir/code-quality/gate.yaml
    const gateDir = join(tempDir, 'code-quality');
    mkdirSync(gateDir);
    writeFileSync(join(gateDir, 'gate.yaml'), 'id: code-quality');

    const result = discoverNestedYamlDirectories(tempDir, 'gate.yaml');
    expect(result).toEqual(['code-quality']);
  });

  it('discovers grouped structure: {group}/{id}/{entryPoint}', () => {
    // Create grouped structure: tempDir/workflow/pre-flight/gate.yaml
    const groupDir = join(tempDir, 'workflow');
    mkdirSync(groupDir);
    const gateDir = join(groupDir, 'pre-flight');
    mkdirSync(gateDir);
    writeFileSync(join(gateDir, 'gate.yaml'), 'id: pre-flight');

    const result = discoverNestedYamlDirectories(tempDir, 'gate.yaml');
    expect(result).toEqual(['pre-flight']);
  });

  it('discovers mixed flat + grouped structures', () => {
    // Flat: tempDir/code-quality/gate.yaml
    const flatDir = join(tempDir, 'code-quality');
    mkdirSync(flatDir);
    writeFileSync(join(flatDir, 'gate.yaml'), 'id: code-quality');

    // Grouped: tempDir/workflow/pre-flight/gate.yaml
    const groupDir = join(tempDir, 'workflow');
    mkdirSync(groupDir);
    const nestedDir = join(groupDir, 'pre-flight');
    mkdirSync(nestedDir);
    writeFileSync(join(nestedDir, 'gate.yaml'), 'id: pre-flight');

    // Grouped: tempDir/workflow/growth-capture/gate.yaml
    const nestedDir2 = join(groupDir, 'growth-capture');
    mkdirSync(nestedDir2);
    writeFileSync(join(nestedDir2, 'gate.yaml'), 'id: growth-capture');

    const result = discoverNestedYamlDirectories(tempDir, 'gate.yaml');
    expect(result).toEqual(['code-quality', 'growth-capture', 'pre-flight']);
  });

  it('deduplicates IDs across flat and grouped', () => {
    // Flat: tempDir/duplicate-gate/gate.yaml
    const flatDir = join(tempDir, 'duplicate-gate');
    mkdirSync(flatDir);
    writeFileSync(join(flatDir, 'gate.yaml'), 'id: duplicate-gate');

    // Grouped: tempDir/group/duplicate-gate/gate.yaml (same ID)
    const groupDir = join(tempDir, 'group');
    mkdirSync(groupDir);
    const nestedDir = join(groupDir, 'duplicate-gate');
    mkdirSync(nestedDir);
    writeFileSync(join(nestedDir, 'gate.yaml'), 'id: duplicate-gate');

    const result = discoverNestedYamlDirectories(tempDir, 'gate.yaml');
    expect(result).toEqual(['duplicate-gate']);
  });

  it('ignores directories without entry point', () => {
    // Directory exists but no gate.yaml
    mkdirSync(join(tempDir, 'no-entry'));
    writeFileSync(join(tempDir, 'no-entry', 'README.md'), 'not a gate');

    // Valid gate
    const gateDir = join(tempDir, 'valid-gate');
    mkdirSync(gateDir);
    writeFileSync(join(gateDir, 'gate.yaml'), 'id: valid-gate');

    const result = discoverNestedYamlDirectories(tempDir, 'gate.yaml');
    expect(result).toEqual(['valid-gate']);
  });

  it('ignores files at root level', () => {
    writeFileSync(join(tempDir, 'stray-file.yaml'), 'content');

    const result = discoverNestedYamlDirectories(tempDir, 'gate.yaml');
    expect(result).toEqual([]);
  });

  it('returns sorted results', () => {
    for (const name of ['zebra', 'alpha', 'middle']) {
      const dir = join(tempDir, name);
      mkdirSync(dir);
      writeFileSync(join(dir, 'gate.yaml'), `id: ${name}`);
    }

    const result = discoverNestedYamlDirectories(tempDir, 'gate.yaml');
    expect(result).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('works with different entry point names', () => {
    const dir = join(tempDir, 'my-methodology');
    mkdirSync(dir);
    writeFileSync(join(dir, 'framework.yaml'), 'id: my-methodology');

    const result = discoverNestedYamlDirectories(tempDir, 'framework.yaml');
    expect(result).toEqual(['my-methodology']);
  });
});
