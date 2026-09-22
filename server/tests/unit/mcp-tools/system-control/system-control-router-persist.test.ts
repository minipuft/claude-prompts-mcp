/**
 * `ConsolidatedSystemControl.persistGateConfig` / `persistFrameworkConfig` used to report every
 * write as landing "to config.json" regardless of which file `SafeConfigWriter` actually wrote —
 * a hard-coded literal, not a read of the write's own target. A workspace running `config.jsonc`
 * got a persist confirmation naming a file it does not have.
 *
 * This file drives `ConsolidatedSystemControl`'s persist replies; `safeConfigWriter` is a
 * hand-built stand-in supplying `getConfigPath()`, the value the router's message text depends
 * on. The writer class's own behavior -- `updateConfigValue`, `getConfigPath`, backup creation --
 * lives in a sibling file: `safe-config-writer.test.ts` under `tests/unit/mcp-tools/`.
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
function makeSafeConfigWriter(
  configPath: string,
  record: Record<string, unknown> = {}
): SafeConfigWriter {
  return {
    updateConfigValue: jest.fn(async () => ({ success: true, message: 'ok', ...record })),
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

/**
 * P4.114 — a persisted toggle names the version it recorded.
 *
 * Every config write has been a `version_history` row since #347, and the number is what a
 * `cpm config rollback` takes; the reply reported the file and stopped there, so a persist that
 * recorded nothing (an unchanged write) and one that recorded version 9 read identically.
 */
describe('a persist reply carries the version the write recorded', () => {
  test('names the recorded version and the rollback that undoes it', async () => {
    const router = new ConsolidatedSystemControl(stubLogger);
    router.safeConfigWriter = makeSafeConfigWriter('/workspace/config.json', {
      recordedVersion: 9,
    });

    const message = await router.persistGateConfig(true);

    expect(message).toContain('as config version 9');
    expect(message).toContain('cpm config rollback 9');
  });

  // POSITIVE CONTROL for the same clause: a write that recorded NOTHING must say so by reason,
  // or "no version named" would also be what a broken version-reporting path produces.
  test('says why no version was recorded when none was', async () => {
    const router = new ConsolidatedSystemControl(stubLogger);
    router.safeConfigWriter = makeSafeConfigWriter('/workspace/config.json', {
      recordedReason: 'the file is unchanged',
    });

    const message = await router.persistGateConfig(true);

    expect(message).toContain('No config version was recorded: the file is unchanged.');
    expect(message).not.toContain('config version 9');
  });
});
