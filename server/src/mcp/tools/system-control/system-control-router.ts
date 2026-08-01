// @lifecycle canonical - Thin router for system_control MCP tool actions.

import {
  SYSTEM_CONTROL_ACTION_IDS,
  type SystemControlActionId,
} from '../../metadata/definitions/system-control.js';
import { recordActionInvocation } from '../../metadata/usage-tracker.js';
import { SafeConfigWriter, createSafeConfigWriter } from '../config-utils.js';
import { createStructuredResponse } from './core/response-utils.js';
import { AnalyticsActionHandler } from './handlers/analytics-action-handler.js';
import { ChangesActionHandler } from './handlers/changes-action-handler.js';
import { ConfigActionHandler } from './handlers/config-action-handler.js';
import { FrameworkActionHandler } from './handlers/framework-action-handler.js';
import { GateActionHandler } from './handlers/gate-action-handler.js';
import { GuideActionHandler } from './handlers/guide-action-handler.js';
import { InjectionActionHandler } from './handlers/injection-action-handler.js';
import { MaintenanceActionHandler } from './handlers/maintenance-action-handler.js';
import { SessionActionHandler } from './handlers/session-action-handler.js';
import { StatusActionHandler } from './handlers/status-action-handler.js';
import { ResponseFormatter } from '../prompt-engine/processors/response-formatter.js';

import type { PromptGuidanceService } from '#engine/frameworks/prompt-guidance/index.js';
import type { GateGuidanceRenderer } from '#engine/gates/guidance/GateGuidanceRenderer.js';
import type { ActionHandler } from './core/action-handler-base.js';
import type { SystemAnalytics, SystemControlContext } from './core/types.js';

