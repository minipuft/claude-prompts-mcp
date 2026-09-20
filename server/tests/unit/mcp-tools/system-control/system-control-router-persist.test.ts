/**
 * `ConsolidatedSystemControl.persistGateConfig` / `persistFrameworkConfig` used to report every
 * write as landing "to config.json" regardless of which file `SafeConfigWriter` actually wrote —
 * a hard-coded literal, not a read of the write's own target. A workspace running `config.jsonc`
 * got a persist confirmation naming a file it does not have.
 *
 * `safeConfigWriter` is stubbed directly (never a real `ConfigLoader`/`SafeConfigWriter` pair
 * against a temp file): the row this test covers only concerns the message text the router
 * builds around `SafeConfigWriter.getConfigPath()`, not the write mechanics `config-utils.ts` /
 * `config-operations.ts` own.
 *
 * Classification: Unit (one router, stubbed `safeConfigWriter`).
 */

import { describe, expect, jest, test } from '@jest/globals';

import { ConsolidatedSystemControl } from '../../../../src/mcp/tools/system-control/system-control-router.js';

import type { SafeConfigWriter } from '../../../../src/mcp/tools/config-utils.js';
import type { Logger } from '../../../../src/shared/types/index.js';

const stubLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

/** A `SafeConfigWriter` stand-in reporting success and a chosen `getConfigPath()`. */
function makeSafeConfigWriter(configPath: string): SafeConfigWriter {
  return {
    updateConfigValue: jest.fn(async () => ({ success: true, message: 'ok' })),
    getConfigPath: jest.fn(() => configPath),
  } as unknown as SafeConfigWriter;
}

function makeRouter(configPath: string): ConsolidatedSystemControl {
  const router = new ConsolidatedSystemControl(stubLogger);
  router.safeConfigWriter = makeSafeConfigWriter(configPath);
  return router;
}

describe('ConsolidatedSystemControl persist replies name the file actually written', () => {
  test('persistGateConfig names config.jsonc when that is the loaded file', async () => {
    const router = makeRouter('/workspace/config.jsonc');

    const message = await router.persistGateConfig(true);

    expect(message).toBe('📁 Persisted gates.enabled=true to config.jsonc.');
  });

  // POSITIVE CONTROL: the strict-JSON dialect's own name comes back too — without this, a
  // message that always said "config.jsonc" would pass the test above for the wrong reason.
  test('persistGateConfig names config.json when that is the loaded file', async () => {
    const router = makeRouter('/workspace/config.json');

    const message = await router.persistGateConfig(false);

    expect(message).toBe('📁 Persisted gates.enabled=false to config.json.');
  });

  test('persistFrameworkConfig names config.jsonc when that is the loaded file', async () => {
    const router = makeRouter('/workspace/config.jsonc');

    const message = await router.persistFrameworkConfig(true);

    expect(message).toContain('in config.jsonc.');
  });

  // POSITIVE CONTROL: same shape, the strict-JSON dialect's own name comes back.
  test('persistFrameworkConfig names config.json when that is the loaded file', async () => {
    const router = makeRouter('/workspace/config.json');

    const message = await router.persistFrameworkConfig(true);

    expect(message).toContain('in config.json.');
  });

  test('persist replies say nothing when the config writer is unavailable', async () => {
    const router = new ConsolidatedSystemControl(stubLogger);

    expect(await router.persistGateConfig(true)).toBe(
      '⚠️ Persistence skipped (config writer unavailable).'
    );
    expect(await router.persistFrameworkConfig(true)).toBe(
      '⚠️ Persistence skipped (config writer unavailable).'
    );
  });
});
