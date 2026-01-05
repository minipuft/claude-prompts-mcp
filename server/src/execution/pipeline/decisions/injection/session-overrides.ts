// @lifecycle canonical - Runtime session overrides for injection control.

import type {
  InjectionRuntimeOverride,
  InjectionSessionState,
  InjectionTarget,
  InjectionType,
} from './types.js';
import type { Logger } from '../../../../logging/index.js';

/**
 * Manages runtime session overrides for injection control.
 *
 * Overrides set via system_control injection:override are stored here
 * and used by InjectionDecisionService during decision making.
 *
 * Session state is ephemeral - cleared on server restart.
 * For persistent configuration changes, use config.json.
 */
export class SessionOverrideManager {
  private readonly logger: Logger;
  private state: InjectionSessionState;

  constructor(logger: Logger) {
    this.logger = logger;
    this.state = {
      overrides: new Map(),
      history: [],
    };
  }

  /**
   * Set a runtime override for an injection type.
   */
  setOverride(
    type: InjectionType,
    enabled: boolean | undefined,
    scope: 'session' | 'chain' | 'step' = 'session',
    scopeId?: string,
    expiresInMs?: number,
    target?: InjectionTarget
  ): InjectionRuntimeOverride {
    const override: InjectionRuntimeOverride = {
      type,
      scope,
      setAt: Date.now(),
    };

    if (enabled !== undefined) {
      override.enabled = enabled;
    }
    if (target !== undefined) {
      override.target = target;
    }
    if (scopeId !== undefined) {
      override.scopeId = scopeId;
    }
    if (expiresInMs) {
      override.expiresAt = Date.now() + expiresInMs;
    }

    this.state.overrides.set(type, override);
    this.state.history.push(override);

    this.logger.info('[SessionOverrideManager] Override set', {
      type,
      enabled,
      target,
      scope,
      scopeId,
    });

    return override;
  }

  /**
   * Clear a specific override.
   */
  clearOverride(type: InjectionType): boolean {
    const existed = this.state.overrides.has(type);
    this.state.overrides.delete(type);

    if (existed) {
      this.logger.info('[SessionOverrideManager] Override cleared', { type });
    }

    return existed;
  }

  /**
   * Clear all overrides.
   */
  clearAllOverrides(): number {
    const count = this.state.overrides.size;
    this.state.overrides.clear();

    this.logger.info('[SessionOverrideManager] All overrides cleared', { count });

    return count;
  }

  /**
   * Get a specific override.
   */
  getOverride(type: InjectionType): InjectionRuntimeOverride | undefined {
    const override = this.state.overrides.get(type);

    // Check if expired
    if (override?.expiresAt && Date.now() > override.expiresAt) {
      this.state.overrides.delete(type);
      this.logger.debug('[SessionOverrideManager] Override expired', { type });
      return undefined;
    }

    return override;
  }

  /**
   * Get all active overrides.
   */
  getAllOverrides(): Map<InjectionType, InjectionRuntimeOverride> {
    // Clean up expired overrides
    for (const [type, override] of this.state.overrides) {
      if (override.expiresAt && Date.now() > override.expiresAt) {
        this.state.overrides.delete(type);
      }
    }

    return new Map(this.state.overrides);
  }

  /**
   * Get override history for debugging.
   */
  getHistory(limit?: number): InjectionRuntimeOverride[] {
    const history = [...this.state.history];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get status summary for system_control injection:status.
   */
  getStatusSummary(): {
    activeOverrides: number;
    overrides: Array<{
      type: InjectionType;
      enabled?: boolean;
      target?: InjectionTarget;
      scope: string;
      setAt: number;
      expiresAt?: number;
    }>;
    historyCount: number;
  } {
    const activeOverrides = this.getAllOverrides();

    return {
      activeOverrides: activeOverrides.size,
      overrides: Array.from(activeOverrides.entries()).map(([type, override]) => {
        const summary: {
          type: InjectionType;
          enabled?: boolean;
          target?: InjectionTarget;
          scope: string;
          setAt: number;
          expiresAt?: number;
        } = {
          type,
          scope: override.scope,
          setAt: override.setAt,
        };

        if (override.enabled !== undefined) {
          summary.enabled = override.enabled;
        }
        if (override.target !== undefined) {
          summary.target = override.target;
        }
        if (override.expiresAt !== undefined) {
          summary.expiresAt = override.expiresAt;
        }

        return summary;
      }),
      historyCount: this.state.history.length,
    };
  }

  /**
   * Convert overrides to a format usable by InjectionDecisionInput.
   */
  toDecisionInputFormat(): Partial<Record<InjectionType, boolean>> {
    const result: Partial<Record<InjectionType, boolean>> = {};

    for (const [type, override] of this.getAllOverrides()) {
      if (override.enabled !== undefined) {
        result[type] = override.enabled;
      }
    }

    return result;
  }
}

/**
 * Singleton instance for the current session.
 * Should be created by the application during startup.
 */
let sessionOverrideManager: SessionOverrideManager | null = null;

/**
 * Initialize the session override manager.
 * Call once during application startup.
 */
export function initSessionOverrideManager(logger: Logger): SessionOverrideManager {
  if (sessionOverrideManager) {
    logger.warn('[SessionOverrideManager] Already initialized, returning existing instance');
    return sessionOverrideManager;
  }

  sessionOverrideManager = new SessionOverrideManager(logger);
  return sessionOverrideManager;
}

/**
 * Get the current session override manager.
 * Throws if not initialized.
 */
export function getSessionOverrideManager(): SessionOverrideManager {
  if (!sessionOverrideManager) {
    throw new Error(
      'SessionOverrideManager not initialized. Call initSessionOverrideManager first.'
    );
  }
  return sessionOverrideManager;
}

/**
 * Check if the session override manager is initialized.
 */
export function isSessionOverrideManagerInitialized(): boolean {
  return sessionOverrideManager !== null;
}

/**
 * Reset the session override manager (for testing).
 */
export function resetSessionOverrideManager(): void {
  sessionOverrideManager = null;
}
