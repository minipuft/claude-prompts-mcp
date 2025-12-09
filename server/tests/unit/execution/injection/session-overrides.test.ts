// @lifecycle canonical - Unit tests for SessionOverrideManager
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  SessionOverrideManager,
  initSessionOverrideManager,
  getSessionOverrideManager,
  isSessionOverrideManagerInitialized,
  resetSessionOverrideManager,
} from '../../../../src/execution/pipeline/decisions/injection/session-overrides.js';

describe('SessionOverrideManager', () => {
  let mockLogger: any;
  let manager: SessionOverrideManager;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    manager = new SessionOverrideManager(mockLogger);
  });

  describe('setOverride', () => {
    it('should set an override for an injection type', () => {
      const override = manager.setOverride('system-prompt', false);

      expect(override.type).toBe('system-prompt');
      expect(override.enabled).toBe(false);
      expect(override.scope).toBe('session');
      expect(override.setAt).toBeDefined();
    });

    it('should set override with custom scope', () => {
      const override = manager.setOverride('gate-guidance', true, 'chain', 'my-chain-id');

      expect(override.scope).toBe('chain');
      expect(override.scopeId).toBe('my-chain-id');
    });

    it('should set override with expiration', () => {
      const expiresInMs = 60000; // 1 minute
      const override = manager.setOverride(
        'style-guidance',
        false,
        'session',
        undefined,
        expiresInMs
      );

      expect(override.expiresAt).toBeDefined();
      expect(override.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should replace existing override', () => {
      manager.setOverride('system-prompt', true);
      const newOverride = manager.setOverride('system-prompt', false);

      expect(newOverride.enabled).toBe(false);
      const retrieved = manager.getOverride('system-prompt');
      expect(retrieved?.enabled).toBe(false);
    });

    it('should log override set', () => {
      manager.setOverride('system-prompt', true);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Override set'),
        expect.any(Object)
      );
    });
  });

  describe('getOverride', () => {
    it('should return undefined for non-existent override', () => {
      const override = manager.getOverride('system-prompt');
      expect(override).toBeUndefined();
    });

    it('should return set override', () => {
      manager.setOverride('gate-guidance', true);

      const override = manager.getOverride('gate-guidance');

      expect(override).toBeDefined();
      expect(override?.enabled).toBe(true);
    });

    it('should return undefined for expired override', () => {
      // Set an override that expires immediately
      manager.setOverride('system-prompt', true, 'session', undefined, -1000);

      const override = manager.getOverride('system-prompt');

      expect(override).toBeUndefined();
    });
  });

  describe('clearOverride', () => {
    it('should clear existing override and return true', () => {
      manager.setOverride('system-prompt', true);

      const result = manager.clearOverride('system-prompt');

      expect(result).toBe(true);
      expect(manager.getOverride('system-prompt')).toBeUndefined();
    });

    it('should return false for non-existent override', () => {
      const result = manager.clearOverride('system-prompt');

      expect(result).toBe(false);
    });
  });

  describe('clearAllOverrides', () => {
    it('should clear all overrides and return count', () => {
      manager.setOverride('system-prompt', true);
      manager.setOverride('gate-guidance', false);
      manager.setOverride('style-guidance', true);

      const count = manager.clearAllOverrides();

      expect(count).toBe(3);
      expect(manager.getOverride('system-prompt')).toBeUndefined();
      expect(manager.getOverride('gate-guidance')).toBeUndefined();
      expect(manager.getOverride('style-guidance')).toBeUndefined();
    });

    it('should return 0 when no overrides exist', () => {
      const count = manager.clearAllOverrides();
      expect(count).toBe(0);
    });
  });

  describe('getAllOverrides', () => {
    it('should return all active overrides', () => {
      manager.setOverride('system-prompt', true);
      manager.setOverride('gate-guidance', false);

      const overrides = manager.getAllOverrides();

      expect(overrides.size).toBe(2);
      expect(overrides.get('system-prompt')?.enabled).toBe(true);
      expect(overrides.get('gate-guidance')?.enabled).toBe(false);
    });

    it('should filter out expired overrides', () => {
      manager.setOverride('system-prompt', true);
      manager.setOverride('gate-guidance', false, 'session', undefined, -1000); // Expired

      const overrides = manager.getAllOverrides();

      expect(overrides.size).toBe(1);
      expect(overrides.has('system-prompt')).toBe(true);
      expect(overrides.has('gate-guidance')).toBe(false);
    });
  });

  describe('getHistory', () => {
    it('should return all override history', () => {
      manager.setOverride('system-prompt', true);
      manager.setOverride('system-prompt', false);
      manager.setOverride('gate-guidance', true);

      const history = manager.getHistory();

      expect(history.length).toBe(3);
    });

    it('should limit history when limit provided', () => {
      manager.setOverride('system-prompt', true);
      manager.setOverride('system-prompt', false);
      manager.setOverride('gate-guidance', true);

      const history = manager.getHistory(2);

      expect(history.length).toBe(2);
    });

    it('should return most recent entries when limited', () => {
      manager.setOverride('system-prompt', true);
      manager.setOverride('gate-guidance', false);
      manager.setOverride('style-guidance', true);

      const history = manager.getHistory(2);

      // Should return the last 2 entries
      expect(history[0].type).toBe('gate-guidance');
      expect(history[1].type).toBe('style-guidance');
    });
  });

  describe('getStatusSummary', () => {
    it('should return summary with active overrides', () => {
      manager.setOverride('system-prompt', true);
      manager.setOverride('gate-guidance', false);

      const summary = manager.getStatusSummary();

      expect(summary.activeOverrides).toBe(2);
      expect(summary.overrides.length).toBe(2);
      expect(summary.historyCount).toBe(2);
    });

    it('should return summary with no overrides', () => {
      const summary = manager.getStatusSummary();

      expect(summary.activeOverrides).toBe(0);
      expect(summary.overrides.length).toBe(0);
      expect(summary.historyCount).toBe(0);
    });

    it('should include override details in summary', () => {
      manager.setOverride('system-prompt', false, 'chain', 'test-chain');

      const summary = manager.getStatusSummary();

      expect(summary.overrides[0]).toEqual(
        expect.objectContaining({
          type: 'system-prompt',
          enabled: false,
          scope: 'chain',
        })
      );
    });
  });

  describe('toDecisionInputFormat', () => {
    it('should convert overrides to decision input format', () => {
      manager.setOverride('system-prompt', false);
      manager.setOverride('gate-guidance', true);

      const format = manager.toDecisionInputFormat();

      expect(format).toEqual({
        'system-prompt': false,
        'gate-guidance': true,
      });
    });

    it('should skip overrides with undefined enabled', () => {
      manager.setOverride('system-prompt', undefined as any);

      const format = manager.toDecisionInputFormat();

      expect(format).toEqual({});
    });

    it('should return empty object when no overrides', () => {
      const format = manager.toDecisionInputFormat();
      expect(format).toEqual({});
    });
  });
});

