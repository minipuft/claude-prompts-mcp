/**
 * The config write path, which is now ONE implementation: read the DOCUMENT, set one dotted key,
 * write it back. `SafeConfigWriter` (mcp/tools/config-utils.ts) composes the same functions rather
 * than carrying a second copy.
 *
 * WHAT THESE CASES DEFEND. The MCP writer used to read `configManager.getConfig()` — the RESOLVED
 * runtime object — and persist that as the operator's file. Two consequences, both asserted below:
 * a section the loader does not map onto `Config` (`hooks`) vanished from the file, and keys the
 * operator never wrote appeared in it. Order matters for the same reason: a one-key toggle that
 * reorders the file makes every later diff unreadable.
 *
 * Classification: Unit (pure file operations against a temp directory).
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyConfigChange,
  readConfigFile,
  setConfigValueAtPath,
  validateConfigDocument,
} from '../../../src/cli-shared/config-operations.js';

describe('config file write path', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cpm-config-write-'));
    configPath = join(tempDir, 'config.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** Writes `document` as the config file and returns the raw text after `key` is set to `value`. */
  function setAndReread(document: Record<string, unknown>, key: string, value: string): string {
    writeFileSync(configPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
    const result = setConfigValueAtPath(configPath, key, value);
    expect(result).toMatchObject({ success: true, key });
    return readFileSync(configPath, 'utf8');
  }

  it('sets one key and leaves every other key untouched, in its original order', () => {
    const text = setAndReread(
      { a: 1, b: 2, c: 3, server: { name: 'claude-prompts', port: 9090 } },
      'server.port',
      '9091'
    );
    const reread = JSON.parse(text) as Record<string, unknown>;

    expect(Object.keys(reread)).toEqual(['a', 'b', 'c', 'server']);
    expect(reread['a']).toBe(1);
    expect(reread['b']).toBe(2);
    expect(reread['c']).toBe(3);
    expect(reread['server']).toEqual({ name: 'claude-prompts', port: 9091 });
  });

  it('keeps a section the resolved runtime config does not carry', () => {
    // `hooks` is read by the Python hooks, never mapped onto `Config`. A writer that persisted
    // `getConfig()` deleted it outright — which is the defect this case exists to catch.
    const text = setAndReread(
      { hooks: { expandedOutput: true }, gates: { enabled: false } },
      'gates.enabled',
      'true'
    );
    const reread = JSON.parse(text) as Record<string, unknown>;

    expect(reread['hooks']).toEqual({ expandedOutput: true });
    expect(reread['gates']).toEqual({ enabled: true });
  });

  it('adds nothing the operator did not write', () => {
    const text = setAndReread({ gates: { enabled: false } }, 'gates.enabled', 'true');
    const reread = JSON.parse(text) as Record<string, unknown>;

    expect(Object.keys(reread)).toEqual(['gates']);
    expect(Object.keys(reread['gates'] as object)).toEqual(['enabled']);
  });

  it('creates intermediate objects for a key whose section is absent', () => {
    const text = setAndReread({ gates: { enabled: true } }, 'telemetry.samplingRate', '0.5');
    const reread = JSON.parse(text) as Record<string, unknown>;

    expect(Object.keys(reread)).toEqual(['gates', 'telemetry']);
    expect(reread['telemetry']).toEqual({ samplingRate: 0.5 });
  });

  it('refuses an invalid value without touching the file', () => {
    const original = JSON.stringify({ server: { port: 9090 } }, null, 2) + '\n';
    writeFileSync(configPath, original, 'utf8');

    const result = setConfigValueAtPath(configPath, 'server.port', 'nine');

    expect(result.success).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('reports a missing file rather than creating one', () => {
    const result = setConfigValueAtPath(join(tempDir, 'absent.json'), 'gates.enabled', 'true');

    expect(result.success).toBe(false);
    expect(readConfigFile(join(tempDir, 'absent.json')).success).toBe(false);
  });

  describe('applyConfigChange', () => {
    it('does not mutate the document it was given', () => {
      const original = { gates: { enabled: false } };
      const updated = applyConfigChange(original, 'gates.enabled', true);

      expect(original.gates.enabled).toBe(false);
      expect((updated['gates'] as { enabled: boolean }).enabled).toBe(true);
    });
  });

  describe('validateConfigDocument', () => {
    it('accepts a document whose leaves the key table knows', () => {
      const result = validateConfigDocument({
        version: 5,
        gates: { enabled: true },
        logging: { level: 'info', directory: './logs' },
      });

      expect(result).toMatchObject({ valid: true });
      expect(result.warnings).toEqual([]);
    });

    it('reports a bad value as an error and an unknown key as a warning', () => {
      const result = validateConfigDocument({
        logging: { level: 'loud' },
        gatez: { enabled: true },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('logging.level');
      expect(result.warnings.join(' ')).toContain('gatez');
    });
  });
});
