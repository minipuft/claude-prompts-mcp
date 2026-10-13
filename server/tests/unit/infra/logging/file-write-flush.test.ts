/**
 * `EnhancedLogger` file writes are queued in call order and `flush()` waits for them, so a
 * caller about to `process.exit` can keep every line it logged. `flushLogger` bounds that wait.
 *
 * Without the queue, each line was a separate unawaited `appendFile`: nothing could wait for
 * them, and the server's exit discarded every line logged during shutdown.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createNoopLogger,
  EnhancedLogger,
  flushLogger,
} from '../../../../src/infra/logging/index.js';
import { TransportType } from '../../../../src/shared/types/index.js';

const LINE_COUNT = 200;

describe('EnhancedLogger file writes', () => {
  let dir: string;
  let logFile: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'logger-flush-'));
    logFile = path.join(dir, 'mcp-server.log');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('holds every line logged before flush() resolves, in call order', async () => {
    const logger = new EnhancedLogger({ logFile, transport: TransportType.STDIO });
    await logger.initLogFile();

    for (let i = 0; i < LINE_COUNT; i++) {
      logger.info(`line-${i}`);
    }
    await logger.flush();

    const logged = readFileSync(logFile, 'utf8')
      .split('\n')
      .map((line) => /line-(\d+)$/.exec(line)?.[1])
      .filter((n): n is string => n !== undefined);
    expect(logged).toEqual(Array.from({ length: LINE_COUNT }, (_, i) => String(i)));
  });

  it('keeps writing after a failed write, and reports the failure on stderr only', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const missing = path.join(dir, 'absent-dir', 'mcp-server.log');
      const logger = new EnhancedLogger({ logFile: missing, transport: TransportType.STDIO });
      logger.info('lost');
      await logger.flush();

      expect(errorSpy).toHaveBeenCalledWith('Error writing to log file:', expect.anything());
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('formats a line when it is logged, not when its write runs', async () => {
    const logger = new EnhancedLogger({ logFile, transport: TransportType.STDIO });
    await logger.initLogFile();
    const state = { phase: 'before' };

    logger.info('state', state);
    state.phase = 'after';
    await logger.flush();

    expect(readFileSync(logFile, 'utf8')).toContain('state {"phase":"before"}');
  });
});

describe('flushLogger', () => {
  it('stops waiting at the timeout when a write never settles', async () => {
    const logger = new EnhancedLogger({ logFile: '/dev/null', transport: TransportType.STDIO });
    jest.spyOn(logger, 'flush').mockReturnValue(new Promise<void>(() => undefined));

    const started = Date.now();
    await flushLogger(logger, 50);

    expect(logger.flush).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns at once for a logger that queues no writes, or none at all', async () => {
    await expect(flushLogger(createNoopLogger())).resolves.toBeUndefined();
    await expect(flushLogger(null)).resolves.toBeUndefined();
  });
});
