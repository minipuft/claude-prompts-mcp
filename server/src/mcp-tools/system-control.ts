// @lifecycle canonical - System control MCP tool implementation.
/**
 * Consolidated System Control - Unified Framework & Analytics Management Tool
 *
 * Consolidates all system management functionality into a single intelligent tool:
 * - Framework switching and management (from system-status-tools.ts)
 * - System status and health monitoring
 * - Execution analytics and performance metrics
 * - Diagnostic reporting and maintenance
 * - Configuration management
 */

import {
  CONFIG_RESTART_REQUIRED_KEYS,
  CONFIG_VALID_KEYS,
  SafeConfigWriter,
  createSafeConfigWriter,
  validateConfigInput,
} from './config-utils.js';
import { ConfigManager } from '../config/index.js';
import {
  INJECTION_TYPES,
  INJECTION_TYPE_DESCRIPTIONS,
  DECISION_SOURCE_DESCRIPTIONS,
  isSessionOverrideManagerInitialized,
  getSessionOverrideManager,
  initSessionOverrideManager,
  type InjectionType,
} from '../execution/pipeline/decisions/injection/index.js';
import { FrameworkManager } from '../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../frameworks/framework-state-manager.js';
import { getDefaultRuntimeLoader } from '../frameworks/methodology/index.js';
import { Logger } from '../logging/index.js';
import {
  SYSTEM_CONTROL_ACTION_IDS,
  systemControlMetadata,
  type SystemControlActionId,
} from '../tooling/action-metadata/definitions/system-control.js';
import { ToolResponse } from '../types/index.js';
import { handleError as utilsHandleError } from '../utils/index.js';
import { ResponseFormatter } from './prompt-engine/processors/response-formatter.js';
import { ToolDescriptionManager } from './tool-description-manager.js';

// Chain session management integration

// Prompt guidance system integration
import { PromptGuidanceService } from '../frameworks/prompt-guidance/index.js';

// Clean architecture gate performance analytics

// Gates system management integration
import { GateSystemManager } from '../gates/gate-state-manager.js';
// Analytics service
import { MetricsCollector } from '../metrics/index.js';
import { recordActionInvocation } from '../tooling/action-metadata/usage-tracker.js';

// Data-driven methodology system (YAML-only)

// Injection control system

import type { ConfigKey } from './config-utils.js';
import type { ChainSessionService } from '../chain-session/types.js';
import type { GateGuidanceRenderer } from '../gates/guidance/GateGuidanceRenderer.js';
import type { FormatterExecutionContext } from './prompt-engine/core/types.js';

function createStructuredResponse(
  content: any,
  second?: boolean | Record<string, any>,
  third?: boolean | Record<string, any>
): ToolResponse {
  let metadata: Record<string, any> | undefined;
  let isError = false;

  if (typeof second === 'boolean') {
    isError = second;
    if (third && typeof third === 'object') {
      metadata = third;
    }
  } else if (second && typeof second === 'object') {
    metadata = second;
    if (typeof third === 'boolean') {
      isError = third;
    }
  }

  const textContent = Array.isArray(content)
    ? content[0]?.text || String(content)
    : String(content);

  const response: ToolResponse = {
    content: [{ type: 'text' as const, text: textContent }],
    isError,
  };

  if (metadata) {
    (response as any).metadata = metadata;
  }

  return response;
}

/**
 * System analytics interface - optimized for API performance and rich historical context
 */
interface SystemAnalytics {
  // High-frequency API fields (kept for O(1) performance)
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number; // Critical for dashboard APIs
  gateValidationCount: number;
  uptime: number;
  memoryUsage?: NodeJS.MemoryUsage;

  // Rich historical data with execution context
  performanceTrends: Array<{
    timestamp: number;
    metric: 'executionTime' | 'memoryDelta' | 'successRate' | 'gateValidationTime';
    value: number;
    executionMode?: string; // Replaces executionsByMode aggregation
    framework?: string;
    success?: boolean;
  }>;
}

/**
 * Consolidated System Control Tool
 */
export class ConsolidatedSystemControl {
  private logger: Logger;
  private mcpServer: any;
  private configManager?: ConfigManager;
  private safeConfigWriter?: SafeConfigWriter;
  public frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  public gateSystemManager?: GateSystemManager;
  public chainSessionManager?: ChainSessionService;
  private onRestart?: (reason: string) => Promise<void>;
  private toolDescriptionManager?: ToolDescriptionManager;
  private mcpToolsManager?: any; // Reference to MCPToolsManager for tool updates
  private analyticsService?: MetricsCollector;
  private responseFormatter: ResponseFormatter;
  // Prompt guidance service
  private promptGuidanceService?: PromptGuidanceService;
  private gateGuidanceRenderer?: GateGuidanceRenderer;
  public startTime: number = Date.now();