describe('Singleton Functions', () => {
  let mockLogger: any;

  beforeEach(() => {
    resetSessionOverrideManager();
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  afterEach(() => {
    resetSessionOverrideManager();
  });

  describe('initSessionOverrideManager', () => {
    it('should initialize and return manager', () => {
      const manager = initSessionOverrideManager(mockLogger);

      expect(manager).toBeDefined();
      expect(isSessionOverrideManagerInitialized()).toBe(true);
    });

    it('should return existing instance if already initialized', () => {
      const manager1 = initSessionOverrideManager(mockLogger);
      const manager2 = initSessionOverrideManager(mockLogger);

      expect(manager1).toBe(manager2);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Already initialized'));
    });
  });

  describe('getSessionOverrideManager', () => {
    it('should throw if not initialized', () => {
      expect(() => getSessionOverrideManager()).toThrow('SessionOverrideManager not initialized');
    });

    it('should return manager if initialized', () => {
      initSessionOverrideManager(mockLogger);

      const manager = getSessionOverrideManager();

      expect(manager).toBeDefined();
    });
  });

  describe('isSessionOverrideManagerInitialized', () => {
    it('should return false before initialization', () => {
      expect(isSessionOverrideManagerInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      initSessionOverrideManager(mockLogger);
      expect(isSessionOverrideManagerInitialized()).toBe(true);
    });
  });

  describe('resetSessionOverrideManager', () => {
    it('should reset the singleton', () => {
      initSessionOverrideManager(mockLogger);
      expect(isSessionOverrideManagerInitialized()).toBe(true);

      resetSessionOverrideManager();

      expect(isSessionOverrideManagerInitialized()).toBe(false);
    });
  });
});
