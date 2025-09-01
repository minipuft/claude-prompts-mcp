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

import { z } from "zod";
import { Logger } from "../logging/index.js";
import { ToolResponse } from "../types/index.js";
import { 
  FrameworkStateManager, 
  FrameworkState, 
  FrameworkSystemHealth, 
  FrameworkSwitchRequest 
} from "../frameworks/framework-state-manager.js";
import { FrameworkManager } from "../frameworks/framework-manager.js";
import { handleError as utilsHandleError } from "../utils/index.js";

/**
 * System analytics interface
 */
interface SystemAnalytics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  executionsByMode: Record<string, number>;
  gateValidationCount: number;
  uptime: number;
  memoryUsage?: NodeJS.MemoryUsage;
  performanceTrends: Array<{
    timestamp: number;
    metric: string;
    value: number;
  }>;
}

/**
 * Consolidated System Control Tool
 */
export class ConsolidatedSystemControl {
  private logger: Logger;
  private mcpServer: any;
  private frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  private startTime: number = Date.now();
  
  // Analytics data
  private systemAnalytics: SystemAnalytics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageExecutionTime: 0,
    executionsByMode: {},
    gateValidationCount: 0,
    uptime: 0,
    performanceTrends: []
  };

  constructor(logger: Logger, mcpServer: any) {
    this.logger = logger;
    this.mcpServer = mcpServer;
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
   * Update system analytics
   */
  updateAnalytics(analytics: Partial<SystemAnalytics>): void {
    Object.assign(this.systemAnalytics, analytics);
    this.systemAnalytics.uptime = Date.now() - this.startTime;
    
    // Update memory usage
    this.systemAnalytics.memoryUsage = process.memoryUsage();
    
    // Record performance trends
    if (analytics.averageExecutionTime) {
      this.systemAnalytics.performanceTrends.push({
        timestamp: Date.now(),
        metric: 'executionTime',
        value: analytics.averageExecutionTime
      });
      
      // Keep only last 100 trend points
      if (this.systemAnalytics.performanceTrends.length > 100) {
        this.systemAnalytics.performanceTrends.shift();
      }
    }
  }

  /**
   * Register the consolidated system control tool
   */
  registerTool(): void {
    this.mcpServer.tool(
      "system_control",
      "⚙️ INTELLIGENT SYSTEM CONTROL: Unified framework management, analytics, diagnostics, and system administration. Handles framework switching, performance monitoring, health checks, and comprehensive system status reporting.",
      {
        action: z
          .enum([
            "status", "switch_framework", "list_frameworks", "analytics", 
            "health", "diagnostics", "reset_metrics", "switch_history", "config"
          ])
          .describe("System action: 'status' (comprehensive overview), 'switch_framework' (change methodology), 'list_frameworks' (available options), 'analytics' (execution metrics), 'health' (system health), 'diagnostics' (detailed analysis), 'reset_metrics' (clear stats), 'switch_history' (framework changes), 'config' (system configuration)"),
          
        // Framework parameters
        framework: z
          .enum(["CAGEERF", "ReACT", "5W1H", "SCAMPER"])
          .optional()
          .describe("Target framework for switch_framework action"),
          
        reason: z
          .string()
          .optional()
          .describe("Reason for framework switch or operation"),
          
        // Display parameters
        include_history: z
          .boolean()
          .optional()
          .describe("Include historical data in reports"),
          
        include_metrics: z
          .boolean()
          .optional()
          .describe("Include detailed performance metrics"),
          
        show_details: z
          .boolean()
          .optional()
          .describe("Show detailed information"),
          
        // Analytics parameters
        reset_analytics: z
          .boolean()
          .optional()
          .describe("Reset analytics counters"),
          
        limit: z
          .number()
          .optional()
          .describe("Limit number of results (for history operations)"),
          
        // Config parameters
        config_key: z
          .string()
          .optional()
          .describe("Configuration key to view/modify"),
          
        config_value: z
          .string()
          .optional()
          .describe("New configuration value"),
          
        // System parameters
        confirm: z
          .boolean()
          .optional()
          .describe("Confirmation for destructive operations"),
          
        options: z
          .record(z.any())
          .optional()
          .describe("Additional operation options")
      },
      async (args: {
        action: "status" | "switch_framework" | "list_frameworks" | "analytics" | 
                "health" | "diagnostics" | "reset_metrics" | "switch_history" | "config";
        framework?: "CAGEERF" | "ReACT" | "5W1H" | "SCAMPER";
        reason?: string;
        include_history?: boolean;
        include_metrics?: boolean;
        show_details?: boolean;
        reset_analytics?: boolean;
        limit?: number;
        config_key?: string;
        config_value?: string;
        confirm?: boolean;
        options?: Record<string, any>;
      }, extra: any) => {
        try {
          return await this.handleAction(args, extra);
        } catch (error) {
          return this.handleError(error, `system_control_${args.action}`);
        }
      }
    );

    this.logger.info("Consolidated System Control registered successfully");
  }

  /**
   * Main action handler
   */
  private async handleAction(args: {
    action: string;
    [key: string]: any;
  }, extra: any): Promise<ToolResponse> {
    
    const { action } = args;
    this.logger.info(`⚙️ System Control: Executing action "${action}"`);

    switch (action) {
      case "status":
        return await this.getSystemStatus({
          include_history: args.include_history,
          include_metrics: args.include_metrics
        });
        
      case "switch_framework":
        return await this.switchFramework({
          framework: args.framework,
          reason: args.reason
        });
        
      case "list_frameworks":
        return await this.listFrameworks({
          show_details: args.show_details
        });
        
      case "analytics":
        return await this.getAnalytics({
          include_history: args.include_history,
          reset_analytics: args.reset_analytics
        });
        
      case "health":
        return await this.getSystemHealth({});
        
      case "diagnostics":
        return await this.runDiagnostics({});
        
      case "reset_metrics":
        return await this.resetMetrics({
          confirm: args.confirm
        });
        
      case "switch_history":
        return await this.getSwitchHistory({
          limit: args.limit
        });
        
      case "config":
        return await this.manageConfig({
          config_key: args.config_key,
          config_value: args.config_value
        });
        
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * Get comprehensive system status
   */
  private async getSystemStatus(args: {
    include_history?: boolean;
    include_metrics?: boolean;
  }): Promise<ToolResponse> {
    const { include_history = false, include_metrics = true } = args;
    
    if (!this.frameworkStateManager) {
      throw new Error("Framework state manager not initialized");
    }

    const currentState = this.frameworkStateManager.getCurrentState();
    const systemHealth = this.frameworkStateManager.getSystemHealth();
    const activeFramework = this.frameworkStateManager.getActiveFramework();
    
    let response = "# ⚙️ System Status Report\n\n";
    
    // Framework Status
    response += "## 📋 Framework Status\n\n";
    response += `**Active Framework**: ${activeFramework.name} (${activeFramework.id})\n`;
    response += `**Description**: ${activeFramework.description}\n`;
    response += `**System Health**: ${this.getHealthIcon(systemHealth.status)} ${systemHealth.status.toUpperCase()}\n`;
    response += `**Last Switch**: ${currentState.switchedAt.toISOString()}\n`;
    response += `**Switch Reason**: ${currentState.switchReason}\n\n`;

    // System Metrics
    response += "## 📊 System Metrics\n\n";
    response += `**Uptime**: ${this.formatUptime(this.systemAnalytics.uptime)}\n`;
    response += `**Total Executions**: ${this.systemAnalytics.totalExecutions}\n`;
    response += `**Success Rate**: ${this.getSuccessRate()}%\n`;
    response += `**Average Execution Time**: ${this.formatExecutionTime(this.systemAnalytics.averageExecutionTime)}\n`;
    
    if (this.systemAnalytics.memoryUsage) {
      const mem = this.systemAnalytics.memoryUsage;
      response += `**Memory Usage**: ${this.formatBytes(mem.heapUsed)}/${this.formatBytes(mem.heapTotal)}\n`;
    }
    
    response += `\n`;

    // Available Frameworks
    const availableFrameworks = this.frameworkStateManager.getAvailableFrameworks();
    response += "## 🔄 Available Frameworks\n\n";
    availableFrameworks.forEach(framework => {
      const isActive = framework.id === currentState.activeFramework;
      const icon = isActive ? "🟢" : "⚪";
      response += `${icon} **${framework.name}** - ${framework.description}\n`;
    });
    response += "\n";

    // Performance Metrics
    if (include_metrics) {
      response += "## 🎯 Performance Breakdown\n\n";
      const frameworkMetrics = systemHealth.performanceMetrics;
      response += `**Framework Switches**: ${frameworkMetrics.totalSwitches}\n`;
      response += `**Framework Success Rate**: ${frameworkMetrics.totalSwitches > 0 
        ? Math.round((frameworkMetrics.successfulSwitches / frameworkMetrics.totalSwitches) * 100) 
        : 100}%\n`;
      response += `**Framework Response Time**: ${Math.round(frameworkMetrics.averageResponseTime)}ms\n`;
      
      response += `\n**Execution Modes**:\n`;
      Object.entries(this.systemAnalytics.executionsByMode).forEach(([mode, count]) => {
        response += `- ${mode.charAt(0).toUpperCase() + mode.slice(1)}: ${count} executions\n`;
      });
      response += `\n`;
    }

    // System Health Issues
    if (systemHealth.issues.length > 0) {
      response += "## ⚠️ System Issues\n\n";
      systemHealth.issues.forEach(issue => {
        response += `- ⚠️ ${issue}\n`;
      });
      response += "\n";
    }

    // Recent Activity
    if (include_history && this.systemAnalytics.performanceTrends.length > 0) {
      response += "## 📈 Recent Performance Trends\n\n";
      const recentTrends = this.systemAnalytics.performanceTrends.slice(-10);
      recentTrends.forEach((trend, index) => {
        const timestamp = new Date(trend.timestamp).toISOString().split('T')[1].split('.')[0];
        response += `${index + 1}. ${timestamp}: ${trend.metric} = ${this.formatTrendValue(trend.metric, trend.value)}\n`;
      });
      response += "\n";
    }

    // Control Commands
    response += "## 🎛️ Available Commands\n\n";
    response += "- `switch_framework` - Change active framework methodology\n";
    response += "- `analytics` - View detailed execution analytics\n";
    response += "- `health` - Check system health status\n";
    response += "- `diagnostics` - Run comprehensive system diagnostics\n";
    response += "- `reset_metrics` - Reset performance counters\n";
    response += "- `switch_history` - View framework change history\n";

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Switch framework
   */
  private async switchFramework(args: {
    framework?: "CAGEERF" | "ReACT" | "5W1H" | "SCAMPER";
    reason?: string;
  }): Promise<ToolResponse> {
    if (!this.frameworkStateManager) {
      throw new Error("Framework state manager not initialized");
    }

    if (!args.framework) {
      throw new Error("Framework parameter is required for switch operation");
    }

    const { framework, reason = `User requested switch to ${args.framework}` } = args;
    
    const currentState = this.frameworkStateManager.getCurrentState();
    
    // Check if already active
    if (currentState.activeFramework === framework) {
      return {
        content: [{
          type: "text",
          text: `ℹ️ Framework '${framework}' is already active. No change needed.`
        }]
      };
    }

    const request: FrameworkSwitchRequest = {
      targetFramework: framework,
      reason: reason
    };

    const success = await this.frameworkStateManager.switchFramework(request);

    if (success) {
      const newState = this.frameworkStateManager.getCurrentState();
      const activeFramework = this.frameworkStateManager.getActiveFramework();
      
      let response = `🔄 **Framework Switch Successful**\n\n`;
      response += `**Previous**: ${currentState.activeFramework}\n`;
      response += `**Current**: ${newState.activeFramework}\n`;
      response += `**Switched At**: ${newState.switchedAt.toISOString()}\n`;
      response += `**Reason**: ${reason}\n\n`;
      response += `**New Framework Details**:\n`;
      response += `- **Name**: ${activeFramework.name}\n`;
      response += `- **Description**: ${activeFramework.description}\n`;
      response += `- **Methodology**: ${activeFramework.methodology}\n\n`;
      response += `**Guidelines**: ${activeFramework.executionGuidelines.join(' • ')}\n\n`;
      response += `✅ All future prompt executions will now use the ${framework} methodology.`;

      return { content: [{ type: "text", text: response }] };
    } else {
      return {
        content: [{
          type: "text",
          text: `❌ Failed to switch to framework '${framework}'. Check system logs for details.`
        }],
        isError: true
      };
    }
  }

  /**
   * List available frameworks
   */
  private async listFrameworks(args: {
    show_details?: boolean;
  }): Promise<ToolResponse> {
    if (!this.frameworkStateManager) {
      throw new Error("Framework state manager not initialized");
    }

    const { show_details = true } = args;
    
    const currentState = this.frameworkStateManager.getCurrentState();
    const availableFrameworks = this.frameworkStateManager.getAvailableFrameworks();
    
    let response = "# 📋 Available Framework Methodologies\n\n";
    response += `**Currently Active**: ${currentState.activeFramework}\n\n`;

    availableFrameworks.forEach(framework => {
      const isActive = framework.id === currentState.activeFramework;
      const icon = isActive ? "🟢" : "⚪";
      const status = isActive ? " (ACTIVE)" : "";
      
      response += `## ${icon} ${framework.name}${status}\n\n`;
      response += `**ID**: ${framework.id}\n`;
      response += `**Methodology**: ${framework.methodology}\n`;
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
      
      response += "\n";
    });

    response += "---\n\n";
    response += "**Usage**: Use `switch_framework` action to change the active framework methodology.\n";
    response += "**Note**: The framework methodology determines how prompts are processed systematically.";

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Get execution analytics
   */
  private async getAnalytics(args: {
    include_history?: boolean;
    reset_analytics?: boolean;
  }): Promise<ToolResponse> {
    const { include_history = false, reset_analytics = false } = args;
    
    if (reset_analytics) {
      this.resetAnalyticsData();
      return {
        content: [{ type: "text", text: "📊 Analytics have been reset to zero." }]
      };
    }

    const successRate = this.getSuccessRate();
    const avgTime = this.formatExecutionTime(this.systemAnalytics.averageExecutionTime);
    
    let response = "# 📊 System Analytics Report\n\n";
    
    // Overall Performance
    response += "## 📈 Overall Performance\n\n";
    response += `**Total Executions**: ${this.systemAnalytics.totalExecutions}\n`;
    response += `**Success Rate**: ${successRate}%\n`;
    response += `**Failed Executions**: ${this.systemAnalytics.failedExecutions}\n`;
    response += `**Average Execution Time**: ${avgTime}\n`;
    response += `**System Uptime**: ${this.formatUptime(this.systemAnalytics.uptime)}\n\n`;
    
    // Execution Modes
    response += "## 🎯 Execution Mode Distribution\n\n";
    const totalModeExecutions = Object.values(this.systemAnalytics.executionsByMode).reduce((a, b) => a + b, 0);
    Object.entries(this.systemAnalytics.executionsByMode).forEach(([mode, count]) => {
      const percentage = totalModeExecutions > 0 ? Math.round((count / totalModeExecutions) * 100) : 0;
      response += `- **${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode**: ${count} executions (${percentage}%)\n`;
    });
    response += "\n";
    
    // Quality Gates
    response += "## 🛡️ Quality Gate Usage\n\n";
    response += `**Gate Validations**: ${this.systemAnalytics.gateValidationCount}\n`;
    response += `**Gate Adoption Rate**: ${this.systemAnalytics.totalExecutions > 0 
      ? Math.round((this.systemAnalytics.gateValidationCount / this.systemAnalytics.totalExecutions) * 100)
      : 0}%\n\n`;
    
    // System Resources
    if (this.systemAnalytics.memoryUsage) {
      response += "## 💾 System Resources\n\n";
      const mem = this.systemAnalytics.memoryUsage;
      response += `**Heap Used**: ${this.formatBytes(mem.heapUsed)}\n`;
      response += `**Heap Total**: ${this.formatBytes(mem.heapTotal)}\n`;
      response += `**RSS**: ${this.formatBytes(mem.rss)}\n`;
      response += `**External**: ${this.formatBytes(mem.external)}\n\n`;
    }
    
    // Performance Trends
    if (include_history && this.systemAnalytics.performanceTrends.length > 0) {
      response += "## 📈 Performance Trends\n\n";
      const recentTrends = this.systemAnalytics.performanceTrends.slice(-20);
      recentTrends.forEach((trend, index) => {
        const time = new Date(trend.timestamp).toISOString().split('T')[1].split('.')[0];
        response += `${index + 1}. ${time}: ${this.formatTrendValue(trend.metric, trend.value)}\n`;
      });
    }
    
    response += `\n---\n*Generated at: ${new Date().toISOString()}*`;

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Get system health
   */
  private async getSystemHealth(args: any): Promise<ToolResponse> {
    if (!this.frameworkStateManager) {
      throw new Error("Framework state manager not initialized");
    }

    const health = this.frameworkStateManager.getSystemHealth();
    const statusIcon = this.getHealthIcon(health.status);
    
    let response = `# 🏥 System Health Report\n\n`;
    response += `**Overall Status**: ${statusIcon} ${health.status.toUpperCase()}\n`;
    response += `**Active Framework**: ${health.activeFramework}\n`;
    response += `**Available Frameworks**: ${health.availableFrameworks.length}\n`;
    response += `**System Uptime**: ${this.formatUptime(this.systemAnalytics.uptime)}\n\n`;
    
    // Performance Health
    response += "## 📊 Performance Health\n\n";
    response += `**Framework Switches**: ${health.performanceMetrics.totalSwitches}\n`;
    response += `**Framework Success Rate**: ${health.performanceMetrics.totalSwitches > 0 
      ? Math.round((health.performanceMetrics.successfulSwitches / health.performanceMetrics.totalSwitches) * 100) 
      : 100}%\n`;
    response += `**Average Response Time**: ${Math.round(health.performanceMetrics.averageResponseTime)}ms\n`;
    response += `**Execution Success Rate**: ${this.getSuccessRate()}%\n\n`;
    
    // Issues
    if (health.issues.length > 0) {
      response += "## ⚠️ Detected Issues\n\n";
      health.issues.forEach((issue, index) => {
        response += `${index + 1}. ⚠️ ${issue}\n`;
      });
      response += "\n";
    } else {
      response += "## ✅ System Status\n\nNo issues detected. System is operating normally.\n\n";
    }
    
    // Health Recommendations
    response += "## 💡 Health Recommendations\n\n";
    
    if (health.status === "healthy") {
      response += "✅ System is healthy. No action required.\n";
      response += "- Continue monitoring performance metrics\n";
      response += "- Regular analytics reviews recommended\n";
    } else if (health.status === "degraded") {
      response += "⚠️ System performance is degraded. Monitor closely.\n";
      response += "- Review recent framework switches for patterns\n";
      response += "- Consider resetting metrics if issues are resolved\n";
      response += "- Check execution failure rates\n";
    } else {
      response += "❌ System requires immediate attention.\n";
      response += "- Check framework configuration\n";
      response += "- Review system logs for error patterns\n";
      response += "- Consider system restart if issues persist\n";
    }

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Run comprehensive diagnostics
   */
  private async runDiagnostics(args: any): Promise<ToolResponse> {
    let response = "# 🔧 System Diagnostics Report\n\n";
    
    // Framework System Check
    response += "## 🔄 Framework System\n\n";
    if (this.frameworkStateManager) {
      const state = this.frameworkStateManager.getCurrentState();
      const health = this.frameworkStateManager.getSystemHealth();
      const frameworks = this.frameworkStateManager.getAvailableFrameworks();
      
      response += `✅ **Framework Manager**: Operational\n`;
      response += `✅ **Active Framework**: ${state.activeFramework}\n`;
      response += `✅ **Available Frameworks**: ${frameworks.length} configured\n`;
      response += `${this.getHealthIcon(health.status)} **System Health**: ${health.status}\n\n`;
      
      // Check each framework
      frameworks.forEach(fw => {
        const icon = fw.enabled ? "✅" : "⚠️";
        response += `${icon} **${fw.name}**: ${fw.enabled ? 'Enabled' : 'Disabled'}\n`;
      });
      response += "\n";
    } else {
      response += `❌ **Framework Manager**: Not initialized\n\n`;
    }
    
    // Performance Diagnostics
    response += "## 📊 Performance Diagnostics\n\n";
    response += `**Total Executions**: ${this.systemAnalytics.totalExecutions}\n`;
    response += `**Success Rate**: ${this.getSuccessRate()}%\n`;
    response += `**Average Execution Time**: ${this.formatExecutionTime(this.systemAnalytics.averageExecutionTime)}\n`;
    
    // Performance Assessment
    const successRate = this.getSuccessRate();
    if (successRate >= 95) {
      response += `✅ **Performance Assessment**: Excellent (${successRate}%)\n`;
    } else if (successRate >= 85) {
      response += `⚠️ **Performance Assessment**: Good (${successRate}%)\n`;
    } else {
      response += `❌ **Performance Assessment**: Needs attention (${successRate}%)\n`;
    }
    response += "\n";
    
    // System Resources
    response += "## 💾 System Resources\n\n";
    if (this.systemAnalytics.memoryUsage) {
      const mem = this.systemAnalytics.memoryUsage;
      const heapUsagePercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);
      
      response += `**Memory Usage**: ${this.formatBytes(mem.heapUsed)}/${this.formatBytes(mem.heapTotal)} (${heapUsagePercent}%)\n`;
      
      if (heapUsagePercent < 70) {
        response += `✅ **Memory Status**: Healthy\n`;
      } else if (heapUsagePercent < 90) {
        response += `⚠️ **Memory Status**: Monitor usage\n`;
      } else {
        response += `❌ **Memory Status**: High usage - consider optimization\n`;
      }
    }
    
    response += `**System Uptime**: ${this.formatUptime(this.systemAnalytics.uptime)}\n\n`;
    
    // Recommendations
    response += "## 💡 Diagnostic Recommendations\n\n";
    
    const recommendations: string[] = [];
    
    if (this.getSuccessRate() < 90) {
      recommendations.push("Investigate execution failure patterns to improve success rate");
    }
    
    if (this.systemAnalytics.averageExecutionTime > 5000) {
      recommendations.push("Consider optimizing execution performance - average time is high");
    }
    
    if (this.systemAnalytics.memoryUsage && 
        (this.systemAnalytics.memoryUsage.heapUsed / this.systemAnalytics.memoryUsage.heapTotal) > 0.8) {
      recommendations.push("Monitor memory usage - heap utilization is high");
    }
    
    if (recommendations.length > 0) {
      recommendations.forEach((rec, index) => {
        response += `${index + 1}. ${rec}\n`;
      });
    } else {
      response += "✅ No issues detected. System is operating optimally.\n";
    }
    
    response += `\n---\n*Diagnostics completed at: ${new Date().toISOString()}*`;

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Reset system metrics
   */
  private async resetMetrics(args: {
    confirm?: boolean;
  }): Promise<ToolResponse> {
    if (!args.confirm) {
      return {
        content: [{
          type: "text",
          text: "❌ Metrics reset cancelled. Set 'confirm: true' to reset all performance metrics."
        }]
      };
    }

    const beforeMetrics = { ...this.systemAnalytics };
    
    this.resetAnalyticsData();
    
    if (this.frameworkStateManager) {
      this.frameworkStateManager.resetMetrics();
    }
    
    let response = `# 🔄 Metrics Reset Completed\n\n`;
    response += `**Reset Timestamp**: ${new Date().toISOString()}\n\n`;
    
    response += "## Metrics Before Reset\n\n";
    response += `**Total Executions**: ${beforeMetrics.totalExecutions}\n`;
    response += `**Successful**: ${beforeMetrics.successfulExecutions}\n`;
    response += `**Failed**: ${beforeMetrics.failedExecutions}\n`;
    response += `**Average Time**: ${this.formatExecutionTime(beforeMetrics.averageExecutionTime)}\n\n`;
    
    response += "## Metrics After Reset\n\n";
    response += `**Total Executions**: ${this.systemAnalytics.totalExecutions}\n`;
    response += `**Successful**: ${this.systemAnalytics.successfulExecutions}\n`;
    response += `**Failed**: ${this.systemAnalytics.failedExecutions}\n`;
    response += `**Average Time**: ${this.formatExecutionTime(this.systemAnalytics.averageExecutionTime)}\n\n`;
    
    response += "✅ All performance metrics have been reset. Monitoring will start fresh.";

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Get framework switch history
   */
  private async getSwitchHistory(args: {
    limit?: number;
  }): Promise<ToolResponse> {
    if (!this.frameworkStateManager) {
      throw new Error("Framework state manager not initialized");
    }

    const { limit = 20 } = args;
    
    const history = this.frameworkStateManager.getSwitchHistory(limit);
    const currentState = this.frameworkStateManager.getCurrentState();
    
    let response = `# 📈 Framework Switch History\n\n`;
    response += `**Current Framework**: ${currentState.activeFramework}\n`;
    response += `**History Entries**: ${history.length}\n\n`;
    
    if (history.length === 0) {
      response += "No framework switches recorded yet.\n\n";
    } else {
      response += "## Recent Switches\n\n";
      
      history.forEach((entry, index) => {
        response += `### ${index + 1}. ${entry.from} → ${entry.to}\n\n`;
        response += `**Timestamp**: ${entry.timestamp.toISOString()}\n`;
        response += `**Reason**: ${entry.reason}\n\n`;
      });
    }
    
    response += "---\n\n";
    response += "**Note**: This history helps track framework usage patterns and audit changes.";

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Manage system configuration
   */
  private async manageConfig(args: {
    config_key?: string;
    config_value?: string;
  }): Promise<ToolResponse> {
    let response = "# ⚙️ System Configuration\n\n";
    
    if (args.config_key && args.config_value) {
      // Set configuration
      response += `**Setting Configuration**: ${args.config_key} = ${args.config_value}\n\n`;
      response += "⚠️ Configuration updates require server restart to take effect.\n";
    } else if (args.config_key) {
      // Get specific configuration
      response += `**Configuration Key**: ${args.config_key}\n`;
      response += `**Current Value**: Not implemented in this version\n\n`;
    } else {
      // Show all configuration
      response += "## Current System Configuration\n\n";
      response += `**Framework System**: ${this.frameworkStateManager ? 'Enabled' : 'Disabled'}\n`;
      response += `**Analytics Collection**: Enabled\n`;
      response += `**Performance Monitoring**: Enabled\n`;
      response += `**System Uptime**: ${this.formatUptime(this.systemAnalytics.uptime)}\n`;
      response += `**Start Time**: ${new Date(this.startTime).toISOString()}\n\n`;
      
      response += "## Available Configuration Options\n\n";
      response += "- Framework system settings\n";
      response += "- Analytics collection preferences\n";
      response += "- Performance monitoring thresholds\n";
      response += "- Logging levels and destinations\n\n";
      
      response += "**Note**: Configuration management is read-only in this version.";
    }

    return { content: [{ type: "text", text: response }] };
  }

  // Helper methods

  private resetAnalyticsData(): void {
    this.systemAnalytics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      executionsByMode: {},
      gateValidationCount: 0,
      uptime: Date.now() - this.startTime,
      performanceTrends: []
    };
  }

  private getSuccessRate(): number {
    if (this.systemAnalytics.totalExecutions === 0) return 100;
    return Math.round((this.systemAnalytics.successfulExecutions / this.systemAnalytics.totalExecutions) * 100);
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private formatExecutionTime(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private formatTrendValue(metric: string, value: number): string {
    switch (metric) {
      case 'executionTime':
        return this.formatExecutionTime(value);
      case 'memoryUsage':
        return this.formatBytes(value);
      default:
        return value.toString();
    }
  }

  private getHealthIcon(status: string): string {
    switch (status) {
      case "healthy": return "✅";
      case "degraded": return "⚠️";
      case "error": return "❌";
      default: return "❓";
    }
  }

  /**
   * Error handling helper
   */
  private handleError(error: unknown, context: string): ToolResponse {
    const { message, isError } = utilsHandleError(error, context, this.logger);
    return {
      content: [{ type: "text", text: message }],
      isError
    };
  }
}

/**
 * Create consolidated system control
 */
export function createConsolidatedSystemControl(
  logger: Logger,
  mcpServer: any
): ConsolidatedSystemControl {
  return new ConsolidatedSystemControl(logger, mcpServer);
}