import { FrameworkManager } from '#engine/frameworks/framework-manager.js';
import { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import { GateStateStore } from '#engine/gates/gate-state-store.js';
import {
  type ConfigManager,
  type MetricsCollector,
  type Logger,
  type ToolResponse,
  type ChainSessionService,
  StateStoreOptions,
} from '#shared/types/index.js';
import { resolveRequestIdentity } from '#shared/utils/request-identity-resolver.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

function isSystemControlActionId(value: string): value is SystemControlActionId {
  return (SYSTEM_CONTROL_ACTION_IDS as readonly string[]).includes(value);
}

/**
 * System control router — thin orchestrator dispatching to focused action handlers.
 *
 * Implements SystemControlContext to provide type-safe shared state to all handlers.
 * Domain logic lives in the handler classes, not here.
 */
export class ConsolidatedSystemControl implements SystemControlContext {
  // ── Infrastructure ──────────────────────────────────────────────────
  readonly logger: Logger;
  readonly responseFormatter: ResponseFormatter;
  readonly startTime: number = Date.now();

  // ── Subsystem managers (set after construction) ─────────────────────
  frameworkStateStore?: FrameworkStateStore;
  frameworkManager?: FrameworkManager;
  gateStateStore?: GateStateStore;
  gateGuidanceRenderer?: GateGuidanceRenderer;
  chainSessionStore?: ChainSessionService;
  configManager?: ConfigManager;
  safeConfigWriter?: SafeConfigWriter;
  onRestart?: (reason: string) => Promise<void>;
  mcpToolsManager?: any;
  analyticsService?: MetricsCollector;
  promptGuidanceService?: PromptGuidanceService;

  // ── Mutable runtime state ───────────────────────────────────────────
  systemAnalytics: SystemAnalytics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageExecutionTime: 0,
    gateValidationCount: 0,
    uptime: 0,
    performanceTrends: [],
  };
  requestScope?: StateStoreOptions;

  // ── Private tracking ────────────────────────────────────────────────
  private lastMemoryUsage: number = 0;

  constructor(logger: Logger, _mcpServer: any, onRestart?: (reason: string) => Promise<void>) {
    this.logger = logger;
    if (onRestart) {
      this.onRestart = onRestart;
    }
    this.responseFormatter = new ResponseFormatter(this.logger);
  }

  // ── Setters (called from McpToolRouter during wiring) ───────────────

  setFrameworkStateStore(frameworkStateStore: FrameworkStateStore): void {
    this.frameworkStateStore = frameworkStateStore;
  }

  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
  }

  setAnalyticsService(analyticsService: MetricsCollector): void {
    this.analyticsService = analyticsService;
    this.responseFormatter.setAnalyticsService(analyticsService);
  }

  setConfigManager(configManager: ConfigManager): void {
    this.configManager = configManager;
    try {
      const configPath = configManager.getConfigPath();
      this.safeConfigWriter = createSafeConfigWriter(this.logger, configManager, configPath);
      this.logger.debug('ConfigManager and SafeConfigWriter configured for system control');
    } catch (error) {
      this.logger.warn('Failed to initialize SafeConfigWriter:', error);
      this.logger.debug('ConfigManager configured for system control (read-only mode)');
    }
  }

  setRestartCallback(onRestart: (reason: string) => Promise<void>): void {
    this.onRestart = onRestart;
    this.logger.debug('Restart callback configured for system control');
  }

  setMCPToolsManager(mcpToolsManager: any): void {
    this.mcpToolsManager = mcpToolsManager;
    this.logger.debug('MCPToolsManager reference configured for dynamic tool updates');
  }

  setGateStateStore(gateStateStore: GateStateStore): void {
    this.gateStateStore = gateStateStore;
    this.logger.debug('Gate system manager configured for runtime gate control');
  }

  setChainSessionStore(chainSessionStore: ChainSessionService): void {
    this.chainSessionStore = chainSessionStore;
    this.logger.debug('Chain session manager configured for session control');
  }

  setGateGuidanceRenderer(renderer: GateGuidanceRenderer): void {
    this.gateGuidanceRenderer = renderer;
    this.logger.debug('Gate guidance renderer configured for gate discovery');
  }

  // ── SystemControlContext methods ────────────────────────────────────

  createMinimalSystemResponse(text: string, action: string): ToolResponse {
    const now = Date.now();
    const frameworkState = this.frameworkStateStore?.getCurrentState();
    const systemHealth = this.frameworkStateStore?.getSystemHealth?.();
    const frameworkEnabled =
      systemHealth?.frameworkSystemEnabled ?? frameworkState?.frameworkSystemEnabled ?? false;

    const activeFramework =
      frameworkState?.activeFramework ?? systemHealth?.activeFramework ?? 'unknown';

    const availableFrameworks =
      systemHealth?.availableFrameworks ??
      this.frameworkManager?.listFrameworks(true).map((framework) => framework.id) ??
      [];

    const uptime = now - this.startTime;

    const memoryUsage =
      typeof process !== 'undefined' && typeof process.memoryUsage === 'function'
        ? process.memoryUsage()
        : undefined;

    const structuredMemoryUsage = memoryUsage
      ? {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external,
          arrayBuffers: memoryUsage.arrayBuffers,
        }
      : undefined;

    return createStructuredResponse(text, false, {
      action,
      executionMetadata: {
        executionId: `sc-${action}-${now}`,
        executionType: 'single' as const,
        startTime: now,
        endTime: now,
        executionTime: 0,
        frameworkEnabled,
      },
      systemState: {
        frameworkEnabled,
        activeFramework,
        availableFrameworks,
        uptime,
        ...(structuredMemoryUsage ? { memoryUsage: structuredMemoryUsage } : {}),
        serverHealth: systemHealth?.status ?? 'unknown',
      },
    });
  }

  async persistGateConfig(enabled: boolean): Promise<string | undefined> {
    if (!this.safeConfigWriter) {
      return '⚠️ Persistence skipped (config writer unavailable).';
    }

    try {
      const result = await this.safeConfigWriter.updateConfigValue(
        'gates.enabled',
        String(enabled),
        { createBackup: false }
      );
      if (!result.success) {
        return `⚠️ Failed to persist gates.enabled: ${result.message || result.error}`;
      }
      return `📁 Persisted gates.enabled=${enabled} to config.json.`;
    } catch (error) {
      this.logger.warn('Failed to persist gates.enabled', error);
      return `⚠️ Failed to persist gates.enabled: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async persistFrameworkConfig(enabled: boolean): Promise<string | undefined> {
    if (!this.safeConfigWriter) {
      return '⚠️ Persistence skipped (config writer unavailable).';
    }

    // Every key here must appear in CONFIG_VALID_KEYS — updateConfigValue rejects anything else
    // as "Unknown configuration key". Two of the three previously listed did not
    // (`frameworks.injection.systemPrompt.enabled` and `gates.enableMethodologyGates`), and the
    // loop returns on first failure, so persistence aborted before writing anything.
    const keys = [
      'frameworks.enabled',
      'frameworks.dynamicToolDescriptions',
      'gates.frameworkGates',
    ];

    try {
      for (const key of keys) {
        const result = await this.safeConfigWriter.updateConfigValue(key, String(enabled), {
          createBackup: false,
        });
        if (!result.success) {
          return `⚠️ Failed to persist ${key}: ${result.message || result.error}`;
        }
      }
      return `📁 Persisted framework toggles (${keys.join(', ')}) to ${enabled} in config.json.`;
    } catch (error) {
      this.logger.warn('Failed to persist framework toggles', error);
      return `⚠️ Failed to persist framework toggles: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // ── Analytics (called from McpToolRouter) ───────────────────────────

  updateAnalytics(analytics: Partial<SystemAnalytics> & { currentExecution?: any }): void {
    Object.assign(this.systemAnalytics, analytics);
    this.systemAnalytics.uptime = Date.now() - this.startTime;
    this.systemAnalytics.memoryUsage = process.memoryUsage();

    if (analytics.currentExecution) {
      const currentExecution = analytics.currentExecution;
      this.systemAnalytics.performanceTrends.push({
        timestamp: Date.now(),
        metric: 'executionTime',
        value: currentExecution.executionTime,
        executionMode: currentExecution.executionMode,
        framework: currentExecution.framework,
        success: currentExecution.success,
      });
    }

    if (this.systemAnalytics.memoryUsage) {
      const memoryDelta = this.calculateMemoryDelta();
      if (Math.abs(memoryDelta) > 1024 * 1024) {
        this.systemAnalytics.performanceTrends.push({
          timestamp: Date.now(),
          metric: 'memoryDelta',
          value: memoryDelta,
        });
      }
    }

    if (analytics.totalExecutions && analytics.totalExecutions % 10 === 0) {
      const successRate =
        analytics.totalExecutions > 0
          ? ((analytics.successfulExecutions || 0) / analytics.totalExecutions) * 100
          : 0;
      this.systemAnalytics.performanceTrends.push({
        timestamp: Date.now(),
        metric: 'successRate',
        value: successRate,
      });
    }

    if (this.systemAnalytics.performanceTrends.length > 100) {
      this.systemAnalytics.performanceTrends.shift();
    }
  }

  private calculateMemoryDelta(): number {
    if (!this.systemAnalytics.memoryUsage) return 0;
    const currentMemory = this.systemAnalytics.memoryUsage.heapUsed;
    const delta = currentMemory - this.lastMemoryUsage;
    this.lastMemoryUsage = currentMemory;
    return delta;
  }

  // ── Action dispatch ─────────────────────────────────────────────────

  async handleAction(
    args: { action: string; [key: string]: any },
    extra: any
  ): Promise<ToolResponse> {
    const { action } = args;
    this.logger.info(`⚙️ System Control: Executing action "${action}"`);

    this.requestScope = this.extractScope(extra);
    recordActionInvocation('system_control', action, 'received');

    try {
      if (!isSystemControlActionId(action)) {
        recordActionInvocation('system_control', action, 'unknown', {
          error: `Unknown action: ${action}`,
        });
        throw new Error(
          `Unknown action: ${action}. Valid actions: ${SYSTEM_CONTROL_ACTION_IDS.join(', ')}`
        );
      }

      const actionHandler = this.getActionHandler(action);
      const response = await actionHandler.execute(args);
      recordActionInvocation('system_control', action, 'success');
      return response;
    } catch (error) {
      const status =
        error instanceof Error && /Unknown action/i.test(error.message) ? 'unknown' : 'failure';
      recordActionInvocation('system_control', action, status, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.requestScope = undefined;
    }
  }

  private extractScope(extra: unknown): StateStoreOptions | undefined {
    if (!extra || typeof extra !== 'object') return undefined;
    const identity = resolveRequestIdentity(extra as Record<string, unknown>);
    const scopeId = resolveContinuityScopeId(identity);
    return scopeId !== 'default' ? { continuityScopeId: scopeId } : undefined;
  }

  private getActionHandler(action: SystemControlActionId): ActionHandler {
    switch (action) {
      case 'status':
        return new StatusActionHandler(this);
      case 'framework':
        return new FrameworkActionHandler(this);
      case 'gates':
        return new GateActionHandler(this);
      case 'analytics':
        return new AnalyticsActionHandler(this);
      case 'config':
        return new ConfigActionHandler(this);
      case 'maintenance':
        return new MaintenanceActionHandler(this);
      case 'guide':
        return new GuideActionHandler(this);
      case 'injection':
        return new InjectionActionHandler(this);
      case 'session':
        return new SessionActionHandler(this);
      case 'changes':
        return new ChangesActionHandler(this);
      default:
        throw new Error(
          `Unknown action: ${action}. Valid actions: ${SYSTEM_CONTROL_ACTION_IDS.join(', ')}`
        );
    }
  }
}

export function createConsolidatedSystemControl(
  logger: Logger,
  mcpServer: any,
  onRestart?: (reason: string) => Promise<void>
): ConsolidatedSystemControl {
  return new ConsolidatedSystemControl(logger, mcpServer, onRestart);
}
