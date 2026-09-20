/**
 * `SafeConfigWriter` — the writer behind `system_control config set`.
 *
 * The property under test is that a toggle issued over MCP costs the operator nothing they wrote
 * by hand. The writer still parses the document, but only to validate what the file will MEAN;
 * the file itself is edited as text. A regression here is silent and total — the comments simply
 * stop being in the file after the first toggle, and every other gate stays green.
 *
 * The backup half matters for the same reason: a backup whose name lost the `.jsonc` extension
 * would restore as a file a strict reader rejects, so the round-trip is asserted on bytes.
 *
 * Classification: Unit (temp directory, no server; `ConfigManager` is a stub whose only job is to
 * record that the reload happened).
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('backs the file up under its own extension, and the backup restores byte for byte', async () => {
    const writer = writerFor('config.jsonc', COMMENTED_CONFIG);

    const result = await writer.updateConfigValue('gates.enabled', 'true');
    expect(result.backupPath).toContain('config.jsonc.backup.');
    expect(readFileSync(result.backupPath as string, 'utf8')).toBe(COMMENTED_CONFIG);

    const restore = await writer.restoreFromBackup(result.backupPath as string);

    expect(restore.success).toBe(true);
    expect(readFileSync(writer.getConfigPath(), 'utf8')).toBe(COMMENTED_CONFIG);
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
