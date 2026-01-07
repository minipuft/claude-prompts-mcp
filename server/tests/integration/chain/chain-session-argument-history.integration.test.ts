import { afterAll, beforeAll, describe, expect, test, jest } from '@jest/globals';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ChainSessionManager } from '../../../src/chain-session/manager.js';
import { ArgumentHistoryTracker } from '../../../src/text-references/argument-history-tracker.js';

import type { Logger } from '../../../src/logging/index.js';

class StubTextReferenceManager {
  private store: Record<string, Record<number, { result: string; metadata: any }>> = {};
  storeChainStepResult = jest.fn(
    (chainId: string, step: number, result: string, metadata: any) => {
      this.store[chainId] ||= {} as any;
      this.store[chainId][step] = { result, metadata };
    }
  );
  buildChainVariables = jest.fn().mockImplementation((chainId: string) => {
    const steps = this.store[chainId] || {};
    const step_results: Record<string, string> = {};
    for (const [k, v] of Object.entries(steps)) {
      step_results[k] = v.result;
    }
    return { step_results };
  });
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
}

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

describe('ChainSessionManager + ArgumentHistoryTracker (integration)', () => {
  let tmpRoot: string;
  let runtimeStateDir: string;
  let argHistoryPath: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-arg-int-'));
    runtimeStateDir = path.join(tmpRoot, 'runtime-state');
    argHistoryPath = path.join(runtimeStateDir, 'argument-history.json');
    fs.mkdirSync(runtimeStateDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  test('real step completion writes argument-history and enriches chainContext', async () => {
    const logger = createLogger();
    const textReference = new StubTextReferenceManager();
    const tracker = new ArgumentHistoryTracker(logger, 10, argHistoryPath);

    const manager = new ChainSessionManager(
      logger,
      textReference as any,
      { serverRoot: tmpRoot, cleanupIntervalMs: 1000 },
      tracker
    );

    await manager.createSession('sess-1', 'chain-ctx', 2, { input: 'alpha' });

    // Simulate placeholder then real response for step 1
    await manager.updateSessionState('sess-1', 1, 'placeholder', { isPlaceholder: true });
    await manager.updateStepResult('sess-1', 1, 'REAL-OUTPUT-1');
    await manager.completeStep('sess-1', 1, { preservePlaceholder: false });
    await manager.advanceStep('sess-1', 1);

    const context = manager.getChainContext('sess-1');
    // Original args should be present via ArgumentHistoryTracker (merged at root)
    expect(context.input).toBe('alpha');
    // previous_step_results should include step 1
    expect(context.previous_step_results).toBeDefined();
    expect(context.previous_step_results['1']).toBe('REAL-OUTPUT-1');

    const persisted = JSON.parse(fs.readFileSync(argHistoryPath, 'utf-8'));
    expect(Object.keys(persisted.chains).length).toBeGreaterThan(0);

    await manager.cleanup();
  });
});
