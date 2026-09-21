// @lifecycle canonical - Core types for system_control action handlers.

import type { FrameworkManager } from '#engine/frameworks/framework-manager.js';
import type { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import type { PromptGuidanceService } from '#engine/frameworks/prompt-guidance/index.js';
import type { GateStateStore } from '#engine/gates/gate-state-store.js';
import type { GateGuidanceRenderer } from '#engine/gates/guidance/GateGuidanceRenderer.js';
import type { ExecutionRecordStore } from '#modules/chains/execution-record-store.js';
import type { SkillsSyncPaths } from '#modules/skills-sync/service.js';
import type {
  StateStoreOptions,
  ConfigManager,
  MetricsCollector,
  Logger,
  ToolResponse,
  ChainSessionService,
  DatabasePort,
} from '#shared/types/index.js';
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
  readonly executionRecordStore?: ExecutionRecordStore;
  /**
   * Set once the database is up. Skills-sync manifests are the only consumer:
   * without it, `export` still writes skills but drops every manifest row, so
   * `diff` and `prune` cannot see what was exported.
   */
  readonly databasePort?: DatabasePort;
  /**
   * Resolves skills-sync's source, write and bundled directories through the running
   * server's own `PathResolver`, so `--workspace` and `MCP_WORKSPACE` resolve identically
   * over MCP. Wired unconditionally at startup (`module-initializer.ts`), regardless of
   * whether persistence is configured, so a missing value here means the composition root
   * itself regressed -- `SkillsSyncActionHandler` throws rather than falling back to the
   * environment-only resolution the standalone CLI wrapper uses.
   */
  readonly skillsSyncPaths?: () => SkillsSyncPaths;
  readonly configManager?: ConfigManager;
  readonly onRestart?: (reason: string) => Promise<void>;
  /**
   * Rebuild and re-advertise the tool surface after a state change that alters
   * it. The `prompt_engine` parameter shape is a function of the gate system
   * switch, so toggling gates has to refresh the surface the same way a
   * framework switch does — otherwise a long-lived STDIO connection keeps
   * advertising parameters that no longer do anything.
   */
  readonly onToolSurfaceChanged?: () => Promise<void>;
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
