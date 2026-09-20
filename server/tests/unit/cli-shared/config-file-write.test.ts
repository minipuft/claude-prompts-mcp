/**
 * The config write path, which is now ONE implementation: read the DOCUMENT, edit one dotted key
 * IN THE FILE'S TEXT, write it back. `SafeConfigWriter` (mcp/tools/config-utils.ts) composes the
 * same functions rather than carrying a second copy.
 *
 * WHAT THESE CASES DEFEND. The MCP writer used to read `configManager.getConfig()` — the RESOLVED
 * runtime object — and persist that as the operator's file. Two consequences, both asserted below:
 * a section the loader does not map onto `Config` (`hooks`) vanished from the file, and keys the
 * operator never wrote appeared in it. Order matters for the same reason: a one-key toggle that
 * reorders the file makes every later diff unreadable.
 *
 * The byte-identity cases go further, and they use HAND-AUTHORED fixtures on purpose: a fixture
 * the writer itself produced can only demonstrate idempotence, never that a human's comments,
 * odd key order, blank lines and four-space section survive a `set`. Each one is paired with a
 * control running the OLD whole-document behaviour over the same fixture, so "the file is
 * unchanged apart from that value" is an assertion shown able to fail.
 *
 * Classification: Unit (pure file operations against a temp directory).
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONFIG_JSONC_TEMPLATE } from '../../../src/cli-shared/_generated/config-template.js';
import {
  applyConfigChange,
  generateDefaultConfig,
  initConfig,
  readConfig,
  readConfigFile,
  resetConfig,
  resolveConfigPath,
  setConfigValue,
  setConfigValueAtPath,
  validateConfigDocument,
} from '../../../src/cli-shared/config-operations.js';
import { parseConfigText } from '../../../src/shared/utils/config-file-format.js';

/**
 * A config nobody generated: a header comment, a block comment, an inline comment on the very
 * line a `set` targets, sections out of alphabetical order, a blank line, a trailing comma, and
 * one section indented four spaces.
 */
const HAND_AUTHORED_JSONC = `// Our server config. Please keep the notes — they are why the values are what they are.

{
  /* Gates run the review chain. Off by default on this box; the CI image turns them on. */
  "gates": {
    "enabled": false, // flipped by hand during incident 4471
  },

  "server": {
      "name": "hand-authored",
      "port": 9090
  },

  "logging": { "level": "info" },
}
`;

