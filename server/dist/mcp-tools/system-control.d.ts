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
import { ConfigManager } from '../config/index.js';
import { FrameworkManager } from '../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../frameworks/framework-state-manager.js';
import { Logger } from '../logging/index.js';
import { ToolResponse } from '../types/index.js';
import { ToolDescriptionManager } from './tool-description-manager.js';
import type { ChainSessionService } from '../chain-session/types.js';
import { GateSystemManager } from '../gates/gate-state-manager.js';
import { MetricsCollector } from '../metrics/index.js';
import type { GateGuidanceRenderer } from '../gates/guidance/GateGuidanceRenderer.js';
/**
 * System analytics interface - optimized for API performance and rich historical context
 */
interface SystemAnalytics {
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
 * Consolidated System Control Tool
 */
export declare class ConsolidatedSystemControl {
    private logger;
    private mcpServer;
    private configManager?;
    private safeConfigWriter?;
    frameworkStateManager?: FrameworkStateManager;
    private frameworkManager?;
    gateSystemManager?: GateSystemManager;
    chainSessionManager?: ChainSessionService;
    private onRestart?;
    private toolDescriptionManager?;
    private mcpToolsManager?;
    private analyticsService?;
    private responseFormatter;
    private promptGuidanceService?;
    private gateGuidanceRenderer?;
    startTime: number;
    systemAnalytics: SystemAnalytics;
    constructor(logger: Logger, mcpServer: any, onRestart?: (reason: string) => Promise<void>);
    /**
     * Set framework state manager
     */
    setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void;
    /**
     * Set framework manager
     */
    setFrameworkManager(frameworkManager: FrameworkManager): void;
    /**
     * Set tool description manager
     */
    setToolDescriptionManager(manager: ToolDescriptionManager): void;
    /**
     * Set analytics service
     */
    setAnalyticsService(analyticsService: MetricsCollector): void;
    /**
     * Set config manager for configuration operations
     */
    setConfigManager(configManager: ConfigManager): void;
    /**
     * Set restart callback (for system restart functionality)
     */
    setRestartCallback(onRestart: (reason: string) => Promise<void>): void;
    /**
     * Set MCPToolsManager reference (for dynamic tool updates)
     */
    setMCPToolsManager(mcpToolsManager: any): void;
    /**
     * Set gate system manager for runtime gate management
     */
    setGateSystemManager(gateSystemManager: GateSystemManager): void;
    /**
     * Set chain session manager for session management operations
     */
    setChainSessionManager(chainSessionManager: ChainSessionService): void;
    /**
     * Set gate guidance renderer for discovery operations
     */
    setGateGuidanceRenderer(renderer: GateGuidanceRenderer): void;
    /**
     * Helper function for minimal outputSchema compliance
     */
    createMinimalSystemResponse(text: string, action: string): ToolResponse;
    /**
     * Derived calculation: Get execution mode distribution from performance trends
     */
    getExecutionsByMode(): Record<string, number>;
    /**
     * Update system analytics with rich execution data
     */
    updateAnalytics(analytics: Partial<SystemAnalytics> & {
        currentExecution?: any;
    }): void;
    /**
     * Calculate memory usage delta from previous execution
     */
    private lastMemoryUsage;
    private calculateMemoryDelta;
    /**
     * Persist gate enablement to config.json when requested.
     */
    private persistGateConfig;
    /**
     * Persist framework system enablement toggles to config.json when requested.
     */
    private persistFrameworkConfig;
    /**
     * Main action handler
     */
    handleAction(args: {
        action: string;
        [key: string]: any;
    }, extra: any): Promise<ToolResponse>;
    /**
     * Get the appropriate action handler based on action type
     */
    private getActionHandler;
    /**
     * Get comprehensive system status
     */
    getSystemStatus(args: {
        include_history?: boolean;
        include_metrics?: boolean;
    }): Promise<ToolResponse>;
    switchFramework(args: {
        framework?: string;
        reason?: string;
    }): Promise<ToolResponse>;
    listFrameworks(args: {
        show_details?: boolean;
    }): Promise<ToolResponse>;
    /**
     * Inspect a specific methodology's data-driven definition
     */
    inspectMethodology(args: {
        methodology_id?: string;
    }): Promise<ToolResponse>;
    /**
     * List all available data-driven methodologies
     */
    listMethodologiesAction(args: {
        show_details?: boolean;
    }): Promise<ToolResponse>;
    enableFrameworkSystem(args: {
        reason?: string;
        persist?: boolean;
    }): Promise<ToolResponse>;
    disableFrameworkSystem(args: {
        reason?: string;
        persist?: boolean;
    }): Promise<ToolResponse>;
    /**
     * Enable gate system
     */
    enableGateSystem(args: {
        reason?: string;
        persist?: boolean;
    }): Promise<ToolResponse>;
    /**
     * Disable gate system
     */
    disableGateSystem(args: {
        reason?: string;
        persist?: boolean;
    }): Promise<ToolResponse>;
    /**
     * Get gate system status
     */
    getGateSystemStatus(): Promise<ToolResponse>;
    /**
     * Get gate system health details
     */
    getGateSystemHealth(): Promise<ToolResponse>;
    /**
     * List all available quality gates with optional search filtering
     */
    listAvailableGates(searchQuery?: string): Promise<ToolResponse>;
    /**
     * Reset analytics data
     */
    private resetAnalyticsData;
    private formatExecutionTime;
    resetMetrics(args: {
        confirm?: boolean;
    }): Promise<ToolResponse>;
    getSwitchHistory(args: {
        limit?: number;
    }): Promise<ToolResponse>;
    private formatUptime;
    private formatBytes;
    private getSuccessRate;
    private formatTrendContext;
    private formatTrendValue;
    getAnalytics(args: {
        include_history?: boolean;
        reset_analytics?: boolean;
    }): Promise<ToolResponse>;
    private getHealthIcon;
    restoreConfig(args: {
        backup_path?: string;
        confirm?: boolean;
    }): Promise<ToolResponse>;
    manageConfig(args: {
        config?: {
            key: string;
            value?: string;
            operation: 'get' | 'set' | 'list' | 'validate';
        };
    }): Promise<ToolResponse>;
    restartServer(args: {
        reason?: string;
        confirm?: boolean;
    }): Promise<ToolResponse>;
    private handleConfigList;
    private handleConfigGet;
    private handleConfigSet;
    private handleConfigValidate;
}
/**
 * Create consolidated system control
 */
export declare function createConsolidatedSystemControl(logger: Logger, mcpServer: any, onRestart?: (reason: string) => Promise<void>): ConsolidatedSystemControl;
export {};
