// @lifecycle canonical - Telemetry subsystem startup/shutdown orchestration.
/**
 * Telemetry Lifecycle
 *
 * Extracts telemetry startup/shutdown from application.ts (1303 lines, Critical severity).
 * Owns: SDK initialization, hook observer registration, graceful shutdown flush.
 *
 * Architecture: Thin orchestration shell — delegates to TelemetryRuntimeImpl,
 * AttributePolicyEnforcer, and TelemetryHookObserver. No embedded domain logic.
 */

import type { TelemetryStatus } from '#infra/observability/telemetry/index.js';
import type { Logger, TelemetryConfig } from '#shared/types/index.js';

import { HookRegistry } from '#infra/hooks/index.js';
import {
  createTelemetryRuntime,
  TelemetryRuntimeImpl,
  AttributePolicyEnforcer,
  TelemetryHookObserver,
} from '#infra/observability/telemetry/index.js';

export interface TelemetryLifecycleParams {
  config: TelemetryConfig;
  logger: Logger;
  hookRegistry: HookRegistry;
  serviceName: string;
  serviceVersion: string;
}

/**
 * Orchestrates the telemetry subsystem lifecycle.
 *
 * Usage in application.ts:
 * ```typescript
 * this.telemetryLifecycle = new TelemetryLifecycle({ config, logger, hookRegistry, ... });
 * await this.telemetryLifecycle.start();  // In startup()
 * await this.telemetryLifecycle.shutdown(); // In shutdown()
 * ```
 */
export class TelemetryLifecycle {
  private readonly runtime: TelemetryRuntimeImpl;
  private readonly observer: TelemetryHookObserver;
  private started = false;

  constructor(params: TelemetryLifecycleParams) {
    const { config, logger, hookRegistry, serviceName, serviceVersion } = params;

    // Create runtime (does not start — start() is called separately)
    this.runtime = createTelemetryRuntime(config, logger, serviceName, serviceVersion);

    // Create attribute policy enforcer from config
    const policyEnforcer = new AttributePolicyEnforcer(config.attributePolicy);

    // Create hook observer and register with HookRegistry
    this.observer = new TelemetryHookObserver(this.runtime, policyEnforcer, logger);
    this.observer.register(hookRegistry);
  }

  /**
   * Start the telemetry runtime (SDK initialization + exporter connection).
   * Safe to call when telemetry is disabled — will log and no-op.
   */
  async start(): Promise<void> {
    if (this.started) return;

    await this.runtime.start();
    this.started = true;
  }

  /**
   * Graceful shutdown: flush pending spans, tear down SDK.
   */
  async shutdown(): Promise<void> {
    if (!this.started) return;

    await this.runtime.shutdown();
    this.started = false;
  }

  /**
   * Whether the telemetry runtime is active and collecting.
   */
  isEnabled(): boolean {
    return this.runtime.isEnabled();
  }

  /**
   * Get the underlying runtime for consumers that need tracer access (Phase 1.4).
   */
  getRuntime(): TelemetryRuntimeImpl {
    return this.runtime;
  }

  /**
   * Get status snapshot for observability resources (Phase 1.6).
   */
  getStatus(): TelemetryStatus {
    return this.runtime.getStatus();
  }
}
