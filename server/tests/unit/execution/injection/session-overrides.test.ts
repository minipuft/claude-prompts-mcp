// @lifecycle canonical - Unit tests for SessionOverrideResolver
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  SessionOverrideResolver,
  initSessionOverrideResolver,
  getSessionOverrideResolver,
  isSessionOverrideResolverInitialized,
  resetSessionOverrideResolver,
} from '../../../../src/engine/execution/pipeline/decisions/injection/session-overrides.js';

describe('SessionOverrideResolver', () => {
  let mockLogger: any;
  let manager: SessionOverrideResolver;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    manager = new SessionOverrideResolver(mockLogger);
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
      const retrieved = manager.getAllOverrides().get('system-prompt');
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

  // getOverride()/clearOverride() were deleted at P4.52 — zero production callers
  // (getAllOverrides()/clearAllOverrides() are the only paths any real caller uses), and
  // their expiry/removal behavior is already covered live-method-first below via
  // getAllOverrides(), which performs its own expiry cleanup.
  describe('clearAllOverrides', () => {
    it('should clear all overrides and return count', () => {
      manager.setOverride('system-prompt', true);
      manager.setOverride('gate-guidance', false);
      manager.setOverride('style-guidance', true);

      const count = manager.clearAllOverrides();

      expect(count).toBe(3);
      expect(manager.getAllOverrides().size).toBe(0);
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

  // toDecisionInputFormat() was deleted at P4.52 — zero production callers.
  // InjectionControlStage feeds decide() through its own private
  // toSessionOverrideRecord(), which duplicates this method's logic against the Map
  // getSessionOverrides() already returns rather than calling it (P4.52 finding, not
  // fixed here: the two return subtly different empty-vs-undefined shapes).
});

describe('Singleton Functions', () => {
  let mockLogger: any;

  beforeEach(() => {
    resetSessionOverrideResolver();
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  afterEach(() => {
    resetSessionOverrideResolver();
  });

  describe('initSessionOverrideResolver', () => {
    it('should initialize and return manager', () => {
      const manager = initSessionOverrideResolver(mockLogger);

      expect(manager).toBeDefined();
      expect(isSessionOverrideResolverInitialized()).toBe(true);
    });

    it('should return existing instance if already initialized', () => {
      const manager1 = initSessionOverrideResolver(mockLogger);
      const manager2 = initSessionOverrideResolver(mockLogger);

      expect(manager1).toBe(manager2);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Already initialized'));
    });
  });

  describe('getSessionOverrideResolver', () => {
    it('should throw if not initialized', () => {
      expect(() => getSessionOverrideResolver()).toThrow('SessionOverrideResolver not initialized');
    });

    it('should return manager if initialized', () => {
      initSessionOverrideResolver(mockLogger);

      const manager = getSessionOverrideResolver();

      expect(manager).toBeDefined();
    });
  });

  describe('isSessionOverrideResolverInitialized', () => {
    it('should return false before initialization', () => {
      expect(isSessionOverrideResolverInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      initSessionOverrideResolver(mockLogger);
      expect(isSessionOverrideResolverInitialized()).toBe(true);
    });
  });

  describe('resetSessionOverrideResolver', () => {
    it('should reset the singleton', () => {
      initSessionOverrideResolver(mockLogger);
      expect(isSessionOverrideResolverInitialized()).toBe(true);

      resetSessionOverrideResolver();

      expect(isSessionOverrideResolverInitialized()).toBe(false);
    });
  });
});
