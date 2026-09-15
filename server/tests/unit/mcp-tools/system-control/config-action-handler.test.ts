/**
 * Nothing tested `ConfigActionHandler` before this file. Its newest path — `execute({ operation:
 * 'validate' })` with no `config` — was only live-driven for two of its five `handleSchemaValidate`
 * outcomes. The outcome that matters most is "not validated" (`getSchemaValidation()` returns
 * undefined), which must never render as success.
 *
 * Classification: Unit (one handler, stubbed context — the same stand-in shape as
 * framework-action-handler.test.ts's `makeContext`).
 */

import { describe, expect, test, jest } from '@jest/globals';

import type { SystemControlContext } from '../../../../src/mcp/tools/system-control/core/types.js';
import type { ConfigManager, ToolResponse } from '../../../../src/shared/types/index.js';
import type { ConfigSchemaValidationResult } from '../../../../src/shared/types/config-manager.js';

import { ConfigActionHandler } from '../../../../src/mcp/tools/system-control/handlers/config-action-handler.js';

/** Stand-in `configManager` exposing only what `ConfigActionHandler` reads. */
function makeConfigManager(result: ConfigSchemaValidationResult | undefined): ConfigManager {
  return {
    getSchemaValidation: jest.fn(() => result),
  } as unknown as ConfigManager;
}

/** Same stub shape as framework-action-handler.test.ts's `makeContext`: `createMinimalSystemResponse`
 *  builds the same `{ content: [{ type: 'text', text }], isError: false }` the real router does. */
function makeContext(configManager: ConfigManager | undefined): SystemControlContext {
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

describe('ConfigActionHandler validate (schema path)', () => {
  test('case 1: not validated renders the not-validated text, never success', async () => {
    const context = makeContext(makeConfigManager(undefined));

    const response = await new ConfigActionHandler(context).execute({ operation: 'validate' });

    expect(textOf(response)).toBe(
      '⚠️ The config has not been checked against a schema in this process.'
    );
    expect(textOf(response)).not.toContain('✅');
    expect(textOf(response)).not.toContain('matches its schema');
  });

  test('case 2: valid renders the valid text', async () => {
    const context = makeContext(makeConfigManager({ status: 'valid', valid: true, errors: [] }));

    const response = await new ConfigActionHandler(context).execute({ operation: 'validate' });

    expect(textOf(response)).toBe('✅ config.json matches its schema.');
  });

  test('case 3: unavailable renders the unavailable text with each error on its own line', async () => {
    const context = makeContext(
      makeConfigManager({
        status: 'unavailable',
        valid: false,
        errors: ['ENOENT: no such file'],
      })
    );

    const response = await new ConfigActionHandler(context).execute({ operation: 'validate' });
    const lines = textOf(response).split('\n');

    expect(lines[0]).toBe('⚠️ The schema could not be read, so the config was not checked.');
    expect(lines).toContain('ENOENT: no such file');
  });

  test('case 4: invalid renders the invalid text with each error on its own line', async () => {
    const context = makeContext(
      makeConfigManager({
        status: 'invalid',
        valid: false,
        errors: ['/gates: must NOT have additional properties (enabld)'],
      })
    );

    const response = await new ConfigActionHandler(context).execute({ operation: 'validate' });
    const lines = textOf(response).split('\n');

    expect(lines[0]).toBe('❌ config.json does not match its schema. The server keeps running.');
    expect(lines).toContain('/gates: must NOT have additional properties (enabld)');
  });

  test('case 5: no configManager rejects execute() with Config manager unavailable', async () => {
    const context = makeContext(undefined);

    await expect(
      new ConfigActionHandler(context).execute({ operation: 'validate' })
    ).rejects.toThrow('Config manager unavailable');
  });

  test('case 6: validate WITH a config object takes the per-key path, not the schema path', async () => {
    const context = makeContext(makeConfigManager({ status: 'valid', valid: true, errors: [] }));

    const response = await new ConfigActionHandler(context).execute({
      operation: 'validate',
      config: { operation: 'validate', key: 'server.port', value: '9090' },
    });
    const text = textOf(response);

    expect(text).not.toBe('⚠️ The config has not been checked against a schema in this process.');
    expect(text).not.toBe('✅ config.json matches its schema.');
    expect(text).not.toContain('The schema could not be read, so the config was not checked.');
    expect(text).not.toContain('does not match its schema. The server keeps running.');
  });
});