  // Analytics data
  public systemAnalytics: SystemAnalytics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageExecutionTime: 0,
    gateValidationCount: 0,
    uptime: 0,
    performanceTrends: [],
  };

  constructor(logger: Logger, mcpServer: any, onRestart?: (reason: string) => Promise<void>) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    if (onRestart) {
      this.onRestart = onRestart;
    }
    this.responseFormatter = new ResponseFormatter(this.logger);
  }

  /**
   * Set framework state manager
   */
  setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void {
    this.frameworkStateManager = frameworkStateManager;
  }

  /**
   * Set framework manager
   */
  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
  }

  /**
   * Set tool description manager
   */
  setToolDescriptionManager(manager: ToolDescriptionManager): void {
    this.toolDescriptionManager = manager;
  }

  /**
   * Set analytics service
   */
  setAnalyticsService(analyticsService: MetricsCollector): void {
    this.analyticsService = analyticsService;
    this.responseFormatter.setAnalyticsService(analyticsService);
  }

  /**
   * Set config manager for configuration operations
   */
  setConfigManager(configManager: ConfigManager): void {
    this.configManager = configManager;

    // Initialize SafeConfigWriter with the config file path
    try {
      // Get the config file path from the ConfigManager using proper getter method
      const configPath = configManager.getConfigPath();
      this.safeConfigWriter = createSafeConfigWriter(this.logger, configManager, configPath);
      this.logger.debug('ConfigManager and SafeConfigWriter configured for system control');
    } catch (error) {
      this.logger.warn('Failed to initialize SafeConfigWriter:', error);
      this.logger.debug('ConfigManager configured for system control (read-only mode)');
    }
  }

  /**
   * Set restart callback (for system restart functionality)
   */
  setRestartCallback(onRestart: (reason: string) => Promise<void>): void {
    this.onRestart = onRestart;
    this.logger.debug('Restart callback configured for system control');
  }

  /**
   * Set MCPToolsManager reference (for dynamic tool updates)
   */
  setMCPToolsManager(mcpToolsManager: any): void {
    this.mcpToolsManager = mcpToolsManager;
    this.logger.debug('MCPToolsManager reference configured for dynamic tool updates');
  }

  /**
   * Set gate system manager for runtime gate management
   */
  setGateSystemManager(gateSystemManager: GateSystemManager): void {
    this.gateSystemManager = gateSystemManager;
    this.logger.debug('Gate system manager configured for runtime gate control');
  }

  /**
   * Set chain session manager for session management operations
   */
  setChainSessionManager(chainSessionManager: ChainSessionService): void {
    this.chainSessionManager = chainSessionManager;
    this.logger.debug('Chain session manager configured for session control');
  }

  /**
   * Set gate guidance renderer for discovery operations
   */
  setGateGuidanceRenderer(renderer: GateGuidanceRenderer): void {
    this.gateGuidanceRenderer = renderer;
    this.logger.debug('Gate guidance renderer configured for gate discovery');
  }

  /**
   * Helper function for minimal outputSchema compliance
   */
  createMinimalSystemResponse(text: string, action: string): ToolResponse {
    const now = Date.now();
    const frameworkState = this.frameworkStateManager?.getCurrentState();
    const systemHealth = this.frameworkStateManager?.getSystemHealth?.();
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

  /**
   * Derived calculation: Get execution mode distribution from performance trends
   */
  getExecutionsByMode(): Record<string, number> {
    return this.systemAnalytics.performanceTrends.reduce(
      (acc, trend) => {
        if (trend.executionMode) {
          acc[trend.executionMode] = (acc[trend.executionMode] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>
    );
  }

  /**
   * Update system analytics with rich execution data
   */
  updateAnalytics(analytics: Partial<SystemAnalytics> & { currentExecution?: any }): void {
    // Update aggregate fields
    Object.assign(this.systemAnalytics, analytics);
    this.systemAnalytics.uptime = Date.now() - this.startTime;

    // Update memory usage
    this.systemAnalytics.memoryUsage = process.memoryUsage();

    // Record execution time trend with rich context
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

    // Add memory delta trend if significant change
    if (this.systemAnalytics.memoryUsage) {
      const memoryDelta = this.calculateMemoryDelta();
      if (Math.abs(memoryDelta) > 1024 * 1024) {
        // Only track changes > 1MB
        this.systemAnalytics.performanceTrends.push({
          timestamp: Date.now(),
          metric: 'memoryDelta',
          value: memoryDelta,
        });
      }
    }

    // Add success rate trend periodically (every 10 executions)
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

    // Keep only last 100 trend points
    if (this.systemAnalytics.performanceTrends.length > 100) {
      this.systemAnalytics.performanceTrends.shift();
    }
  }

  /**
   * Calculate memory usage delta from previous execution
   */
  private lastMemoryUsage: number = 0;
  private calculateMemoryDelta(): number {
    if (!this.systemAnalytics.memoryUsage) return 0;

    const currentMemory = this.systemAnalytics.memoryUsage.heapUsed;
    const delta = currentMemory - this.lastMemoryUsage;
    this.lastMemoryUsage = currentMemory;

    return delta;
  }

  /**
   * Persist gate enablement to config.json when requested.
   */
  private async persistGateConfig(enabled: boolean): Promise<string | undefined> {
    if (!this.safeConfigWriter) {
      return '⚠️ Persistence skipped (config writer unavailable).';
    }

    try {
      const result = await this.safeConfigWriter.updateConfigValue(
        'gates.enabled',
        String(enabled),
        {
          createBackup: false,
        }
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

  /**
   * Persist framework system enablement toggles to config.json when requested.
   */
  private async persistFrameworkConfig(enabled: boolean): Promise<string | undefined> {
    if (!this.safeConfigWriter) {
      return '⚠️ Persistence skipped (config writer unavailable).';
    }

    const keys = [
      'frameworks.injection.systemPrompt.enabled',
      'frameworks.dynamicToolDescriptions',
      'gates.enableMethodologyGates',
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

  /**
   * Main action handler
   */
  public async handleAction(
    args: {
      action: string;
      [key: string]: any;
    },
    extra: any
  ): Promise<ToolResponse> {
    const { action } = args;
    this.logger.info(`⚙️ System Control: Executing action "${action}"`);

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
    }
  }

  /**
   * Get the appropriate action handler based on action type
   */
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
      default:
        throw new Error(
          `Unknown action: ${action}. Valid actions: ${SYSTEM_CONTROL_ACTION_IDS.join(', ')}`
        );
    }
  }

  /**
   * Get comprehensive system status
   */
  public async getSystemStatus(args: {
    include_history?: boolean;
    include_metrics?: boolean;
  }): Promise<ToolResponse> {
    const { include_history = false, include_metrics = true } = args;

    if (!this.frameworkStateManager) {
      throw new Error('Framework state manager not initialized');
    }

    const health = this.frameworkStateManager.getSystemHealth();
    const statusIcon = health.status === 'healthy' ? '✅' : '⚠️';

    // Check if framework system is enabled for injection
    const isFrameworkEnabled = health.frameworkSystemEnabled;
    const frameworkStatusIcon = isFrameworkEnabled ? '✅' : '🚫';
    const frameworkStatusText = isFrameworkEnabled
      ? `${frameworkStatusIcon} Enabled (${health.activeFramework})`
      : `${frameworkStatusIcon} Disabled (${health.activeFramework} selected)`;

    let response = `${statusIcon} **System Status Overview**\n\n`;
    response += `**Framework System**: ${frameworkStatusText}\n`;
    response += `**Status**: ${health.status}\n`;
    response += `**Uptime**: ${Math.floor((Date.now() - this.startTime) / 1000 / 60)} minutes\n\n`;

    // Add warning message when framework is selected but system disabled
    if (!isFrameworkEnabled && health.activeFramework) {
      response += `⚠️ **Notice**: ${health.activeFramework} is selected but framework injection is disabled.\n`;
      response += `Prompts will execute without methodology guidance.\n`;
      response += `Use \`system_control framework enable\` to activate framework injection.\n\n`;
    }

    if (include_metrics) {
      response += `📊 **Performance Metrics**:\n`;
      response += `- Total Executions: ${this.systemAnalytics.totalExecutions}\n`;
      response += `- Success Rate: ${
        this.systemAnalytics.totalExecutions > 0
          ? Math.round(
              (this.systemAnalytics.successfulExecutions / this.systemAnalytics.totalExecutions) *
                100
            )
          : 0
      }%\n`;
      response += `- Average Execution Time: ${this.systemAnalytics.averageExecutionTime}ms\n\n`;
    }

    return this.createMinimalSystemResponse(response, 'status');
  }

  // Framework management methods
  public async switchFramework(args: {
    framework?: string;
    reason?: string;
  }): Promise<ToolResponse> {
    if (!this.frameworkManager) {
      throw new Error('Framework manager not initialized');
    }

    if (!args.framework) {
      throw new Error('Framework parameter is required for switch operation');
    }

    // Delegate to FrameworkManager - single authority for framework switching
    const result = await this.frameworkManager.switchFramework(
      args.framework,
      args.reason || `User requested switch to ${args.framework}`
    );

    if (!result.success) {
      throw new Error(result.error || 'Framework switch failed');
    }

    // Build success response using result.framework
    const framework = result.framework!;
    let response = `🔄 **Framework Switch Successful**\n\n`;
    response += `**Current**: ${framework.name} (${framework.id})\n`;
    response += `**Description**: ${framework.description}\n`;
    response += `**Type**: ${framework.type}\n\n`;
    response += `**Guidelines**: ${framework.executionGuidelines.join(' • ')}\n\n`;
    response += `✅ All future prompt executions will now use the ${framework.id} methodology.`;

    return this.createMinimalSystemResponse(response, 'switch_framework');
  }

  public async listFrameworks(args: { show_details?: boolean }): Promise<ToolResponse> {
    if (!this.frameworkManager) {
      throw new Error('Framework manager not initialized');
    }

    const frameworks = this.frameworkManager.listFrameworks();
    const currentState = this.frameworkStateManager?.getCurrentState();
    const activeFramework = currentState?.activeFramework || 'CAGEERF';

    // Get available data-driven methodologies for enrichment
    const runtimeLoader = getDefaultRuntimeLoader();
    const methodologyIds = runtimeLoader.discoverMethodologies();

    let response = `📋 **Available Frameworks**\n\n`;

    frameworks.forEach((framework: any) => {
      // Handle case variations by comparing uppercase versions
      const isActive = framework.id.toUpperCase() === activeFramework.toUpperCase();
      const status = isActive ? '🟢 ACTIVE' : '⚪ Available';

      // Try to load data-driven methodology definition for enhanced info
      const methodologyDef = runtimeLoader.loadMethodology(framework.id.toLowerCase());

      response += `**${framework.name}** ${status}\n`;

      if (args.show_details) {
        response += `   📝 ${framework.description}\n`;
        response += `   🎯 Type: ${framework.type}\n`;

        // Add data-driven methodology info if available
        if (methodologyDef) {
          if (methodologyDef.methodologyGates?.length) {
            response += `   🚧 Methodology Gates: ${methodologyDef.methodologyGates.length}\n`;
          }
          if (methodologyDef.phases?.processingSteps?.length) {
            response += `   📊 Processing Steps: ${methodologyDef.phases.processingSteps.length}\n`;
          }
          if (methodologyDef.phases?.qualityIndicators) {
            const indicatorCount = Object.keys(methodologyDef.phases.qualityIndicators).length;
            response += `   ✅ Quality Indicators: ${indicatorCount} categories\n`;
          }
        }

        if (framework.executionGuidelines && framework.executionGuidelines.length > 0) {
          response += `   📋 Guidelines: ${framework.executionGuidelines
            .slice(0, 2)
            .join(' • ')}\n`;
        }
        response += `\n`;
      }
    });

    if (!args.show_details) {
      response += `\n💡 Use 'show_details: true' for more information about each framework.\n`;
    }

    // Note about data-driven methodologies
    if (methodologyIds.length > 0) {
      response += `\n📦 Data-driven methodologies: ${methodologyIds.length} available`;
      response += `\n🔍 Use \`operation:"list_methodologies"\` for methodology-specific details`;
    }

    response += `\n🔄 Switch frameworks using: action="framework", operation="switch", framework="<name>"`;

    return this.createMinimalSystemResponse(response, 'list_frameworks');
  }

  /**
   * Inspect a specific methodology's data-driven definition
   */
  public async inspectMethodology(args: { methodology_id?: string }): Promise<ToolResponse> {
    const methodologyId = args.methodology_id?.toLowerCase();
    const runtimeLoader = getDefaultRuntimeLoader();

    if (!methodologyId) {
      // List available methodologies
      const available = runtimeLoader.discoverMethodologies();
      return this.createMinimalSystemResponse(
        `📋 **Available Methodologies**\n\n` +
          `Use \`operation:"inspect" methodology_id:"<id>"\` to inspect a specific methodology.\n\n` +
          `Available: ${available.join(', ')}`,
        'inspect_methodology'
      );
    }

    const definition = runtimeLoader.loadMethodology(methodologyId);

    if (!definition) {
      const available = runtimeLoader.discoverMethodologies();
      return this.createMinimalSystemResponse(
        `❌ **Methodology Not Found**: \`${methodologyId}\`\n\n` +
          `Available methodologies: ${available.join(', ')}`,
        'inspect_methodology'
      );
    }

    // Format methodology details
    let response = `🔍 **Methodology: ${definition.name}**\n\n`;

    response += `**ID**: ${definition.id}\n`;
    response += `**Version**: ${definition.version || '1.0.0'}\n`;
    response += `**Type**: ${definition.type || definition.methodology}\n`;
    response += `**Status**: ${definition.enabled !== false ? '✅ Enabled' : '❌ Disabled'}\n\n`;

    // System prompt guidance
    if (definition.systemPromptGuidance) {
      response += `**System Guidance**:\n${definition.systemPromptGuidance.slice(0, 500)}${
        definition.systemPromptGuidance.length > 500 ? '...' : ''
      }\n\n`;
    }

    // Gates
    if (definition.gates?.include?.length) {
      response += `**Included Gates**: ${definition.gates.include.join(', ')}\n`;
    }
    if (definition.methodologyGates?.length) {
      response += `**Methodology Gates** (${definition.methodologyGates.length}):\n`;
      definition.methodologyGates.slice(0, 3).forEach((gate: any) => {
        response += `  • ${gate.name} (${gate.priority || 'medium'})\n`;
      });
      if (definition.methodologyGates.length > 3) {
        response += `  ... and ${definition.methodologyGates.length - 3} more\n`;
      }
      response += '\n';
    }

    // Methodology elements
    if (definition.methodologyElements?.requiredSections?.length) {
      response += `**Required Sections**: ${definition.methodologyElements.requiredSections.join(
        ', '
      )}\n\n`;
    }

    // Phases info
    if (definition.phases) {
      const processingSteps = definition.phases.processingSteps?.length || 0;
      const executionSteps = definition.phases.executionSteps?.length || 0;
      response += `**Processing Steps**: ${processingSteps}\n`;
      response += `**Execution Steps**: ${executionSteps}\n`;

      // Quality indicators
      if (definition.phases.qualityIndicators) {
        const indicatorCount = Object.keys(definition.phases.qualityIndicators).length;
        response += `**Quality Indicators**: ${indicatorCount} categories\n`;
      }
      response += '\n';
    }

    // Tool descriptions
    if (definition.toolDescriptions) {
      response += `**Tool Description Overrides**: ${Object.keys(definition.toolDescriptions).join(
        ', '
      )}\n\n`;
    }

    response += `💡 Use \`action:"framework" operation:"switch" framework:"${definition.id}"\` to activate this methodology.`;

    return this.createMinimalSystemResponse(response, 'inspect_methodology');
  }

  /**
   * List all available data-driven methodologies
   */
  public async listMethodologiesAction(args: { show_details?: boolean }): Promise<ToolResponse> {
    const runtimeLoader = getDefaultRuntimeLoader();
    const methodologyIds = runtimeLoader.discoverMethodologies();

    if (methodologyIds.length === 0) {
      return this.createMinimalSystemResponse(
        `📋 **No Methodologies Found**\n\n` +
          `Ensure YAML files exist in \`resources/methodologies/<id>/methodology.yaml\`.`,
        'list_methodologies'
      );
    }

    let response = `📋 **Available Methodologies** (${methodologyIds.length})\n\n`;

    for (const id of methodologyIds) {
      const definition = runtimeLoader.loadMethodology(id);
      if (!definition) continue;

      const status = definition.enabled !== false ? '✅' : '⚪';
      response += `${status} **${definition.name}** (\`${definition.id}\`)\n`;

      if (args.show_details) {
        response += `   Type: ${definition.type || definition.methodology}\n`;
        if (definition.methodologyGates?.length) {
          response += `   Gates: ${definition.methodologyGates.length} methodology-specific\n`;
        }
        if (definition.phases?.processingSteps?.length) {
          response += `   Processing Steps: ${definition.phases.processingSteps.length}\n`;
        }
        response += '\n';
      }
    }

    if (!args.show_details) {
      response += `\n💡 Use \`show_details:true\` for more information.`;
    }

    response += `\n🔍 Use \`operation:"inspect" methodology_id:"<id>"\` for full details.`;

    return this.createMinimalSystemResponse(response, 'list_methodologies');
  }

  public async enableFrameworkSystem(args: {
    reason?: string;
    persist?: boolean;
  }): Promise<ToolResponse> {
    if (!this.frameworkStateManager) {
      throw new Error('Framework state manager not initialized');
    }

    const currentState = this.frameworkStateManager.getCurrentState();
    if (currentState.frameworkSystemEnabled) {
      return this.createMinimalSystemResponse(
        `ℹ️ Framework system is already enabled.`,
        'enable_framework_system'
      );
    }

    // Enable framework system (for now, just return success message since the method may not exist)
    try {
      await (this.frameworkStateManager as any).enableFrameworkSystem?.(
        args.reason || 'User requested to enable framework system'
      );
    } catch (error) {
      // Method may not exist, that's ok for now
    }

    const persistenceNotes: string[] = [];
    if (args.persist) {
      const note = await this.persistFrameworkConfig(true);
      if (note) persistenceNotes.push(note);
    }

    const response =
      `✅ **Framework System Enabled**\n\n` +
      `**Reason**: ${args.reason || 'User requested to enable framework system'}\n` +
      `**Status**: Framework system is now active\n` +
      `**Active Framework**: ${currentState.activeFramework}\n\n` +
      `🎯 All prompt executions will now use framework-guided processing.` +
      (persistenceNotes.length ? `\n\n${persistenceNotes.join('\n')}` : '');

    return this.createMinimalSystemResponse(response, 'enable_framework_system');
  }

  public async disableFrameworkSystem(args: {
    reason?: string;
    persist?: boolean;
  }): Promise<ToolResponse> {
    if (!this.frameworkStateManager) {
      throw new Error('Framework state manager not initialized');
    }

    const currentState = this.frameworkStateManager.getCurrentState();
    if (!currentState.frameworkSystemEnabled) {
      return this.createMinimalSystemResponse(
        `ℹ️ Framework system is already disabled.`,
        'disable_framework_system'
      );
    }

    // Disable framework system (for now, just return success message since the method may not exist)
    try {
      await (this.frameworkStateManager as any).disableFrameworkSystem?.(
        args.reason || 'User requested to disable framework system'
      );
    } catch (error) {
      // Method may not exist, that's ok for now
    }

    const persistenceNotes: string[] = [];
    if (args.persist) {
      const note = await this.persistFrameworkConfig(false);
      if (note) persistenceNotes.push(note);
    }

    const response =
      `⚠️ **Framework System Disabled**\n\n` +
      `**Reason**: ${args.reason || 'User requested to disable framework system'}\n` +
      `**Status**: Framework system is now inactive\n` +
      `**Previous Framework**: ${currentState.activeFramework}\n\n` +
      `📝 Prompt executions will now use basic processing without framework guidance.` +
      (persistenceNotes.length ? `\n\n${persistenceNotes.join('\n')}` : '');

    return this.createMinimalSystemResponse(response, 'disable_framework_system');
  }

  /**
   * Enable gate system
   */
  public async enableGateSystem(args: {
    reason?: string;
    persist?: boolean;
  }): Promise<ToolResponse> {
    if (!this.gateSystemManager) {
      throw new Error('Gate system manager not initialized');
    }

    const currentState = this.gateSystemManager.getCurrentState();
    if (currentState.enabled) {
      return this.createMinimalSystemResponse(
        `ℹ️ Gate system is already enabled.`,
        'enable_gate_system'
      );
    }

    await this.gateSystemManager.enableGateSystem(
      args.reason || 'User requested to enable gate system'
    );

    const persistenceNotes: string[] = [];
    if (args.persist) {
      const note = await this.persistGateConfig(true);
      if (note) persistenceNotes.push(note);
    }

    const response =
      `✅ **Gate System Enabled**\n\n` +
      `**Reason**: ${args.reason || 'User requested to enable gate system'}\n` +
      `**Status**: Gate system is now active\n` +
      `**Validation**: Quality gates will now be applied to prompt executions\n\n` +
      `🔍 All template and chain executions will now include gate validation and guidance.` +
      (persistenceNotes.length ? `\n\n${persistenceNotes.join('\n')}` : '');

    return this.createMinimalSystemResponse(response, 'enable_gate_system');
  }

  /**
   * Disable gate system
   */
  public async disableGateSystem(args: {
    reason?: string;
    persist?: boolean;
  }): Promise<ToolResponse> {
    if (!this.gateSystemManager) {
      throw new Error('Gate system manager not initialized');
    }

    const currentState = this.gateSystemManager.getCurrentState();
    if (!currentState.enabled) {
      return this.createMinimalSystemResponse(
        `ℹ️ Gate system is already disabled.`,
        'disable_gate_system'
      );
    }

    await this.gateSystemManager.disableGateSystem(
      args.reason || 'User requested to disable gate system'
    );

    const persistenceNotes: string[] = [];
    if (args.persist) {
      const note = await this.persistGateConfig(false);
      if (note) persistenceNotes.push(note);
    }

    const response =
      `⚠️ **Gate System Disabled**\n\n` +
      `**Reason**: ${args.reason || 'User requested to disable gate system'}\n` +
      `**Status**: Gate system is now inactive\n` +
      `**Impact**: Gate validation and guidance will be skipped\n\n` +
      `📝 Prompt executions will now skip quality gate validation.` +
      (persistenceNotes.length ? `\n\n${persistenceNotes.join('\n')}` : '');

    return this.createMinimalSystemResponse(response, 'disable_gate_system');
  }

  /**
   * Get gate system status
   */
  public async getGateSystemStatus(): Promise<ToolResponse> {
    if (!this.gateSystemManager) {
      return this.createMinimalSystemResponse(
        `❌ Gate system manager not available.`,
        'gate_system_status'
      );
    }

    const currentState = this.gateSystemManager.getCurrentState();
    const health = this.gateSystemManager.getSystemHealth();

    let response = `🚪 **Gate System Status**\n\n`;
    response += `**System State**: ${currentState.enabled ? 'Enabled' : 'Disabled'}\n`;
    response += `**Health Status**: ${health.status}\n`;
    response += `**Total Validations**: ${health.totalValidations}\n`;
    response += `**Success Rate**: ${health.successRate}%\n`;
    response += `**Average Validation Time**: ${health.averageValidationTime}ms\n`;

    if (health.lastValidationTime) {
      response += `**Last Validation**: ${health.lastValidationTime.toISOString()}\n`;
    }

    if (health.issues.length > 0) {
      response += `\n⚠️ **Issues**:\n`;
      health.issues.forEach((issue) => {
        response += `- ${issue}\n`;
      });
    }

    response += `\n🔧 Control gates using: action="gates", operation="enable/disable"`;

    return this.createMinimalSystemResponse(response, 'gate_system_status');
  }

  /**
   * Get gate system health details
   */
  public async getGateSystemHealth(): Promise<ToolResponse> {
    if (!this.gateSystemManager) {
      return this.createMinimalSystemResponse(
        `❌ Gate system manager not available.`,
        'gate_system_health'
      );
    }

    const health = this.gateSystemManager.getSystemHealth();

    let response = `🏥 **Gate System Health Report**\n\n`;

    // Health status indicator
    const statusIcon =
      health.status === 'healthy' ? '✅' : health.status === 'degraded' ? '⚠️' : '❌';
    response += `**Overall Status**: ${statusIcon} ${health.status.toUpperCase()}\n\n`;

    // Core metrics
    response += `**Performance Metrics**:\n`;
    response += `- Enabled: ${health.enabled ? 'Yes' : 'No'}\n`;
    response += `- Total Validations: ${health.totalValidations}\n`;
    response += `- Success Rate: ${health.successRate}%\n`;
    response += `- Average Validation Time: ${health.averageValidationTime}ms\n`;

    if (health.lastValidationTime) {
      response += `- Last Validation: ${health.lastValidationTime.toISOString()}\n`;
    }

    // Health analysis
    if (health.status === 'healthy') {
      response += '\n✅ System is performing optimally. No action required.\n';
    } else if (health.status === 'degraded') {
      response += '\n⚠️ System performance is degraded. Monitor closely.\n';
      if (health.issues.length > 0) {
        response += '\n**Issues Detected**:\n';
        health.issues.forEach((issue) => {
          response += `- ${issue}\n`;
        });
      }
    } else if (health.status === 'disabled') {
      response += '\n🚫 Gate system is currently disabled.\n';
      response += "Enable using: `action='gates', operation='enable'`\n";
    }

    return this.createMinimalSystemResponse(response, 'gate_system_health');
  }

  /**
   * List all available quality gates with optional search filtering
   */
  async listAvailableGates(searchQuery?: string): Promise<ToolResponse> {
    const gateDefinitions = (await this.gateGuidanceRenderer?.getAvailableGateDefinitions()) || [];

    // Filter by search query if provided
    const filteredGates = searchQuery
      ? gateDefinitions.filter(
          (gate) =>
            gate.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
            gate.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (gate.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
        )
      : gateDefinitions;

    if (filteredGates.length === 0) {
      const noResultsMsg = searchQuery
        ? `No gates found matching "${searchQuery}". Try: \`>>gates\` to list all.`
        : 'No quality gates discovered. Ensure gate configuration is available.';

      return this.createMinimalSystemResponse(
        `📋 **Available Quality Gates**\n\n${noResultsMsg}`,
        'gate_list'
      );
    }

    const lines: string[] = ['📋 **Available Quality Gates**', ''];

    if (searchQuery) {
      lines.push(`🔍 Filtered by: "${searchQuery}"`, '');
    }

    // Format each gate with name, ID, and description
    for (const gate of filteredGates) {
      lines.push(`### ${gate.name}`);
      lines.push(`**ID**: \`${gate.id}\``);
      if (gate.description) {
        lines.push(`${gate.description}`);
      }
      lines.push('');
    }

    // Add usage syntax reference
    lines.push('---', '');
    lines.push('**Usage Syntax**:', '');
    lines.push('```');
    lines.push(`:: ${filteredGates[0]?.id || 'gate-id'}              # Use canonical gate`);
    lines.push(`:: security:"validate inputs"   # Named inline gate`);
    lines.push(`:: "custom criteria"            # Anonymous inline gate`);
    lines.push('```');
    lines.push('');
    lines.push(
      `**Total Gates**: ${filteredGates.length}${searchQuery ? ` (filtered from ${gateDefinitions.length})` : ''}`
    );

    return this.createMinimalSystemResponse(lines.join('\n'), 'gate_list');
  }

  /**
   * Reset analytics data
   */
  private resetAnalyticsData(): void {
    this.systemAnalytics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      gateValidationCount: 0,
      uptime: Date.now() - this.startTime,
      performanceTrends: [],
    };
  }

  private formatExecutionTime(time: number): string {
    return `${Math.round(time)}ms`;
  }

  public async resetMetrics(args: { confirm?: boolean }): Promise<ToolResponse> {
    if (!args.confirm) {
      return this.createMinimalSystemResponse(
        "❌ Metrics reset cancelled. Set 'confirm: true' to reset all switching performance metrics.",
        'reset_metrics'
      );
    }

    const beforeMetrics = { ...this.systemAnalytics };

    this.resetAnalyticsData();

    if (this.frameworkStateManager) {
      this.frameworkStateManager.resetMetrics();
    }

    let response = `# 🔄 Metrics Reset Completed\n\n`;
    response += `**Reset Timestamp**: ${new Date().toISOString()}\n\n`;

    response += '## Metrics Before Reset\n\n';
    response += `**Total Executions**: ${beforeMetrics.totalExecutions}\n`;
    response += `**Successful**: ${beforeMetrics.successfulExecutions}\n`;
    response += `**Failed**: ${beforeMetrics.failedExecutions}\n`;
    response += `**Average Time**: ${this.formatExecutionTime(
      beforeMetrics.averageExecutionTime
    )}\n\n`;

    response += '## Metrics After Reset\n\n';
    response += `**Total Executions**: ${this.systemAnalytics.totalExecutions}\n`;
    response += `**Successful**: ${this.systemAnalytics.successfulExecutions}\n`;
    response += `**Failed**: ${this.systemAnalytics.failedExecutions}\n`;
    response += `**Average Time**: ${this.formatExecutionTime(
      this.systemAnalytics.averageExecutionTime
    )}\n\n`;

    response +=
      '✅ All switching performance metrics have been reset. Framework switching monitoring will start fresh.';

    return this.createMinimalSystemResponse(response, 'reset_metrics');
  }

  public async getSwitchHistory(args: { limit?: number }): Promise<ToolResponse> {
    if (!this.frameworkStateManager) {
      throw new Error('Framework state manager not initialized');
    }

    const { limit = 20 } = args;

    const history = this.frameworkStateManager.getSwitchHistory(limit);
    const currentState = this.frameworkStateManager.getCurrentState();

    let response = `# 📈 Framework Switch History\n\n`;
    response += `**Current Framework**: ${currentState.activeFramework}\n`;
    response += `**History Entries**: ${history.length}\n\n`;

    if (history.length === 0) {
      response += 'No framework switches recorded yet.\n\n';
    } else {
      response += '## Recent Switches\n\n';

      history.forEach((entry, index) => {
        response += `### ${index + 1}. ${entry.from} → ${entry.to}\n\n`;
        response += `**Timestamp**: ${entry.timestamp.toISOString()}\n`;
        response += `**Reason**: ${entry.reason}\n\n`;
      });
    }

    response += '---\n\n';
    response += '**Note**: This history helps track framework usage patterns and audit changes.';

    return this.createMinimalSystemResponse(response, 'switch_history');
  }

  private formatUptime(uptime: number): string {
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${Math.round(value * 100) / 100}${units[unitIndex]}`;
  }

  private getSuccessRate(): number {
    const total = this.systemAnalytics.totalExecutions;
    if (total === 0) return 100;
    return Math.round((this.systemAnalytics.successfulExecutions / total) * 100);
  }

  private formatTrendContext(trend: any): string {
    let context = '';
    if (trend.framework) context += ` [${trend.framework}]`;
    if (trend.executionMode) context += ` (${trend.executionMode})`;
    if (trend.success !== undefined) context += trend.success ? ' ✓' : ' ✗';
    return context;
  }

  private formatTrendValue(metric: string, value: number): string {
    switch (metric) {
      case 'executionTime':
        return `${Math.round(value)}ms`;
      case 'memoryDelta':
        return `${value > 0 ? '+' : ''}${this.formatBytes(value)}`;
      case 'successRate':
        return `${Math.round(value * 100)}%`;
      case 'gateValidationTime':
        return `${Math.round(value)}ms validation`;
      default:
        return String(value);
    }
  }

  public async getAnalytics(args: {
    include_history?: boolean;
    reset_analytics?: boolean;
  }): Promise<ToolResponse> {
    const { include_history = false, reset_analytics = false } = args;

    if (reset_analytics) {
      this.resetAnalyticsData();
      return this.createMinimalSystemResponse('📊 Analytics have been reset to zero.', 'analytics');
    }

    const successRate = this.getSuccessRate();
    const avgTime = this.formatExecutionTime(this.systemAnalytics.averageExecutionTime);

    let response = '# 📊 System Analytics Report\n\n';

    // Overall Performance
    response += '## 📈 Overall Performance\n\n';
    response += `**Total Executions**: ${this.systemAnalytics.totalExecutions}\n`;
    response += `**Success Rate**: ${successRate}%\n`;
    response += `**Failed Executions**: ${this.systemAnalytics.failedExecutions}\n`;
    response += `**Average Execution Time**: ${avgTime}\n`;
    response += `**System Uptime**: ${this.formatUptime(this.systemAnalytics.uptime)}\n\n`;

    // Execution Modes
    response += '## 🎯 Execution Mode Distribution\n\n';
    const executionsByMode = this.getExecutionsByMode();
    const totalModeExecutions = Object.values(executionsByMode).reduce((a, b) => a + b, 0);
    Object.entries(executionsByMode).forEach(([mode, count]) => {
      const percentage =
        totalModeExecutions > 0 ? Math.round((count / totalModeExecutions) * 100) : 0;
      response += `- **${
        mode.charAt(0).toUpperCase() + mode.slice(1)
      } Mode**: ${count} executions (${percentage}%)\n`;
    });
    response += '\n';

    // Quality Gates
    response += '## 🛡️ Quality Gate Analytics\n\n';
    response += `**Gate Validations**: ${this.systemAnalytics.gateValidationCount}\n`;
    response += `**Gate Adoption Rate**: ${
      this.systemAnalytics.totalExecutions > 0
        ? Math.round(
            (this.systemAnalytics.gateValidationCount / this.systemAnalytics.totalExecutions) * 100
          )
        : 0
    }%\n`;

    // System Resources
    if (this.systemAnalytics.memoryUsage) {
      response += '## 💾 System Resources\n\n';
      const mem = this.systemAnalytics.memoryUsage;
      response += `**Heap Used**: ${this.formatBytes(mem.heapUsed)}\n`;
      response += `**Heap Total**: ${this.formatBytes(mem.heapTotal)}\n`;
      response += `**RSS**: ${this.formatBytes(mem.rss)}\n`;
      response += `**External**: ${this.formatBytes(mem.external)}\n\n`;
    }

    // Performance Trends
    if (include_history && this.systemAnalytics.performanceTrends.length > 0) {
      response += '## 📈 Performance Trends\n\n';

      // Group trends by metric type for better organization
      const trendsByMetric = this.systemAnalytics.performanceTrends.reduce<
        Record<string, Array<SystemAnalytics['performanceTrends'][number]>>
      >((acc, trend) => {
        const bucket = acc[trend.metric] ?? [];
        bucket.push(trend);
        acc[trend.metric] = bucket;
        return acc;
      }, {});

      Object.entries(trendsByMetric).forEach(([metric, trends]) => {
        const recentTrends = (trends ?? []).slice(-10);
        response += `### ${metric.charAt(0).toUpperCase() + metric.slice(1)} Trends\n`;
        recentTrends.forEach((trend, index) => {
          const isoTime = new Date(trend.timestamp).toISOString();
          const time = isoTime.split('T')[1]?.split('.')[0] ?? isoTime;
          const contextInfo = this.formatTrendContext(trend);
          response += `${index + 1}. ${time}: ${this.formatTrendValue(
            trend.metric,
            trend.value
          )}${contextInfo}\n`;
        });
        response += '\n';
      });
    }

    response += `\n---\n*Generated at: ${new Date().toISOString()}*`;

    return this.createMinimalSystemResponse(response, 'analytics');
  }

  private getHealthIcon(status: string): string {
    switch (status) {
      case 'healthy':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      case 'critical':
        return '🚨';
      default:
        return '❓';
    }
  }

  public async restoreConfig(args: {
    backup_path?: string;
    confirm?: boolean;
  }): Promise<ToolResponse> {
    if (!this.configManager) {
      throw new Error('Configuration manager not initialized');
    }

    if (!args.confirm) {
      return this.createMinimalSystemResponse(
        "❌ Restore cancelled. Set 'confirm: true' to restore configuration.",
        'restore_config'
      );
    }

    try {
      if (!this.safeConfigWriter) {
        throw new Error('SafeConfigWriter not available');
      }
      const result = await this.safeConfigWriter.restoreFromBackup(args.backup_path || '');
      if (result.success) {
        return this.createMinimalSystemResponse(
          '✅ Configuration restored successfully.',
          'restore_config'
        );
      } else {
        throw new Error(result.message || 'Failed to restore configuration.');
      }
    } catch (error) {
      const result = utilsHandleError(error, 'restore_config', this.logger);
      return createStructuredResponse(result.message, result.isError, { action: 'restore_config' });
    }
  }

  public async manageConfig(args: {
    config?: {
      key: string;
      value?: string;
      operation: 'get' | 'set' | 'list' | 'validate';
    };
  }): Promise<ToolResponse> {
    const configRequest = args.config;

    if (!this.configManager) {
      return createStructuredResponse(
        '❌ **Configuration Manager Unavailable**',
        { operation: 'config', error: 'config_manager_unavailable' },
        true
      );
    }

    try {
      if (!configRequest) {
        return await this.handleConfigList();
      }

      switch (configRequest.operation) {
        case 'list':
          return await this.handleConfigList();
        case 'get':
          return await this.handleConfigGet(configRequest.key);
        case 'set':
          return await this.handleConfigSet(configRequest.key, configRequest.value || '');
        case 'validate':
          return await this.handleConfigValidate(configRequest.key, configRequest.value || '');
        default:
          throw new Error(`Unknown config operation: ${configRequest.operation}`);
      }
    } catch (error) {
      const result = utilsHandleError(error, 'config_management', this.logger);
      return createStructuredResponse(result.message, result.isError, { action: 'config' });
    }
  }

  public async restartServer(args: { reason?: string; confirm?: boolean }): Promise<ToolResponse> {
    if (!args.confirm) {
      return this.createMinimalSystemResponse(
        "❌ Restart cancelled. Set 'confirm: true' to perform a full system restart.",
        'restart_server'
      );
    }

    const reason = args.reason || 'User requested restart via system_control';
    this.logger.info(`🔄 System restart requested: ${reason}`);

    if (this.onRestart) {
      setTimeout(() => {
        this.onRestart?.(reason).catch((err) => {
          this.logger.error('Failed to execute restart callback:', err);
        });
      }, 1000);

      return this.createMinimalSystemResponse(
        `🔄 Server restart initiated.\n\n**Reason**: ${reason}\n**Status**: Restarting in 1 second...`,
        'restart_server'
      );
    } else {
      return this.createMinimalSystemResponse(
        '⚠️ Restart callback not configured. Server cannot be restarted automatically.',
        'restart_server'
      );
    }
  }

  private async handleConfigList(): Promise<ToolResponse> {
    const config = this.configManager?.getConfig();
    return this.createMinimalSystemResponse(
      `📋 **Current Configuration**\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\``,
      'config_list'
    );
  }

  private async handleConfigGet(key: string): Promise<ToolResponse> {
    const config = this.configManager?.getConfig();
    const value = config
      ? key
          .split('.')
          .reduce((obj: any, k) => (obj?.[k] !== undefined ? obj[k] : undefined), config)
      : undefined;
    return this.createMinimalSystemResponse(`**${key}**: ${JSON.stringify(value)}`, 'config_get');
  }

  private async handleConfigSet(key: string, value: string): Promise<ToolResponse> {
    if (!this.safeConfigWriter) throw new Error('SafeConfigWriter unavailable');
    const result = await this.safeConfigWriter.updateConfigValue(key, value);
    if (!result.success) {
      throw new Error(result.message || result.error);
    }
    return this.createMinimalSystemResponse(`✅ Set **${key}** to \`${value}\``, 'config_set');
  }

  private async handleConfigValidate(key: string, value: string): Promise<ToolResponse> {
    if (!this.configManager) throw new Error('Config manager unavailable');
    const validation = validateConfigInput(key as any, value);
    return this.createMinimalSystemResponse(
      validation.valid
        ? `✅ Configuration valid for **${key}**`
        : `❌ Invalid configuration for **${key}**: ${validation.error}`,
      'config_validate'
    );
  }
}

/**
 * Base class for action handlers using command pattern
 */
abstract class ActionHandler {
  constructor(protected systemControl: ConsolidatedSystemControl) {}
  abstract execute(args: any): Promise<ToolResponse>;

  // Convenience getters for accessing system control properties
  protected get responseFormatter() {
    return this.systemControl['responseFormatter'];
  }
  protected get logger() {
    return this.systemControl['logger'];
  }
  protected get startTime() {
    return this.systemControl.startTime;
  }
  protected get frameworkManager() {
    return this.systemControl['frameworkManager'];
  }
  protected get mcpToolsManager() {
    return this.systemControl['mcpToolsManager'];
  }
  protected get configManager() {
    return this.systemControl['configManager'];
  }
  protected get safeConfigWriter() {
    return this.systemControl['safeConfigWriter'];
  }
  protected get onRestart() {
    return this.systemControl['onRestart'];
  }

  // Helper methods for system status and formatting
  protected createMinimalSystemResponse(text: string, action: string): ToolResponse {
    return this.systemControl.createMinimalSystemResponse(text, action);
  }

  protected getExecutionsByMode(): Record<string, number> {
    // Extract execution mode data from performance trends
    const modeData: Record<string, number> = {};
    this.systemControl.systemAnalytics.performanceTrends.forEach((trend) => {
      if (trend.executionMode) {
        modeData[trend.executionMode] = (modeData[trend.executionMode] || 0) + 1;
      }
    });
    return modeData;
  }

  protected formatUptime(uptime: number): string {
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  protected formatExecutionTime(time: number): string {
    return `${Math.round(time)}ms`;
  }

  protected formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${Math.round(value * 100) / 100}${units[unitIndex]}`;
  }

  protected getHealthIcon(status: string): string {
    switch (status) {
      case 'healthy':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      case 'critical':
        return '🚨';
      default:
        return '❓';
    }
  }

  protected getSuccessRate(): number {
    const total = this.systemControl.systemAnalytics.totalExecutions;
    if (total === 0) return 100;
    return Math.round((this.systemControl.systemAnalytics.successfulExecutions / total) * 100);
  }

  protected formatTrendContext(trend: any): string {
    let context = '';
    if (trend.framework) context += ` [${trend.framework}]`;
    if (trend.executionMode) context += ` (${trend.executionMode})`;
    if (trend.success !== undefined) context += trend.success ? ' ✓' : ' ✗';
    return context;
  }

  protected formatTrendValue(metric: string, value: number): string {
    switch (metric) {
      case 'executionTime':
        return `${Math.round(value)}ms`;
      case 'memoryDelta':
        return `${value > 0 ? '+' : ''}${this.formatBytes(value)}`;
      case 'successRate':
        return `${Math.round(value * 100)}%`;
      case 'gateValidationTime':
        return `${Math.round(value)}ms validation`;
      default:
        return String(value);
    }
  }
}

/**
 * Handler for status-related operations
 */
class StatusActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'default';

    switch (operation) {
      case 'health':
        return await this.getSystemHealthStatus();
      case 'diagnostics':
        return await this.getSystemDiagnostics();
      case 'framework_status':
        return await this.getFrameworkStatus();
      case 'overview':
      case 'default':
      default:
        return await this.systemControl.getSystemStatus({
          include_history: args.include_history,
          include_metrics: args.include_metrics,
        });
    }
  }

  private async getSystemHealthStatus(): Promise<ToolResponse> {
    if (!this.systemControl.frameworkStateManager) {
      throw new Error('Framework state manager not initialized');
    }

    const health = this.systemControl.frameworkStateManager.getSystemHealth();
    const statusIcon = health.status === 'healthy' ? '✅' : '⚠️';

    let response = `${statusIcon} **System Health Status**: ${health.status}\n\n`;
    response += `📊 **Metrics**:\n`;

    // Improved framework status display
    const isFrameworkEnabled = health.frameworkSystemEnabled;
    const injectionStatus = isFrameworkEnabled ? 'Working' : 'Inactive';
    const frameworkStatusText = isFrameworkEnabled
      ? `✅ Enabled - ${health.activeFramework} methodology active`
      : `🚫 Disabled - ${health.activeFramework} selected but not injecting`;

    response += `- Framework System: ${frameworkStatusText}\n`;
    response += `- Framework Injection: ${injectionStatus}\n`;
    response += `- Available Frameworks: ${health.availableFrameworks.join(', ')}\n`;
    response += `- Total Framework Switches: ${health.switchingMetrics.totalSwitches}\n`;

    return this.createMinimalSystemResponse(response, 'health');
  }

  private async getSystemDiagnostics(): Promise<ToolResponse> {
    let response = `🔧 **System Diagnostics**\n\n`;

    try {
      if (this.systemControl.frameworkStateManager) {
        const health = this.systemControl.frameworkStateManager.getSystemHealth();
        response += `Framework State: ${health.status}\n`;
        response += `Active Framework: ${health.activeFramework}\n`;
      }

      response += `Server Uptime: ${Date.now() - this.systemControl.startTime}ms\n`;
    } catch (error) {
      response += `❌ Error during diagnostics: ${error}\n`;
    }

    return this.createMinimalSystemResponse(response, 'diagnostics');
  }

  private async getFrameworkStatus(): Promise<ToolResponse> {
    if (!this.systemControl.frameworkStateManager) {
      throw new Error('Framework state manager not initialized');
    }

    const health = this.systemControl.frameworkStateManager.getSystemHealth();

    let response = `🎯 **Framework System Status**\n\n`;

    // Enhanced status display
    const isFrameworkEnabled = health.frameworkSystemEnabled;
    const injectionStatusIcon = isFrameworkEnabled ? '✅' : '🚫';
    const injectionStatusText = isFrameworkEnabled
      ? 'Active - Framework guidance being applied'
      : 'Inactive - Framework guidance disabled';

    response += `**Selected Framework**: ${health.activeFramework}\n`;
    response += `**Injection Status**: ${injectionStatusIcon} ${injectionStatusText}\n`;
    response += `**System State**: ${health.frameworkSystemEnabled ? 'Enabled' : 'Disabled'}\n`;
    response += `**Health Status**: ${health.status}\n`;
    response += `**Available Frameworks**: ${health.availableFrameworks.join(', ')}\n`;

    // Add warning for confused state
    if (!isFrameworkEnabled && health.activeFramework) {
      response += `\n⚠️ **Warning**: Framework system is disabled while ${health.activeFramework} is selected.\n`;
      response += `This means prompts will NOT receive framework methodology guidance.\n`;
      response += `To enable framework injection, use: \`system_control framework enable\`\n`;
    }

    return this.createMinimalSystemResponse(response, 'framework_status');
  }
}

/**
 * Handler for framework-related operations
 */
class FrameworkActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'default';

    switch (operation) {
      case 'switch':
        return await this.systemControl.switchFramework({
          framework: args.framework,
          reason: args.reason,
        });
      case 'list':
        return await this.systemControl.listFrameworks({
          show_details: args.show_details,
        });
      case 'enable':
        return await this.systemControl.enableFrameworkSystem({
          reason: args.reason,
        });
      case 'disable':
        return await this.systemControl.disableFrameworkSystem({
          reason: args.reason,
        });
      case 'inspect':
        return await this.systemControl.inspectMethodology({
          methodology_id: args.methodology_id || args.framework,
        });
      case 'list_methodologies':
        return await this.systemControl.listMethodologiesAction({
          show_details: args.show_details,
        });
      default:
        throw new Error(
          `Unknown framework operation: ${operation}. Valid operations: switch, list, enable, disable, inspect, list_methodologies`
        );
    }
  }
}

