import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createFrameworkStateStore } from '../../../src/engine/frameworks/framework-state-store.js';

import type { Logger } from '../../../src/infra/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * A config whose `frameworks.defaultFramework` names a framework the bundle does not ship.
 *
 * Measured 2026-10-28 when `radiant` left the bundle: a project whose config still said
 * `defaultFramework: "RADIANT"` and whose workspace no longer carried it. The scope has no
 * persisted row, so the configured default IS its starting selection, and the server has to say
 * so rather than start on some other framework.
 */
describe('FrameworkStateStore (configured default that is not registered)', () => {
  let tmpRoot: string;
  let stateDbPath: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-unknown-default-'));
    fs.mkdirSync(path.join(tmpRoot, 'runtime-state'), { recursive: true });
    stateDbPath = path.join(tmpRoot, 'runtime-state', 'state.db');
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  test('a scope with no persisted row refuses to start, naming the framework and the setting', async () => {
    const logger = createLogger();

    await expect(
      createFrameworkStateStore(logger, stateDbPath, {
        defaultFramework: () => 'framework-nobody-registered',
        defaultScope: { workspaceId: 'project-naming-an-unknown-default' },
      })
    ).rejects.toThrow(
      /'framework-nobody-registered'.*not registered.*frameworks\.defaultFramework/s
    );
  });

  test('the same scope starts when the configured default is registered', async () => {
    const logger = createLogger();

    // Positive control: this call differs from the refusal above in the default's identifier
    // alone, so the refusal is about that identifier and not about the scope, the database or
    // the options object.
    const store = await createFrameworkStateStore(logger, stateDbPath, {
      defaultFramework: () => 'react',
      defaultScope: { workspaceId: 'project-naming-a-registered-default' },
    });

    expect(store.getCurrentState().activeFramework.toLowerCase()).toBe('react');
    await store.shutdown();
  });

  test('a persisted selection that is gone falls back to the configured default and says which', async () => {
    const logger = createLogger();
    const scope = { workspaceId: 'project-whose-framework-left-the-bundle' };
    // `switchFramework` on the store persists what it is told; validation belongs to the manager.
    const before = await createFrameworkStateStore(logger, stateDbPath, { defaultScope: scope });
    await before.switchFramework({ targetFramework: 'framework-that-left-the-bundle' });
    await before.shutdown();

    const after = await createFrameworkStateStore(logger, stateDbPath, {
      defaultFramework: () => 'react',
      defaultScope: scope,
    });

    expect(after.getCurrentState().activeFramework.toLowerCase()).toBe('react');
    const warned = (logger.warn as jest.Mock).mock.calls.map(([message]) => String(message));
    expect(warned).toContainEqual(
      expect.stringMatching(/'framework-that-left-the-bundle' not found.*default framework 'react'/)
    );
    await after.shutdown();
  });
});
