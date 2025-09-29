/**
 * Consolidated Prompt Engine - Unified Execution Tool
 *
 * Consolidates all prompt execution functionality into a single systematic tool:
 * - execute_prompt (from index.ts)
 * - Chain execution with progress tracking
 * - Structural execution mode detection
 * - Gate validation and retry logic
 */

import path from "path";
import { z } from "zod";
import { ConfigManager } from "../../../config/index.js";
import { Logger } from "../../../logging/index.js";
import { PromptManager } from "../../../prompts/index.js";
import {
  ChainExecutionProgress,
  ConvertedPrompt,
  ExecutionState,
  GateDefinition,
  PromptData,
  ToolResponse,
} from "../../../types/index.js";
// REMOVED: ModularChainDefinition from deleted chain-scaffolding.ts
import {
  PromptError,
  ValidationError,
  getAvailableTools,
  isChainPrompt,
  handleError as utilsHandleError,
} from "../../../utils/index.js";
import { processTemplate } from "../../../utils/jsonUtils.js";
// Gate evaluation removed - now using Framework methodology validation
import { FrameworkManager } from "../../../frameworks/framework-manager.js";
import { FrameworkExecutionContext } from "../../../frameworks/types/index.js";
import { FrameworkStateManager } from "../../../frameworks/framework-state-manager.js";
import { ContentAnalyzer } from "../../../semantic/configurable-semantic-analyzer.js";
import { ConversationManager } from "../../../text-references/conversation.js";
import { TextReferenceManager } from "../../../text-references/index.js";
import { ChainSessionManager, createChainSessionManager } from "../../../chain-session/manager.js";
import { createExecutionResponse } from "../../shared/structured-response-builder.js";
// Legacy gate system removed - using lightweight gates only
// NEW: Lightweight gate system
import {
  LightweightGateSystem,
  createLightweightGateSystem,
} from "../../../gates/core/index.js";
// NEW: Role-based gate components (Phase 3)
import {
  GateGuidanceRenderer,
  createGateGuidanceRenderer,
} from "../../../gates/guidance/GateGuidanceRenderer.js";
// Gate validation integration
import {
  EngineValidator,
  GateValidationResult,
} from "../utils/validation.js";
// Phase 4: Clean architecture gate intelligence (replaced advanced orchestrator)
import {
  GateSelectionEngine,
  createGateSelectionEngine,
  ExtendedGateSelectionCriteria,
} from "../../../gates/intelligence/GateSelectionEngine.js";
import {
  GateSelectionResult,
} from "../../../gates/core/gate-definitions.js";
// Phase 3: Prompt guidance system integration
import {
  PromptGuidanceService,
  createPromptGuidanceService,
  type ServicePromptGuidanceResult
} from "../../../frameworks/prompt-guidance/index.js";
// REMOVED: ChainOrchestrator and detectChainType/isModularChain - modular chain system completely removed
// REMOVED: Chain URI addressing system - deprecated with markdown-embedded chains
// New unified parsing system
import {
  createParsingSystem,
  type ExecutionContext,
  type ParsingSystem,
} from "../../../execution/parsers/index.js";
// REMOVED: Dynamic template discovery - scaffolding system deprecated
// Tool description manager
import { ToolDescriptionManager } from "../../tool-description-manager.js";
// Chain execution separation
import { ChainExecutor } from "./executor.js";
import { ChainExecutionContext, ChainExecutionOptions } from "./types.js";
// Enhanced tool dependencies removed (Phase 1.3) - Core implementations
// Simple core response handling without enhanced complexity
interface SimpleResponseFormatter {
  formatResponse(content: any): any;
  formatPromptEngineResponse(response: any, ...args: any[]): any; // Required
  formatErrorResponse(error: any, ...args: any[]): any; // Required
  setAnalyticsService(service: any): void; // Required
}

function createSimpleResponseFormatter(): SimpleResponseFormatter {
  return {
    formatResponse: (content: any) => content,
    formatPromptEngineResponse: (response: any, ...args: any[]) => {
      // Create proper ToolResponse with structuredContent using shared builder
      const executionContext = args[0] || {};
      const options = args[1] || {};

      return createExecutionResponse(
        String(response),
        "execute",
        {
          executionType: executionContext.executionType || "prompt",
          executionTime: executionContext.executionTime,
          frameworkUsed: executionContext.frameworkUsed,
          stepsExecuted: executionContext.stepsExecuted,
          sessionId: executionContext.sessionId,
          gateResults: executionContext.gateResults
        }
      );
    },
    formatErrorResponse: (error: any, ...args: any[]) => {
      return createExecutionResponse(
        String(error),
        "error",
        {
          executionType: "prompt",
          executionTime: 0,
          frameworkUsed: undefined,
          stepsExecuted: 0,
          sessionId: undefined
        }
      );
    },
    setAnalyticsService: (service: any) => {}, // No-op for now
  };
}

// Simple output schema (minimal for Phase 1)
const promptEngineOutputSchema = {
  content: { type: "array" },
  isError: { type: "boolean", optional: true },
};

// Type aliases for compatibility
type ResponseFormatter = SimpleResponseFormatter;
const createResponseFormatter = createSimpleResponseFormatter;
type FormatterExecutionContext = {
  [key: string]: any; // Completely flexible for Phase 1
};
// Analytics service
import { ExecutionData, MetricsCollector } from "../../../metrics/index.js";

/**
 * Prompt classification interface for execution strategy
 */
export interface PromptClassification {
  executionType: "prompt" | "template" | "chain";
  requiresExecution: boolean;
  confidence: number;
  reasoning: string[];
  suggestedGates: string[];
  framework?: string;
}

/**
 * Tool routing detection result interface
 */
interface ToolRoutingResult {
  requiresRouting: boolean;
  targetTool?: string;
  translatedParams?: Record<string, any>;
  originalCommand?: string;
}

/**
 * Consolidated Prompt Engine Tool
 */
export class ConsolidatedPromptEngine {
  private logger: Logger;
  private mcpServer: any;
  private promptManager: PromptManager;
  private configManager: ConfigManager;
  private semanticAnalyzer: ContentAnalyzer;
  private conversationManager: ConversationManager;
  private textReferenceManager: TextReferenceManager;
  private chainSessionManager: ChainSessionManager;
  private frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  // Legacy gate system removed - using only lightweightGateSystem
  // NEW: Lightweight gate system (Phase 2 integration)
  private lightweightGateSystem: LightweightGateSystem;
  // NEW: Role-based gate guidance renderer (Phase 3)
  private gateGuidanceRenderer: GateGuidanceRenderer;
  // Gate validation engine
  private engineValidator?: EngineValidator;
  // Phase 4: Clean architecture gate intelligence
  private gateSelectionEngine?: GateSelectionEngine;
  // Chain execution delegation
  private chainExecutor?: ChainExecutor;
  // REMOVED: chainOrchestrator - modular chain system removed
  // Chain URI addressing system
  // REMOVED: chainAddressingSystem - deprecated with markdown-embedded chains

  // MCP Tools Manager reference for analytics flow
  private mcpToolsManager?: any;

  // Analytics service for event-driven analytics collection
  private analyticsService?: MetricsCollector;

  // Response formatter for structured output
  private responseFormatter: ResponseFormatter;

  // New unified parsing system
  private parsingSystem: ParsingSystem;

  // Dynamic template discovery system
  // REMOVED: dynamicTemplateDiscovery - scaffolding system deprecated

  // Tool description manager
  private toolDescriptionManager?: ToolDescriptionManager;

  // Phase 3: Prompt guidance service
  private promptGuidanceService?: PromptGuidanceService;

  // Data references
  private promptsData: PromptData[] = [];
  private convertedPrompts: ConvertedPrompt[] = [];

  // Execution state tracking
  private currentExecutionState: ExecutionState | null = null;
  private executionHistory: ExecutionState[] = [];
  private chainProgressState: ChainExecutionProgress | null = null;

