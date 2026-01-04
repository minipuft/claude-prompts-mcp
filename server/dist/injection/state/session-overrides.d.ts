import type { Logger } from '../../logging/index.js';
import type { InjectionRuntimeOverride } from '../config-types.js';
import type { InjectionType } from '../types.js';
/**
 * Manages runtime session overrides for injection control.
 *
 * Overrides set via system_control injection:override are stored here
 * and used by InjectionDecisionAuthority during decision making.
 *
 * Session state is ephemeral - cleared on server restart.
 * For persistent configuration changes, use config.json.
 */
export declare class SessionOverrideManager {
    private readonly logger;
    private state;
    constructor(logger: Logger);
    /**
     * Set a runtime override for an injection type.
     */
    setOverride(type: InjectionType, enabled: boolean | undefined, scope?: 'session' | 'chain' | 'step', scopeId?: string, expiresInMs?: number): InjectionRuntimeOverride;
    /**
     * Clear a specific override.
     */
    clearOverride(type: InjectionType): boolean;
    /**
     * Clear all overrides.
     */
    clearAllOverrides(): number;
    /**
     * Get a specific override.
     */
    getOverride(type: InjectionType): InjectionRuntimeOverride | undefined;
    /**
     * Get all active overrides.
     */
    getAllOverrides(): Map<InjectionType, InjectionRuntimeOverride>;
    /**
     * Get override history for debugging.
     */
    getHistory(limit?: number): InjectionRuntimeOverride[];
    /**
     * Get status summary for system_control injection:status.
     */
    getStatusSummary(): {
        activeOverrides: number;
        overrides: Array<{
            type: InjectionType;
            enabled?: boolean;
            scope: string;
            setAt: number;
            expiresAt?: number;
        }>;
        historyCount: number;
    };
    /**
     * Convert overrides to a format usable by InjectionDecisionInput.
     */
    toDecisionInputFormat(): Partial<Record<InjectionType, boolean>>;
}
/**
 * Initialize the session override manager.
 * Call once during application startup.
 */
export declare function initSessionOverrideManager(logger: Logger): SessionOverrideManager;
/**
 * Get the current session override manager.
 * Throws if not initialized.
 */
export declare function getSessionOverrideManager(): SessionOverrideManager;
/**
 * Check if the session override manager is initialized.
 */
export declare function isSessionOverrideManagerInitialized(): boolean;
/**
 * Reset the session override manager (for testing).
 */
export declare function resetSessionOverrideManager(): void;
