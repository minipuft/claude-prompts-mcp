import { afterAll, afterEach, beforeAll, describe, expect, test, jest } from '@jest/globals';

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ArgumentHistoryTracker } from '../../../src/text-references/argument-history-tracker.js';

import type { Logger } from '../../../src/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

describe('ArgumentHistoryTracker (persistence)', () => {
  let tmpRoot: string;
  let persistencePath: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'arg-history-'));
    const rt = path.join(tmpRoot, 'runtime-state');
    try { require('fs').mkdirSync(rt, { recursive: true }); } catch {}
    persistencePath = path.join(rt, 'argument-history.json');
  });

  afterAll(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('writes to and restores from runtime-state/argument-history.json', () => {
    const logger = createLogger();
    // First tracker: write one entry
    const trackerA = new ArgumentHistoryTracker(logger, 10, persistencePath);
    trackerA.trackExecution({
      promptId: 'chain-x',
      sessionId: 'sess-1',
      originalArgs: { q: 'hello' },
      stepNumber: 1,
      stepResult: 'R1',
    });

    // Ensure state is flushed (saveToFile is sync, but call shutdown to be explicit)
    trackerA.shutdown();
    const raw = readFileSync(persistencePath, 'utf-8');
    const json = JSON.parse(raw);
    expect(json.version).toBe('1.0.0');
    expect(Object.keys(json.chains)).toContain('sess-1');

    // Second tracker: should restore previous state
    const trackerB = new ArgumentHistoryTracker(logger, 10, persistencePath);
    const history = trackerB.getSessionHistory('sess-1');
    expect(history).toHaveLength(1);
    expect(history[0].originalArgs).toEqual({ q: 'hello' });
    expect(history[0].stepNumber).toBe(1);
    expect(history[0].stepResult).toBe('R1');
  });
});