  constructor(
    logger: Logger,
    mcpServer: any,
    promptManager: PromptManager,
    configManager: ConfigManager,
    semanticAnalyzer: ContentAnalyzer,
    conversationManager: ConversationManager,
    textReferenceManager: TextReferenceManager,
    // Legacy gateEvaluationService parameter removed - using lightweight system only
    mcpToolsManager?: any
    // Phase 3: Removed executionCoordinator parameter - no longer needed
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.promptManager = promptManager;
    this.configManager = configManager;
    this.semanticAnalyzer = semanticAnalyzer;
    this.conversationManager = conversationManager;
    this.textReferenceManager = textReferenceManager;

    // Initialize chain session manager with both conversation and text reference managers
    this.chainSessionManager = createChainSessionManager(logger, conversationManager, textReferenceManager);

    // Legacy gate evaluation service assignment removed
    this.mcpToolsManager = mcpToolsManager;
    // Phase 3: Removed executionCoordinator assignment - using LLM-driven chain model

    // Initialize lightweight gate system (Phase 2 integration)
    const config = configManager.getConfig();
    const gatesConfig = config.gates;
    const gatesDirectory = gatesConfig?.definitionsDirectory
      ? path.join(process.cwd(), 'server', gatesConfig.definitionsDirectory)
      : undefined;
    this.lightweightGateSystem = createLightweightGateSystem(
      logger,
      gatesDirectory
    );

    // NEW: Initialize role-based gate guidance renderer (Phase 3)
    this.gateGuidanceRenderer = createGateGuidanceRenderer(logger, gatesDirectory);

    // Initialize EngineValidator with gate system (Phase 1.1 fix)
    this.engineValidator = new EngineValidator(this.lightweightGateSystem);

    // Phase 4: Initialize clean architecture gate intelligence
    this.gateSelectionEngine = createGateSelectionEngine(logger);

    // Note: Performance analytics now handled separately through system control
    // No need to connect gate selection engine to other components

    // Initialize new parsing system
    this.parsingSystem = createParsingSystem(logger);

    // Initialize dynamic template discovery
    // REMOVED: Dynamic template discovery initialization - scaffolding system deprecated

    // Initialize response formatter
    this.responseFormatter = createResponseFormatter();

    this.logger.info(
      "ConsolidatedPromptEngine initialized with new unified parsing system, dynamic template discovery, and response formatter"
    );
  }

  /**
   * Update data references
   */
  updateData(
    promptsData: PromptData[],
    convertedPrompts: ConvertedPrompt[]
  ): void {
    this.promptsData = promptsData;
    this.convertedPrompts = convertedPrompts;
  }

  /**
   * Set framework state manager (called after initialization)
   */
  setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void {
    this.frameworkStateManager = frameworkStateManager;
    this.initializeChainExecutor();
  }

