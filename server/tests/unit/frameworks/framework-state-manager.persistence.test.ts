import { afterAll, beforeAll, describe, expect, test, jest } from '@jest/globals';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createFrameworkStateManager } from '../../../src/frameworks/framework-state-manager.js';

import type { Logger } from '../../../src/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

describe('FrameworkStateManager (persistence)', () => {
  let tmpRoot: string;
  let stateFile: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-state-'));
    stateFile = path.join(tmpRoot, 'runtime-state', 'framework-state.json');
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  test('writes and restores framework state across instances', async () => {
    const logger = createLogger();
    const mgrA = await createFrameworkStateManager(logger, tmpRoot);

    await mgrA.enableFrameworkSystem('unit-enable');
    await mgrA.switchFramework({ targetFramework: 'react', reason: 'unit-switch' });

    const rawA = fs.readFileSync(stateFile, 'utf-8');
    const jsonA = JSON.parse(rawA);
    expect(jsonA.frameworkSystemEnabled).toBe(true);
    expect(jsonA.activeFramework.toLowerCase()).toBe('react');

    // New instance should restore the same state
    const mgrB = await createFrameworkStateManager(logger, tmpRoot);
    const stateB = mgrB.getCurrentState();
    expect(stateB.frameworkSystemEnabled).toBe(true);
    expect(stateB.activeFramework.toLowerCase()).toBe('react');

    await mgrA.shutdown();
    await mgrB.shutdown();
  });
});

