// @lifecycle canonical - Core types for system_control action handlers.

import type { FrameworkManager } from '../../../../engine/frameworks/framework-manager.js';
import type { FrameworkStateStore } from '../../../../engine/frameworks/framework-state-store.js';
import type { PromptGuidanceService } from '../../../../engine/frameworks/prompt-guidance/index.js';
import type { GateStateStore } from '../../../../engine/gates/gate-state-store.js';
import type { GateGuidanceRenderer } from '../../../../engine/gates/guidance/GateGuidanceRenderer.js';
import type {
  StateStoreOptions,
  ConfigManager,
  MetricsCollector,
  Logger,
  ToolResponse,
  ChainSessionService,
} from '../../../../shared/types/index.js';
import type { SafeConfigWriter } from '../../config-utils.js';
import type { ResponseFormatter } from '../../prompt-engine/processors/response-formatter.js';

/**
 * System analytics — optimized for API performance and rich historical context.
 */
export interface SystemAnalytics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  gateValidationCount: number;
  uptime: number;
  memoryUsage?: NodeJS.MemoryUsage;
  performanceTrends: Array<{
    timestamp: number;
    metric: 'executionTime' | 'memoryDelta' | 'successRate' | 'gateValidationTime';
    value: number;
    executionMode?: string;
    framework?: string;
    success?: boolean;
  }>;
}

/**
 * Shared context for all system_control action handlers.
 *
 * Replaces the previous pattern of handlers accessing private fields via
 * bracket notation (`this.systemControl['field']`). Each field is type-safe
 * and documented.
 */
export interface SystemControlContext {
  // Infrastructure
  readonly logger: Logger;
  readonly responseFormatter: ResponseFormatter;

  // Subsystem managers (set after construction via setters)
  readonly frameworkStateStore?: FrameworkStateStore;
  readonly frameworkManager?: FrameworkManager;
  readonly gateStateStore?: GateStateStore;
  readonly gateGuidanceRenderer?: GateGuidanceRenderer;
  readonly chainSessionStore?: ChainSessionService;
  readonly configManager?: ConfigManager;
  readonly safeConfigWriter?: SafeConfigWriter;
  readonly onRestart?: (reason: string) => Promise<void>;
  readonly mcpToolsManager?: any;
  readonly analyticsService?: MetricsCollector;
  readonly promptGuidanceService?: PromptGuidanceService;

  // Mutable runtime state
  readonly startTime: number;
  systemAnalytics: SystemAnalytics;
  requestScope?: StateStoreOptions;

  // Shared methods
  createMinimalSystemResponse(text: string, action: string): ToolResponse;
  persistGateConfig(enabled: boolean): Promise<string | undefined>;
  persistFrameworkConfig(enabled: boolean): Promise<string | undefined>;
}
