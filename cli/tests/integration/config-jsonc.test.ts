import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { seedVersionHistory } from '../helpers/seed-version-history.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/cpm.js');

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    // Merge stderr into stdout for backward-compatible assertions on error paths
    stdout: result.status === 0 ? stdout : stdout + stderr,
    stderr,
    exitCode: result.status ?? 1,
  };
}

/** A fresh, empty temp workspace directory — no resources, no config. */
function makeWorkspace(label: string): string {
  const tmp = join(__dirname, `../fixtures/.tmp-config-${label}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  return tmp;
}

describe('cpm config (config.jsonc)', () => {
  let tmpWs: string;

  afterEach(() => {
    if (tmpWs && existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('cpm init creates config.jsonc with a comment and version 5', () => {
    tmpWs = makeWorkspace('init');
    const { exitCode } = run(['init', tmpWs]);
    expect(exitCode).toBe(0);

    const configPath = join(tmpWs, 'config.jsonc');
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, 'utf8');
    expect(content).toMatch(/^\/\//m);
    expect(content).toContain('"version": 5');
  });

  it('cpm config set keeps a hand-authored comment; cpm config get reads the new value', () => {
    tmpWs = makeWorkspace('set-get');
    writeFileSync(
      join(tmpWs, 'config.jsonc'),
      [
        '// MARKER: hand-authored, must survive a set',
        '{',
        '  "$schema": "./config.schema.json",',
        '  "version": 5,',
        '  "gates": {',
        '    "enabled": true',
        '  }',
        '}',
        '',
      ].join('\n'),
    );

    const setResult = run(['config', 'set', 'gates.enabled', 'false', '--workspace', tmpWs]);
    expect(setResult.exitCode).toBe(0);

    const content = readFileSync(join(tmpWs, 'config.jsonc'), 'utf8');
    expect(content).toContain('// MARKER: hand-authored, must survive a set');

    const getResult = run(['config', 'get', 'gates.enabled', '--workspace', tmpWs]);
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout).toContain('gates.enabled = false');
  });

  it('cpm config list and validate work on a commented config.jsonc', () => {
    tmpWs = makeWorkspace('list-validate');
    writeFileSync(
      join(tmpWs, 'config.jsonc'),
      [
        '// a leading comment',
        '{',
        '  "$schema": "./config.schema.json",',
        '  "version": 5, // trailing comma below is fine in jsonc',
        '  "gates": {',
        '    "enabled": true,',
        '  },',
        '}',
        '',
      ].join('\n'),
    );

    const listResult = run(['config', 'list', '--workspace', tmpWs]);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain('"version": 5');

    const validateResult = run(['config', 'validate', '--workspace', tmpWs]);
    expect(validateResult.exitCode).toBe(0);
    expect(validateResult.stdout).toContain('config.jsonc is valid');
  });

  it('refuses a directory holding both config.jsonc and config.json', () => {
    tmpWs = makeWorkspace('ambiguous');
    const jsoncPath = join(tmpWs, 'config.jsonc');
    const jsonPath = join(tmpWs, 'config.json');
    writeFileSync(jsoncPath, '{\n  "version": 5\n}\n');
    writeFileSync(jsonPath, '{\n  "version": 5\n}\n');

    const { exitCode, stdout } = run(['config', 'get', 'gates.enabled', '--workspace', tmpWs]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toContain(jsoncPath);
    expect(stdout).toContain(jsonPath);
  });

  it('cpm config reset --force on config.jsonc leaves no backup file and keeps the name', () => {
    tmpWs = makeWorkspace('reset-jsonc');
    writeFileSync(
      join(tmpWs, 'config.jsonc'),
      '// a hand-authored comment that would not survive a whole-document rewrite\n{\n  "version": 5\n}\n',
    );

    const { exitCode, stdout } = run(['config', 'reset', '--force', '--workspace', tmpWs]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toMatch(/Backup:/);

    // Ruling R53: the prior bytes are a version row, not a timestamped copy beside the file.
    expect(readdirSync(tmpWs).filter((f) => f.includes('.backup.'))).toEqual([]);
    // Positive control: the probe reads the directory the config actually sits in.
    expect(readdirSync(tmpWs)).toContain('config.jsonc');

    expect(existsSync(join(tmpWs, 'config.jsonc'))).toBe(true);
    expect(existsSync(join(tmpWs, 'config.json'))).toBe(false);
    const content = readFileSync(join(tmpWs, 'config.jsonc'), 'utf8');
    expect(content).toMatch(/^\/\//m);
  });

  it('cpm config reset --force on config.json stays config.json', () => {
    tmpWs = makeWorkspace('reset-json');
    writeFileSync(join(tmpWs, 'config.json'), JSON.stringify({ version: 5 }, null, 2) + '\n');

    const { exitCode } = run(['config', 'reset', '--force', '--workspace', tmpWs]);
    expect(exitCode).toBe(0);
    expect(existsSync(join(tmpWs, 'config.json'))).toBe(true);
    expect(existsSync(join(tmpWs, 'config.jsonc'))).toBe(false);
  });

  // Positive control: strict JSON stays strict. Without this, a suite that only ever
  // exercises the accepting path (config.jsonc with comments) could not tell "comments in
  // config.json are refused" from "the probe never looked".
  it('POSITIVE CONTROL: a commented file named config.json is refused by config list', () => {
    tmpWs = makeWorkspace('strict-control');
    writeFileSync(
      join(tmpWs, 'config.json'),
      '// this comment is invalid in strict JSON\n{\n  "version": 5\n}\n',
    );

    const { exitCode, stdout } = run(['config', 'list', '--workspace', tmpWs]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toContain('Failed to parse config.json');
  });
  /**
   * P6.255 (R139). `cpm config set` records through `setConfigValueRecorded`, which calls
   * `recordCheckpointedWrite` exactly as `cpm rollback` does: the bridge row first, then the
   * transaction. A value the validator refuses throws inside that transaction, so a refused set
   * MAY leave a `Bridge: prior live state` row, the same as the P6.246 rollback twins pin.
   * MEASURED 2026-09-28 on `07e7dc545`: driven here, not read.
   */
  describe('P6.255 a refused config set and the bridge row', () => {
    const BRIDGE = 'Bridge: prior live state (era transition or out-of-band edit)';
    const configRows = (): string[] => {
      const history = run(['config', 'history', '--workspace', tmpWs, '--json']);
      return (JSON.parse(history.stdout) as { versions: { description: string }[] }).versions.map(
        (version) => version.description,
      );
    };
    const seedRecordedSet = (label: string): string => {
      tmpWs = makeWorkspace(label);
      // An empty history: the seeder creates `state.db` and a strict `config.json`.
      seedVersionHistory(tmpWs, 'config', 'config', []);
      expect(run(['config', 'set', 'gates.enabled', 'false', '--workspace', tmpWs]).exitCode).toBe(0);
      return join(tmpWs, 'config.json');
    };

    it('(a) over an out-of-band edit it leaves exactly one new row, the bridge', () => {
      const configPath = seedRecordedSet('p255-edited');
      const edited = readFileSync(configPath, 'utf8').replace('"enabled": false', '"enabled": true');
      expect(edited).toContain('"enabled": true');
      writeFileSync(configPath, edited);
      const before = configRows();

      const refused = run(['config', 'set', 'gates.enabled', 'notabool', '--workspace', tmpWs]);

      expect(refused.exitCode).toBe(1);
      expect(refused.stdout).toContain('Validation failed');
      expect(readFileSync(configPath, 'utf8')).toBe(edited);
      const after = configRows();
      expect([...after].sort()).toEqual([...before, BRIDGE].sort());
      expect(after.filter((row) => row.startsWith('Set ')).length).toBe(
        before.filter((row) => row.startsWith('Set ')).length,
      );
    });

    it('(b) control: over a live state already recorded it leaves zero new rows', () => {
      const configPath = seedRecordedSet('p255-recorded');
      const live = readFileSync(configPath, 'utf8');
      const before = configRows();
      expect(before).toContain('Set gates.enabled');

      const refused = run(['config', 'set', 'gates.enabled', 'notabool', '--workspace', tmpWs]);

      expect(refused.exitCode).toBe(1);
      expect(readFileSync(configPath, 'utf8')).toBe(live);
      expect(configRows()).toEqual(before);
    });
  });
});
