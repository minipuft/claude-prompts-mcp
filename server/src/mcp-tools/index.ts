/**
 * MCP Tools Module - Fully Consolidated Architecture
 *
 * This module provides 3 intelligent consolidated tools that completely replace
 * the previous 24+ scattered legacy tools that have been removed from the codebase:
 *
 * ACTIVE CONSOLIDATED TOOLS:
 * - prompt_engine: Unified execution with intelligent analysis and semantic detection
 * - prompt_manager: Complete lifecycle management with smart filtering and analysis
 * - system_control: Framework management, analytics, and comprehensive system control
 *
 * REMOVED LEGACY TOOLS:
 * - prompt-management-tools.ts (1,123 lines) - Replaced by consolidated-prompt-manager.ts
 * - gate-management-tools.ts (635+ lines) - Gate functionality moved to evaluation service
 * - system-status-tools.ts (50+ lines) - Replaced by consolidated-system-control.ts
 * - workflow-management-tools.ts (302+ lines) - Replaced by consolidated-prompt-engine.ts
 *
 * ARCHITECTURE BENEFITS:
 * - 87.5% reduction in MCP tools (24+ → 3)
 * - ~2,100+ lines of legacy code removed
 * - Single source of truth for each functional area
 * - Improved maintainability and reduced complexity
 */

import { Logger } from "../logging/index.js";
import { PromptManager } from "../prompts/index.js";
import { ConfigManager } from "../config/index.js";
import {
  Category,
  ConvertedPrompt,
  PromptData,
} from "../types/index.js";
// Gate evaluator removed - now using Framework methodology validation
import { createConfigurableSemanticAnalyzer } from "../analysis/configurable-semantic-analyzer.js";
import { createAnalysisIntegrationFactory } from "../analysis/integrations/index.js";
import { FrameworkStateManager } from "../frameworks/framework-state-manager.js";
import { FrameworkManager, createFrameworkManager } from "../frameworks/framework-manager.js";
import { ConversationManager, createConversationManager } from "../text-references/conversation.js";
import { ExecutionCoordinator } from "../execution/execution-coordinator.js";

// Consolidated tools
import {
  ConsolidatedPromptEngine,
  createConsolidatedPromptEngine
} from "./prompt-engine.js";
import {
  ConsolidatedPromptManager,
  createConsolidatedPromptManager
} from "./prompt-manager.js";
import {
  ConsolidatedSystemControl,
  createConsolidatedSystemControl
} from "./system-control.js";

/**
 * Consolidated MCP Tools Manager
 *
 * Manages 3 intelligent consolidated tools that replace the previous 24+ scattered tools
 */
export class ConsolidatedMcpToolsManager {
  private logger: Logger;
  private mcpServer: any;
  private promptManager: PromptManager;
  private configManager: ConfigManager;

  // Consolidated tools (3 instead of 24+)
  private promptEngine!: ConsolidatedPromptEngine;
  private promptManagerTool!: ConsolidatedPromptManager;
  private systemControl!: ConsolidatedSystemControl;

  // Shared components
  private semanticAnalyzer!: ReturnType<typeof createConfigurableSemanticAnalyzer>;
  private frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  private conversationManager!: ConversationManager;
  // Phase 3: Removed executionCoordinator - chains now use LLM-driven execution model

  // Data references
  private promptsData: PromptData[] = [];
  private convertedPrompts: ConvertedPrompt[] = [];
  private categories: Category[] = [];

  constructor(
    logger: Logger,
    mcpServer: any,
    promptManager: PromptManager,
    configManager: ConfigManager,
    // Phase 3: Removed executionCoordinator parameter - using LLM-driven chain model
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.promptManager = promptManager;
    this.configManager = configManager;
    // Phase 3: Removed executionCoordinator assignment - using LLM-driven chain model
  }

