// @lifecycle canonical - Runtime session overrides for injection control.

import type { Logger } from '#infra/logging/index.js';
import type {
  InjectionRuntimeOverride,
  InjectionSessionState,
  InjectionTarget,
  InjectionType,
} from './types.js';

/**
 * Manages runtime session overrides for injection control.
 *
 * Overrides set via system_control injection:override are stored here
 * and used by InjectionDecisionService during decision making.
 *
 * Session state is ephemeral - cleared on server restart.
 * For persistent configuration changes, use config.json.
 */
export class SessionOverrideResolver {
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

    this.logger.info('[SessionOverrideResolver] Override set', {
      type,
      enabled,
      target,
      scope,
      scopeId,
    });

    return override;
  }

  /**
   * Clear all overrides.
   */
  clearAllOverrides(): number {
    const count = this.state.overrides.size;
    this.state.overrides.clear();

    this.logger.info('[SessionOverrideResolver] All overrides cleared', { count });

    return count;
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
}

/**
 * Singleton instance for the current session.
 * Should be created by the application during startup.
 */
let sessionOverrideResolver: SessionOverrideResolver | null = null;

/**
 * Initialize the session override manager.
 * Call once during application startup.
 */
export function initSessionOverrideResolver(logger: Logger): SessionOverrideResolver {
  if (sessionOverrideResolver) {
    logger.warn('[SessionOverrideResolver] Already initialized, returning existing instance');
    return sessionOverrideResolver;
  }

  sessionOverrideResolver = new SessionOverrideResolver(logger);
  return sessionOverrideResolver;
}

/**
 * Get the current session override manager.
 * Throws if not initialized.
 */
export function getSessionOverrideResolver(): SessionOverrideResolver {
  if (!sessionOverrideResolver) {
    throw new Error(
      'SessionOverrideResolver not initialized. Call initSessionOverrideResolver first.'
    );
  }
  return sessionOverrideResolver;
}

/**
 * Check if the session override manager is initialized.
 */
export function isSessionOverrideResolverInitialized(): boolean {
  return sessionOverrideResolver !== null;
}

/**
 * Reset the session override manager (for testing).
 */
export function resetSessionOverrideResolver(): void {
  sessionOverrideResolver = null;
}
