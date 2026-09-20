import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { DiagnosticAccumulator } from '../../../../../src/engine/execution/pipeline/state/accumulators/diagnostic-accumulator.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('DiagnosticAccumulator', () => {
  let accumulator: DiagnosticAccumulator;

  beforeEach(() => {
    jest.clearAllMocks();
    accumulator = new DiagnosticAccumulator(mockLogger as any);
  });

  // The read-side query API (getAll/getByLevel/getByStage/hasErrors/hasWarnings/getSummary/
  // clear) was deleted at P4.52 — nothing in production ever read the accumulated entries
  // back, only the logger side effect `add()` performs. Coverage below observes that side
  // effect, which is the only externally-visible behavior `add()`/the convenience methods
  // still have.

  describe('basic operations', () => {
    test('adds diagnostic entries', () => {
      accumulator.add('info', 'TestStage', 'Test message');
      expect(accumulator.size).toBe(1);
    });
  });

  describe('logger integration', () => {
    test('logs error entries to logger.error', () => {
      accumulator.error('TestStage', 'Error message', 'CODE', { data: 'test' });

      expect(mockLogger.error).toHaveBeenCalledWith('[TestStage] Error message', { data: 'test' });
    });

    test('logs warning entries to logger.warn', () => {
      accumulator.warn('TestStage', 'Warning message', { data: 'test' });

      expect(mockLogger.warn).toHaveBeenCalledWith('[TestStage] Warning message', { data: 'test' });
    });

    test('logs info entries to logger.info', () => {
      accumulator.info('TestStage', 'Info message', { data: 'test' });

      expect(mockLogger.info).toHaveBeenCalledWith('[TestStage] Info message', { data: 'test' });
    });

    test('logs debug entries to logger.debug', () => {
      accumulator.debug('TestStage', 'Debug message', { data: 'test' });

      expect(mockLogger.debug).toHaveBeenCalledWith('[TestStage] Debug message', { data: 'test' });
    });

    test('logs with empty context when not provided', () => {
      accumulator.info('TestStage', 'Info message');

      expect(mockLogger.info).toHaveBeenCalledWith('[TestStage] Info message', {});
    });
  });
});
