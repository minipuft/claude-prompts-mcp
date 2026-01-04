export interface ManagedService {
    /** Unique identifier for the service */
    readonly name: string;
    /** Start the service (may be synchronous or async) */
    start(): Promise<void> | void;
    /** Stop the service (should be idempotent) */
    stop(): Promise<void> | void;
}
/**
 * ServiceManager orchestrates lifecycle for background services (watchers, timers, etc.).
 * It prevents duplicate starts, provides deterministic shutdown order, and makes it easier
 * to restart services when configuration changes.
 */
export declare class ServiceManager {
    private services;
    register(service: ManagedService): void;
    hasService(name: string): boolean;
    startService(name: string): Promise<void>;
    stopService(name: string): Promise<void>;
    startAll(): Promise<void>;
    stopAll(): Promise<void>;
}
