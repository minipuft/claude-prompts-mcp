/**
 * `EnhancedLogger.logToConsole` console-output rules by transport and environment.
 *
 * Row 1.8 of `config-contract-consolidation-2026-09-11.md`: under STDIO outside CI, every level
 * used to drop silently from the console — a real warning or error existed only in the log file,
 * never on stderr. `tests/setup.ts` sets `NODE_ENV=test` globally, and `isCI` reads
 * `NODE_ENV === 'test'` in the constructor, so the bug was invisible to this entire suite unless a
 * test explicitly removed `CI`/`NODE_ENV` first — which is why these tests do that in
 * `beforeEach`, before constructing the logger.
 *
 * Ruling (do not re-decide): STDIO + not CI → ERROR/WARN always reach stderr, INFO/DEBUG only
 * with `enableDebug`. CI, any transport → unchanged. non-STDIO, not CI → unchanged. Nothing may
 * ever reach stdout/console.log: STDIO owns it for the protocol.
 *
 * POSITIVE CONTROL: the "STDIO + not CI" tests below were run once against the OLD
 * `logToConsole` (the version that gated everything on `transport !== TransportType.STDIO`
 * outside the CI branch) and confirmed to fail — a probe that cannot fail is not a check.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { EnhancedLogger } from '../../../../src/infra/logging/index.js';
import { TransportType } from '../../../../src/shared/types/index.js';

const LOG_FILE = '/dev/null';

describe('EnhancedLogger.logToConsole', () => {
  let originalCI: string | undefined;
  let originalNodeEnv: string | undefined;
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;

  beforeEach(() => {
    // isCI is computed once, in the constructor — remove both signals BEFORE any logger in
    // this describe block is built, so `new EnhancedLogger(...)` inside each test observes a
    // non-CI environment. tests/setup.ts sets NODE_ENV=test globally, which is why this suite
    // would otherwise never exercise the STDIO-outside-CI branch at all.
    originalCI = process.env['CI'];
    originalNodeEnv = process.env['NODE_ENV'];
    delete process.env['CI'];
    delete process.env['NODE_ENV'];

    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
    stdoutSpy.mockRestore();

    if (originalCI === undefined) {
      delete process.env['CI'];
    } else {
      process.env['CI'] = originalCI;
    }
    if (originalNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = originalNodeEnv;
    }
  });

  describe('STDIO transport, outside CI', () => {
    it('sends warn() to console.warn with the [WARN] prefix', () => {
      const logger = new EnhancedLogger({ logFile: LOG_FILE, transport: TransportType.STDIO });

      logger.warn('disk space low');

      expect(warnSpy).toHaveBeenCalledWith('[WARN] disk space low');
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('sends error() to console.error with the [ERROR] prefix', () => {
      const logger = new EnhancedLogger({ logFile: LOG_FILE, transport: TransportType.STDIO });

      logger.error('config load failed');

      expect(errorSpy).toHaveBeenCalledWith('[ERROR] config load failed');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not reach the console for info() or debug() without enableDebug', () => {
      const logger = new EnhancedLogger({ logFile: LOG_FILE, transport: TransportType.STDIO });

      logger.info('server starting');
      logger.debug('verbose detail');

      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('reaches console.error for info() and debug() when enableDebug is set', () => {
      const logger = new EnhancedLogger({
        logFile: LOG_FILE,
        transport: TransportType.STDIO,
        enableDebug: true,
      });

      logger.info('server starting');
      logger.debug('verbose detail');

      expect(errorSpy).toHaveBeenCalledWith('[INFO] server starting');
      expect(errorSpy).toHaveBeenCalledWith('[DEBUG] verbose detail');
    });

    it('never writes to stdout or console.log, at any level', () => {
      const logger = new EnhancedLogger({
        logFile: LOG_FILE,
        transport: TransportType.STDIO,
        enableDebug: true,
      });

      logger.error('e');
      logger.warn('w');
      logger.info('i');
      logger.debug('d');

      expect(logSpy).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });

  describe('regression guards for the ruling\'s "unchanged" cells', () => {
    it('CI + STDIO still only prints ERROR/WARN, matching pre-fix behavior', () => {
      process.env['CI'] = 'true';
      const logger = new EnhancedLogger({
        logFile: LOG_FILE,
        transport: TransportType.STDIO,
        enableDebug: true,
      });

      logger.error('e');
      logger.warn('w');
      logger.info('i');
      logger.debug('d');

      expect(errorSpy).toHaveBeenCalledWith('[ERROR] e');
      expect(warnSpy).toHaveBeenCalledWith('[WARN] w');
      expect(errorSpy).not.toHaveBeenCalledWith('[INFO] i');
      expect(errorSpy).not.toHaveBeenCalledWith('[DEBUG] d');
    });

    it('non-STDIO transport outside CI still prints all four levels, unchanged', () => {
      const logger = new EnhancedLogger({ logFile: LOG_FILE, transport: 'streamable-http' });

      logger.error('e');
      logger.warn('w');
      logger.info('i');
      logger.debug('d');

      expect(errorSpy).toHaveBeenCalledWith('[ERROR] e');
      expect(warnSpy).toHaveBeenCalledWith('[WARN] w');
      expect(errorSpy).toHaveBeenCalledWith('[INFO] i');
      // debug() is gated by shouldLog() before it ever reaches logToConsole — the default
      // configuredLevel is 'info', which excludes DEBUG regardless of transport.
      expect(errorSpy).not.toHaveBeenCalledWith('[DEBUG] d');
    });
  });
});
