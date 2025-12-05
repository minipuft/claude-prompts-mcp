import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { DiagnosticAccumulator } from '../../../../../src/execution/pipeline/state/accumulators/diagnostic-accumulator.js';

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

  describe('basic operations', () => {
    test('adds diagnostic entries', () => {
      accumulator.add('info', 'TestStage', 'Test message');
      expect(accumulator.size).toBe(1);
    });

    test('getAll returns all entries', () => {
      accumulator.info('Stage1', 'Info message');
      accumulator.warn('Stage2', 'Warning message');
      accumulator.error('Stage3', 'Error message');

      const entries = accumulator.getAll();
      expect(entries).toHaveLength(3);
    });

    test('entries have correct structure', () => {
      accumulator.add('warning', 'GateEnhancement', 'No gates configured', {
        code: 'NO_GATES',
        context: { promptId: 'demo' },
      });

      const entries = accumulator.getAll();
      expect(entries[0]).toMatchObject({
        level: 'warning',
        stage: 'GateEnhancement',
        message: 'No gates configured',
        code: 'NO_GATES',
        context: { promptId: 'demo' },
      });
      expect(entries[0].timestamp).toBeDefined();
      expect(typeof entries[0].timestamp).toBe('number');
    });
  });

  describe('convenience methods', () => {
    test('warn() adds warning entry', () => {
      accumulator.warn('TestStage', 'Warning message', { extra: 'data' });

      const entries = accumulator.getAll();
      expect(entries[0].level).toBe('warning');
      expect(entries[0].stage).toBe('TestStage');
      expect(entries[0].message).toBe('Warning message');
      expect(entries[0].context).toEqual({ extra: 'data' });
    });

    test('error() adds error entry with code', () => {
      accumulator.error('TestStage', 'Error message', 'ERR_CODE', { details: 'here' });

      const entries = accumulator.getAll();
      expect(entries[0].level).toBe('error');
      expect(entries[0].code).toBe('ERR_CODE');
      expect(entries[0].context).toEqual({ details: 'here' });
    });

    test('info() adds info entry', () => {
      accumulator.info('TestStage', 'Info message');

      const entries = accumulator.getAll();
      expect(entries[0].level).toBe('info');
    });

    test('debug() adds debug entry', () => {
      accumulator.debug('TestStage', 'Debug message');

      const entries = accumulator.getAll();
      expect(entries[0].level).toBe('debug');
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

  describe('filtering', () => {
    beforeEach(() => {
      accumulator.debug('Stage1', 'Debug 1');
      accumulator.info('Stage1', 'Info 1');
      accumulator.info('Stage2', 'Info 2');
      accumulator.warn('Stage2', 'Warning 1');
      accumulator.error('Stage3', 'Error 1');
      accumulator.error('Stage3', 'Error 2');
    });

    test('getByLevel filters by level', () => {
      const errors = accumulator.getByLevel('error');
      expect(errors).toHaveLength(2);
      errors.forEach((e) => expect(e.level).toBe('error'));

      const warnings = accumulator.getByLevel('warning');
      expect(warnings).toHaveLength(1);

      const infos = accumulator.getByLevel('info');
      expect(infos).toHaveLength(2);

      const debugs = accumulator.getByLevel('debug');
      expect(debugs).toHaveLength(1);
    });

    test('getByStage filters by stage', () => {
      const stage1Entries = accumulator.getByStage('Stage1');
      expect(stage1Entries).toHaveLength(2);
      stage1Entries.forEach((e) => expect(e.stage).toBe('Stage1'));

      const stage2Entries = accumulator.getByStage('Stage2');
      expect(stage2Entries).toHaveLength(2);

      const stage3Entries = accumulator.getByStage('Stage3');
      expect(stage3Entries).toHaveLength(2);
    });

    test('getByStage returns empty for unknown stage', () => {
      const unknownEntries = accumulator.getByStage('UnknownStage');
      expect(unknownEntries).toHaveLength(0);
    });
  });

  describe('status checks', () => {
    test('hasErrors returns true when errors exist', () => {
      expect(accumulator.hasErrors()).toBe(false);
      accumulator.error('TestStage', 'Error');
      expect(accumulator.hasErrors()).toBe(true);
    });

    test('hasWarnings returns true when warnings exist', () => {
      expect(accumulator.hasWarnings()).toBe(false);
      accumulator.warn('TestStage', 'Warning');
      expect(accumulator.hasWarnings()).toBe(true);
    });

    test('hasErrors is false for warnings only', () => {
      accumulator.warn('TestStage', 'Warning');
      expect(accumulator.hasErrors()).toBe(false);
    });
  });

  describe('summary', () => {
    test('getSummary returns counts by level', () => {
      accumulator.debug('S', 'msg');
      accumulator.info('S', 'msg');
      accumulator.info('S', 'msg');
      accumulator.warn('S', 'msg');
      accumulator.warn('S', 'msg');
      accumulator.warn('S', 'msg');
      accumulator.error('S', 'msg');

      const summary = accumulator.getSummary();
      expect(summary).toEqual({
        debug: 1,
        info: 2,
        warning: 3,
        error: 1,
      });
    });

    test('getSummary returns zeros when empty', () => {
      const summary = accumulator.getSummary();
      expect(summary).toEqual({
        debug: 0,
        info: 0,
        warning: 0,
        error: 0,
      });
    });
  });

  describe('clear operation', () => {
    test('clear removes all entries', () => {
      accumulator.info('S', 'msg1');
      accumulator.warn('S', 'msg2');
      expect(accumulator.size).toBe(2);

      accumulator.clear();
      expect(accumulator.size).toBe(0);
      expect(accumulator.getAll()).toHaveLength(0);
      expect(accumulator.hasErrors()).toBe(false);
      expect(accumulator.hasWarnings()).toBe(false);
    });
  });

  describe('immutability', () => {
    test('getAll returns a copy, not the original array', () => {
      accumulator.info('S', 'msg');
      const entries1 = accumulator.getAll();
      const entries2 = accumulator.getAll();

      expect(entries1).not.toBe(entries2);
      expect(entries1).toEqual(entries2);
    });
  });
});
