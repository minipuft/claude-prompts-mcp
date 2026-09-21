/**
 * `server.transport` refusal at load time (row 4.7, Ruling R30).
 *
 * Transport is launch-time-only: `--transport` selects it, and `config.json` cannot — `Config`
 * carries no `transport` member for a config value to reach (`src/shared/types/core-config.ts`).
 * A `server.transport` left at `"stdio"` (or omitted) is tolerated: the schema no longer declares
 * the key at all, so it draws only the existing "does not match its schema" warning
 * (`config-schema-warning.test.ts` owns that path in general). Anything ELSE under
 * `server.transport` can never take effect, so `loadConfig` refuses to start rather than silently
 * running on the default while the operator believes they configured HTTP.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigLoader, TransportConfigError } from '../../../../src/infra/config/index.js';

// Same resolution pattern as config-schema-warning.test.ts, one directory deeper.
const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');

describe('server.transport refusal at load time', () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    tempDir = await mkdtemp(path.join(tmpdir(), 'cfg-transport-refusal-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('refuses a config file whose server.transport is not "stdio", naming the value and --transport=streamable-http', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ version: 5, server: { transport: 'streamable-http' } }),
      'utf8'
    );
    const manager = new ConfigLoader(configPath);

    let caught: unknown;
    try {
      await manager.loadConfig();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TransportConfigError);
    const message = (caught as Error).message;
    expect(message).toContain('"server.transport"');
    expect(message).toContain('streamable-http');
    expect(message).toContain('--transport=streamable-http');
  });

  // POSITIVE CONTROL — without this, the refusal assertion above could pass equally well against
  // a loader that refuses on every load, regardless of the value it was given.
  it('POSITIVE CONTROL — server.transport: "stdio" does not refuse, and draws only the existing schema warning', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ version: 5, server: { transport: 'stdio' } }),
      'utf8'
    );
    const manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });

    await expect(manager.loadConfig()).resolves.toBeDefined();

    const schemaWarnings = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith('[WARN] ') && line.includes('[CONFIG]'));
    expect(schemaWarnings).toHaveLength(1);
    expect(schemaWarnings[0]).toContain('does not match its schema');
    expect(schemaWarnings[0]).toContain('transport');
  });

  it('omitting server.transport entirely does not refuse', async () => {
    await writeFile(configPath, JSON.stringify({ version: 5 }), 'utf8');
    const manager = new ConfigLoader(configPath);

    await expect(manager.loadConfig()).resolves.toBeDefined();
  });
});

/**
 * `ConfigLoader.getTransportMode()` is the reader `pipeline-builder.ts`'s identity-resolution
 * closure and `TransportRouter.determineTransport`'s config-fallback branch both call. Since
 * `Config` carries no `transport` member (above), the config file this manager loaded cannot be
 * what changes its answer.
 *
 * Row 4.12: this used to re-derive the answer by scanning `process.argv` for `--transport=`
 * itself — a second, independent parse of the flag `runtime/cli.ts`'s `parseServerCliArgs`
 * already owns, and one that only recognized the `=` form (missing the space form
 * `--transport streamable-http` entirely). There is now exactly one parse of `--transport` per
 * process; `getTransportMode()` just returns whatever `setTransportMode()` last stored, which
 * `runtime/application.ts` calls once from the SAME resolution `TransportRouter.determineTransport`
 * produced for the transport the server actually serves. These tests pin that new contract: no
 * `process.argv` involvement at all, a `'stdio'` default until the setter runs, and the setter's
 * value echoed back exactly — using a config file that never mentions transport, since that half
 * is already covered above.
 */
describe('getTransportMode() returns what setTransportMode() stored, never process.argv', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'cfg-transport-launch-'));
    configPath = path.join(tempDir, 'config.json');
    await writeFile(configPath, JSON.stringify({ version: 5 }), 'utf8');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns the value setTransportMode() was given, regardless of argv', async () => {
    const manager = new ConfigLoader(configPath);
    await manager.loadConfig();

    manager.setTransportMode('streamable-http');

    expect(manager.getTransportMode()).toBe('streamable-http');
  });

  // POSITIVE CONTROL — without this, the assertion above could pass equally well against a
  // getTransportMode() that always returns 'streamable-http' regardless of the setter.
  it('POSITIVE CONTROL — defaults to stdio before setTransportMode() is ever called', async () => {
    const manager = new ConfigLoader(configPath);
    await manager.loadConfig();

    expect(manager.getTransportMode()).toBe('stdio');
  });
});
