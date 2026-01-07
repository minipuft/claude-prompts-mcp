import { afterAll, beforeAll, describe, expect, test, jest } from '@jest/globals';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createMethodologyTracker } from '../../../src/frameworks/prompt-guidance/methodology-tracker.js';

import type { Logger } from '../../../src/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

describe('MethodologyTracker (persistence)', () => {
  let tmpRoot: string;
  let stateFile: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'methodology-state-'));
    stateFile = path.join(tmpRoot, 'runtime-state', 'framework-state.json');
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  test('writes and restores methodology state', async () => {
    const logger = createLogger();
    const trackerA = await createMethodologyTracker(logger, {
      serverRoot: tmpRoot,
      stateFilePath: stateFile,
      persistStateToDisk: true,
      enableHealthMonitoring: false,
    });

    await trackerA.switchMethodology({ targetMethodology: 'ReACT', reason: 'unit-switch' });
    await trackerA.setMethodologySystemEnabled(false, 'unit-disable');

    const raw = fs.readFileSync(stateFile, 'utf-8');
    const json = JSON.parse(raw);
    expect(json.activeMethodology).toBeDefined();

    await trackerA.shutdown();

    const trackerB = await createMethodologyTracker(logger, {
      serverRoot: tmpRoot,
      stateFilePath: stateFile,
      persistStateToDisk: true,
      enableHealthMonitoring: false,
    });
    const state = trackerB.getCurrentState();
    // Note: schema differs from FrameworkStateManager; we assert toggle persisted
    expect(state.methodologySystemEnabled).toBe(false);
    await trackerB.shutdown();
  });
});