  /**
   * Set framework manager (called after initialization)
   */
  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
    this.initializeChainExecutor();
    this.initializePromptGuidanceService();
  }

  /**
   * Initialize ChainExecutor once dependencies are available
   */
  private initializeChainExecutor(): void {
    if (this.frameworkManager && this.frameworkStateManager) {
      this.chainExecutor = new ChainExecutor(
        this.conversationManager,
        this.lightweightGateSystem,
        this.frameworkManager,
        this.frameworkStateManager,
        this.responseFormatter,
        this.chainSessionManager
      );
      this.logger.debug("ChainExecutor initialized successfully");
    }
  }

  /**
   * Initialize PromptGuidanceService once framework manager is available
   */
  private async initializePromptGuidanceService(): Promise<void> {
    if (this.frameworkManager && !this.promptGuidanceService) {
      try {
        this.promptGuidanceService = await createPromptGuidanceService(
          this.logger,
          {
            systemPromptInjection: {
              enabled: true,
              injectionMethod: 'smart',
              enableTemplateVariables: true,
              enableContextualEnhancement: true
            },
            templateEnhancement: {
              enabled: true,
              enhancementLevel: 'moderate',
              enableArgumentSuggestions: true,
              enableStructureOptimization: true
            },
            methodologyTracking: {
              enabled: true,
              persistStateToDisk: true,
              enableHealthMonitoring: true
            }
          },
          this.frameworkManager
        );
        this.logger.debug("PromptGuidanceService initialized successfully");
      } catch (error) {
        this.logger.warn("Failed to initialize PromptGuidanceService:", error);
        // Continue without guidance service - it's optional
      }
    }
  }

  /**
   * Set analytics service (called after initialization)
   */
  setAnalyticsService(analyticsService: MetricsCollector): void {
    this.analyticsService = analyticsService;
    this.responseFormatter.setAnalyticsService(analyticsService);
  }

  /**
   * Set tool description manager (called after initialization)
   */
  setToolDescriptionManager(manager: ToolDescriptionManager): void {
    this.toolDescriptionManager = manager;
  }

  /**
   * Get the prompts base path using ConfigManager for cross-platform compatibility
   */
  private getPromptsBasePath(): string {
    // Use environment variable override if available
    if (process.env.MCP_PROMPTS_PATH) {
      return process.env.MCP_PROMPTS_PATH;
    }

    // Use ConfigManager to get proper path resolution
    const promptsFilePath = this.configManager.getPromptsFilePath();
    // Get the directory containing the prompts config file
    return path.dirname(promptsFilePath);
  }

  // REMOVED: setChainOrchestrator method - modular chain system removed

  /**
   * Get lightweight gate system for external access
   */
  getLightweightGateSystem(): LightweightGateSystem {
    return this.lightweightGateSystem;
  }

  /**
   * Get framework-enhanced system prompt injection
   */
  private async getFrameworkExecutionContext(
    prompt: ConvertedPrompt
  ): Promise<FrameworkExecutionContext | null> {
    this.logger.debug(`[ENGINE DEBUG] getFrameworkExecutionContext called for prompt: ${prompt.id}`);

    if (!this.frameworkManager || !this.frameworkStateManager) {
      this.logger.debug(`[ENGINE DEBUG] Missing dependencies - frameworkManager: ${!!this.frameworkManager}, frameworkStateManager: ${!!this.frameworkStateManager}`);
      return null;
    }

    // NEW: Check if framework system is enabled before generating context
    const isEnabled = this.frameworkStateManager.isFrameworkSystemEnabled();
    this.logger.debug(`[ENGINE DEBUG] Framework system enabled: ${isEnabled}`);
    if (!isEnabled) {
      return null;
    }

    try {
      // Get current active framework from state manager
      const activeFramework = this.frameworkStateManager.getActiveFramework();
      this.logger.debug(`[ENGINE DEBUG] Active framework:`, {
        methodology: activeFramework.methodology,
        name: activeFramework.name
      });

      // Generate execution context using the framework manager
      const context = this.frameworkManager.generateExecutionContext(prompt, {
        userPreference: activeFramework.methodology as any,
      });

      this.logger.debug(`[ENGINE DEBUG] Generated execution context:`, {
        hasContext: !!context,
        contextType: context ? typeof context : 'null',
        hasSystemPrompt: context?.systemPrompt ? true : false,
        systemPromptLength: context?.systemPrompt?.length || 0
      });

      return context;
    } catch (error) {
      this.logger.warn(
        "Failed to generate framework execution context:",
        error
      );
      return null;
    }
  }


  /**
   * Main prompt execution handler
   */
  public async executePromptCommand(
    args: {
      command: string;
      execution_mode?: "auto" | "prompt" | "template" | "chain";
      force_restart?: boolean;
      session_id?: string;
      options?: Record<string, any>;
    },
    extra: any
  ): Promise<ToolResponse> {
    const { command, execution_mode = "auto", options = {} } = args;

    this.logger.info(
      `🚀 [ENTRY] Prompt Engine: Executing "${command}" (mode: ${execution_mode})`
    );

    // Phase 1: Check if command should be routed to a different tool
    const routingResult = await this.detectToolRoutingCommand(command);
    this.logger.info(`🔍 [ROUTING DEBUG] Tool routing check:`, {
      command,
      requiresRouting: routingResult.requiresRouting,
      targetTool: routingResult.targetTool
    });

    if (routingResult.requiresRouting) {
      this.logger.info(`🔀 [ROUTING DEBUG] Command being routed to different tool: ${routingResult.targetTool}`);
      const routedResult = await this.routeToTool(
        routingResult.targetTool!,
        routingResult.translatedParams!,
        routingResult.originalCommand!
      );
      // TEMP DEBUG: Add routing debug to response
      if (routedResult.content && routedResult.content[0]) {
        routedResult.content[0].text = `\n\n--- ROUTING DEBUG ---\n🔀 Command routed to tool: ${routingResult.targetTool}\n--- END DEBUG ---\n\n` + routedResult.content[0].text;
      }
      return routedResult;
    }

    // Parse command and extract execution context
    const executionContext = await this.parseAndPrepareExecution(command);

    // Handle chain management commands
    if (executionContext.isChainManagement && this.chainExecutor) {
      return await this.chainExecutor.executeChainManagement(
        executionContext.chainAction!,
        executionContext.chainParameters || {},
        options
      );
    }

    // Determine execution strategy
    const strategy = await this.determineExecutionStrategy(
      executionContext.convertedPrompt,
      execution_mode
    );

    // Initialize execution state with session tracking
    this.initializeExecutionState(executionContext.convertedPrompt, strategy, args.session_id);

    // Execute using determined strategy
    return await this.executeWithStrategy(strategy, executionContext, args);
  }

  /**
   * Parse command and prepare execution context
   */
  private async parseAndPrepareExecution(command: string) {
    const {
      promptId,
      arguments: promptArgs,
      convertedPrompt,
      isChainManagement,
      chainAction,
      chainParameters,
    } = await this.parseCommandUnified(command);

    // TEMP DISABLE: Apply prompt guidance if available and not a chain management command
    let enhancedPrompt = convertedPrompt;
    let guidanceResult: ServicePromptGuidanceResult | undefined;

    // TEMP DISABLE: Disable entire PromptGuidanceService to eliminate framework duplication
    // if (!isChainManagement && this.promptGuidanceService && convertedPrompt) {
    //   try {
    //     guidanceResult = await this.promptGuidanceService.applyGuidance(convertedPrompt, {
    //       includeSystemPromptInjection: false,  // FIXED: Disable to prevent duplication with Engine framework context
    //       includeTemplateEnhancement: false     // FIXED: Disabled since template enhancer was also causing duplication
    //     });

    //     if (guidanceResult.guidanceApplied && guidanceResult.enhancedPrompt) {
    //       enhancedPrompt = guidanceResult.enhancedPrompt;
    //       this.logger.debug(`Prompt guidance applied: ${guidanceResult.metadata.enhancementsApplied.join(', ')}`);
    //     }
    //   } catch (error) {
    //     this.logger.warn("Prompt guidance failed, continuing with original prompt:", error);
    //   }
    // }

    return {
      promptId,
      promptArgs,
      convertedPrompt: enhancedPrompt,
      originalPrompt: convertedPrompt,
      guidanceResult,
      isChainManagement,
      chainAction,
      chainParameters,
    };
  }

  /**
   * Determine the execution strategy based on mode and prompt type
   */
  private async determineExecutionStrategy(
    convertedPrompt: any,
    execution_mode: string
  ): Promise<{
    mode: "prompt" | "template" | "chain";
    gateValidation: boolean;
  }> {
    let effectiveExecutionMode: "prompt" | "template" | "chain";

    if (!execution_mode || execution_mode === "auto") {
      const detectedMode = await this.detectExecutionMode(convertedPrompt);
      effectiveExecutionMode = detectedMode as "prompt" | "template" | "chain";
    } else {
      effectiveExecutionMode = execution_mode as
        | "prompt"
        | "template"
        | "chain";
    }

    const effectiveGateValidation = effectiveExecutionMode === "chain";

    this.logger.info(
      `🔍 EXECUTION MODE DEBUG: Effective settings: mode=${effectiveExecutionMode}, gates=${effectiveGateValidation}, prompt=${convertedPrompt.id}`
    );

    return {
      mode: effectiveExecutionMode,
      gateValidation: effectiveGateValidation,
    };
  }

  /**
   * Initialize execution state tracking with session support
   */
  private initializeExecutionState(
    convertedPrompt: any,
    strategy: { mode: string; gateValidation: boolean },
    sessionId?: string
  ) {
    this.currentExecutionState = {
      type: isChainPrompt(convertedPrompt) ? "chain" : "single",
      promptId: convertedPrompt.id,
      status: "pending",
      gates: [],
      results: {},
      metadata: {
        startTime: Date.now(),
        executionMode: strategy.mode as "prompt" | "template" | "chain",
        gateValidation: strategy.gateValidation,
        sessionId, // Store session ID for step result capture
      },
    };
  }

  /**
   * Execute using the determined strategy
   */
  private async executeWithStrategy(
    strategy: {
      mode: "prompt" | "template" | "chain";
      gateValidation: boolean;
    },
    context: any,
    args: any
  ): Promise<ToolResponse> {
    const { convertedPrompt, promptArgs } = context;

    switch (strategy.mode) {
      case "prompt":
        this.logger.info(
          `📍 EXECUTION PATH: Taking PROMPT path for ${convertedPrompt.id}`
        );
        // TEMP DEBUG: Inject debug into response to identify execution path
        const promptResult = await this.executePrompt(convertedPrompt, promptArgs);
        // Add debug marker to response content
        if (promptResult.content && promptResult.content[0]) {
          promptResult.content[0].text = `\n\n--- EXECUTION PATH DEBUG ---\n📍 Taking PROMPT path for ${convertedPrompt.id}\n--- END DEBUG ---\n\n` + promptResult.content[0].text;
        }
        return promptResult;

      case "template":
        this.logger.info(
          `📍 EXECUTION PATH: Taking TEMPLATE path for ${convertedPrompt.id}`
        );
        // TEMP DEBUG: Inject debug into response to identify execution path
        const templateResult = await this.executeTemplateWithFramework(
          convertedPrompt,
          promptArgs,
          strategy.gateValidation
        );
        // Add debug marker to response content
        if (templateResult.content && templateResult.content[0]) {
          templateResult.content[0].text = `\n\n--- EXECUTION PATH DEBUG ---\n📍 Taking TEMPLATE path for ${convertedPrompt.id}\n--- END DEBUG ---\n\n` + templateResult.content[0].text;
        }
        return templateResult;

      case "chain":
        this.logger.info(
          `📍 EXECUTION PATH: Taking CHAIN path for ${convertedPrompt.id}`
        );
        if (!this.chainExecutor) {
          return this.responseFormatter.formatErrorResponse(
            'ChainExecutor not initialized - framework managers required',
            'ConsolidatedPromptEngine',
            'executePromptCommand'
          );
        }

        // Ensure chain session exists
        const chainSessionId = await this.ensureChainSession(
          convertedPrompt,
          args.session_id,
          args.force_restart,
          promptArgs
        );

        return await this.chainExecutor.executeChainWithDualSupport(
          convertedPrompt,
          promptArgs,
          strategy.gateValidation,
          {
            enableGates: strategy.gateValidation,
            force_restart: args.force_restart,
            session_id: chainSessionId,
            ...args.options
          }
        );

      default:
        throw new ValidationError(`Unknown execution mode: ${strategy.mode}`);
    }
  }

  /**
   * Phase 1: Chain Management Command Detection
   */

  // REMOVED: detectChainManagementCommand - migrated to ChainExecutor

  // REMOVED: parseKeyValueParams - migrated to ChainExecutor

  // REMOVED: handleChainManagementCommand - migrated to ChainExecutor

  /**
   * Detect if command should be routed to a different tool
   */
  private async detectToolRoutingCommand(command: string): Promise<ToolRoutingResult> {
    const trimmedCommand = command.trim();

    // Built-in commands that route to prompt_manager
    if (/^(>>|\/)?listprompts?(\s.*)?$/i.test(trimmedCommand)) {
      const args = trimmedCommand.replace(/^(>>|\/)?listprompts?\s*/i, '').trim();
      return {
        requiresRouting: true,
        targetTool: 'prompt_manager',
        translatedParams: {
          action: 'list',
          ...(args && { search_query: args })
        },
        originalCommand: command
      };
    }

    // Help and status commands that route to system_control
    if (/^(>>|\/)?help$/i.test(trimmedCommand)) {
      return {
        requiresRouting: true,
        targetTool: 'system_control',
        translatedParams: {
          action: 'status',
          show_details: true
        },
        originalCommand: command
      };
    }

    if (/^(>>|\/)?status$/i.test(trimmedCommand)) {
      return {
        requiresRouting: true,
        targetTool: 'system_control',
        translatedParams: {
          action: 'status'
        },
        originalCommand: command
      };
    }

    // Framework switch commands
    const frameworkMatch = trimmedCommand.match(/^(>>|\/)?framework\s+(switch|change)\s+(.+)$/i);
    if (frameworkMatch) {
      return {
        requiresRouting: true,
        targetTool: 'system_control',
        translatedParams: {
          action: 'framework',
          operation: 'switch',
          framework: frameworkMatch[3].trim()
        },
        originalCommand: command
      };
    }

    // Analytics/metrics commands
    if (/^(>>|\/)?analytics?$/i.test(trimmedCommand)) {
      return {
        requiresRouting: true,
        targetTool: 'system_control',
        translatedParams: {
          action: 'analytics'
        },
        originalCommand: command
      };
    }

    // No routing needed - let existing parser handle it
    return {
      requiresRouting: false
    };
  }

  /**
   * Route command to appropriate tool with safe error handling
   */
  private async routeToTool(targetTool: string, params: Record<string, any>, originalCommand: string): Promise<ToolResponse> {
    this.logger.info(`🔀 Routing command "${originalCommand}" to ${targetTool}`);

    try {
      switch (targetTool) {
        case 'prompt_manager':
          if (this.mcpToolsManager?.promptManagerTool) {
            this.logger.debug(`Calling prompt_manager with params:`, params);
            return await this.mcpToolsManager.promptManagerTool.handleAction(params, {});
          } else {
            throw new Error('Prompt manager tool not available');
          }

        case 'system_control':
          if (this.mcpToolsManager?.systemControl) {
            this.logger.debug(`Calling system_control with params:`, params);
            return await this.mcpToolsManager.systemControl.handleAction(params, {});
          } else {
            throw new Error('System control tool not available');
          }

        default:
          throw new Error(`Unknown target tool: ${targetTool}`);
      }
    } catch (error) {
      this.logger.error(`Tool routing failed for ${targetTool}:`, error);

      // Return formatted error response
      return this.responseFormatter.formatErrorResponse(
        error instanceof Error
          ? `Tool routing failed: ${error.message}`
          : `Tool routing failed: ${String(error)}`,
        {
          tool: 'prompt_engine',
          operation: 'routeToTool',
          targetTool,
          originalCommand
        },
        {
          includeStructuredData: true
        }
      );
    }
  }

  /**
   * Parse command string using unified parsing system with chain management detection
   */
  private async parseCommandUnified(command: string): Promise<{
    promptId: string;
    arguments: Record<string, any>;
    convertedPrompt: ConvertedPrompt;
    isChainManagement?: boolean;
    chainAction?: string;
    chainParameters?: Record<string, any>;
  }> {
    // Phase 1: Smart chain management command detection
    if (this.chainExecutor) {
      const chainCommand = this.chainExecutor.detectChainManagementCommand(command);
      if (chainCommand.isChainManagement) {
        // Mark this as a chain management operation
        return {
          promptId: '',
          arguments: {},
          convertedPrompt: {} as ConvertedPrompt,
          isChainManagement: true,
          chainAction: chainCommand.action!,
          chainParameters: chainCommand.parameters!
        };
      }
    }
    // Use new unified command parser
    const parseResult = await this.parsingSystem.commandParser.parseCommand(
      command,
      this.promptsData
    );

    // Find the matching prompt data and converted prompt
    const promptData = this.promptsData.find(
      (p) => p.id === parseResult.promptId || p.name === parseResult.promptId
    );
    if (!promptData) {
      throw new PromptError(
        `Unknown prompt: ${parseResult.promptId}. Use >>listprompts to see available prompts.`
      );
    }

    const convertedPrompt = this.convertedPrompts.find(
      (p) => p.id === promptData.id
    );
    if (!convertedPrompt) {
      throw new PromptError(
        `Converted prompt data not found for: ${parseResult.promptId}`
      );
    }

    // Process arguments using new argument processor
    const context: ExecutionContext = {
      conversationHistory: [], // Would be injected from conversation manager
      environmentVars: process.env as Record<string, string>,
      promptDefaults: {},
      systemContext: {},
    };

    const argResult = await this.parsingSystem.argumentParser.parseArguments(
      parseResult.rawArgs,
      promptData,
      context
    );

    // Log parsing details for monitoring
    this.logger.debug(`Command parsed successfully:`, {
      strategy: parseResult.metadata.parseStrategy,
      confidence: parseResult.confidence,
      argumentsProcessed: Object.keys(argResult.processedArgs).length,
      appliedDefaults: argResult.metadata.appliedDefaults.length,
      warnings: [
        ...parseResult.metadata.warnings,
        ...argResult.metadata.warnings,
      ],
    });

    return {
      promptId: promptData.id,
      arguments: argResult.processedArgs, // Pass typed arguments directly
      convertedPrompt,
    };
  }

  /**
   * Detect execution mode using semantic analysis - THREE-TIER MODEL
   * Returns appropriate execution strategy based on prompt characteristics
   */
  private async detectExecutionMode(
    convertedPrompt: ConvertedPrompt
  ): Promise<"prompt" | "template" | "chain"> {
    if (convertedPrompt.executionMode) {
      return convertedPrompt.executionMode;
    }

    const classification = await this.analyzePrompt(convertedPrompt);
    this.autoAssignQualityGates(convertedPrompt, classification);

    this.logger.debug(
      `Semantic analysis: ${classification.executionType} (${Math.round(
        classification.confidence * 100
      )}%)`
    );

    // Return the semantic analysis result directly - it now handles the three-tier distinction
    return classification.executionType;
  }

  /**
   * Create fallback analysis when semantic analysis is disabled
   */
  private createDisabledAnalysisFallback(
    prompt: ConvertedPrompt
  ): PromptClassification {
    const hasChainSteps = Boolean(prompt.chainSteps?.length);
    const argCount = prompt.arguments?.length || 0;
    const hasTemplateVars = /\{\{.*?\}\}/g.test(
      prompt.userMessageTemplate || ""
    );

    // Reliable structural detection: only use verifiable indicators
    const hasComplexTemplateLogic =
      /\{\{.*?\|.*?\}\}|\{%-.*?-%\}|\{%.*?if.*?%\}|\{%.*?for.*?%\}/g.test(
        prompt.userMessageTemplate || ""
      );
    const hasMultipleArgs = argCount > 1; // More than one argument suggests complexity

    // Three-tier detection based on structural indicators only
    let executionType: "prompt" | "template" | "chain" = "prompt";

    if (hasChainSteps) {
      executionType = "chain";
    } else if (hasComplexTemplateLogic) {
      // Complex Nunjucks logic always needs template mode
      executionType = "template";
    } else if (hasTemplateVars && hasMultipleArgs) {
      // Template variables with multiple args suggests framework benefit
      executionType = "template";
    }
    // Default to 'prompt' for simple cases (no vars, single arg, or static content)

    return {
      executionType,
      requiresExecution: true,
      confidence: 0.9, // High confidence in structural detection
      reasoning: [
        "Structural auto detection (semantic analysis disabled)",
        `Args: ${argCount}, Template vars: ${hasTemplateVars}, Complex logic: ${hasComplexTemplateLogic}`,
        `Selected ${executionType} mode based on verifiable structural indicators`,
      ],
      suggestedGates: ["basic_validation"],
      framework: "disabled",
    };
  }

  /**
   * Detect analysis intent using LLM semantic understanding (FUTURE IMPLEMENTATION)
   *
   * This method will be implemented when the LLM semantic layer is completed.
   * It will provide intelligent analysis intent detection by examining:
   * - Template content and complexity
   * - Argument semantics and naming patterns
   * - Task complexity indicators
   * - Context and domain-specific signals
   *
   * @param prompt - The prompt to analyze for analysis intent
   * @returns Promise<boolean> - True if prompt requires analytical framework processing
   *
   * @todo Implement when ContentAnalyzer LLM integration is enabled
   * @todo Design proper interface for semantic intent classification
   * @todo Add confidence scoring and reasoning for intent decisions
   */
  private async detectAnalysisIntentLLM(
    prompt: ConvertedPrompt
  ): Promise<boolean> {
    // STUB: Always return false until LLM semantic analysis is implemented
    // When implemented, this will use the LLM to intelligently detect:
    // - Analysis vs formatting tasks
    // - Complex reasoning requirements
    // - Domain-specific analytical patterns
    // - Context-dependent intent signals

    this.logger.debug(
      `LLM analysis intent detection not yet implemented for ${prompt.id}`
    );
    return false;
  }

  /**
   * Analyze prompt for execution strategy (configuration-aware)
   */
  private async analyzePrompt(
    prompt: ConvertedPrompt
  ): Promise<PromptClassification> {
    // Check if semantic analysis is enabled via the analyzer's config
    const analysisConfig = this.semanticAnalyzer.getConfig();

    if (!analysisConfig.llmIntegration.enabled) {
      this.logger.debug(
        `Semantic analysis disabled for ${prompt.id} - using structural fallback`
      );
      return this.createDisabledAnalysisFallback(prompt);
    }

    try {
      const analysis = await this.semanticAnalyzer.analyzePrompt(prompt);
      return {
        executionType: analysis.executionType,
        requiresExecution: analysis.requiresExecution,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        suggestedGates: analysis.suggestedGates,
        framework: "semantic",
      };
    } catch (error) {
      this.logger.error(`Semantic analysis failed for ${prompt.id}:`, error);
      return {
        executionType: isChainPrompt(prompt) ? "chain" : "template",
        requiresExecution: true,
        confidence: 0.5,
        reasoning: [`Fallback analysis: ${error}`],
        suggestedGates: ["execution_validation"],
        framework: "fallback",
      };
    }
  }

  /**
   * Auto-assign quality gates based on classification
   */
  private autoAssignQualityGates(
    prompt: ConvertedPrompt,
    classification: PromptClassification
  ): void {
    const autoGates: GateDefinition[] = [];

    if (classification.requiresExecution && classification.confidence > 0.5) {
      autoGates.push({
        id: "content_length_validation",
        name: "Content Length Validation",
        type: "validation",
        requirements: [
          {
            type: "content_length",
            criteria: { min: 50 },
            required: true,
          },
        ],
        failureAction: "retry",
      });
    }

    if (autoGates.length > 0) {
      (prompt as any).autoAssignedGates = autoGates;
      this.logger.debug(
        `Auto-assigned ${autoGates.length} gates for ${prompt.id}`
      );
    }
  }

  /**
   * NEW: Execute basic prompt with simple variable substitution (fastest)
   * No framework processing, minimal overhead
   */
  private async executePrompt(
    prompt: ConvertedPrompt,
    args: Record<string, string>
  ): Promise<ToolResponse> {
    if (!this.currentExecutionState) {
      throw new PromptError("No execution state available");
    }

    this.currentExecutionState.status = "running";

    // Simple template processing without framework enhancement
    let content = prompt.userMessageTemplate;
    if (prompt.systemMessage) {
      content = `[System: ${prompt.systemMessage}]\n\n${content}`;
    }

    // Phase 4: Enhanced args without gate injection (gates now appended at end)
    const enhancedArgs = args;

    // Phase 3: Inject session context for step result interpolation
    const sessionEnhancedArgs = await this.injectSessionContext(enhancedArgs);

    // Fast variable substitution using modern template processor
    content = processTemplate(content, sessionEnhancedArgs, {});

    // Phase 4: Enhanced gate validation for basic prompts (only when framework system is enabled)
    let gateResults: GateValidationResult | null = null;
    const frameworkEnabled = this.frameworkStateManager?.isFrameworkSystemEnabled();
    this.logger.info(`🔍 [DEBUG] Framework system enabled: ${frameworkEnabled}`);

    if (frameworkEnabled) {
      const gateValidation = await this.validateContentWithGates(prompt, content, sessionEnhancedArgs, 'prompt');
      gateResults = gateValidation.validation;
      this.logger.info(`🔍 [DEBUG] Gate validation result:`, {
        hasGateResults: !!gateResults,
        gateResultsType: typeof gateResults,
        gateResultsValue: gateResults
      });

      if (gateResults && !gateResults.passed) {
        this.logger.debug(`Basic prompt gate validation failed for ${prompt.id}:`, gateResults.results);
        // For basic prompts, we just log and continue
      } else if (gateResults && gateResults.passed) {
        this.logger.debug(`Basic prompt gate validation passed for ${prompt.id}`);
      }
    }

    // Update state and analytics
    this.currentExecutionState.status = "completed";
    this.currentExecutionState.metadata.endTime = Date.now();
    // Store gate results in execution state for analytics
    if (gateResults) {
      (this.currentExecutionState.metadata as any).gateResults = gateResults;
    }

    // Capture step result if this is part of a chain session
    await this.captureStepResult(content, prompt);

    this.recordExecutionAnalytics();

    // Create execution context for response formatter
    const executionId = `exec_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const activeFramework =
      this.frameworkStateManager?.getActiveFramework()?.name;
    const frameworkEnabledForContext =
      this.frameworkStateManager?.isFrameworkSystemEnabled() || false;

    const executionContext: FormatterExecutionContext = {
      executionId,
      executionType: "prompt",
      startTime: this.currentExecutionState.metadata.startTime,
      endTime: this.currentExecutionState.metadata.endTime || Date.now(),
      frameworkUsed: activeFramework,
      frameworkEnabled: frameworkEnabledForContext,
      success: true,
    };

    // FIXED: Add supplemental gate guidance for prompt mode (same as template mode)
    let enhancedContent = content;
    this.logger.info(`🔍 [DEBUG] Gate conditional logic:`, {
      hasGateResults: !!gateResults,
      gateResultsValue: gateResults,
      willExecuteIfBranch: !!gateResults,
      willExecuteElseBranch: !gateResults
    });

    if (gateResults) {
      this.logger.info(`🔀 [DEBUG] Taking IF branch (gateResults exists)`);

      // TEMP DEBUG: Inject debug info into content
      const debugInfo = `\n\n--- DEBUG INFO ---\n🔀 IF branch executed - gateResults exists: ${JSON.stringify(gateResults)}\n--- END DEBUG ---\n\n`;
      enhancedContent = content + debugInfo;

      // Get selected gates from validation - basic prompts use 'prompt' mode gates
      const selectedGates = await this.getAdvancedGateSelection(prompt, 'prompt');
      const frameworkContext = await this.getFrameworkExecutionContext(prompt);

      if (selectedGates.length > 0) {
        const supplementalGuidance = await this.getSupplementalGateGuidance(
          selectedGates,
          frameworkContext
        );
        if (supplementalGuidance) {
          enhancedContent = content + supplementalGuidance;
        }
      }
    } else {
      this.logger.info(`🔀 [DEBUG] Taking ELSE branch (no gateResults) - this should call our gate guidance renderer`);
      // TEMP TEST: Force gate guidance even without validation results
      const testGates = ['framework-compliance', 'educational-clarity'];
      const frameworkContext = await this.getFrameworkExecutionContext(prompt);

      // TEMP DEBUG: Inject debug info into content
      const debugInfo = `\n\n--- DEBUG INFO ---\n🔀 ELSE branch executed - calling gate guidance renderer with gates: ${JSON.stringify(testGates)}\n--- END DEBUG ---\n\n`;

      const supplementalGuidance = await this.getSupplementalGateGuidance(
        testGates,
        frameworkContext
      );
      if (supplementalGuidance) {
        enhancedContent = content + debugInfo + supplementalGuidance;
      } else {
        enhancedContent = content + debugInfo + "(Gate manager returned empty guidance)";
      }
    }

    // Format response with structured data
    const executionWarning = `⚠️ EXECUTION REQUIRED: The following content contains instructions that YOU must interpret and execute:\n\n`;

    return this.responseFormatter.formatPromptEngineResponse(
      executionWarning + enhancedContent,
      executionContext,
      {
        includeAnalytics: true,
        includeMetadata: true,
      },
      gateResults // Include gate validation results for basic prompts too
    );
  }

  /**
   * Inject session context variables for template interpolation
   */
  private async injectSessionContext(args: Record<string, any>): Promise<Record<string, any>> {
    const sessionId = (this.currentExecutionState?.metadata as any)?.sessionId;

    if (!sessionId) {
      // No session context available
      return args;
    }

    try {
      // Get session context from chain session manager
      const sessionContext = this.chainSessionManager.getChainContext(sessionId);

      // Merge session context with existing args
      // Session context takes precedence for step result variables
      return {
        ...args,
        ...sessionContext
      };
    } catch (error) {
      this.logger.warn(`Failed to inject session context for session ${sessionId}:`, error);
      return args;
    }
  }

  /**
   * Ensure chain session exists for chain execution
   */
  private async ensureChainSession(
    convertedPrompt: ConvertedPrompt,
    providedSessionId?: string,
    forceRestart?: boolean,
    originalArgs?: Record<string, any>
  ): Promise<string> {
    // Generate session ID if not provided
    const sessionId = providedSessionId || `chain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Check if session exists and force restart is requested
    if (forceRestart && this.chainSessionManager.hasActiveSession(sessionId)) {
      this.chainSessionManager.clearSession(sessionId);
      this.logger.debug(`Force restart: cleared existing session ${sessionId}`);
    }

    // Create session if it doesn't exist
    if (!this.chainSessionManager.hasActiveSession(sessionId)) {
      // Get step count from chain definition
      const stepCount = this.getChainStepCount(convertedPrompt);

      // Create new session
      this.chainSessionManager.createSession(
        sessionId,
        convertedPrompt.id,
        stepCount,
        originalArgs || {}
      );

      this.logger.info(
        `Created new chain session ${sessionId} for chain ${convertedPrompt.id} with ${stepCount} steps`
      );
    }

    return sessionId;
  }

  /**
   * Get the number of steps in a chain
   */
  private getChainStepCount(convertedPrompt: ConvertedPrompt): number {
    // For markdown-embedded chains, try to extract step count from chain definition
    if (convertedPrompt.chainSteps) {
      return convertedPrompt.chainSteps.length;
    }

    // Fallback: try to parse from userMessageTemplate
    if (convertedPrompt.userMessageTemplate) {
      const stepMatches = convertedPrompt.userMessageTemplate.match(/## Step \d+|### Step \d+/g);
      if (stepMatches) {
        return stepMatches.length;
      }
    }

    // Default to 1 if we can't determine step count
    this.logger.warn(`Could not determine step count for chain ${convertedPrompt.id}, defaulting to 1`);
    return 1;
  }

  /**
   * Capture step result for chain session management
   */
  private async captureStepResult(content: string, prompt: ConvertedPrompt): Promise<void> {
    const sessionId = (this.currentExecutionState?.metadata as any)?.sessionId;

    if (!sessionId) {
      // No session ID, this is not part of a chain execution
      return;
    }

    // Check if this session exists and should capture results
    if (!this.chainSessionManager.hasActiveSession(sessionId)) {
      this.logger.debug(`Session ${sessionId} not found or inactive, skipping result capture`);
      return;
    }

    try {
      // Get current session state to determine step number
      const session = this.chainSessionManager.getSession(sessionId);
      if (!session) {
        this.logger.warn(`Session ${sessionId} not found during result capture`);
        return;
      }

      // For LLM-driven chains, we need to determine the step number
      // This implementation assumes the step number is derived from current state
      const currentStepNumber = session.state.currentStep;

      // Store the step result
      const stepMetadata = {
        promptId: prompt.id,
        executionTime: Date.now() - (this.currentExecutionState?.metadata?.startTime || Date.now()),
        contentLength: content.length,
        timestamp: Date.now()
      };

      this.chainSessionManager.updateSessionState(
        sessionId,
        currentStepNumber,
        content,
        stepMetadata
      );

      this.logger.debug(
        `Captured step ${currentStepNumber} result for session ${sessionId} (${content.length} chars)`
      );
    } catch (error) {
      this.logger.error(`Failed to capture step result for session ${sessionId}:`, error);
    }
  }

  /**
   * Execute template with full framework processing and gates
   */
  private async executeTemplateWithFramework(
    prompt: ConvertedPrompt,
    args: Record<string, string>,
    enableGates: boolean
  ): Promise<ToolResponse> {
    if (!this.currentExecutionState) {
      throw new PromptError("No execution state available");
    }

    this.currentExecutionState.status = "running";

    // Process template with framework-enhanced system prompt injection
    let content = prompt.userMessageTemplate;

    // FIXED: Get framework execution context for enhanced system prompt
    const frameworkContext = await this.getFrameworkExecutionContext(prompt);
    this.logger.debug(`[ENGINE DEBUG] Framework context result:`, {
      hasFrameworkContext: !!frameworkContext,
      frameworkContextType: frameworkContext ? typeof frameworkContext : 'null',
      hasSystemPrompt: frameworkContext?.systemPrompt ? true : false,
      systemPromptLength: frameworkContext?.systemPrompt?.length || 0
    });

    if (prompt.systemMessage || frameworkContext) {
      let systemPrompt = prompt.systemMessage || "";

      // FIXED: Enhance with framework-specific system prompt if available
      if (frameworkContext) {
        const frameworkSystemPrompt = frameworkContext.systemPrompt;
        this.logger.debug(`[ENGINE DEBUG] Framework system prompt:`, {
          hasFrameworkSystemPrompt: !!frameworkSystemPrompt,
          frameworkSystemPromptLength: frameworkSystemPrompt?.length || 0,
          frameworkSystemPromptPreview: frameworkSystemPrompt?.substring(0, 100) + '...'
        });
        if (frameworkSystemPrompt) {
          systemPrompt = systemPrompt
            ? `${frameworkSystemPrompt}\n\n${systemPrompt}`
            : frameworkSystemPrompt;
        }
      }

      if (systemPrompt) {
        content = `[System: ${systemPrompt}]\n\n${content}`;
      }
    }

    // Phase 4: Enhanced args without gate injection (gates now appended at end)
    const enhancedArgs = args;

    // Template processing with special context and optional tools
    const specialContext: Record<string, string> = {
      previous_message: "{{previous_message}}",
    };
    if (prompt.tools) {
      specialContext["tools_available"] = getAvailableTools();
    }

    // Inject session context for step result interpolation
    const sessionEnhancedArgs = await this.injectSessionContext(enhancedArgs);

    content = processTemplate(content, sessionEnhancedArgs, specialContext);

    // Phase 1.2: Post-execution gate validation with retry logic (only for template mode when gates are enabled)
    let gateResults: GateValidationResult | null = null;
    let selectedGates: string[] = [];
    let retryAttempt = 0;
    const maxRetries = 2; // Allow up to 2 retries for template mode

    if (enableGates) {
      do {
        const gateValidation = await this.validateContentWithGates(prompt, content, sessionEnhancedArgs, 'template');
        gateResults = gateValidation.validation;
        selectedGates = gateValidation.selectedGates;

        if (gateResults && !gateResults.passed && retryAttempt < maxRetries) {
          retryAttempt++;
          this.logger.warn(`Gate validation failed for ${prompt.id} (attempt ${retryAttempt}):`, gateResults.results);

          // Get retry hints from failed gates
          const retryHints = this.getRetryHintsFromValidation(gateResults);
          if (retryHints.length > 0) {
            this.logger.debug(`Applying retry hints: ${retryHints.join(', ')}`);

            // Enhance args with retry hints for content regeneration
            const retryEnhancedArgs = {
              ...sessionEnhancedArgs,
              retry_hints: retryHints.join('\n'),
              previous_attempt: content.substring(0, 200) + '...',
              improvement_focus: this.getImprovementFocus(gateResults)
            };

            // Regenerate content with improvement hints
            content = processTemplate(prompt.userMessageTemplate, retryEnhancedArgs, specialContext);
            this.logger.debug(`Content regenerated for retry attempt ${retryAttempt}`);
          } else {
            // No actionable hints available, break retry loop
            this.logger.debug(`No actionable retry hints available, accepting current result`);
            break;
          }
        } else if (gateResults && gateResults.passed) {
          this.logger.debug(`Gate validation passed for ${prompt.id}` + (retryAttempt > 0 ? ` after ${retryAttempt} retries` : ''));
          break;
        } else {
          // Max retries reached
          if (retryAttempt >= maxRetries) {
            this.logger.warn(`Max retries (${maxRetries}) reached for ${prompt.id}, proceeding with current content`);
          }
          break;
        }
      } while (retryAttempt <= maxRetries);
    }

    // Update state and analytics
    this.currentExecutionState.status = "completed";
    this.currentExecutionState.metadata.endTime = Date.now();
    // Store gate results in execution state for analytics
    if (gateResults) {
      (this.currentExecutionState.metadata as any).gateResults = gateResults;
    }
    this.recordExecutionAnalytics();

    // Create execution context for response formatter
    const executionId = `exec_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const activeFramework =
      this.frameworkStateManager?.getActiveFramework()?.name;
    const frameworkEnabledForContext =
      this.frameworkStateManager?.isFrameworkSystemEnabled() || false;

    const executionContext: FormatterExecutionContext = {
      executionId,
      executionType: "template",
      startTime: this.currentExecutionState.metadata.startTime,
      endTime: this.currentExecutionState.metadata.endTime || Date.now(),
      frameworkUsed: activeFramework,
      frameworkEnabled: frameworkEnabledForContext,
      success: true,
    };

    // Phase 4: Append supplemental gate guidance to content
    let enhancedContent = content;

    // TEMP DEBUG: Add debug injection to template method
    const templateDebugInfo = `\n\n--- TEMPLATE DEBUG ---\nTemplate method gate logic: gateResults=${!!gateResults}, selectedGates=${selectedGates.length}\n--- END DEBUG ---\n\n`;
    enhancedContent = content + templateDebugInfo;

    if (gateResults && selectedGates.length > 0) {
      enhancedContent = enhancedContent + `\n--- TEMPLATE IF BRANCH ---\nUsing validation gates\n--- END ---\n`;
      const supplementalGuidance = await this.getSupplementalGateGuidance(
        selectedGates,
        frameworkContext
      );
      if (supplementalGuidance) {
        enhancedContent = content + supplementalGuidance;
      }
    } else {
      enhancedContent = enhancedContent + `\n--- TEMPLATE ELSE BRANCH ---\nForcing test gates\n--- END ---\n`;
      // TEMP TEST: Force gate guidance even without validation results (same as executePrompt)
      const testGates = ['framework-compliance', 'educational-clarity'];
      const supplementalGuidance = await this.getSupplementalGateGuidance(
        testGates,
        frameworkContext
      );
      if (supplementalGuidance) {
        enhancedContent = enhancedContent + supplementalGuidance;
      } else {
        enhancedContent = enhancedContent + `\n--- GATE MANAGER RETURNED EMPTY ---\n`;
      }
    }

    // Format response with structured data
    const executionWarning = `⚠️ EXECUTION REQUIRED: The following content contains instructions that YOU must interpret and execute:\n\n`;

    return this.responseFormatter.formatPromptEngineResponse(
      executionWarning + enhancedContent,
      executionContext,
      {
        includeAnalytics: true,
        includeMetadata: true,
      },
      gateResults // Include gate validation results
    );
  }

  // REMOVED: getGateInfo - migrated to ChainExecutor

  // REMOVED: generateMetadataSection - migrated to ChainExecutor

  /**
   * Get supplemental gate guidance to append to responses (Phase 1 - Framework-style implementation)
   */
  private async getSupplementalGateGuidance(
    selectedGates: string[],
    frameworkContext?: any
  ): Promise<string> {
    console.log(`🎯 [CONSOLE DEBUG] getSupplementalGateGuidance called:`, {
      selectedGatesCount: selectedGates.length,
      selectedGates,
      hasFrameworkContext: !!frameworkContext,
      frameworkMethodology: frameworkContext?.selectedFramework?.methodology
    });
    this.logger.info(`🎯 [GATE MANAGER] getSupplementalGateGuidance called:`, {
      selectedGatesCount: selectedGates.length,
      selectedGates,
      hasFrameworkContext: !!frameworkContext,
      frameworkMethodology: frameworkContext?.selectedFramework?.methodology
    });

    if (selectedGates.length === 0) {
      this.logger.debug(`[GATE MANAGER] No gates selected, returning empty guidance`);
      return '';
    }

    try {

      // NEW: Use role-based gate guidance renderer (Phase 3)
      const supplementalGuidance = await this.gateGuidanceRenderer.renderGuidance(
        selectedGates,
        {
          framework: frameworkContext?.selectedFramework?.methodology || 'CAGEERF',
          category: 'development', // Could be dynamic based on prompt category
          promptId: frameworkContext?.promptId
        }
      );

      this.logger.debug(`[GATE GUIDANCE RENDERER] Gate guidance renderer returned guidance:`, {
        guidanceLength: supplementalGuidance.length,
        hasContent: supplementalGuidance.length > 0
      });

      return supplementalGuidance;
    } catch (error) {
      this.logger.error("Failed to get supplemental gate guidance:", error);
      return '';
    }
  }

  /**
   * Extract gate title from guidance text
   */
  private extractGateTitle(guidanceText: string): string {
    const lines = guidanceText.split('\n');
    const titleLine = lines.find(line => line.includes('Guidelines') || line.includes(':'));
    if (titleLine) {
      return titleLine.replace(/\*\*/g, '').replace(/:/g, '').trim();
    }
    return 'Quality Guidelines';
  }

  /**
   * Simple prompt categorization for gate activation
   */
  private categorizePrompt(promptId: string): string {
    // Basic categorization based on prompt ID patterns
    if (promptId.includes("research") || promptId.includes("analysis")) {
      return "research";
    } else if (promptId.includes("code") || promptId.includes("development")) {
      return "code";
    } else if (
      promptId.includes("content") ||
      promptId.includes("documentation")
    ) {
      return "content_processing";
    }
    return "general";
  }

  /**
   * Get framework-specific gates for validation (Phase 4: Enhanced with advanced orchestration)
   */
  private async getAdvancedGateSelection(
    prompt: ConvertedPrompt,
    executionMode: 'prompt' | 'template' | 'chain',
    semanticAnalysis?: any
  ): Promise<string[]> {
    this.logger.debug(`[GATE DEBUG] getAdvancedGateSelection called:`, {
      promptId: prompt.id,
      executionMode,
      hasGateSelectionEngine: !!this.gateSelectionEngine,
      hasSemanticAnalysis: !!semanticAnalysis
    });

    if (!this.gateSelectionEngine) {
      this.logger.debug(`[GATE DEBUG] No gate selection engine, using fallback gates`);
      return this.getFallbackGates(prompt);
    }

    try {
      // Build gate selection criteria
      const criteria: ExtendedGateSelectionCriteria = {
        framework: this.frameworkStateManager?.getActiveFramework()?.methodology,
        category: prompt.category || 'general',
        promptId: prompt.id,
        executionMode,
        complexityLevel: this.assessPromptComplexity(prompt),
        semanticAnalysis,
        frameworkContext: this.frameworkStateManager?.isFrameworkSystemEnabled()
          ? this.frameworkStateManager.getActiveFramework()
          : undefined,
        userPreferences: {
          qualityFocus: 'balanced',
          performanceMode: false,
          strictValidation: true
        }
      };

      this.logger.debug(`[GATE DEBUG] Gate selection criteria:`, {
        hasFrameworkContext: !!criteria.frameworkContext,
        frameworkMethodology: criteria.frameworkContext?.methodology,
        executionMode: criteria.executionMode,
        complexityLevel: criteria.complexityLevel
      });

      // Use gate selection engine for intelligent gate selection
      const selection = await this.gateSelectionEngine.selectGates(criteria);

      this.logger.debug(`[GATE DEBUG] Advanced gate selection result:`, {
        promptId: prompt.id,
        selectedGates: selection.selectedGates,
        gateCount: selection.selectedGates.length,
        confidence: selection.confidence,
        reasoning: selection.reasoning,
        estimatedTime: selection.estimatedExecutionTime
      });

      return selection.selectedGates;

    } catch (error) {
      this.logger.error("Advanced gate selection failed, using fallback:", error);
      const fallbackGates = this.getFallbackGates(prompt);
      this.logger.debug(`[GATE DEBUG] Using fallback gates:`, { fallbackGates });
      return fallbackGates;
    }
  }

  /**
   * Fallback gate selection for when advanced orchestration is unavailable
   */
  private getFallbackGates(prompt: ConvertedPrompt): string[] {
    // TEMP DEBUG: Add comprehensive logging
    const isEnabled = this.frameworkStateManager?.isFrameworkSystemEnabled();
    this.logger.debug(`[FALLBACK GATES DEBUG] Framework system enabled: ${isEnabled}`);

    if (!isEnabled) {
      this.logger.debug(`[FALLBACK GATES DEBUG] Framework disabled, returning content-structure`);
      return ['content-structure'];
    }

    const activeFramework = this.frameworkStateManager?.getActiveFramework();
    this.logger.debug(`[FALLBACK GATES DEBUG] Active framework:`, {
      hasFramework: !!activeFramework,
      methodology: activeFramework?.methodology,
      frameworkObj: activeFramework
    });

    if (!activeFramework) {
      this.logger.debug(`[FALLBACK GATES DEBUG] No active framework, returning content-structure`);
      return ['content-structure'];
    }

    const gates: string[] = [];

    // Framework-specific gates based on methodology
    switch (activeFramework.methodology) {
      case 'CAGEERF':
        gates.push('framework-compliance', 'technical-accuracy', 'content-structure');
        break;
      case 'ReACT':
        gates.push('framework-compliance', 'educational-clarity');
        break;
      case '5W1H':
        gates.push('framework-compliance', 'research-quality');
        break;
      case 'SCAMPER':
        gates.push('framework-compliance', 'content-structure');
        break;
    }

    // Add category-specific gates
    const category = this.categorizePrompt(prompt.id);
    switch (category) {
      case 'code':
        gates.push('code-quality', 'security-awareness');
        break;
      case 'research':
        gates.push('research-quality', 'technical-accuracy');
        break;
      case 'content_processing':
        gates.push('content-structure', 'educational-clarity');
        break;
    }

    // Remove duplicates and return
    const finalGates = [...new Set(gates)];
    this.logger.debug(`[FALLBACK GATES DEBUG] Final gates returned:`, {
      gatesArray: finalGates,
      gateCount: finalGates.length
    });
    return finalGates;
  }

  /**
   * Assess prompt complexity for gate selection
   */
  private assessPromptComplexity(prompt: ConvertedPrompt): 'low' | 'medium' | 'high' {
    const argCount = prompt.arguments?.length || 0;
    const contentLength = prompt.userMessageTemplate?.length || 0;
    const hasSystemMessage = Boolean(prompt.systemMessage);

    if (argCount >= 5 || contentLength > 1000 || hasSystemMessage) return 'high';
    if (argCount >= 3 || contentLength > 500) return 'medium';
    return 'low';
  }

  /**
   * Validate content with framework-specific gates (Phase 4: Enhanced with advanced orchestration)
   */
  private async validateContentWithGates(
    prompt: ConvertedPrompt,
    content: string,
    promptArgs: Record<string, any>,
    executionMode: 'prompt' | 'template' | 'chain' = 'template',
    semanticAnalysis?: any
  ): Promise<{ validation: GateValidationResult | null; selectedGates: string[] }> {
    if (!this.engineValidator) {
      this.logger.debug("EngineValidator not available for gate validation");
      return { validation: null, selectedGates: [] };
    }

    // Get advanced gate selection (Phase 4)
    const suggestedGates = await this.getAdvancedGateSelection(prompt, executionMode, semanticAnalysis);

    if (suggestedGates.length === 0) {
      this.logger.debug("No gates suggested for validation");
      return { validation: { passed: true, results: [] }, selectedGates: [] };
    }

    try {
      const startTime = performance.now();
      this.logger.debug(`Validating content with advanced gate selection: ${suggestedGates.join(', ')}`);

      const validationResult = await this.engineValidator.validateWithGates(
        prompt,
        promptArgs,
        suggestedGates,
        content  // FIXED: Pass processed content for validation
      );

      const executionTime = performance.now() - startTime;

      // Performance metrics now handled separately by GatePerformanceAnalyzer in system control

      return { validation: validationResult, selectedGates: suggestedGates };
    } catch (error) {
      this.logger.error("Gate validation failed:", error);

      // Performance metrics for failed validation now handled by GatePerformanceAnalyzer

      return { validation: { passed: false, results: [{ gate: 'system', passed: false, message: `Validation error: ${error}` }] }, selectedGates: suggestedGates };
    }
  }

  /**
   * Extract retry hints from gate validation results (Phase 3 implementation)
   */
  private getRetryHintsFromValidation(gateResults: GateValidationResult): string[] {
    const hints: string[] = [];

    for (const result of gateResults.results) {
      if (!result.passed && result.message) {
        // Convert gate failure messages to actionable hints
        const hint = this.convertGateMessageToHint(result.gate, result.message);
        if (hint) {
          hints.push(hint);
        }
      }
    }

    return hints;
  }

  /**
   * Convert gate failure message to actionable retry hint
   */
  private convertGateMessageToHint(gateId: string, message: string): string | null {
    // Convert specific gate failures to actionable improvement hints
    switch (gateId) {
      case 'technical-accuracy':
        return 'Include specific version numbers, official documentation references, and technical specifications';
      case 'content-structure':
        return 'Organize content with clear headers, logical flow, and structured sections';
      case 'framework-compliance':
        return 'Follow the active methodology framework structure and include all required sections';
      case 'research-quality':
        return 'Include credible sources, evidence-based statements, and factual accuracy';
      case 'educational-clarity':
        return 'Use clear explanations, provide examples, and ensure concepts are well-explained';
      case 'code-quality':
        return 'Include proper syntax, error handling, and follow coding best practices';
      case 'security-awareness':
        return 'Address security considerations, validate inputs, and follow security best practices';
      default:
        // Generic hint based on message content
        if (message.toLowerCase().includes('length')) {
          return 'Provide more detailed and comprehensive content';
        } else if (message.toLowerCase().includes('structure')) {
          return 'Improve content organization and structure';
        } else if (message.toLowerCase().includes('quality')) {
          return 'Enhance content quality and accuracy';
        }
        return `Address validation concern: ${message}`;
    }
  }

  /**
   * Get improvement focus based on failed gates
   */
  private getImprovementFocus(gateResults: GateValidationResult): string {
    const failedGates = gateResults.results.filter(r => !r.passed).map(r => r.gate);

    if (failedGates.includes('technical-accuracy')) {
      return 'Technical accuracy and precision';
    } else if (failedGates.includes('framework-compliance')) {
      return 'Methodology framework compliance';
    } else if (failedGates.includes('content-structure')) {
      return 'Content organization and structure';
    } else if (failedGates.length > 1) {
      return 'Multiple quality aspects';
    } else {
      return 'Content quality improvement';
    }
  }

  /**
   * Record execution analytics using event-driven architecture
   */
  private recordExecutionAnalytics(): void {
    if (!this.currentExecutionState) {
      this.logger.debug(
        "RecordExecutionAnalytics called but currentExecutionState is null"
      );
      return;
    }

    if (!this.analyticsService) {
      this.logger.debug(
        "Analytics service not available - skipping analytics recording"
      );
      return;
    }

    const duration =
      (this.currentExecutionState.metadata.endTime || Date.now()) -
      this.currentExecutionState.metadata.startTime;

    const executionData: ExecutionData = {
      executionId: `exec_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
      executionType: this.currentExecutionState.metadata.executionMode as
        | "prompt"
        | "template"
        | "chain",
      startTime: this.currentExecutionState.metadata.startTime,
      endTime: this.currentExecutionState.metadata.endTime || Date.now(),
      executionTime: duration,
      success: this.currentExecutionState.status === "completed",
      frameworkUsed: this.getActiveFrameworkId(),
      frameworkEnabled:
        this.frameworkStateManager?.isFrameworkSystemEnabled() || false,
      stepsExecuted: (this.currentExecutionState.metadata as any).stepsExecuted,
      sessionId: (this.currentExecutionState.metadata as any).sessionId,
      toolName: "prompt_engine",
      error:
        this.currentExecutionState.status === "failed"
          ? (this.currentExecutionState as any).error
          : undefined,
      memoryUsage: {
        heapUsed: process.memoryUsage().heapUsed,
        heapTotal: process.memoryUsage().heapTotal,
        external: process.memoryUsage().external,
      },
    };

    // Record execution analytics via event
    this.analyticsService.recordExecution(executionData);

    // Store in history for local access (keep limited history)
    this.executionHistory.push({ ...this.currentExecutionState });
    if (this.executionHistory.length > 100) {
      this.executionHistory.shift();
    }

    this.logger.debug(
      `Analytics recorded: ${executionData.executionType} execution (${duration}ms, success: ${executionData.success})`
    );
  }

  /**
   * Get active framework ID
   */
  private getActiveFrameworkId(): string | undefined {
    if (!this.frameworkStateManager?.isFrameworkSystemEnabled()) {
      return undefined;
    }
    return this.frameworkStateManager?.getCurrentState().activeFramework;
  }

  /**
   * Get execution analytics from analytics service
   */
  getAnalytics() {
    if (this.analyticsService) {
      return this.analyticsService.getExecutionStats();
    }

    // Fallback for backward compatibility
    return {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      executionsByMode: {
        prompt: 0,
        template: 0,
        chain: 0,
      },
      executionsByTool: {
        prompt_engine: 0,
        prompt_manager: 0,
        system_control: 0,
      },
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get parsing system statistics for monitoring
   */
  getParsingStats() {
    return {
      commandParser: this.parsingSystem.commandParser.getStats(),
      argumentParser: this.parsingSystem.argumentParser.getStats(),
      contextResolver: this.parsingSystem.contextResolver.getStats(),
    };
  }

  /**
   * Reset parsing statistics
   */
  resetParsingStats(): void {
    this.parsingSystem.commandParser.resetStats();
    this.parsingSystem.argumentParser.resetStats();
    this.parsingSystem.contextResolver.resetStats();
    this.logger.debug("Parsing system statistics reset");
  }

  /**
   * Error handling helper
   */
  private handleError(error: unknown, context: string): ToolResponse {
    utilsHandleError(error, context, this.logger);

    return this.responseFormatter.formatErrorResponse(
      error instanceof Error ? error : String(error),
      {
        tool: "prompt_engine",
        operation: context,
      },
      {
        includeStructuredData: true,
      }
    );
  }

  // REMOVED: executeChainWithDualSupport - migrated to ChainExecutor

  /**
   * MIGRATION: Chain management commands - deprecated scaffolding removed
   */
  // REMOVED: executeChainManagement - migrated to ChainExecutor
  // REMOVED: handleScaffoldCommand (~56 lines) - deprecated scaffolding functionality

  // REMOVED: handleConvertCommand (~42 lines) - deprecated chain conversion functionality

  /**
   * Handle validate command for markdown-embedded chains
   */
  // REMOVED: handleValidateCommand - migrated to ChainExecutor

  /**
   * Handle list chains command
   */
  // REMOVED: handleListChainsCommand - migrated to ChainExecutor

  // REMOVED: handleListTemplatesCommand (~55 lines) - scaffolding system deprecated
  // Migration: Use `prompt_manager action=list filter=category:analysis` for organized prompt discovery

  // REMOVED: handleDiscoverWorkflowsCommand (~50 lines) - scaffolding system deprecated
  // Migration: Use `prompt_manager action=list filter="intent:debugging category:development"` for intelligent discovery

  // REMOVED: handleScaffoldUsingCommand (~135 lines) - deprecated workflow scaffolding functionality
  // REMOVED: createChainDefinitionFromTemplate (~40 lines) - deprecated template creation functionality

  // REMOVED: handleChainEditCommand (~25 lines) - deprecated chain editing functionality
  // Migration: Chain editing is no longer needed with markdown-embedded chains
}

/**
 * Create consolidated prompt engine with enhanced parsing system
 */
export function createConsolidatedPromptEngine(
  logger: Logger,
  mcpServer: any,
  promptManager: PromptManager,
  configManager: ConfigManager,
  semanticAnalyzer: ContentAnalyzer,
  conversationManager: ConversationManager,
  textReferenceManager: TextReferenceManager,
  mcpToolsManager?: any
  // Phase 3: Removed executionCoordinator parameter - using LLM-driven chain model
): ConsolidatedPromptEngine {
  const engine = new ConsolidatedPromptEngine(
    logger,
    mcpServer,
    promptManager,
    configManager,
    semanticAnalyzer,
    conversationManager,
    textReferenceManager,
    // Phase 3: Legacy gateEvaluationService removed - using lightweight system only
    mcpToolsManager
    // Phase 3: Removed executionCoordinator parameter
  );

  logger.info("ConsolidatedPromptEngine created with enhanced features:");
  logger.info("- Unified multi-strategy command parsing");
  logger.info("- Advanced argument processing pipeline");
  logger.info(
    "- Optional gate evaluation service for template-driven verification"
  );
  logger.info("- Intelligent context resolution system");
  logger.info("- Backward compatibility with legacy parsing");

  return engine;
}