/**
 * Handler for gates-related operations
 */
class GateActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'status';

    switch (operation) {
      case 'enable':
        return await this.systemControl.enableGateSystem({
          reason: args.reason,
          persist: args.persist,
        });
      case 'disable':
        return await this.systemControl.disableGateSystem({
          reason: args.reason,
          persist: args.persist,
        });
      case 'status':
        return await this.systemControl.getGateSystemStatus();
      case 'health':
        return await this.systemControl.getGateSystemHealth();
      case 'list':
        return await this.systemControl.listAvailableGates(args.search_query);
      default:
        throw new Error(
          `Unknown gates operation: ${operation}. Valid operations: enable, disable, status, health, list`
        );
    }
  }
}

/**
 * Handler for guide/discovery operations
 */
class GuideActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const topic = typeof args.topic === 'string' ? args.topic.trim().toLowerCase() : '';
    const includePlanned = args.include_planned !== false;
    const operations = systemControlMetadata.data.operations.filter(
      (operation) => includePlanned || operation.status !== 'planned'
    );

    const filtered =
      topic.length > 0
        ? operations.filter(
            (operation) =>
              operation.category.toLowerCase().includes(topic) ||
              operation.id.toLowerCase().includes(topic) ||
              operation.description.toLowerCase().includes(topic)
          )
        : operations;

    const lines: string[] = [];
    lines.push('🧭 **System Control Guide**');
    if (topic) {
      lines.push(`Focus: \`${topic}\``);
    } else {
      lines.push('Use `system_control action:"guide" topic:"framework"` for focused help.');
    }

    if (filtered.length === 0) {
      lines.push(
        includePlanned
          ? 'No operations matched the requested topic.'
          : 'No stable operations matched the requested topic. Set `include_planned:true` to view planned commands.'
      );
    } else {
      filtered.forEach((operation) => {
        let entry = `- \`${operation.id}\` (${this.describeStatus(operation.status)}) — ${
          operation.description
        }`;
        if (operation.issues && operation.issues.length > 0) {
          entry += `\n  Issues: ${operation.issues
            .map((issue) => `${issue.severity === 'high' ? '❗' : '⚠️'} ${issue.summary}`)
            .join(' • ')}`;
        }
        lines.push(entry);
      });
    }

    if (!includePlanned) {
      lines.push('Include planned operations with `include_planned:true`.');
    }

    return this.createMinimalSystemResponse(lines.join('\n\n'), 'guide');
  }

  private describeStatus(status: string): string {
    switch (status) {
      case 'working':
        return '✅ Working';
      case 'planned':
        return '🗺️ Planned';
      case 'untested':
        return '🧪 Untested';
      case 'deprecated':
        return '🛑 Deprecated';
      default:
        return `⚠️ ${status}`;
    }
  }
}