  /**
   * Initialize the MCP tools with async configuration
   */
  async initialize(
    onRefresh: () => Promise<void>,
    onRestart: (reason: string) => Promise<void>
  ): Promise<void> {
    // Initialize shared components with configurable analysis
    const analysisConfig = this.configManager.getSemanticAnalysisConfig();
    const integrationFactory = createAnalysisIntegrationFactory(this.logger);
    this.semanticAnalyzer = await integrationFactory.createFromEnvironment(analysisConfig);
    this.conversationManager = createConversationManager(this.logger);

    this.logger.info(`Configurable semantic analyzer initialized (mode: ${analysisConfig.mode})`);

    // Initialize consolidated tools
    this.promptEngine = createConsolidatedPromptEngine(
      this.logger,
      this.mcpServer,
      this.promptManager,
      this.semanticAnalyzer,
      this.conversationManager
      // Phase 3: Removed executionCoordinator - chains now use LLM-driven execution
    );

    this.promptManagerTool = createConsolidatedPromptManager(
      this.logger,
      this.mcpServer,
      this.configManager,
      this.semanticAnalyzer,
      this.frameworkStateManager,
      this.frameworkManager,
      onRefresh,
      onRestart
    );

    this.systemControl = createConsolidatedSystemControl(
      this.logger,
      this.mcpServer
    );

    this.logger.info("Consolidated MCP Tools Manager initialized with 3 intelligent tools");
  }

  /**
   * Set framework state manager (called after initialization)
   */
  setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void {
    this.frameworkStateManager = frameworkStateManager;
    this.promptEngine.setFrameworkStateManager(frameworkStateManager);
    this.systemControl.setFrameworkStateManager(frameworkStateManager);
    this.promptManagerTool.setFrameworkStateManager?.(frameworkStateManager);
  }

  /**
   * Initialize and set framework manager (called after framework state manager)
   */
  async setFrameworkManager(): Promise<void> {
    if (!this.frameworkManager) {
      this.frameworkManager = await createFrameworkManager(this.logger);
      this.promptEngine.setFrameworkManager(this.frameworkManager);
      this.systemControl.setFrameworkManager(this.frameworkManager);
      this.promptManagerTool.setFrameworkManager?.(this.frameworkManager);
      this.logger.info("Framework manager initialized and integrated with MCP tools");
    }
  }

  /**
   * Wire ConsolidatedPromptEngine to ExecutionCoordinator for delegation (Phase 3)
   */
  wireExecutionCoordinator(executionCoordinator: ExecutionCoordinator): void {
    executionCoordinator.setConsolidatedEngine(this.promptEngine);
    this.logger.info("ConsolidatedPromptEngine wired to ExecutionCoordinator for delegation");
  }

  /**
   * Register all consolidated MCP tools with the server
   */
  async registerAllTools(): Promise<void> {
    this.logger.info("Registering consolidated MCP tools with server...");

    // Register the 3 consolidated tools
    this.promptEngine.registerTool();
    this.promptManagerTool.registerTool();
    this.systemControl.registerTool();

    this.logger.info("🎉 All 3 consolidated MCP tools registered successfully!");
    this.logger.info("📊 Tool consolidation: 24+ scattered tools → 3 intelligent tools (87.5% reduction)");

    // Log available tools for user reference
    const toolSummary = [
      "Available Consolidated Tools:",
      "🚀 prompt_engine - Unified execution with intelligent analysis",
      "📝 prompt_manager - Complete lifecycle management",
      "⚙️ system_control - Framework and analytics management with integrated quality validation"
    ].join("\n   ");

    this.logger.info(toolSummary);
  }

  /**
   * Update internal data references
   */
  updateData(
    promptsData: PromptData[],
    convertedPrompts: ConvertedPrompt[],
    categories: Category[]
  ): void {
    this.promptsData = promptsData;
    this.convertedPrompts = convertedPrompts;
    this.categories = categories;

    // Update all consolidated tools with new data
    this.promptEngine.updateData(promptsData, convertedPrompts);
    this.promptManagerTool.updateData(promptsData, convertedPrompts, categories);
  }

  /**
   * Update system analytics (from consolidated tools)
   */
  updateAnalytics(analytics: any): void {
    this.systemControl.updateAnalytics(analytics);
  }
}

/**
 * Create consolidated MCP tools manager
 */
export async function createConsolidatedMcpToolsManager(
  logger: Logger,
  mcpServer: any,
  promptManager: PromptManager,
  configManager: ConfigManager,
  onRefresh: () => Promise<void>,
  onRestart: (reason: string) => Promise<void>
  // Phase 3: Removed executionCoordinator parameter - using LLM-driven chain model
): Promise<ConsolidatedMcpToolsManager> {
  const manager = new ConsolidatedMcpToolsManager(
    logger,
    mcpServer,
    promptManager,
    configManager
    // Phase 3: Removed executionCoordinator parameter
  );
  
  await manager.initialize(onRefresh, onRestart);
  return manager;
}

// Legacy compatibility - export the consolidated manager as the old name
export { ConsolidatedMcpToolsManager as McpToolsManager };
export const createMcpToolsManager = createConsolidatedMcpToolsManager;