/** A plain JSON config with the same human fingerprints a strict reader still accepts. */
const HAND_AUTHORED_JSON = `{
    "logging": { "level": "info" },

    "gates": {
        "enabled": false
    },
    "server": { "name": "hand-authored", "port": 9090 }
}
`;

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

  describe('in-place editing', () => {
    it('changes only the targeted value in a hand-authored config.jsonc', () => {
      const jsoncPath = join(tempDir, 'config.jsonc');
      writeFileSync(jsoncPath, HAND_AUTHORED_JSONC, 'utf8');

      const result = setConfigValueAtPath(jsoncPath, 'gates.enabled', 'true');
      expect(result).toMatchObject({ success: true, previousValue: false, newValue: true });

      const expected = HAND_AUTHORED_JSONC.replace('"enabled": false', '"enabled": true');
      expect(readFileSync(jsoncPath, 'utf8')).toBe(expected);
    });

    it('CONTROL: re-serializing the whole document does NOT leave the file byte-identical', () => {
      // Without this the case above would pass just as happily against a writer that rewrote the
      // file, if the fixture happened to be in the writer's own shape. It is not, and this proves
      // the comparison notices.
      const expected = HAND_AUTHORED_JSONC.replace('"enabled": false', '"enabled": true');
      const wholeDocument =
        JSON.stringify(parseConfigText(HAND_AUTHORED_JSONC, 'jsonc'), null, 2) + '\n';

      expect(wholeDocument).not.toBe(expected);
      expect(wholeDocument).not.toContain('incident 4471');
    });

    it('changes only the targeted value in a hand-authored config.json', () => {
      writeFileSync(configPath, HAND_AUTHORED_JSON, 'utf8');

      const result = setConfigValueAtPath(configPath, 'server.port', '9091');
      expect(result.success).toBe(true);

      expect(readFileSync(configPath, 'utf8')).toBe(
        HAND_AUTHORED_JSON.replace('"port": 9090', '"port": 9091')
      );
    });

    it('CONTROL: re-serializing a plain JSON document reflows it', () => {
      const wholeDocument =
        JSON.stringify(parseConfigText(HAND_AUTHORED_JSON, 'json'), null, 2) + '\n';

      expect(wholeDocument).not.toBe(HAND_AUTHORED_JSON.replace('"port": 9090', '"port": 9091'));
    });

    it('inserts a live key beside a commented-out example without disturbing the comment', () => {
      const jsoncPath = join(tempDir, 'config.jsonc');
      const commentedOnly = `{
  // "gates": {
  //   "enabled": true,
  // },
  "version": 5,
}
`;
      writeFileSync(jsoncPath, commentedOnly, 'utf8');

      expect(setConfigValueAtPath(jsoncPath, 'gates.enabled', 'true').success).toBe(true);

      const after = readFileSync(jsoncPath, 'utf8');
      // The whole commented example, contiguous and unedited — not one line of it was consumed
      expect(after).toContain('  // "gates": {\n  //   "enabled": true,\n  // },\n');

      const reread = readConfigFile(jsoncPath);
      expect(reread.success).toBe(true);
      expect((reread.config?.['gates'] as { enabled?: unknown } | undefined)?.enabled).toBe(true);
    });

    it('creates a section a commented config does not have yet', () => {
      const jsoncPath = join(tempDir, 'config.jsonc');
      writeFileSync(jsoncPath, '// nothing configured yet\n{\n  "version": 5,\n}\n', 'utf8');

      expect(setConfigValueAtPath(jsoncPath, 'telemetry.samplingRate', '0.5').success).toBe(true);

      const after = readFileSync(jsoncPath, 'utf8');
      expect(after).toContain('// nothing configured yet');
      expect(parseConfigText(after, 'jsonc')).toMatchObject({
        version: 5,
        telemetry: { samplingRate: 0.5 },
      });
    });
  });

  describe('two config files in one workspace', () => {
    beforeEach(() => {
      writeFileSync(join(tempDir, 'config.jsonc'), '{\n  "version": 5,\n}\n', 'utf8');
      writeFileSync(configPath, '{\n  "version": 5\n}\n', 'utf8');
    });

    /** Both absolute paths and the remedy, so the operator can act without reading source. */
    function expectRefusal(message: string | undefined): void {
      expect(message).toContain(join(tempDir, 'config.jsonc'));
      expect(message).toContain(join(tempDir, 'config.json'));
      expect(message).toContain('Keep one');
    }

    it('refuses a read', () => {
      const result = readConfig(tempDir);
      expect(result.success).toBe(false);
      expectRefusal(result.error);
    });

    it('refuses a set, leaving both files alone', () => {
      const before = [
        readFileSync(join(tempDir, 'config.jsonc'), 'utf8'),
        readFileSync(configPath, 'utf8'),
      ];

      const result = setConfigValue(tempDir, 'gates.enabled', 'true');
      expect(result.success).toBe(false);
      expectRefusal(result.message);

      expect(readFileSync(join(tempDir, 'config.jsonc'), 'utf8')).toBe(before[0]);
      expect(readFileSync(configPath, 'utf8')).toBe(before[1]);
    });

    it('refuses an init', () => {
      const result = initConfig(tempDir);
      expect(result).toMatchObject({ success: false, created: false });
      expectRefusal(result.message);
    });

    it('refuses a reset, writing no backup', () => {
      const result = resetConfig(tempDir);
      expect(result.success).toBe(false);
      expectRefusal(result.message);
      expect(result.backupPath).toBeUndefined();
    });
  });

  describe('resolveConfigPath', () => {
    it('prefers config.jsonc, falls back to config.json, and names config.jsonc for a create', () => {
      expect(resolveConfigPath(tempDir)).toBe(join(tempDir, 'config.jsonc'));

      writeFileSync(configPath, '{}\n', 'utf8');
      expect(resolveConfigPath(tempDir)).toBe(configPath);

      writeFileSync(join(tempDir, 'config.jsonc'), '{}\n', 'utf8');
      expect(resolveConfigPath(tempDir)).toBe(join(tempDir, 'config.jsonc'));
    });
  });

  describe('initConfig', () => {
    it('writes the commented template verbatim when the workspace has no config', () => {
      const result = initConfig(tempDir);

      expect(result).toMatchObject({ success: true, created: true });
      expect(result.configPath).toBe(join(tempDir, 'config.jsonc'));
      expect(readFileSync(result.configPath, 'utf8')).toBe(CONFIG_JSONC_TEMPLATE);
    });

    it('skips a workspace that already has a config.json, writing nothing', () => {
      const original = '{\n  "version": 5\n}\n';
      writeFileSync(configPath, original, 'utf8');

      const result = initConfig(tempDir);

      expect(result).toMatchObject({ success: true, created: false });
      expect(result.message).toContain('config.json');
      expect(existsSync(join(tempDir, 'config.jsonc'))).toBe(false);
      expect(readFileSync(configPath, 'utf8')).toBe(original);
    });

    it('skips a workspace that already has a config.jsonc, writing nothing', () => {
      const jsoncPath = join(tempDir, 'config.jsonc');
      writeFileSync(jsoncPath, HAND_AUTHORED_JSONC, 'utf8');

      const result = initConfig(tempDir);

      expect(result).toMatchObject({ success: true, created: false });
      expect(result.message).toContain('config.jsonc');
      expect(readFileSync(jsoncPath, 'utf8')).toBe(HAND_AUTHORED_JSONC);
    });
  });

  describe('resetConfig', () => {
    it('rewrites an existing config.jsonc from the template, keeping a backup of what was there', () => {
      const jsoncPath = join(tempDir, 'config.jsonc');
      writeFileSync(jsoncPath, HAND_AUTHORED_JSONC, 'utf8');

      const result = resetConfig(tempDir);

      expect(result).toMatchObject({ success: true, configPath: jsoncPath });
      expect(readFileSync(jsoncPath, 'utf8')).toBe(CONFIG_JSONC_TEMPLATE);
      expect(readFileSync(result.backupPath as string, 'utf8')).toBe(HAND_AUTHORED_JSONC);
      expect(existsSync(configPath)).toBe(false);
    });

    it('rewrites an existing config.json as JSON, never renaming it', () => {
      writeFileSync(configPath, HAND_AUTHORED_JSON, 'utf8');

      const result = resetConfig(tempDir);

      expect(result).toMatchObject({ success: true, configPath });
      expect(readFileSync(configPath, 'utf8')).toBe(
        JSON.stringify(generateDefaultConfig(), null, 2) + '\n'
      );
      expect(readFileSync(result.backupPath as string, 'utf8')).toBe(HAND_AUTHORED_JSON);
      expect(existsSync(join(tempDir, 'config.jsonc'))).toBe(false);
    });

    it('writes the template as config.jsonc when the workspace has no config to back up', () => {
      const result = resetConfig(tempDir);

      expect(result).toMatchObject({ success: true, configPath: join(tempDir, 'config.jsonc') });
      expect(result.backupPath).toBeUndefined();
      expect(readFileSync(result.configPath, 'utf8')).toBe(CONFIG_JSONC_TEMPLATE);
    });
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
