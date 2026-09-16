/**
 * ConfigActionHandler's read surface (`list`, `keys`, `validate`) plus the refusal controls that
 * are the point of this row. Before this file, nothing unit-tested this handler except the
 * schema-validate branch (`config-action-handler.test.ts`) — `list`, `keys`, and the refusal path
 * that replaced the deleted write/get handling had no coverage at all.
 *
 * Real `ConfigLoader` against a temp `config.json` + the packaged `config.schema.json` — same
 * construction as `config-value-source.test.ts` / `legacy-key-migration.test.ts` — behind a
 * stubbed `SystemControlContext` (same stand-in shape as `config-action-handler.test.ts`'s
 * `makeContext`: `createMinimalSystemResponse` mirrors the `{ content, isError: false }` shape the
 * real router builds). `validateConfigInput` is a pure function, so the nested `validate` form
 * needs no config-file fixture of its own.
 *
 * Classification: Unit (one handler, real ConfigManager, stubbed router context).
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigActionHandler } from '../../../../src/mcp/tools/system-control/handlers/config-action-handler.js';
import { ConfigLoader } from '../../../../src/infra/config/index.js';

import type { SystemControlContext } from '../../../../src/mcp/tools/system-control/core/types.js';
import type { ToolResponse } from '../../../../src/shared/types/index.js';

// Same resolution pattern as the ConfigLoader siblings under tests/unit/infra/config/ — the
// schema ships beside the server root, four directories up from this file.
const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');

/** Same stub shape as config-action-handler.test.ts's makeContext. */
function makeContext(configManager: ConfigLoader | undefined): SystemControlContext {
  return {
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    startTime: 0,
    configManager,
    createMinimalSystemResponse: (text: string, _action: string): ToolResponse => ({
      content: [{ type: 'text', text }],
      isError: false,
    }),
  } as unknown as SystemControlContext;
}

function textOf(response: ToolResponse): string {
  return (response.content[0] as { text: string }).text;
}

