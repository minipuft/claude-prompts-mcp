/**
 * `SafeConfigWriter` — the writer behind `system_control config set`.
 *
 * The property under test is that a toggle issued over MCP costs the operator nothing they wrote
 * by hand. The writer still parses the document, but only to validate what the file will MEAN;
 * the file itself is edited as text. A regression here is silent and total — the comments simply
 * stop being in the file after the first toggle, and every other gate stays green.
 *
 * The backup half matters for the same reason: a backup whose name lost the `.jsonc` extension
 * would be unusable as a restore source, so its bytes and extension are asserted directly.
 * `restoreFromBackup` itself was deleted (P4.81, 2026-09-20) -- no caller has existed since
 * PR #312 retired `system_control config restore`; the backup this test checks currently has
 * no reader.
 *
 * Classification: Unit (temp directory, no server; `ConfigManager` is a stub whose only job is to
 * record that the reload happened).
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSafeConfigWriter } from '../../../src/mcp/tools/config-utils.js';
import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';

const COMMENTED_CONFIG = `// Production config — the comments are the handover notes.

{
  /* Gates gate the review chain. */
  "gates": {
    "enabled": false, // turned off during the 4471 incident
  },

  "logging": { "level": "info" },
}
`;

const SILENT_LOGGER: Logger = {
  info: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
};

describe('SafeConfigWriter', () => {
  let tempDir: string;
  let reloads: number;
  let configManager: ConfigManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cpm-safe-writer-'));
    reloads = 0;
    configManager = {
      loadConfig: () => {
        reloads += 1;
        return Promise.resolve();
      },
    } as unknown as ConfigManager;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writerFor(
    fileName: string,
    contents: string
  ): ReturnType<typeof createSafeConfigWriter> {
    const configPath = join(tempDir, fileName);
    writeFileSync(configPath, contents, 'utf8');
    return createSafeConfigWriter(SILENT_LOGGER, configManager, configPath);
  }

  it('changes one value in a commented config.jsonc and leaves every other byte', async () => {
    const writer = writerFor('config.jsonc', COMMENTED_CONFIG);

    const result = await writer.updateConfigValue('gates.enabled', 'true');

    expect(result.success).toBe(true);
    expect(readFileSync(writer.getConfigPath(), 'utf8')).toBe(
      COMMENTED_CONFIG.replace('"enabled": false', '"enabled": true')
    );
    expect(reloads).toBe(1);
  });

  it('leaves no backup file beside the config it wrote', async () => {
    const writer = writerFor('config.jsonc', COMMENTED_CONFIG);

    const result = await writer.updateConfigValue('gates.enabled', 'true');
    expect(result.success).toBe(true);
    // The prior bytes are a `version_history` row now (ruling R53), not a timestamped copy
    // nothing could restore. `cpm config rollback` is what reads them back.
    expect(readdirSync(tempDir).filter((name) => name.includes('.backup.'))).toEqual([]);
    // Positive control: the probe reads the directory the config actually sits in.
    expect(readdirSync(tempDir)).toContain('config.jsonc');
  });

  it('refuses when the workspace holds both config names, naming both paths', async () => {
    const writer = writerFor('config.jsonc', COMMENTED_CONFIG);
    writeFileSync(join(tempDir, 'config.json'), '{\n  "version": 5\n}\n', 'utf8');

    const result = await writer.updateConfigValue('gates.enabled', 'true');

    expect(result.success).toBe(false);
    expect(result.message).toContain(join(tempDir, 'config.jsonc'));
    expect(result.message).toContain(join(tempDir, 'config.json'));
    expect(readFileSync(writer.getConfigPath(), 'utf8')).toBe(COMMENTED_CONFIG);
    expect(reloads).toBe(0);
  });

  it('refuses an invalid value before anything reaches disk', async () => {
    const writer = writerFor('config.jsonc', COMMENTED_CONFIG);

    const result = await writer.updateConfigValue('logging.level', 'loud');

    expect(result.success).toBe(false);
    expect(readFileSync(writer.getConfigPath(), 'utf8')).toBe(COMMENTED_CONFIG);
    expect(reloads).toBe(0);
  });
});