/**
 * Handler for analytics-related operations
 */
class AnalyticsActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'default';

    switch (operation) {
      case 'reset':
        return await this.systemControl.resetMetrics({
          confirm: args.confirm,
        });
      case 'history':
        return await this.systemControl.getSwitchHistory({
          limit: args.limit,
        });
      case 'view':
      case 'default':
      default:
        return await this.systemControl.getAnalytics({
          include_history: args.include_history,
          reset_analytics: args.reset_analytics,
        });
    }
  }
}

/**
 * Handler for config-related operations
 */
class ConfigActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'default';

    switch (operation) {
      case 'restore':
        return await this.systemControl.restoreConfig({
          backup_path: args.backup_path,
          confirm: args.confirm,
        });
      case 'get':
      case 'set':
      case 'list':
      case 'validate':
      case 'default':
      default:
        return await this.systemControl.manageConfig({
          config: args.config,
        });
    }
  }
}

/**
 * Handler for maintenance-related operations
 */
class MaintenanceActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'default';

    // TODO: Add cleanup operation to prune logs, remove not-found prompt artifacts, and resync state with the current stack once supporting hooks exist.
    // TODO: Add diagnostics operation that searches logs for specific error topics/ids and surfaces results to LLM clients for in-tool debugging after log plumbing is in place.
    switch (operation) {
      case 'restart':
      case 'default':
      default:
        return await this.systemControl.restartServer({
          reason: args.reason,
          confirm: args.confirm,
        });
    }
  }

  /**
   * Get comprehensive system status
   */
  public async getSystemStatus(args: {
    include_history?: boolean;
    include_metrics?: boolean;
  }): Promise<ToolResponse> {
    const { include_history = false, include_metrics = true } = args;

    if (!this.systemControl.frameworkStateManager) {
      throw new Error('Framework state manager not initialized');
    }

    const currentState = this.systemControl.frameworkStateManager.getCurrentState();
    const systemHealth = this.systemControl.frameworkStateManager.getSystemHealth();
    const activeFramework = this.systemControl.frameworkStateManager.getActiveFramework();

    let response = '# ⚙️ System Status Report\n\n';

    // Framework Status
    response += '## 📋 Framework Status\n\n';
    response += `**Active Framework**: ${activeFramework.name} (${activeFramework.id})\n`;
    response += `**Description**: ${activeFramework.description}\n`;
    response += `**System Health**: ${this.getHealthIcon(
      systemHealth.status
    )} ${systemHealth.status.toUpperCase()}\n`;
    response += `**Last Switch**: ${currentState.switchedAt.toISOString()}\n`;
    response += `**Switch Reason**: ${currentState.switchReason}\n\n`;

    // Gate System Status
    if (this.systemControl.gateSystemManager) {
      const gateHealth = this.systemControl.gateSystemManager.getSystemHealth();
      response += '## 🚪 Gate System Status\n\n';
      response += `**System State**: ${gateHealth.enabled ? 'Enabled' : 'Disabled'}\n`;
      response += `**Health Status**: ${this.getHealthIcon(
        gateHealth.status
      )} ${gateHealth.status.toUpperCase()}\n`;
      response += `**Total Validations**: ${gateHealth.totalValidations}\n`;
      response += `**Success Rate**: ${gateHealth.successRate}%\n`;
      if (gateHealth.lastValidationTime) {
        response += `**Last Validation**: ${gateHealth.lastValidationTime.toISOString()}\n`;
      }
      response += `\n`;
    } else {
      response += '## 🚪 Gate System Status\n\n';
      response += `**System State**: Not Available\n`;
      response += `**Note**: Gate system manager not initialized\n\n`;
    }

    // System Metrics
    response += '## 📊 System Metrics\n\n';
    response += `**Uptime**: ${this.formatUptime(this.systemControl.systemAnalytics.uptime)}\n`;
    response += `**Total Executions**: ${this.systemControl.systemAnalytics.totalExecutions}\n`;
    response += `**Success Rate**: ${this.getSuccessRate()}%\n`;
    response += `**Average Execution Time**: ${this.formatExecutionTime(
      this.systemControl.systemAnalytics.averageExecutionTime
    )}\n`;

    if (this.systemControl.systemAnalytics.memoryUsage) {
      const mem = this.systemControl.systemAnalytics.memoryUsage;
      response += `**Memory Usage**: ${this.formatBytes(mem.heapUsed)}/${this.formatBytes(
        mem.heapTotal
      )}\n`;
    }

    response += `\n`;

    // Available Frameworks
    const availableFrameworks = this.systemControl.frameworkStateManager.getAvailableFrameworks();
    response += '## 🔄 Available Frameworks\n\n';
    availableFrameworks.forEach((framework) => {
      const isActive = framework.id === currentState.activeFramework;
      const icon = isActive ? '🟢' : '⚪';
      response += `${icon} **${framework.name}** - ${framework.description}\n`;
    });
    response += '\n';

    // Performance Metrics
    if (include_metrics) {
      response += '## 🎯 Performance Breakdown\n\n';
      const switchingMetrics = systemHealth.switchingMetrics;
      response += `**Framework Switches**: ${switchingMetrics.totalSwitches}\n`;
      response += `**Framework Switch Success Rate**: ${
        switchingMetrics.totalSwitches > 0
          ? Math.round((switchingMetrics.successfulSwitches / switchingMetrics.totalSwitches) * 100)
          : 100
      }%\n`;
      response += `**Framework Switch Time**: ${Math.round(
        switchingMetrics.averageResponseTime
      )}ms\n`;

      response += `\n**Execution Modes**:\n`;
      const executionsByMode = this.getExecutionsByMode();
      Object.entries(executionsByMode).forEach(([mode, count]) => {
        response += `- ${mode.charAt(0).toUpperCase() + mode.slice(1)}: ${count} executions\n`;
      });
      response += `\n`;
    }

    // System Health Issues
    if (systemHealth.issues.length > 0) {
      response += '## ⚠️ System Issues\n\n';
      systemHealth.issues.forEach((issue) => {
        response += `- ⚠️ ${issue}\n`;
      });
      response += '\n';
    }

    // Recent Activity
    if (include_history && this.systemControl.systemAnalytics.performanceTrends.length > 0) {
      response += '## 📈 Recent Performance Trends\n\n';
      const recentTrends = (this.systemControl.systemAnalytics.performanceTrends ?? []).slice(-10);
      recentTrends.forEach((trend, index) => {
        const isoTime = new Date(trend.timestamp).toISOString();
        const timestamp = isoTime.split('T')[1]?.split('.')[0] ?? isoTime;
        const contextInfo = this.formatTrendContext(trend);
        response += `${index + 1}. ${timestamp}: ${this.formatTrendValue(
          trend.metric,
          trend.value
        )}${contextInfo}\n`;
      });
      response += '\n';
    }

    // Control Commands
    response += '## 🎛️ Available Commands\n\n';
    response += '- `switch_framework` - Change active framework methodology\n';
    response += '- `gates` - Control gate system (enable, disable, status, health)\n';
    response += '- `analytics` - View detailed execution analytics\n';
    response += '- `health` - Check system health status\n';
    response += '- `diagnostics` - Run comprehensive system diagnostics\n';
    response += '- `config` - Manage system configuration (get, set, list, validate)\n';
    response += '- `config_restore` - Restore configuration from backup\n';
    response += '- `reset_metrics` - Reset framework switching counters\n';
    response += '- `switch_history` - View framework change history\n';
    response += '- `restart` - Full server restart (requires confirmation)\n';

    const now = Date.now();
    const formatterContext: FormatterExecutionContext = {
      executionId: `system-control-status-${now}`,
      executionType: 'single',
      startTime: now,
      endTime: now,
      frameworkEnabled: currentState.frameworkSystemEnabled,
      frameworkUsed: activeFramework.name,
      success: true,
    };

    return this.responseFormatter.formatPromptEngineResponse(response, formatterContext, {
      includeMetadata: true,
      metadata: {
        frameworkEnabled: currentState.frameworkSystemEnabled,
        activeFramework: activeFramework.name,
        availableFrameworks: this.frameworkManager?.listFrameworks().map((f: any) => f.name) || [],
        uptime: (now - this.startTime) / 1000,
        memoryUsage: process.memoryUsage ? process.memoryUsage() : undefined,
        serverHealth: systemHealth.status as 'healthy' | 'warning' | 'error' | 'critical',
        lastFrameworkSwitch: currentState.switchedAt.toISOString(),
      },
    });
  }

  /**
   * Switch framework - delegates to FrameworkManager (single authority)
   */
  public async switchFramework(args: {
    framework?: string;
    reason?: string;
  }): Promise<ToolResponse> {
    if (!this.frameworkManager) {
      throw new Error('Framework manager not initialized');
    }

    if (!args.framework) {
      throw new Error('Framework parameter is required for switch operation');
    }

    // Delegate to FrameworkManager - single authority for framework switching
    const result = await this.frameworkManager.switchFramework(
      args.framework,
      args.reason || `User requested switch to ${args.framework}`
    );

    if (!result.success) {
      throw new Error(result.error || 'Framework switch failed');
    }

    // Build success response using result.framework
    const framework = result.framework!;
    let response = `🔄 **Framework Switch Successful**\n\n`;
    response += `**Current**: ${framework.name} (${framework.id})\n`;
    response += `**Description**: ${framework.description}\n`;
    response += `**Type**: ${framework.type}\n\n`;
    response += `**Guidelines**: ${framework.executionGuidelines.join(' • ')}\n\n`;
    response += `✅ All future prompt executions will now use the ${framework.id} methodology.`;

    // Trigger dynamic tool description updates
    if (this.mcpToolsManager?.reregisterToolsWithUpdatedDescriptions) {
      try {
        await this.mcpToolsManager.reregisterToolsWithUpdatedDescriptions();
        response += `\n\n🔄 **Tool descriptions updated** - MCP clients will receive updated tool descriptions with ${framework.id} methodology guidance.`;
      } catch (error) {
        this.logger.error(
          `Failed to update tool descriptions after framework switch: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        response += `\n\n⚠️ **Note**: Tool descriptions may need manual refresh for some clients.`;
      }
    }

    return this.createMinimalSystemResponse(response, 'switch_framework');
  }

  /**
   * List available frameworks
   */
  public async listFrameworks(args: { show_details?: boolean }): Promise<ToolResponse> {
    if (!this.systemControl.frameworkStateManager) {
      throw new Error('Framework state manager not initialized');
    }

    const { show_details = true } = args;

    const currentState = this.systemControl.frameworkStateManager.getCurrentState();
    const availableFrameworks = this.systemControl.frameworkStateManager.getAvailableFrameworks();

    let response = '# 📋 Available Framework Methodologies\n\n';
    response += `**Currently Active**: ${currentState.activeFramework}\n\n`;

    availableFrameworks.forEach((framework) => {
      const isActive = framework.id === currentState.activeFramework;
      const icon = isActive ? '🟢' : '⚪';
      const status = isActive ? ' (ACTIVE)' : '';

      response += `## ${icon} ${framework.name}${status}\n\n`;
      response += `**ID**: ${framework.id}\n`;
      response += `**Type**: ${framework.type}\n`;
      response += `**Description**: ${framework.description}\n`;
      response += `**Priority**: ${framework.priority}\n`;
      response += `**Enabled**: ${framework.enabled ? '✅ Yes' : '❌ No'}\n`;
      response += `**Applicable Types**: ${framework.applicableTypes.join(', ') || 'All'}\n`;

      if (show_details && framework.executionGuidelines) {
        response += `\n**Execution Guidelines**:\n`;
        framework.executionGuidelines.forEach((guideline, index) => {
          response += `${index + 1}. ${guideline}\n`;
        });
      }

      response += '\n';
    });

    response += '---\n\n';
    response +=
      '**Usage**: Use `switch_framework` action to change the active framework methodology.\n';
    response +=
      '**Note**: The framework methodology determines how prompts are processed systematically.';

    return this.createMinimalSystemResponse(response, 'list_frameworks');
  }

  /**
   * Get execution analytics
   */
  public async getAnalytics(args: {
    include_history?: boolean;
    reset_analytics?: boolean;
  }): Promise<ToolResponse> {
    const { include_history = false, reset_analytics = false } = args;

    if (reset_analytics) {
      this.resetAnalyticsData();
      return this.createMinimalSystemResponse('📊 Analytics have been reset to zero.', 'analytics');
    }

    const successRate = this.getSuccessRate();
    const avgTime = this.formatExecutionTime(
      this.systemControl.systemAnalytics.averageExecutionTime
    );

    let response = '# 📊 System Analytics Report\n\n';

    // Overall Performance
    response += '## 📈 Overall Performance\n\n';
    response += `**Total Executions**: ${this.systemControl.systemAnalytics.totalExecutions}\n`;
    response += `**Success Rate**: ${successRate}%\n`;
    response += `**Failed Executions**: ${this.systemControl.systemAnalytics.failedExecutions}\n`;
    response += `**Average Execution Time**: ${avgTime}\n`;
    response += `**System Uptime**: ${this.formatUptime(
      this.systemControl.systemAnalytics.uptime
    )}\n\n`;

    // Execution Modes
    response += '## 🎯 Execution Mode Distribution\n\n';
    const executionsByMode = this.getExecutionsByMode();
    const totalModeExecutions = Object.values(executionsByMode).reduce((a, b) => a + b, 0);
    Object.entries(executionsByMode).forEach(([mode, count]) => {
      const percentage =
        totalModeExecutions > 0 ? Math.round((count / totalModeExecutions) * 100) : 0;
      response += `- **${
        mode.charAt(0).toUpperCase() + mode.slice(1)
      } Mode**: ${count} executions (${percentage}%)\n`;
    });
    response += '\n';

    // Quality Gates (Enhanced with advanced analytics)
    response += '## 🛡️ Quality Gate Analytics\n\n';
    response += `**Gate Validations**: ${this.systemControl.systemAnalytics.gateValidationCount}\n`;
    response += `**Gate Adoption Rate**: ${
      this.systemControl.systemAnalytics.totalExecutions > 0
        ? Math.round(
            (this.systemControl.systemAnalytics.gateValidationCount /
              this.systemControl.systemAnalytics.totalExecutions) *
              100
          )
        : 0
    }%\n`;

    // System Resources
    if (this.systemControl.systemAnalytics.memoryUsage) {
      response += '## 💾 System Resources\n\n';
      const mem = this.systemControl.systemAnalytics.memoryUsage;
      response += `**Heap Used**: ${this.formatBytes(mem.heapUsed)}\n`;
      response += `**Heap Total**: ${this.formatBytes(mem.heapTotal)}\n`;
      response += `**RSS**: ${this.formatBytes(mem.rss)}\n`;
      response += `**External**: ${this.formatBytes(mem.external)}\n\n`;
    }

    // Performance Trends
    if (include_history && this.systemControl.systemAnalytics.performanceTrends.length > 0) {
      response += '## 📈 Performance Trends\n\n';

      // Group trends by metric type for better organization
      const trendsByMetric = this.systemControl.systemAnalytics.performanceTrends.reduce<
        Record<string, Array<SystemAnalytics['performanceTrends'][number]>>
      >((acc, trend) => {
        const bucket = acc[trend.metric] ?? [];
        bucket.push(trend);
        acc[trend.metric] = bucket;
        return acc;
      }, {});

      Object.entries(trendsByMetric).forEach(([metric, trends]) => {
        const recentTrends = (trends ?? []).slice(-10);
        response += `### ${metric.charAt(0).toUpperCase() + metric.slice(1)} Trends\n`;
        recentTrends.forEach((trend, index) => {
          const isoTime = new Date(trend.timestamp).toISOString();
          const time = isoTime.split('T')[1]?.split('.')[0] ?? isoTime;
          const contextInfo = this.formatTrendContext(trend);
          response += `${index + 1}. ${time}: ${this.formatTrendValue(
            trend.metric,
            trend.value
          )}${contextInfo}\n`;
        });
        response += '\n';
      });
    }

    response += `\n---\n*Generated at: ${new Date().toISOString()}*`;

    return this.createMinimalSystemResponse(response, 'analytics');
  }

  /**
   * Get system health
   */
  public async getSystemHealth(args: any): Promise<ToolResponse> {
    if (!this.systemControl.frameworkStateManager) {
      throw new Error('Framework state manager not initialized');
    }

    const health = this.systemControl.frameworkStateManager.getSystemHealth();
    const statusIcon = this.getHealthIcon(health.status);

    let response = `# 🏥 System Health Report\n\n`;
    response += `**Overall Status**: ${statusIcon} ${health.status.toUpperCase()}\n`;
    response += `**Active Framework**: ${health.activeFramework}\n`;
    response += `**Available Frameworks**: ${health.availableFrameworks.length}\n`;
    response += `**System Uptime**: ${this.formatUptime(
      this.systemControl.systemAnalytics.uptime
    )}\n\n`;

    // Performance Health
    response += '## 📊 Performance Health\n\n';
    response += `**Framework Switches**: ${health.switchingMetrics.totalSwitches}\n`;
    response += `**Framework Switch Success Rate**: ${
      health.switchingMetrics.totalSwitches > 0
        ? Math.round(
            (health.switchingMetrics.successfulSwitches / health.switchingMetrics.totalSwitches) *
              100
          )
        : 100
    }%\n`;
    response += `**Framework Switch Time**: ${Math.round(
      health.switchingMetrics.averageResponseTime
    )}ms\n`;
    response += `**Execution Success Rate**: ${this.getSuccessRate()}%\n\n`;

    // Issues
    if (health.issues.length > 0) {
      response += '## ⚠️ Detected Issues\n\n';
      health.issues.forEach((issue, index) => {
        response += `${index + 1}. ⚠️ ${issue}\n`;
      });
      response += '\n';
    } else {
      response += '## ✅ System Status\n\nNo issues detected. System is operating normally.\n\n';
    }

    // Health Recommendations
    response += '## 💡 Health Recommendations\n\n';

    if (health.status === 'healthy') {
      response += '✅ System is healthy. No action required.\n';
      response += '- Continue monitoring performance metrics\n';
      response += '- Regular analytics reviews recommended\n';
    } else if (health.status === 'degraded') {
      response += '⚠️ System performance is degraded. Monitor closely.\n';
      response += '- Review recent framework switches for patterns\n';
      response += '- Consider resetting metrics if issues are resolved\n';
      response += '- Check execution failure rates\n';
    } else {
      response += '❌ System requires immediate attention.\n';
      response += '- Check framework configuration\n';
      response += '- Review system logs for error patterns\n';
      response += '- Consider system restart if issues persist\n';
    }

    return this.createMinimalSystemResponse(response, 'health');
  }

  /**
   * Run comprehensive diagnostics
   */
  public async runDiagnostics(args: any): Promise<ToolResponse> {
    let response = '# 🔧 System Diagnostics Report\n\n';

    // Framework System Check
    response += '## 🔄 Framework System\n\n';
    if (this.systemControl.frameworkStateManager) {
      const state = this.systemControl.frameworkStateManager.getCurrentState();
      const health = this.systemControl.frameworkStateManager.getSystemHealth();
      const frameworks = this.systemControl.frameworkStateManager.getAvailableFrameworks();

      response += `✅ **Framework Manager**: Operational\n`;
      response += `✅ **Active Framework**: ${state.activeFramework}\n`;
      response += `✅ **Available Frameworks**: ${frameworks.length} configured\n`;
      response += `${this.getHealthIcon(health.status)} **System Health**: ${health.status}\n\n`;

      // Check each framework
      frameworks.forEach((fw) => {
        const icon = fw.enabled ? '✅' : '⚠️';
        response += `${icon} **${fw.name}**: ${fw.enabled ? 'Enabled' : 'Disabled'}\n`;
      });
      response += '\n';
    } else {
      response += `❌ **Framework Manager**: Not initialized\n\n`;
    }

    // Performance Diagnostics
    response += '## 📊 Performance Diagnostics\n\n';
    response += `**Total Executions**: ${this.systemControl.systemAnalytics.totalExecutions}\n`;
    response += `**Success Rate**: ${this.getSuccessRate()}%\n`;
    response += `**Average Execution Time**: ${this.formatExecutionTime(
      this.systemControl.systemAnalytics.averageExecutionTime
    )}\n`;

    // Performance Assessment
    const successRate = this.getSuccessRate();
    if (successRate >= 95) {
      response += `✅ **Performance Assessment**: Excellent (${successRate}%)\n`;
    } else if (successRate >= 85) {
      response += `⚠️ **Performance Assessment**: Good (${successRate}%)\n`;
    } else {
      response += `❌ **Performance Assessment**: Needs attention (${successRate}%)\n`;
    }
    response += '\n';

    // System Resources
    response += '## 💾 System Resources\n\n';
    if (this.systemControl.systemAnalytics.memoryUsage) {
      const mem = this.systemControl.systemAnalytics.memoryUsage;
      const heapUsagePercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);

      response += `**Memory Usage**: ${this.formatBytes(mem.heapUsed)}/${this.formatBytes(
        mem.heapTotal
      )} (${heapUsagePercent}%)\n`;

      if (heapUsagePercent < 70) {
        response += `✅ **Memory Status**: Healthy\n`;
      } else if (heapUsagePercent < 90) {
        response += `⚠️ **Memory Status**: Monitor usage\n`;
      } else {
        response += `❌ **Memory Status**: High usage - consider optimization\n`;
      }
    }

    response += `**System Uptime**: ${this.formatUptime(
      this.systemControl.systemAnalytics.uptime
    )}\n\n`;

    // Recommendations
    response += '## 💡 Diagnostic Recommendations\n\n';

    const recommendations: string[] = [];

    if (this.getSuccessRate() < 90) {
      recommendations.push('Investigate execution failure patterns to improve success rate');
    }

    if (this.systemControl.systemAnalytics.averageExecutionTime > 5000) {
      recommendations.push('Consider optimizing execution performance - average time is high');
    }

    if (
      this.systemControl.systemAnalytics.memoryUsage &&
      this.systemControl.systemAnalytics.memoryUsage.heapUsed /
        this.systemControl.systemAnalytics.memoryUsage.heapTotal >
        0.8
    ) {
      recommendations.push('Monitor memory usage - heap utilization is high');
    }

    if (recommendations.length > 0) {
      recommendations.forEach((rec, index) => {
        response += `${index + 1}. ${rec}\n`;
      });
    } else {
      response += '✅ No issues detected. System is operating optimally.\n';
    }

    response += `\n---\n*Diagnostics completed at: ${new Date().toISOString()}*`;

    return this.createMinimalSystemResponse(response, 'diagnostics');
  }

  /**
   * Reset framework switching metrics
   */
  public async resetMetrics(args: { confirm?: boolean }): Promise<ToolResponse> {
    if (!args.confirm) {
      return this.createMinimalSystemResponse(
        "❌ Metrics reset cancelled. Set 'confirm: true' to reset all switching performance metrics.",
        'reset_metrics'
      );
    }

    const beforeMetrics = { ...this.systemControl.systemAnalytics };

    this.resetAnalyticsData();

    if (this.systemControl.frameworkStateManager) {
      this.systemControl.frameworkStateManager.resetMetrics();
    }

    let response = `# 🔄 Metrics Reset Completed\n\n`;
    response += `**Reset Timestamp**: ${new Date().toISOString()}\n\n`;

    response += '## Metrics Before Reset\n\n';
    response += `**Total Executions**: ${beforeMetrics.totalExecutions}\n`;
    response += `**Successful**: ${beforeMetrics.successfulExecutions}\n`;
    response += `**Failed**: ${beforeMetrics.failedExecutions}\n`;
    response += `**Average Time**: ${this.formatExecutionTime(
      beforeMetrics.averageExecutionTime
    )}\n\n`;

    response += '## Metrics After Reset\n\n';
    response += `**Total Executions**: ${this.systemControl.systemAnalytics.totalExecutions}\n`;
    response += `**Successful**: ${this.systemControl.systemAnalytics.successfulExecutions}\n`;
    response += `**Failed**: ${this.systemControl.systemAnalytics.failedExecutions}\n`;
    response += `**Average Time**: ${this.formatExecutionTime(
      this.systemControl.systemAnalytics.averageExecutionTime
    )}\n\n`;

    response +=
      '✅ All switching performance metrics have been reset. Framework switching monitoring will start fresh.';

    return this.createMinimalSystemResponse(response, 'reset_metrics');
  }

  /**
   * Get framework switch history
   */
  public async getSwitchHistory(args: { limit?: number }): Promise<ToolResponse> {
    if (!this.systemControl.frameworkStateManager) {
      throw new Error('Framework state manager not initialized');
    }

    const { limit = 20 } = args;

    const history = this.systemControl.frameworkStateManager.getSwitchHistory(limit);
    const currentState = this.systemControl.frameworkStateManager.getCurrentState();

    let response = `# 📈 Framework Switch History\n\n`;
    response += `**Current Framework**: ${currentState.activeFramework}\n`;
    response += `**History Entries**: ${history.length}\n\n`;

    if (history.length === 0) {
      response += 'No framework switches recorded yet.\n\n';
    } else {
      response += '## Recent Switches\n\n';

      history.forEach((entry, index) => {
        response += `### ${index + 1}. ${entry.from} → ${entry.to}\n\n`;
        response += `**Timestamp**: ${entry.timestamp.toISOString()}\n`;
        response += `**Reason**: ${entry.reason}\n\n`;
      });
    }

    response += '---\n\n';
    response += '**Note**: This history helps track framework usage patterns and audit changes.';

    return this.createMinimalSystemResponse(response, 'switch_history');
  }

  /**
   * Manage system configuration
   */
  public async manageConfig(args: {
    config?: {
      key: string;
      value?: string;
      operation: 'get' | 'set' | 'list' | 'validate';
    };
  }): Promise<ToolResponse> {
    const configRequest = args.config;

    // Check if ConfigManager is available
    if (!this.configManager) {
      return createStructuredResponse(
        '❌ **Configuration Manager Unavailable**\n\n' +
          'ConfigManager is not initialized. This indicates a system initialization issue.\n' +
          'Configuration management requires proper system startup.',
        { operation: 'config', error: 'config_manager_unavailable' },
        true
      );
    }

    try {
      // Handle different config operations
      if (!configRequest) {
        return await this.handleConfigList();
      }

      switch (configRequest.operation) {
        case 'list':
          return await this.handleConfigList();
        case 'get':
          return await this.handleConfigGet(configRequest.key);
        case 'set':
          return await this.handleConfigSet(configRequest.key, configRequest.value || '');
        case 'validate':
          return await this.handleConfigValidate(configRequest.key, configRequest.value || '');
        default:
          throw new Error(`Unknown config operation: ${configRequest.operation}`);
      }
    } catch (error) {
      return this.handleError(error, 'config_management');
    }
  }

  /**
   * Handle config list operation
   */
  private async handleConfigList(): Promise<ToolResponse> {
    const config = this.configManager!.getConfig();

    let response = '# ⚙️ System Configuration Overview\n\n';

    // Server Configuration
    response += '## 🖥️ Server Configuration\n\n';
    response += `**Name**: ${config.server.name}\n`;
    response += `**Version**: ${config.server.version}\n`;
    response += `**Port**: ${config.server.port}\n\n`;

    // Transport Configuration
    response += '## 🚀 Transport Configuration\n\n';
    const transportMode = config.transport ?? 'stdio';
    response += `**Transport Mode**: ${transportMode}\n`;
    if (transportMode === 'both') {
      response += '  - STDIO: ✅ Active (Claude Desktop/CLI)\n';
      response += '  - SSE: ✅ Active (Web clients on port ' + config.server.port + ')\n';
    } else if (transportMode === 'stdio') {
      response += '  - STDIO: ✅ Active\n';
      response += '  - SSE: ❌ Disabled\n';
    } else {
      response += '  - STDIO: ❌ Disabled\n';
      response += '  - SSE: ✅ Active\n';
    }
    response += '\n';

    // Analysis Configuration
    if (config.analysis) {
      response += '## 🔍 Analysis Configuration\n\n';
      response += `**LLM Integration**: ${
        config.analysis.semanticAnalysis.llmIntegration.enabled ? '✅' : '❌'
      }\n`;
      if (config.analysis.semanticAnalysis.llmIntegration.enabled) {
        response += `**Model**: ${config.analysis.semanticAnalysis.llmIntegration.model}\n`;
        response += `**Max Tokens**: ${config.analysis.semanticAnalysis.llmIntegration.maxTokens}\n`;
        response += `**Temperature**: ${config.analysis.semanticAnalysis.llmIntegration.temperature}\n`;
      }
      response += '\n';
    }

    // Logging Configuration
    if (config.logging) {
      response += '## 📝 Logging Configuration\n\n';
      response += `**Directory**: ${config.logging.directory}\n`;
      response += `**Level**: ${config.logging.level}\n\n`;
    }

    // Runtime Status
    response += '## 📊 Runtime Status\n\n';
    response += `**Framework System**: ${
      this.systemControl.frameworkStateManager ? '✅ Enabled' : '❌ Disabled'
    }\n`;
    response += `**Analytics Collection**: ✅ Enabled\n`;
    response += `**Performance Monitoring**: ✅ Enabled\n`;
    response += `**System Uptime**: ${this.formatUptime(
      this.systemControl.systemAnalytics.uptime
    )}\n`;
    response += `**Start Time**: ${new Date(this.startTime).toISOString()}\n\n`;

    // Available Operations
    response += '## 🔧 Available Configuration Keys\n\n';
    response += '**Server Configuration:**\n';
    response += '- `server.name` (string) - Server display name\n';
    response += '- `server.version` (string) - Server version\n';
    response += '- `server.port` (number) - HTTP server port ⚠️ *restart required*\n\n';
    response += '**Transport Configuration:**\n';
    response +=
      "- `transport` (string) - Transport mode: 'stdio', 'sse', or 'both' ⚠️ *restart required*\n\n";
    response += '**Logging Configuration:**\n';
    response += '- `logging.level` (string) - Log level: debug, info, warn, error\n';
    response += '- `logging.directory` (string) - Log file directory\n\n';
    response += '**Usage Examples:**\n';
    response += '- Get value: `{ "config": { "key": "server.port", "operation": "get" } }`\n';
    response +=
      '- Set value: `{ "config": { "key": "logging.level", "value": "debug", "operation": "set" } }`\n';
    response +=
      '- Validate: `{ "config": { "key": "server.port", "value": "3000", "operation": "validate" } }`';

    return this.createMinimalSystemResponse(response, 'config');
  }

  /**
   * Handle config get operation
   */
  private async handleConfigGet(key: string): Promise<ToolResponse> {
    if (!key) {
      throw new Error('Configuration key is required for get operation');
    }

    const value = this.getConfigValue(key);
    if (value === undefined) {
      return createStructuredResponse(
        `❌ **Configuration Key Not Found**\n\n` +
          `The key \`${key}\` does not exist in the configuration.\n\n` +
          `Use the \`list\` operation to see available configuration keys.`,
        { operation: 'config_get', key, error: 'key_not_found' },
        true
      );
    }

    let response = `# 🔍 Configuration Value\n\n`;
    response += `**Key**: \`${key}\`\n`;
    response += `**Current Value**: \`${JSON.stringify(value)}\`\n`;
    response += `**Type**: ${typeof value}\n\n`;

    if (this.requiresRestart(key)) {
      response += `⚠️ **Restart Required**: Changes to this setting require a server restart to take effect.\n\n`;
    } else {
      response += `✅ **Runtime Changeable**: This setting can be changed without restart.\n\n`;
    }

    response += `**Usage**: To modify this value, use:\n`;
    response += `\`{ "config": { "key": "${key}", "value": "new_value", "operation": "set" } }\``;

    return this.createMinimalSystemResponse(response, 'config');
  }

  /**
   * Handle config set operation
   */
  private async handleConfigSet(key: string, value: string): Promise<ToolResponse> {
    if (!key || value === undefined) {
      throw new Error('Both key and value are required for set operation');
    }

    // Check if SafeConfigWriter is available
    if (!this.safeConfigWriter) {
      return createStructuredResponse(
        `⚠️ **Configuration Writing Unavailable**\n\n` +
          `Configuration writing is not available (SafeConfigWriter not initialized).\n` +
          `This may indicate a file system permission issue or invalid configuration path.\n\n` +
          `**Key**: \`${key}\`\n` +
          `**Value**: \`${value}\`\n\n` +
          `**Fallback**: Use the \`validate\` operation to check if your change would be valid.`,
        {
          operation: 'config_set',
          key,
          value,
          error: 'config_writer_unavailable',
        },
        true
      );
    }

    // First validate the new value
    const validation = this.validateConfigValue(key, value);
    if (!validation.valid) {
      return {
        content: [
          {
            type: 'text',
            text:
              `❌ **Invalid Configuration Value**\n\n` +
              `**Key**: \`${key}\`\n` +
              `**Value**: \`${value}\`\n` +
              `**Error**: ${validation.error}\n\n` +
              `${validation.suggestion ? `**Suggestion**: ${validation.suggestion}` : ''}`,
          },
        ],
        isError: true,
      };
    }

    try {
      // Perform the actual configuration update
      const currentValue = this.getConfigValue(key);
      const writeResult = await this.safeConfigWriter.updateConfigValue(key, value);

      if (!writeResult.success) {
        return {
          content: [
            {
              type: 'text',
              text:
                `❌ **Configuration Update Failed**\n\n` +
                `**Key**: \`${key}\`\n` +
                `**Value**: \`${value}\`\n` +
                `**Error**: ${writeResult.error || writeResult.message}\n\n` +
                `${writeResult.backupPath ? `**Backup**: ${writeResult.backupPath}\n` : ''}` +
                `**Current Value**: \`${JSON.stringify(currentValue)}\` (unchanged)\n\n` +
                `**Note**: Configuration file has been left unchanged. No restart required.`,
            },
          ],
          isError: true,
        };
      }

      // Success! Configuration has been updated
      let response = `✅ **Configuration Updated Successfully**\n\n`;
      response += `**Key**: \`${key}\`\n`;
      response += `**Previous Value**: \`${JSON.stringify(currentValue)}\`\n`;
      response += `**New Value**: \`${value}\`\n`;
      response += `**Backup Created**: \`${writeResult.backupPath}\`\n\n`;

      if (writeResult.restartRequired) {
        response += `⚠️ **Server Restart Required**\n\n`;
        response += `This configuration change requires a server restart to take effect.\n`;
        response += `Use the \`restart\` action with \`confirm: true\` to restart the server.\n\n`;
        response += `**Alternative**: The configuration file has been updated and will take effect on next startup.`;
      } else {
        response += `✅ **Change Applied Immediately**\n\n`;
        response += `This configuration change has been applied and is now active.\n`;
        response += `No server restart is required.`;
      }

      response += `\n\n**Recovery**: If needed, you can restore the previous configuration using:\n`;
      response += `\`{ "action": "config_restore", "backup_path": "${writeResult.backupPath}" }\``;

      return this.createMinimalSystemResponse(response, 'config');
    } catch (error) {
      this.logger.error(`Unexpected error during config set for ${key}:`, error);
      return {
        content: [
          {
            type: 'text',
            text:
              `❌ **Unexpected Configuration Error**\n\n` +
              `**Key**: \`${key}\`\n` +
              `**Value**: \`${value}\`\n` +
              `**Error**: ${String(error)}\n\n` +
              `**Status**: Configuration unchanged. System remains stable.\n` +
              `**Action**: Check system logs for detailed error information.`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle config validate operation
   */
  private async handleConfigValidate(key: string, value: string): Promise<ToolResponse> {
    if (!key || value === undefined) {
      throw new Error('Both key and value are required for validate operation');
    }

    const validation = this.validateConfigValue(key, value);
    const currentValue = this.getConfigValue(key);

    let response = `# 🔍 Configuration Validation\n\n`;
    response += `**Key**: \`${key}\`\n`;
    response += `**Proposed Value**: \`${value}\`\n`;
    response += `**Current Value**: \`${JSON.stringify(currentValue)}\`\n`;
    response += `**Valid**: ${validation.valid ? '✅ Yes' : '❌ No'}\n\n`;

    if (!validation.valid) {
      response += `**Error**: ${validation.error}\n`;
      if (validation.suggestion) {
        response += `**Suggestion**: ${validation.suggestion}\n`;
      }
    } else {
      response += `**Type**: ${validation.type}\n`;
      response += `**Restart Required**: ${this.requiresRestart(key) ? '⚠️ Yes' : '✅ No'}\n`;
    }

    return this.createMinimalSystemResponse(response, 'config');
  }

  /**
   * Get configuration value using dot notation
   */
  private getConfigValue(key: string): any {
    const config = this.configManager!.getConfig();
    const parts = key.split('.');
    let value: any = config;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Validate configuration value
   */
  private validateConfigValue(
    key: string,
    value: string
  ): { valid: boolean; error?: string; suggestion?: string; type?: string } {
    if (!this.isValidConfigKey(key)) {
      return {
        valid: false,
        error: `Unknown configuration key: ${key}`,
        suggestion: "Use the 'list' operation to see available keys",
      };
    }

    const validation = validateConfigInput(key, value);
    const suggestion = this.getValidationSuggestion(key);

    if (!validation.valid) {
      return {
        valid: false,
        error: validation.error ?? 'Invalid configuration value',
        ...(suggestion ? { suggestion } : {}),
      };
    }

    const inferredType =
      validation.valueType ??
      (typeof validation.convertedValue !== 'undefined'
        ? typeof validation.convertedValue
        : 'unknown');

    return {
      valid: true,
      type: inferredType,
    };
  }

  /**
   * Check if config key is valid
   */
  private isValidConfigKey(key: string): boolean {
    return CONFIG_VALID_KEYS.includes(key as ConfigKey);
  }

  /**
   * Check if config key requires restart
   */
  private requiresRestart(key: string): boolean {
    return CONFIG_RESTART_REQUIRED_KEYS.includes(key as ConfigKey);
  }

  private getValidationSuggestion(key: string): string | undefined {
    const suggestions: Record<string, string> = {
      'server.port': 'Try a value like 3000 or 8080',
      'server.name': 'Provide a non-empty string value',
      'server.version': 'Provide a non-empty string value',
      transport: "Use 'stdio' (default), 'sse' for web clients, or 'both' for dual mode",
      'logging.level': "Use 'debug' for development or 'info' for production",
      'logging.directory': "Provide a valid directory path like './logs'",
      'analysis.semanticAnalysis.llmIntegration.enabled': 'Use boolean values: true or false',
      'analysis.semanticAnalysis.llmIntegration.model': 'Provide a non-empty model identifier',
      'analysis.semanticAnalysis.llmIntegration.maxTokens': 'Use a number between 1 and 4000',
      'analysis.semanticAnalysis.llmIntegration.temperature': 'Provide a number between 0 and 2',
    };

    return suggestions[key];
  }

  /**
   * Restore configuration from backup
   */
  public async restoreConfig(args: {
    backup_path?: string;
    confirm?: boolean;
  }): Promise<ToolResponse> {
    if (!args.backup_path) {
      return {
        content: [
          {
            type: 'text',
            text:
              `❌ **Backup Path Required**\n\n` +
              `The \`backup_path\` parameter is required for config restore operations.\n\n` +
              `**Usage**: \`{ "action": "config_restore", "backup_path": "/path/to/backup", "confirm": true }\`\n\n` +
              `**Note**: Backup files are typically named like \`config.json.backup.1640995200000\``,
          },
        ],
        isError: true,
      };
    }

    if (!args.confirm) {
      return {
        content: [
          {
            type: 'text',
            text:
              `⚠️ **Configuration Restore Confirmation Required**\n\n` +
              `**Backup Path**: \`${args.backup_path}\`\n` +
              `**Impact**: This will overwrite the current configuration file\n` +
              `**Data Loss Risk**: Current configuration will be lost unless backed up\n\n` +
              `**To proceed**: Set \`confirm: true\` to execute the restore.\n\n` +
              `**Alternative**: Use \`config\` operations to make individual changes instead of full restore.`,
          },
        ],
      };
    }

    // Check if SafeConfigWriter is available
    if (!this.safeConfigWriter) {
      return {
        content: [
          {
            type: 'text',
            text:
              `❌ **Configuration Restore Unavailable**\n\n` +
              `Configuration restoration is not available (SafeConfigWriter not initialized).\n` +
              `This may indicate a file system permission issue or invalid configuration path.\n\n` +
              `**Backup Path**: \`${args.backup_path}\`\n\n` +
              `**Manual Restore**: You may need to manually copy the backup file to replace the current config.`,
          },
        ],
        isError: true,
      };
    }

    try {
      // Create a backup of the current config before restoring
      const fs = await import('fs');
      const currentConfigPath = this.safeConfigWriter.getConfigPath();
      const emergencyBackupPath = `${currentConfigPath}.emergency.backup.${Date.now()}`;

      if (fs.existsSync(currentConfigPath)) {
        await fs.promises.copyFile(currentConfigPath, emergencyBackupPath);
        this.logger.info(`Emergency backup created before restore: ${emergencyBackupPath}`);
      }

      // Perform the restoration
      const restoreResult = await this.safeConfigWriter.restoreFromBackup(args.backup_path);

      if (!restoreResult.success) {
        return {
          content: [
            {
              type: 'text',
              text:
                `❌ **Configuration Restore Failed**\n\n` +
                `**Backup Path**: \`${args.backup_path}\`\n` +
                `**Error**: ${restoreResult.error || restoreResult.message}\n\n` +
                `**Status**: Original configuration unchanged\n` +
                `${
                  fs.existsSync(emergencyBackupPath)
                    ? `**Emergency Backup**: ${emergencyBackupPath}\n`
                    : ''
                }` +
                `**Action**: Verify the backup file exists and is readable.`,
            },
          ],
          isError: true,
        };
      }

      // Success! Configuration has been restored
      let response = `✅ **Configuration Restored Successfully**\n\n`;
      response += `**Restored From**: \`${args.backup_path}\`\n`;
      response += `**Emergency Backup**: \`${emergencyBackupPath}\`\n`;
      response += `**Timestamp**: ${new Date().toISOString()}\n\n`;

      response += `⚠️ **Server Restart Recommended**\n\n`;
      response += `Configuration has been restored from backup. A server restart is recommended `;
      response += `to ensure all systems are using the restored configuration.\n\n`;

      response += `**To restart**: Use \`{ "action": "restart", "confirm": true }\`\n\n`;

      response += `**Recovery Options**:\n`;
      response += `- **Undo**: \`{ "action": "config_restore", "backup_path": "${emergencyBackupPath}", "confirm": true }\`\n`;
      response += `- **Check config**: \`{ "action": "config", "config": { "operation": "list" } }\``;

      return this.createMinimalSystemResponse(response, 'config_restore');
    } catch (error) {
      this.logger.error(`Unexpected error during config restore from ${args.backup_path}:`, error);
      return {
        content: [
          {
            type: 'text',
            text:
              `❌ **Unexpected Restore Error**\n\n` +
              `**Backup Path**: \`${args.backup_path}\`\n` +
              `**Error**: ${String(error)}\n\n` +
              `**Status**: Configuration unchanged. System remains stable.\n` +
              `**Action**: Check file permissions and backup file validity.`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Restart server with confirmation and reason
   */
  public async restartServer(args: { reason?: string; confirm?: boolean }): Promise<ToolResponse> {
    const { reason = 'Manual restart requested via system_control', confirm = false } = args;

    if (!this.onRestart) {
      return {
        content: [
          {
            type: 'text',
            text: "❌ **Restart Unavailable**: Server restart functionality not configured. This may indicate the server is running in a mode that doesn't support programmatic restart.",
          },
        ],
        isError: true,
      };
    }

    if (!confirm) {
      return {
        content: [
          {
            type: 'text',
            text:
              `⚠️ **Server Restart Confirmation Required**\n\n` +
              `**Reason**: ${reason}\n` +
              `**Impact**: All active connections will be terminated\n` +
              `**Downtime**: Server will restart (typically 5-10 seconds)\n\n` +
              `**To proceed**: Set 'confirm: true' to execute the restart.\n\n` +
              `🔄 **Alternative**: Use hot-reload via resource_manager(resource_type:"prompt", action:"reload") for most changes.`,
          },
        ],
      };
    }

    let response = `🚨 **Server Restart Initiated**\n\n`;
    response += `**Reason**: ${reason}\n`;
    response += `**Timestamp**: ${new Date().toISOString()}\n\n`;
    response += `📊 **Pre-Restart System Status**:\n`;
    response += `- **Uptime**: ${this.formatUptime(this.systemControl.systemAnalytics.uptime)}\n`;
    response += `- **Total Executions**: ${this.systemControl.systemAnalytics.totalExecutions}\n`;
    response += `- **Success Rate**: ${this.getSuccessRate()}%\n`;

    if (this.systemControl.frameworkStateManager) {
      const currentState = this.systemControl.frameworkStateManager.getCurrentState();
      response += `- **Active Framework**: ${currentState.activeFramework}\n`;
    }

    response += `\n⚡ **Server will restart in 2 seconds**... Please wait for reconnection.\n\n`;
    response += `✅ All system state and configurations will be preserved.`;

    // Schedule restart after response is sent
    setTimeout(() => {
      this.logger.info(`System restart initiated via system_control. Reason: ${reason}`);
      this.onRestart!(reason);
    }, 2000);

    return this.createMinimalSystemResponse(response, 'restart');
  }

  // Helper methods

  private resetAnalyticsData(): void {
    this.systemControl.systemAnalytics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      gateValidationCount: 0,
      uptime: Date.now() - this.startTime,
      performanceTrends: [],
    };
  }

  /**
   * Enable framework system
   */
  public async enableFrameworkSystem(args: { reason?: string }): Promise<ToolResponse> {
    try {
      if (!this.systemControl.frameworkStateManager) {
        return createStructuredResponse(
          '❌ Framework State Manager not available',
          {
            operation: 'enable_framework',
            error: 'framework_manager_unavailable',
          },
          true
        );
      }

      const reason = args.reason || 'Manual enable via MCP tool';
      this.systemControl.frameworkStateManager.enableFrameworkSystem(reason);

      const status = this.systemControl.frameworkStateManager.isFrameworkSystemEnabled();

      let response = '✅ **Framework System Enabled**\n\n';
      response += `**Status**: ${status ? 'Enabled' : 'Disabled'}\n`;
      response += `**Reason**: ${reason}\n`;
      response += `**Active Framework**: ${
        this.systemControl.frameworkStateManager.getActiveFramework().name
      }\n`;
      response += `**Timestamp**: ${new Date().toISOString()}\n\n`;
      response += 'Framework injection will now be active for template and chain executions.\n\n';
      response +=
        '🔄 **Note**: Tool descriptions now reflect framework-enabled capabilities. Tool descriptions will show framework-enhanced functionality on next client connection/restart.';

      return this.createMinimalSystemResponse(response, 'enable_framework');
    } catch (error) {
      return this.handleError(error, 'enable_framework_system');
    }
  }

  /**
   * Disable framework system
   */
  public async disableFrameworkSystem(args: { reason?: string }): Promise<ToolResponse> {
    try {
      if (!this.systemControl.frameworkStateManager) {
        return createStructuredResponse(
          '❌ Framework State Manager not available',
          {
            operation: 'disable_framework',
            error: 'framework_manager_unavailable',
          },
          true
        );
      }

      const reason = args.reason || 'Manual disable via MCP tool';
      this.systemControl.frameworkStateManager.disableFrameworkSystem(reason);

      const status = this.systemControl.frameworkStateManager.isFrameworkSystemEnabled();

      let response = '🚫 **Framework System Disabled**\n\n';
      response += `**Status**: ${status ? 'Enabled' : 'Disabled'}\n`;
      response += `**Reason**: ${reason}\n`;
      response += `**Timestamp**: ${new Date().toISOString()}\n\n`;
      response +=
        'Framework injection is now bypassed. All executions will use standard prompts without methodology enhancements.\n\n';
      response +=
        '🔄 **Note**: Tool descriptions now reflect framework-disabled state. Tool descriptions will show basic functionality (no framework enhancement) on next client connection/restart.';

      return this.createMinimalSystemResponse(response, 'disable_framework');
    } catch (error) {
      return this.handleError(error, 'disable_framework_system');
    }
  }

  /**
   * Get framework system status
   */
  public async getFrameworkSystemStatus(args: any): Promise<ToolResponse> {
    try {
      if (!this.systemControl.frameworkStateManager) {
        return createStructuredResponse(
          '❌ Framework State Manager not available',
          {
            operation: 'framework_status',
            error: 'framework_manager_unavailable',
          },
          true
        );
      }

      const state = this.systemControl.frameworkStateManager.getCurrentState();
      const health = this.systemControl.frameworkStateManager.getSystemHealth();

      let response = '📊 **Framework System Status**\n\n';

      // Main status with enhanced clarity
      const isEnabled = state.frameworkSystemEnabled;
      const injectionStatus = isEnabled ? '✅ Active' : '🚫 Inactive';

      response += `**System Status**: ${
        state.frameworkSystemEnabled ? '✅ Enabled' : '🚫 Disabled'
      }\n`;
      response += `**Selected Framework**: ${state.activeFramework}\n`;
      response += `**Framework Injection**: ${injectionStatus}\n`;
      response += `**Health Status**: ${this.getHealthEmoji(
        health.status
      )} ${health.status.toUpperCase()}\n`;
      response += `**Last Updated**: ${state.switchedAt.toISOString()}\n`;
      response += `**Last Reason**: ${state.switchReason}\n\n`;

      // Available frameworks
      response += `**Available Frameworks**: ${health.availableFrameworks.join(', ')}\n\n`;

      // Framework capabilities
      if (state.frameworkSystemEnabled) {
        response += '**Current Capabilities**:\n';
        response += '• Framework-aware prompt injection\n';
        response += '• Methodology-specific system prompts\n';
        response += '• Quality gate validation\n';
        response += '• Enhanced execution context\n\n';
      } else {
        response += '**Current Mode**: Standard execution (no framework enhancements)\n\n';
      }

      // Switching metrics
      response += '**Switching Metrics**:\n';
      response += `• Total Operations: ${state.switchingMetrics.switchCount}\n`;
      response += `• Error Count: ${state.switchingMetrics.errorCount}\n`;
      response += `• Avg Response Time: ${state.switchingMetrics.averageResponseTime.toFixed(
        1
      )}ms\n`;

      // Health issues
      if (health.issues.length > 0) {
        response += '\n**Issues**:\n';
        health.issues.forEach((issue) => {
          response += `• ⚠️ ${issue}\n`;
        });
      }

      return this.createMinimalSystemResponse(response, 'framework_status');
    } catch (error) {
      return this.handleError(error, 'framework_system_status');
    }
  }

  /**
   * Get health status emoji
   */
  private getHealthEmoji(status: string): string {
    switch (status) {
      case 'healthy':
        return '✅';
      case 'degraded':
        return '⚠️';
      case 'error':
        return '❌';
      default:
        return '❓';
    }
  }

  /**
   * Error handling helper
   */
  public handleError(error: unknown, context: string): ToolResponse {
    utilsHandleError(error, context, this.logger);

    const now = Date.now();
    const formatterContext: FormatterExecutionContext = {
      executionId: `system-control-error-${now}`,
      executionType: 'single',
      startTime: now,
      endTime: now,
      frameworkEnabled: false,
      success: false,
    };

    return this.responseFormatter.formatErrorResponse(
      error instanceof Error ? error : String(error),
      formatterContext,
      {
        metadata: {
          tool: 'system_control',
          operation: context,
        },
      }
    );
  }
}

/**
 * Handler for injection control operations.
 * Manages runtime injection overrides via the modular injection system.
 */
class InjectionActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'status';

    switch (operation) {
      case 'status':
        return this.getInjectionStatus();
      case 'override':
        return this.setInjectionOverride(args);
      case 'reset':
        return this.resetInjectionOverrides();
      default:
        return this.createMinimalSystemResponse(
          `❌ Unknown injection operation: ${operation}\n\n` +
            'Valid operations:\n' +
            '- `status` - Show injection configuration and active overrides\n' +
            '- `override` - Set a session override for an injection type\n' +
            '- `reset` - Clear all session overrides',
          'injection_error'
        );
    }
  }

  /**
   * Show current injection configuration and session overrides.
   */
  private getInjectionStatus(): ToolResponse {
    const lines: string[] = [];
    lines.push('💉 **Injection Control Status**\n');

    // Show available injection types
    lines.push('**Available Injection Types:**');
    for (const type of INJECTION_TYPES) {
      const description = INJECTION_TYPE_DESCRIPTIONS[type] || 'No description';
      lines.push(`- \`${type}\`: ${description}`);
    }
    lines.push('');

    // Show session overrides if manager is initialized
    if (isSessionOverrideManagerInitialized()) {
      const manager = getSessionOverrideManager();
      const status = manager.getStatusSummary();

      lines.push('**Session Overrides:**');
      if (status.activeOverrides === 0) {
        lines.push('_No active session overrides._');
      } else {
        for (const override of status.overrides) {
          const enabledStr =
            override.enabled === true
              ? '✅ Enabled'
              : override.enabled === false
                ? '🚫 Disabled'
                : '❓ Undefined';
          const expiresStr = override.expiresAt
            ? ` (expires: ${new Date(override.expiresAt).toISOString()})`
            : '';
          lines.push(
            `- \`${override.type}\`: ${enabledStr} [scope: ${override.scope}]${expiresStr}`
          );
        }
      }
      lines.push('');
      lines.push(`**Override History Count:** ${status.historyCount}`);
      lines.push('_Applied automatically by InjectionControlStage on every execution._');
    } else {
      lines.push('**Session Overrides:** _Manager not initialized._');
    }

    lines.push('');
    lines.push('**Decision Source Priority:**');
    for (const [source, description] of Object.entries(DECISION_SOURCE_DESCRIPTIONS)) {
      lines.push(`- \`${source}\`: ${description}`);
    }

    lines.push('');
    lines.push('**Usage:**');
    lines.push(
      '- Set override: `system_control action:"injection" operation:"override" type:"system-prompt" enabled:false`'
    );
    lines.push('- Clear overrides: `system_control action:"injection" operation:"reset"`');

    return this.createMinimalSystemResponse(lines.join('\n'), 'injection_status');
  }

  /**
   * Set a session override for an injection type.
   */
  private setInjectionOverride(args: any): ToolResponse {
    const type = args.type as InjectionType | undefined;
    const enabled = args.enabled as boolean | undefined;
    const scope = (args.scope as 'session' | 'chain' | 'step') || 'session';
    const scopeId = args.scope_id as string | undefined;
    const expiresInMs = args.expires_in_ms as number | undefined;

    // Validate type
    if (!type || !INJECTION_TYPES.includes(type)) {
      return this.createMinimalSystemResponse(
        `❌ Invalid injection type: \`${type}\`\n\n` +
          `Valid types: ${INJECTION_TYPES.map((t) => `\`${t}\``).join(', ')}`,
        'injection_override_error'
      );
    }

    // Validate enabled is provided
    if (enabled === undefined) {
      return this.createMinimalSystemResponse(
        '❌ Missing `enabled` parameter.\n\n' +
          'Specify `enabled:true` to enable injection or `enabled:false` to disable.',
        'injection_override_error'
      );
    }

    // Initialize manager if needed
    if (!isSessionOverrideManagerInitialized()) {
      initSessionOverrideManager(this.logger);
    }

    const manager = getSessionOverrideManager();
    const override = manager.setOverride(type, enabled, scope, scopeId, expiresInMs);

    const lines: string[] = [];
    lines.push('✅ **Injection Override Set**\n');
    lines.push(`**Type:** \`${type}\``);
    lines.push(`**Enabled:** ${enabled ? '✅ Yes' : '🚫 No'}`);
    lines.push(`**Scope:** ${scope}`);
    if (scopeId) {
      lines.push(`**Scope ID:** ${scopeId}`);
    }
    if (override.expiresAt) {
      lines.push(`**Expires:** ${new Date(override.expiresAt).toISOString()}`);
    }
    lines.push('');
    lines.push('_This override will affect injection decisions until cleared or expired._');

    return this.createMinimalSystemResponse(lines.join('\n'), 'injection_override');
  }

  /**
   * Clear all session overrides.
   */
  private resetInjectionOverrides(): ToolResponse {
    if (!isSessionOverrideManagerInitialized()) {
      return this.createMinimalSystemResponse(
        '✅ **No Active Overrides**\n\nSession override manager was not initialized. Nothing to reset.',
        'injection_reset'
      );
    }

    const manager = getSessionOverrideManager();
    const count = manager.clearAllOverrides();

    return this.createMinimalSystemResponse(
      `✅ **Injection Overrides Cleared**\n\n` +
        `Cleared ${count} override${count === 1 ? '' : 's'}.\n\n` +
        '_Injection decisions will now use default configuration._',
      'injection_reset'
    );
  }
}

/**
 * Handler for session-related operations
 */
class SessionActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'list';
    const manager = this.systemControl.chainSessionManager;

    if (!manager) {
      throw new Error('Chain session manager not initialized');
    }

    switch (operation) {
      case 'list':
        return await this.listSessions(args);
      case 'clear':
        return await this.clearSession(args);
      case 'inspect':
        return await this.inspectSession(args);
      default:
        throw new Error(
          `Unknown session operation: ${operation}. Valid operations: list, clear, inspect`
        );
    }
  }

  private async listSessions(args: any): Promise<ToolResponse> {
    const manager = this.systemControl.chainSessionManager!;
    const sessions = manager.listActiveSessions();

    if (sessions.length === 0) {
      return this.createMinimalSystemResponse(
        '📭 **No Active Sessions**\n\nThere are currently no active chain sessions.',
        'session_list'
      );
    }

    let response = `📋 **Active Sessions** (${sessions.length})\n\n`;

    sessions.forEach((session) => {
      const startTime = new Date(session.startTime).toLocaleString();
      const lastActivity = new Date(session.lastActivity).toLocaleString();
      const promptInfo = session.promptId ? ` (\`${session.promptId}\`)` : '';

      response += `### Session: \`${session.sessionId}\`\n`;
      response += `**Chain**: \`${session.chainId}\`${promptInfo}\n`;
      response += `**Progress**: Step ${session.currentStep}/${session.totalSteps}\n`;
      response += `**Status**: ${session.pendingReview ? '⚠️ Awaiting Review' : '🟢 Active'}\n`;

      if (args.show_details) {
        response += `**Started**: ${startTime}\n`;
        response += `**Last Activity**: ${lastActivity}\n`;
      }
      response += '\n';
    });

    if (!args.show_details) {
      response += `💡 Use 'show_details: true' for more information about each session.\n`;
    }

    response += `\n🔧 Clear sessions using: action="session", operation="clear", session_id="<id>"`;

    return this.createMinimalSystemResponse(response, 'session_list');
  }

  private async clearSession(args: any): Promise<ToolResponse> {
    const manager = this.systemControl.chainSessionManager!;
    const sessionId = args.session_id;

    if (!sessionId) {
      throw new Error('session_id parameter is required for clear operation');
    }

    // Try clearing as a session ID first, then as a chain ID
    const wasSessionCleared = await manager.clearSession(sessionId);
    if (wasSessionCleared) {
      return this.createMinimalSystemResponse(
        `✅ **Session Cleared**: \`${sessionId}\`\n\nAll state and artifacts for this session have been removed.`,
        'session_clear'
      );
    }

    // Try clearing all sessions for this chain
    await manager.clearSessionsForChain(sessionId);
    return this.createMinimalSystemResponse(
      `✅ **Chain Sessions Cleared**: \`${sessionId}\`\n\nAll sessions and history associated with chain ID \`${sessionId}\` have been removed.`,
      'session_clear'
    );
  }

  private async inspectSession(args: any): Promise<ToolResponse> {
    const manager = this.systemControl.chainSessionManager!;
    const sessionId = args.session_id;

    if (!sessionId) {
      throw new Error('session_id parameter is required for inspect operation');
    }

    const session = manager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const context = manager.getChainContext(sessionId);

    let response = `🔍 **Session Inspection: \`${sessionId}\`**\n\n`;
    response += `**Chain ID**: \`${session.chainId}\`\n`;
    response += `**Prompt**: \`${session.blueprint?.parsedCommand?.promptId || 'unknown'}\`\n`;
    response += `**Step**: ${session.state.currentStep} / ${session.state.totalSteps}\n`;
    response += `**Started**: ${new Date(session.startTime).toLocaleString()}\n`;
    response += `**Last Activity**: ${new Date(session.lastActivity).toLocaleString()}\n`;
    response += `**Lifecycle**: \`${session.lifecycle}\`\n\n`;

    if (session.pendingGateReview) {
      response += `### ⚠️ Pending Review\n`;
      response += `**Gates**: ${session.pendingGateReview.gateIds.join(', ')}\n`;
      response += `**Attempts**: ${session.pendingGateReview.attemptCount}/${session.pendingGateReview.maxAttempts}\n\n`;
    }

    response += `### 📄 Context Variables\n`;
    const varNames = Object.keys(context).filter(
      (k) =>
        !['chain_run_id', 'chain_id', 'current_step', 'total_steps', 'execution_order'].includes(k)
    );

    if (varNames.length > 0) {
      varNames.forEach((name) => {
        const val = context[name];
        const displayVal =
          typeof val === 'string'
            ? val.substring(0, 100) + (val.length > 100 ? '...' : '')
            : JSON.stringify(val);
        response += `- \`${name}\`: ${displayVal}\n`;
      });
    } else {
      response += '_No custom variables stored._\n';
    }

    return this.createMinimalSystemResponse(response, 'session_inspect');
  }
}

function isSystemControlActionId(value: string): value is SystemControlActionId {
  return (SYSTEM_CONTROL_ACTION_IDS as readonly string[]).includes(value);
}

/**
 * Create consolidated system control
 */
export function createConsolidatedSystemControl(
  logger: Logger,
  mcpServer: any,
  onRestart?: (reason: string) => Promise<void>
): ConsolidatedSystemControl {
  return new ConsolidatedSystemControl(logger, mcpServer, onRestart);
}
