// @lifecycle canonical - OpenTelemetry SDK lifecycle: initialization, shutdown, tracer access.
/**
 * Telemetry Runtime
 *
 * Wraps @opentelemetry/sdk-node for MCP server lifecycle management.
 * Handles:
 * - SDK initialization from TelemetryConfig
 * - Graceful shutdown with span flush
 * - Disabled/no-op mode when telemetry is off
 * - Tracer access for span creation
 *
 * Architecture: OOP shell (lifecycle class) + FP internals (config validation).
 * Cannot be added to existing analytics-service.ts (different concern: OTel SDK vs in-memory analytics).
 */

import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import type { Logger, TelemetryConfig } from '#shared/types/index.js';
import type { TelemetryRuntime, TelemetryStatus } from './types.js';
import type { Tracer } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';

// ===== Pure Functions =====

/**
 * Build OTel Resource from server identity.
 * Uses resourceFromAttributes() — the v2.x replacement for `new Resource()`.
 */
function buildResource(serviceName: string, serviceVersion: string): Resource {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
  });
}

/**
 * Build OTLP trace exporter from config.
 */
function buildTraceExporter(endpoint: string): OTLPTraceExporter {
  return new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  });
}

/**
 * Validate telemetry config for SDK initialization.
 * Returns null if config indicates telemetry should not start.
 */
function shouldInitialize(config: TelemetryConfig): boolean {
  if (!config.enabled) return false;
  if (config.mode === 'off') return false;
  return true;
}

// ===== Service Class =====

/**
 * Manages the OpenTelemetry NodeSDK lifecycle.
 *
 * Usage:
 * ```typescript
 * const runtime = new TelemetryRuntimeImpl(config, logger, 'claude-prompts', '2.0.0');
 * await runtime.start();
 * const tracer = runtime.getTracer('pipeline');
 * // ... create spans ...
 * await runtime.shutdown();
 * ```
 */
export class TelemetryRuntimeImpl implements TelemetryRuntime {
  private sdk: NodeSDK | null = null;
  private enabled = false;
  private startedAt: number | undefined;
  private readonly config: TelemetryConfig;
  private readonly logger: Logger;
  private readonly serviceName: string;
  private readonly serviceVersion: string;

  constructor(
    config: TelemetryConfig,
    logger: Logger,
    serviceName: string,
    serviceVersion: string
  ) {
    this.config = config;
    this.logger = logger;
    this.serviceName = serviceName;
    this.serviceVersion = serviceVersion;
  }

  async start(): Promise<void> {
    if (this.enabled) {
      this.logger.debug('[TelemetryRuntime] Already started, skipping');
      return;
    }

    if (!shouldInitialize(this.config)) {
      this.logger.info('[TelemetryRuntime] Telemetry disabled by config, running in no-op mode');
      return;
    }

    try {
      const resource = buildResource(this.serviceName, this.serviceVersion);
      const traceExporter = buildTraceExporter(this.config.exporterEndpoint);

      this.sdk = new NodeSDK({
        resource,
        traceExporter,
        // Sampling is configured via head sampling rate
        // Tail sampling is handled by the OTel Collector (see Phase 6.0)
      });

      this.sdk.start();
      this.enabled = true;
      this.startedAt = Date.now();

      this.logger.info('[TelemetryRuntime] Started', {
        mode: this.config.mode,
        endpoint: this.config.exporterEndpoint,
        samplingRate: this.config.samplingRate,
      });
    } catch (error) {
      // Graceful degradation: telemetry failure should not crash the server
      this.logger.error('[TelemetryRuntime] Failed to start, continuing without telemetry', error);
      this.enabled = false;
      this.sdk = null;
    }
  }

  async shutdown(): Promise<void> {
    if (this.sdk === null) {
      return;
    }

    try {
      this.logger.info('[TelemetryRuntime] Shutting down, flushing pending spans...');
      await this.sdk.shutdown();
      this.logger.info('[TelemetryRuntime] Shutdown complete');
    } catch (error) {
      this.logger.error('[TelemetryRuntime] Shutdown error', error);
    } finally {
      this.sdk = null;
      this.enabled = false;
      this.startedAt = undefined;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get a named tracer for creating spans.
   * Returns the global no-op tracer when telemetry is disabled,
   * so callers don't need to check isEnabled() before creating spans.
   */
  getTracer(name: string, version?: string): Tracer {
    return trace.getTracer(name, version);
  }

  /**
   * Get runtime status snapshot for observability resources.
   */
  getStatus(): TelemetryStatus {
    return {
      enabled: this.enabled,
      mode: this.config.mode,
      exporterEndpoint: this.config.exporterEndpoint,
      samplingRate: this.config.samplingRate,
      startedAt: this.startedAt,
    };
  }
}

// ===== Factory =====

/**
 * Create a telemetry runtime from config.
 * Does NOT start the runtime — call `start()` separately during application bootstrap.
 */
export function createTelemetryRuntime(
  config: TelemetryConfig,
  logger: Logger,
  serviceName: string,
  serviceVersion: string
): TelemetryRuntimeImpl {
  return new TelemetryRuntimeImpl(config, logger, serviceName, serviceVersion);
}