describe('ConfigActionHandler read surface + refusal controls', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'config-action-'));
    configPath = path.join(tempDir, 'config.json');
    // `version` is a required member of the 5.0 document — a fixture without it loads, but the
    // stored schema result is `invalid`, which is the thing two tests below assert on.
    await writeFile(configPath, JSON.stringify({ version: 5, gates: { enabled: true } }), 'utf8');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('list', () => {
    test('returns the loaded configuration, not a header claiming one', async () => {
      const manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
      await manager.loadConfig();
      const handler = new ConfigActionHandler(makeContext(manager));

      const response = await handler.execute({ operation: 'list' });
      expect(response.isError).toBe(false);

      const text = textOf(response);
      const jsonBlock = text.match(/```json\n([\s\S]*?)\n```/)?.[1];
      expect(jsonBlock).toBeDefined();
      const parsed = JSON.parse(jsonBlock as string);

      // The whole loaded config round-trips, including the one value the temp file set.
      expect(parsed).toEqual(manager.getConfig());
      expect(parsed.gates.enabled).toBe(true);
    });
  });

  describe('keys', () => {
    test('returns the declared schema keys', async () => {
      const manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
      await manager.loadConfig();
      const expectedKeys = await manager.listConfigKeys();
      const handler = new ConfigActionHandler(makeContext(manager));

      const response = await handler.execute({ operation: 'keys' });
      expect(response.isError).toBe(false);

      const text = textOf(response);
      expect(text).toContain(`(${expectedKeys.length})`);
      const block = text.match(/```\n([\s\S]*?)\n```/)?.[1];
      expect(block?.split('\n')).toEqual(expectedKeys);
      expect(expectedKeys).toContain('gates.enabled');
    });

    // listConfigKeys() throws when the schema cannot be enumerated (here: no schemaPath was
    // injected at all). That must surface as an explicit error — never an empty or
    // successful-looking list, which would read as "the schema declares zero keys".
    test('reports enumeration failure as an explicit error, never an empty list', async () => {
      const manager = new ConfigLoader(configPath); // no schemaPath injected
      await manager.loadConfig();
      const handler = new ConfigActionHandler(makeContext(manager));

      const response = await handler.execute({ operation: 'keys' });
      const text = textOf(response);

      expect(response.isError).toBe(true);
      expect(text).not.toContain('Declared Configuration Keys** (0)');
      expect(text).toContain('no config schema path was injected');
    });
  });

  describe('validate', () => {
    // R14: a bare `operation: "validate"` reports the STORED load-time schema result.
    test('top-level validate reports the stored valid result', async () => {
      const manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
      await manager.loadConfig();
      expect(manager.getSchemaValidation()).toMatchObject({ status: 'valid', valid: true });
      const handler = new ConfigActionHandler(makeContext(manager));

      const response = await handler.execute({ operation: 'validate' });

      expect(response.isError).toBe(false);
      expect(textOf(response)).toBe('✅ config.json matches its schema.');
    });

    test('top-level validate reports the stored invalid result, naming the bad key', async () => {
      await writeFile(
        configPath,
        JSON.stringify({ version: 5, gates: { enabled: true, nonsenseKey: true } }),
        'utf8'
      );
      const manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
      await manager.loadConfig();
      expect(manager.getSchemaValidation()).toMatchObject({ status: 'invalid', valid: false });
      const handler = new ConfigActionHandler(makeContext(manager));

      const response = await handler.execute({ operation: 'validate' });
      const text = textOf(response);

      expect(text).toContain('does not match its schema');
      expect(text).toContain('nonsenseKey');
    });

    // The nested form: `config: { operation: "validate", key, value }` runs a per-key candidate
    // check via validateConfigInput — independent of whatever the stored load-time result says.
    test('nested validate runs a per-key candidate check', async () => {
      const manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
      await manager.loadConfig();
      const handler = new ConfigActionHandler(makeContext(manager));

      const response = await handler.execute({
        operation: 'validate',
        config: { operation: 'validate', key: 'server.port', value: '9090' },
      });

      expect(response.isError).toBe(false);
      expect(textOf(response)).toBe('✅ Configuration valid for **server.port**');
    });

    test('nested validate reports an invalid candidate value as invalid', async () => {
      const manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
      await manager.loadConfig();
      const handler = new ConfigActionHandler(makeContext(manager));

      // `'nine'` rather than an out-of-range port: `ConfigFile` declares `server.port` as an
      // integer with no `@minimum`/`@maximum`, so the generated key table carries no bound to
      // reject 99 with. Restoring that bound is a one-line-per-tag change to `ConfigFileServer`,
      // not a second range list in the validator — which is what this row deleted.
      const response = await handler.execute({
        operation: 'validate',
        config: { operation: 'validate', key: 'server.port', value: 'nine' },
      });
      const text = textOf(response);

      expect(text).toContain('❌ Invalid configuration for **server.port**');
      expect(text).toContain('server.port must be a whole number');
    });
  });

  // The point of this row: `get`, `set`, `reset`/`restore` never reach a per-operation handler —
  // one generic refusal answers all of them, and a request naming NO operation at all must land
  // on that same refusal rather than falling through to a listing. Asserted on `isError`, not on
  // message text, so a reworded refusal message cannot silently drop the guard.
  describe('refusal controls', () => {
    let manager: ConfigLoader;

    beforeEach(async () => {
      manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
      await manager.loadConfig();
    });

    test.each([
      ['get', { operation: 'get', key: 'server.port' }],
      ['set', { operation: 'set', key: 'server.port', value: '9090' }],
      ['restore', { operation: 'restore' }],
      ['reset', { operation: 'reset' }],
    ])('%s is refused as an error, never answered', async (_label, args) => {
      const handler = new ConfigActionHandler(makeContext(manager));

      const response = await handler.execute(args);

      expect(response.isError).toBe(true);
    });

    // The regression guard: a deleted fallback (`if (!configRequest) return list`) used to answer
    // ANY malformed or unrecognized request — including a bare `{}` with no operation at all —
    // with a successful full-configuration dump. This is that fallback's exact input shape.
    test('an empty request ({}) is refused, never a successful configuration dump', async () => {
      const handler = new ConfigActionHandler(makeContext(manager));

      const response = await handler.execute({});

      expect(response.isError).toBe(true);
    });
  });
});
