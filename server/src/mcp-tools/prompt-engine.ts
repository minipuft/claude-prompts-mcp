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
import { ConfigManager } from "../config/index.js";
import { Logger } from "../logging/index.js";
import { PromptManager } from "../prompts/index.js";
import {
  ChainExecutionProgress,
  ConvertedPrompt,
  ExecutionState,
  GateDefinition,
  PromptData,
  ToolResponse,
} from "../types/index.js";
// REMOVED: ModularChainDefinition from deleted chain-scaffolding.ts
import {
  PromptError,
  ValidationError,
  getAvailableTools,
  isChainPrompt,
  handleError as utilsHandleError,
} from "../utils/index.js";
import { processTemplate } from "../utils/jsonUtils.js";
// Gate evaluation removed - now using Framework methodology validation
import {
  FrameworkExecutionContext,
  FrameworkManager,
} from "../frameworks/framework-manager.js";
import { FrameworkStateManager } from "../frameworks/framework-state-manager.js";
import { ContentAnalyzer } from "../semantic/configurable-semantic-analyzer.js";
import { ConversationManager } from "../text-references/conversation.js";
// Legacy gate system removed - using lightweight gates only
// NEW: Lightweight gate system
import {
  LightweightGateSystem,
  createLightweightGateSystem,
} from "../gates/lightweight/index.js";
// REMOVED: ChainOrchestrator and detectChainType/isModularChain - modular chain system completely removed
// REMOVED: Chain URI addressing system - deprecated with markdown-embedded chains
// New unified parsing system
import {
  createParsingSystem,
  type ExecutionContext,
  type ParsingSystem,
} from "../execution/parsers/index.js";
// REMOVED: Dynamic template discovery - scaffolding system deprecated
// Tool description manager
import { ToolDescriptionManager } from "./tool-description-manager.js";
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
      // Create proper ToolResponse with structuredContent
      const executionContext = args[0] || {};
      const options = args[1] || {};

      const toolResponse: ToolResponse = {
        content: [{ type: "text", text: String(response) }],
        isError: false,
        structuredContent: {
          executionMetadata: {
            executionId: executionContext.executionId || `pe-${Date.now()}`,
            executionType: executionContext.executionType || "prompt",
            startTime: executionContext.startTime || Date.now(),
            endTime: executionContext.endTime || Date.now(),
            executionTime: executionContext.executionTime || 0,
            frameworkEnabled: executionContext.frameworkEnabled || false,
            frameworkUsed: executionContext.frameworkUsed,
            stepsExecuted: executionContext.stepsExecuted,
            sessionId: executionContext.sessionId
          }
        }
      };

      return toolResponse;
    },
    formatErrorResponse: (error: any, ...args: any[]) => ({
      content: [{ type: "text", text: String(error) }],
      isError: true,
      structuredContent: {
        executionMetadata: {
          executionId: `pe-error-${Date.now()}`,
          executionType: "prompt",
          startTime: Date.now(),
          endTime: Date.now(),
          executionTime: 0,
          frameworkEnabled: false
        }
      }
    }),
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
import { ExecutionData, MetricsCollector } from "../metrics/index.js";

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
 * Consolidated Prompt Engine Tool
 */
export class ConsolidatedPromptEngine {
  private logger: Logger;
  private mcpServer: any;
  private promptManager: PromptManager;
  private configManager: ConfigManager;
  private semanticAnalyzer: ContentAnalyzer;
  private conversationManager: ConversationManager;
  private frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  // Legacy gate system removed - using only lightweightGateSystem
  // NEW: Lightweight gate system (Phase 2 integration)
  private lightweightGateSystem: LightweightGateSystem;
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
    // Legacy gate evaluation service assignment removed
    this.mcpToolsManager = mcpToolsManager;
    // Phase 3: Removed executionCoordinator assignment - using LLM-driven chain model

    // Initialize lightweight gate system (Phase 2 integration)
    const config = configManager.getConfig();
    const gatesConfig = config.gates;
    const gatesDirectory = gatesConfig?.definitionsDirectory
      ? path.join(process.cwd(), gatesConfig.definitionsDirectory)
      : undefined;
    this.lightweightGateSystem = createLightweightGateSystem(
      logger,
      gatesDirectory
    );

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
  }

  /**
   * Set framework manager (called after initialization)
   */
  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
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
    if (!this.frameworkManager || !this.frameworkStateManager) {
      return null;
    }

    // NEW: Check if framework system is enabled before generating context
    if (!this.frameworkStateManager.isFrameworkSystemEnabled()) {
      return null;
    }

    try {
      // Get current active framework from state manager
      const activeFramework = this.frameworkStateManager.getActiveFramework();

      // Generate execution context using the framework manager
      const context = this.frameworkManager.generateExecutionContext(prompt, {
        userPreference: activeFramework.methodology as any,
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
      `🚀 Prompt Engine: Executing "${command}" (mode: ${execution_mode})`
    );

    // Parse command and extract execution context
    const executionContext = await this.parseAndPrepareExecution(command);

    // Handle chain management commands
    if (executionContext.isChainManagement) {
      return await this.executeChainManagement(
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

    // Initialize execution state
    this.initializeExecutionState(executionContext.convertedPrompt, strategy);

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

    return {
      promptId,
      promptArgs,
      convertedPrompt,
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
   * Initialize execution state tracking
   */
  private initializeExecutionState(
    convertedPrompt: any,
    strategy: { mode: string; gateValidation: boolean }
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
        return await this.executePrompt(convertedPrompt, promptArgs);

      case "template":
        this.logger.info(
          `📍 EXECUTION PATH: Taking TEMPLATE path for ${convertedPrompt.id}`
        );
        return await this.executeTemplateWithFramework(
          convertedPrompt,
          promptArgs,
          strategy.gateValidation
        );

      case "chain":
        this.logger.info(
          `📍 EXECUTION PATH: Taking CHAIN path for ${convertedPrompt.id}`
        );
        return await this.executeChainWithDualSupport(
          convertedPrompt,
          promptArgs,
          strategy.gateValidation,
          args.options || {},
          { force_restart: args.force_restart, session_id: args.session_id }
        );

      default:
        throw new ValidationError(`Unknown execution mode: ${strategy.mode}`);
    }
  }

  /**
   * Phase 1: Chain Management Command Detection
   */

  /**
   * Detect if command is a chain management operation
   */
  private detectChainManagementCommand(command: string): {
    action: string;
    target: string;
    parameters: Record<string, any>;
  } | null {
    // Chain management command patterns:
    // >>scaffold chain_name template=code_review
    // >>convert legacy_chain
    // >>chain_name.add_step name=new_step
    // >>chain_name.remove_step step_id
    // >>validate chain_name
    // >>list_chains
    // >>templates

    const trimmedCommand = command.trim();

    // Remove >> prefix if present
    const cleanCommand = trimmedCommand.startsWith(">>")
      ? trimmedCommand.slice(2).trim()
      : trimmedCommand;

    // Pattern 1: scaffold commands
    if (cleanCommand.startsWith("scaffold ")) {
      const parts = cleanCommand.split(" ");
      const chainName = parts[1];
      const params = this.parseKeyValueParams(parts.slice(2).join(" "));

      return {
        action: "scaffold",
        target: chainName,
        parameters: params,
      };
    }

    // Pattern 2: convert commands
    if (cleanCommand.startsWith("convert ")) {
      const chainName = cleanCommand.slice(8).trim();

      return {
        action: "convert",
        target: chainName,
        parameters: {},
      };
    }

    // Pattern 3: validate commands
    if (cleanCommand.startsWith("validate ")) {
      const chainName = cleanCommand.slice(9).trim();

      return {
        action: "validate",
        target: chainName,
        parameters: {},
      };
    }

    // Pattern 4: list commands
    if (cleanCommand === "list_chains" || cleanCommand === "chains") {
      return {
        action: "list_chains",
        target: "",
        parameters: {},
      };
    }

    // Enhanced templates command with category support
    if (cleanCommand === "templates" || cleanCommand === "list_templates") {
      return {
        action: "list_templates",
        target: "",
        parameters: {},
      };
    }

    // templates [category] command
    const templatesMatch = cleanCommand.match(/^templates\s+(\w+)$/);
    if (templatesMatch) {
      return {
        action: "list_templates",
        target: "",
        parameters: { category: templatesMatch[1] },
      };
    }

    // discover [category] command
    const discoverMatch = cleanCommand.match(/^discover(?:\s+(\w+))?$/);
    if (discoverMatch) {
      return {
        action: "discover_workflows",
        target: "",
        parameters: { category: discoverMatch[1] },
      };
    }

    // scaffold using=prompt1,prompt2,prompt3 command
    const scaffoldUsingMatch = cleanCommand.match(
      /^scaffold\s+(\w+)\s+using=(.+)$/
    );
    if (scaffoldUsingMatch) {
      const [, chainName, promptList] = scaffoldUsingMatch;
      const promptIds = promptList.split(",").map((id) => id.trim());
      return {
        action: "scaffold_using",
        target: chainName,
        parameters: { promptIds },
      };
    }

    // Pattern 5: chain.action commands (e.g., chain_name.add_step)
    const dotActionMatch = cleanCommand.match(/^([\w-]+)\.(\w+)(?:\s+(.+))?$/);
    if (dotActionMatch) {
      const [, chainName, action, paramString] = dotActionMatch;
      const params = paramString ? this.parseKeyValueParams(paramString) : {};

      // Validate action is a chain management action
      const validActions = ["add_step", "remove_step", "reorder_steps", "info"];
      if (validActions.includes(action)) {
        return {
          action,
          target: chainName,
          parameters: params,
        };
      }
    }

    return null;
  }

  /**
   * Parse key=value parameters from command string
   */
  private parseKeyValueParams(paramString: string): Record<string, any> {
    const params: Record<string, any> = {};

    if (!paramString.trim()) return params;

    // Split by spaces, handling quoted values
    const parts =
      paramString.match(/\S+="[^"]*"|\S+='[^']*'|\S+=\S+|\S+/g) || [];

    parts.forEach((part) => {
      if (part.includes("=")) {
        const [key, ...valueParts] = part.split("=");
        let value = valueParts.join("=");

        // Remove quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        params[key] = value;
      } else {
        // Positional parameter - use as 'name' by default
        if (!params.name) {
          params.name = part;
        }
      }
    });

    return params;
  }

  /**
   * Handle chain management command
   */
  private async handleChainManagementCommand(chainCommand: {
    action: string;
    target: string;
    parameters: Record<string, any>;
  }): Promise<{
    promptId: string;
    arguments: Record<string, any>;
    convertedPrompt: ConvertedPrompt;
    isChainManagement: boolean;
    chainAction: string;
    chainParameters: Record<string, any>;
  }> {
    // Create a virtual prompt for chain management
    const virtualPrompt: ConvertedPrompt = {
      id: `__chain_${chainCommand.action}__`,
      name: `Chain ${chainCommand.action}`,
      description: `Chain management: ${chainCommand.action}`,
      category: "chain_management",
      systemMessage: "",
      userMessageTemplate: `Execute chain management action: ${chainCommand.action}`,
      arguments: [],
    };

    return {
      promptId: virtualPrompt.id,
      arguments: chainCommand.parameters,
      convertedPrompt: virtualPrompt,
      isChainManagement: true,
      chainAction: chainCommand.action,
      chainParameters: {
        target: chainCommand.target,
        ...chainCommand.parameters,
      },
    };
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
    const chainCommand = this.detectChainManagementCommand(command);
    if (chainCommand) {
      return await this.handleChainManagementCommand(chainCommand);
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

    // Phase 2: Inject gate guidance if enabled and available
    const enhancedArgs = await this.injectGateGuidance(prompt, args);

    // Fast variable substitution using modern template processor
    content = processTemplate(content, enhancedArgs, {});

    // Update state and analytics
    this.currentExecutionState.status = "completed";
    this.currentExecutionState.metadata.endTime = Date.now();
    this.recordExecutionAnalytics();

    // Create execution context for response formatter
    const executionId = `exec_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const activeFramework =
      this.frameworkStateManager?.getActiveFramework()?.name;
    const frameworkEnabled =
      this.frameworkStateManager?.isFrameworkSystemEnabled() || false;

    const executionContext: FormatterExecutionContext = {
      executionId,
      executionType: "prompt",
      startTime: this.currentExecutionState.metadata.startTime,
      endTime: this.currentExecutionState.metadata.endTime || Date.now(),
      frameworkUsed: activeFramework,
      frameworkEnabled,
      success: true,
    };

    // Format response with structured data
    const executionWarning = `⚠️ EXECUTION REQUIRED: The following content contains instructions that YOU must interpret and execute:\n\n`;

    return this.responseFormatter.formatPromptEngineResponse(
      executionWarning + content,
      executionContext,
      {
        includeAnalytics: true,
        includeMetadata: true,
      }
    );
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

    // Get framework execution context for enhanced system prompt
    const frameworkContext = await this.getFrameworkExecutionContext(prompt);

    if (prompt.systemMessage || frameworkContext) {
      let systemPrompt = prompt.systemMessage || "";

      // Enhance with framework-specific system prompt if available
      if (frameworkContext) {
        const frameworkSystemPrompt = frameworkContext.systemPrompt;
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

    // Phase 2: Inject gate guidance if enabled and available
    const enhancedArgs = await this.injectGateGuidance(prompt, args);

    // Template processing with special context and optional tools
    const specialContext: Record<string, string> = {
      previous_message: "{{previous_message}}",
    };
    if (prompt.tools) {
      specialContext["tools_available"] = getAvailableTools();
    }
    content = processTemplate(content, enhancedArgs, specialContext);


    // Update state and analytics
    this.currentExecutionState.status = "completed";
    this.currentExecutionState.metadata.endTime = Date.now();
    this.recordExecutionAnalytics();

    // Create execution context for response formatter
    const executionId = `exec_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const activeFramework =
      this.frameworkStateManager?.getActiveFramework()?.name;
    const frameworkEnabled =
      this.frameworkStateManager?.isFrameworkSystemEnabled() || false;

    const executionContext: FormatterExecutionContext = {
      executionId,
      executionType: "template",
      startTime: this.currentExecutionState.metadata.startTime,
      endTime: this.currentExecutionState.metadata.endTime || Date.now(),
      frameworkUsed: activeFramework,
      frameworkEnabled,
      success: true,
    };

    // Format response with structured data
    const executionWarning = `⚠️ EXECUTION REQUIRED: The following content contains instructions that YOU must interpret and execute:\n\n`;

    return this.responseFormatter.formatPromptEngineResponse(
      executionWarning + content,
      executionContext,
      {
        includeAnalytics: true,
        includeMetadata: true,
      },
      undefined // No gate results for template/prompt execution - gates only validate chain step outputs
    );
  }

  /**
   * Extract gate status information for LLM guidance - only shows gates when present
   */
  private async getGateInfo(
    enableGates: boolean,
    promptId?: string,
    stepGates?: string[]
  ): Promise<{
    status: string;
    gates: Array<{ name: string; location: string; criteria: string }>;
  }> {
    if (!enableGates) {
      return {
        status: "⚠️ Quality Gates DISABLED",
        gates: [],
      };
    }

    // Debug logging
    this.logger.debug(
      `getGateInfo called: enableGates=${enableGates}, promptId=${promptId}, stepGates=`,
      stepGates
    );

    const gates = [];

    // Process gates if present

    // Process actual gates
    if (stepGates && stepGates.length > 0) {
      for (const gateId of stepGates) {
        try {
          const gateDefinition =
            await this.lightweightGateSystem.gateLoader.loadGate(gateId);
          if (gateDefinition) {
            gates.push({
              name: gateDefinition.name,
              location: `@server/src/gates/definitions/${gateId}.json`,
              criteria: `✅ Active - ${gateDefinition.description}${
                gateDefinition.guidance
                  ? "\n  - Guidance: " +
                    gateDefinition.guidance.substring(0, 200) +
                    (gateDefinition.guidance.length > 200 ? "..." : "")
                  : ""
              }`,
            });
          } else {
            gates.push({
              name: gateId,
              location: `@server/src/gates/definitions/${gateId}.json (not found)`,
              criteria: "⚠️ Gate definition missing",
            });
          }
        } catch (error) {
          gates.push({
            name: gateId,
            location: `@server/src/gates/definitions/${gateId}.json (error)`,
            criteria: "❌ Gate loading error",
          });
        }
      }
    }
    // REMOVED: Fallback lightweight system message - only show gates when they exist

    return {
      status:
        gates.length > 0
          ? "✅ Quality Gates ENABLED - Validation MANDATORY"
          : "✅ Quality Gates AVAILABLE",
      gates,
    };
  }

  /**
   * Generate structured metadata section for LLM guidance
   */
  private async generateMetadataSection(
    chainId: string,
    currentStep: number,
    totalSteps: number,
    stepData: any,
    contextData: Record<string, any>,
    enableGates: boolean,
    promptGates?: string[]
  ): Promise<string> {
    const gateInfo = await this.getGateInfo(enableGates, chainId, promptGates);
    const progressPercent = Math.round(((currentStep + 1) / totalSteps) * 100);

    let metadata = "";

    // Only show Quality Gate Status section if gates are present
    if (gateInfo.gates.length > 0) {
      metadata += `\n## 🛡️ Quality Gate Status\n`;
      metadata += `**${gateInfo.status}**\n\n`;

      gateInfo.gates.forEach((gate) => {
        metadata += `- **${gate.name}**: ${gate.criteria}\n`;
        metadata += `  - Location: ${gate.location}\n`;
      });
    }

    metadata += `\n## 🔗 Chain Execution Metadata\n`;
    metadata += `- **Chain ID**: ${chainId}\n`;
    metadata += `- **Progress**: Step ${
      currentStep + 1
    }/${totalSteps} (${progressPercent}% Complete)\n`;
    metadata += `- **Current Step**: ${stepData.stepName}\n`;
    metadata += `- **Next Action**: TOOL_CALL >>${stepData.promptId}\n`;

    if (Object.keys(contextData).length > 0) {
      metadata += `- **Available Context**: ${
        Object.keys(contextData).length
      } previous step(s)\n`;
      Object.keys(contextData).forEach((key) => {
        const value = contextData[key];
        const preview =
          value.length > 50 ? value.substring(0, 50) + "..." : value;
        metadata += `  - ${key}: ${preview}\n`;
      });
    }

    metadata += `\n### 📋 LLM Instructions\n`;
    metadata += `1. **MANDATORY**: Follow active quality gates (see locations above)\n`;
    metadata += `2. **Execute next step**: \`prompt_engine >>${stepData.promptId}\`\n`;
    metadata += `3. **Framework details**: Use \`system_control status\` if needed\n`;
    metadata += `4. **Quality requirement**: All gate validation criteria must be met\n`;

    return metadata;
  }

  /**
   * Generate chain execution instructions for LLM-driven iterative workflow
   * (W.I.P): Smart iterative execution with step-by-step LLM guidance
   */
  private async generateChainInstructions(
    prompt: ConvertedPrompt,
    steps: any[],
    enableGates: boolean,
    originalArgs: Record<string, any> = {} // Original chain arguments
  ): Promise<ToolResponse> {
    const chainId = prompt.id;
    const totalSteps = steps.length;

    // Update analytics for chain step execution immediately
    if (this.currentExecutionState) {
      this.logger.debug("Updating analytics for chain step execution");
      this.currentExecutionState.status = "completed";
      this.currentExecutionState.metadata.endTime = Date.now();
      this.recordExecutionAnalytics();
    } else {
      this.logger.debug(
        "Cannot update analytics for chain step - currentExecutionState is null"
      );
    }

    // Check for restart parameter first
    if (originalArgs["restart_chain"] === "true") {
      this.conversationManager.clearChainContext(chainId);
      this.conversationManager.setChainState(chainId, 0, totalSteps);
      this.logger.info(`🔄 Restarting chain execution: ${chainId}`);
    }

    // Get or initialize chain state with validation
    let chainState = this.conversationManager.getChainState(chainId);
    if (!chainState) {
      // Initialize chain execution from the beginning
      this.conversationManager.setChainState(chainId, 0, totalSteps);
      this.logger.info(
        `🔗 Initializing chain execution: ${chainId} (${totalSteps} steps)`
      );
      chainState = { currentStep: 0, totalSteps, lastUpdated: Date.now() };
    } else {
      // Validate existing chain state and recover if needed
      const validation = this.conversationManager.validateChainState(chainId);
      if (!validation.valid) {
        this.logger.warn(
          `Chain ${chainId} validation issues: ${validation.issues?.join(", ")}`
        );
        if (validation.recovered) {
          // Refetch state after recovery
          chainState =
            this.conversationManager.getChainState(chainId) || chainState;
        }
      }
    }

    const currentStep = chainState?.currentStep || 0;

    // Check if chain is complete
    if (currentStep >= totalSteps) {
      this.logger.info(`🎉 Chain ${chainId} completed successfully`);

      // Get final result and clear chain context
      const finalResult =
        this.conversationManager.getStepResult(chainId, totalSteps - 1) ||
        "Chain execution completed";
      this.conversationManager.clearChainContext(chainId);

      // Chain completion logging (analytics already updated at method start)

      // Use response formatter to ensure proper structured content
      const executionContext = {
        executionId: Date.now().toString(),
        executionType: "chain" as const,
        startTime:
          this.currentExecutionState?.metadata?.startTime || Date.now(),
        endTime: Date.now(),
        frameworkUsed: this.frameworkStateManager?.getActiveFramework()?.id,
        frameworkEnabled:
          this.frameworkStateManager?.isFrameworkSystemEnabled() || false,
        stepsExecuted: totalSteps,
        sessionId: chainId,
        success: true,
      };

      return this.responseFormatter.formatPromptEngineResponse(
        `🎉 **Chain Complete**: ${prompt.name}\n\n${finalResult}`,
        executionContext,
        {
          includeAnalytics: true,
          includeMetadata: true,
        }
      );
    }

    // Get current step information
    const stepData = steps[currentStep];
    if (!stepData) {
      throw new PromptError(`Invalid step ${currentStep} for chain ${chainId}`);
    }

    // Get previous step results for context
    const stepResults = this.conversationManager.getStepResults(chainId);
    const contextData: Record<string, any> = {};

    // Build context from previous steps
    Object.keys(stepResults).forEach((stepNum) => {
      const stepIndex = parseInt(stepNum);
      if (stepIndex < currentStep) {
        contextData[`step${stepIndex + 1}_result`] = stepResults[stepIndex];
      }
    });

    // Generate primary instruction content
    const progressInfo = `**Step ${currentStep + 1}/${totalSteps}**: ${
      stepData.stepName
    }`;

    let primaryInstructions = `🔗 **Chain Execution**: ${prompt.name}\n`;
    primaryInstructions += `${progressInfo}\n\n`;

    // Build step arguments using inputMapping and original chain arguments
    const stepArgs = this.buildStepArguments(
      stepData,
      originalArgs,
      contextData,
      currentStep
    );
    const stepCommand = this.formatStepCommand(stepData.promptId, stepArgs);

    primaryInstructions += `**Execute**: Call \`prompt_engine\` with:\n`;
    primaryInstructions += `\`\`\`\n${stepCommand}\n\`\`\`\n\n`;

    if (currentStep > 0 && Object.keys(contextData).length > 0) {
      primaryInstructions += `**Context from previous steps**:\n`;
      Object.keys(contextData).forEach((key) => {
        const value = contextData[key];
        const truncated =
          value.length > 100 ? value.substring(0, 100) + "..." : value;
        primaryInstructions += `- ${key}: ${truncated}\n`;
      });
      primaryInstructions += `\n`;
    }

    const nextStepNum = currentStep + 2;
    if (nextStepNum <= totalSteps) {
      primaryInstructions += `**Next**: After execution, call \`prompt_engine\` again to continue to step ${nextStepNum}/${totalSteps}`;
    } else {
      primaryInstructions += `**Next**: This is the final step. Chain will complete after execution.`;
    }

    // Generate structured metadata section for LLM guidance
    // Extract step gates for debugging and metadata
    console.log(
      `🔍 [Chain Debug] generateChainInstructions called for: ${prompt.id}`
    );
    console.log(
      `🔍 [Chain Debug] convertedPrompt.chainSteps:`,
      prompt.chainSteps?.length || 0,
      "steps"
    );
    console.log(
      `🔍 [Chain Debug] currentStep:`,
      currentStep,
      "stepData:",
      JSON.stringify(stepData, null, 2)
    );

    // Handle chain step gates from either config.gates or gates property
    const stepGates = stepData.config?.gates || stepData.gates || [];
    this.logger.debug(
      `Chain ${chainId} Step ${currentStep + 1}: Found ${
        stepGates.length
      } gates:`,
      stepGates
    );

    const metadataSection = await this.generateMetadataSection(
      chainId,
      currentStep,
      totalSteps,
      stepData,
      contextData,
      enableGates,
      stepGates // Use current step's gates instead of main chain prompt gates
    );

    // IMPORTANT: Only advance state when this is not a restart or initialization
    // In LLM-driven chains, we advance the state after providing instructions,
    // assuming the LLM will execute the next step
    if (!originalArgs["restart_chain"]) {
      this.conversationManager.setChainState(
        chainId,
        currentStep + 1,
        totalSteps
      );
      this.logger.debug(
        `Chain ${chainId}: Advanced to step ${currentStep + 1}/${totalSteps}`
      );
    }

    // Chain step logging (analytics already updated at method start)

    // Use response formatter to ensure proper structured content
    const executionContext = {
      executionId: Date.now().toString(),
      executionType: "chain" as const,
      startTime: this.currentExecutionState?.metadata?.startTime || Date.now(),
      endTime: Date.now(),
      frameworkUsed: this.frameworkStateManager?.getActiveFramework()?.id,
      frameworkEnabled:
        this.frameworkStateManager?.isFrameworkSystemEnabled() || false,
      stepsExecuted: currentStep,
      sessionId: chainId,
      success: true,
    };

    return this.responseFormatter.formatPromptEngineResponse(
      primaryInstructions + "\n\n" + metadataSection,
      executionContext,
      {
        includeAnalytics: true,
        includeMetadata: true,
      }
    );
  }

  /**
   * Build step arguments using inputMapping from chain definition with enhanced validation
   */
  private buildStepArguments(
    stepData: any,
    originalArgs: Record<string, any>,
    contextData: Record<string, any>,
    currentStep: number
  ): Record<string, any> {
    const stepArgs: Record<string, any> = {};

    // Enhanced logging for better visibility
    this.logger.debug(`\n🔧 Building step arguments for step ${currentStep}:`);
    this.logger.debug(`   📝 Step data:`, stepData);
    this.logger.debug(`   🎯 Original args:`, originalArgs);
    this.logger.debug(`   📚 Context data:`, contextData);

    // Add console logging for immediate visibility during debugging
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `\n🔧 [Chain Debug] Building arguments for step ${currentStep}:`
      );
      console.log(`   📝 Step: ${stepData.stepName} (${stepData.promptId})`);
      console.log(
        `   🎯 Original args:`,
        Object.keys(originalArgs).length > 0 ? originalArgs : "NONE"
      );
      console.log(
        `   📚 Context data:`,
        Object.keys(contextData).length > 0 ? contextData : "NONE"
      );
    }

    // NEW: Validate that we have actual step results, not placeholders
    const placeholderWarnings: string[] = [];
    Object.entries(contextData).forEach(([key, value]) => {
      if (
        typeof value === "string" &&
        (value.includes("{{previous_message}}") ||
          value.includes("[Please check previous messages]") ||
          value.length < 10)
      ) {
        placeholderWarnings.push(`${key} appears to contain placeholder data`);
      }
    });

    if (placeholderWarnings.length > 0) {
      console.log(`   ⚠️  Context quality warnings:`, placeholderWarnings);
      this.logger.warn(
        `Chain ${
          stepData.promptId
        } context quality issues: ${placeholderWarnings.join(", ")}`
      );
    }

    // Process inputMapping if it exists
    if (stepData.inputMapping && typeof stepData.inputMapping === "object") {
      console.log(`   🗺️  Using inputMapping:`, stepData.inputMapping);

      let mappedCount = 0;
      Object.entries(stepData.inputMapping).forEach(
        ([stepArgName, sourceValue]) => {
          if (typeof sourceValue === "string") {
            // Check if it's a reference to original argument
            if (originalArgs.hasOwnProperty(sourceValue)) {
              stepArgs[stepArgName] = originalArgs[sourceValue];
              console.log(
                `     ✅ Mapped ${stepArgName} <- originalArgs[${sourceValue}]: "${String(
                  originalArgs[sourceValue]
                ).substring(0, 100)}${
                  originalArgs[sourceValue]?.length > 100 ? "..." : ""
                }"`
              );
              mappedCount++;
            }
            // Check if it's a reference to previous step result
            else if (contextData.hasOwnProperty(sourceValue)) {
              stepArgs[stepArgName] = contextData[sourceValue];
              console.log(
                `     ✅ Mapped ${stepArgName} <- contextData[${sourceValue}]: "${String(
                  contextData[sourceValue]
                ).substring(0, 100)}${
                  contextData[sourceValue]?.length > 100 ? "..." : ""
                }"`
              );
              mappedCount++;
            }
            // Otherwise use the literal value
            else {
              stepArgs[stepArgName] = sourceValue;
              console.log(
                `     ✅ Mapped ${stepArgName} <- literal: "${sourceValue}"`
              );
              mappedCount++;
            }
          } else {
            stepArgs[stepArgName] = sourceValue;
            console.log(
              `     ✅ Mapped ${stepArgName} <- non-string:`,
              sourceValue
            );
            mappedCount++;
          }
        }
      );

      console.log(
        `   📊 Mapping result: ${mappedCount} arguments mapped via inputMapping`
      );
      this.logger.debug(`Mapped ${mappedCount} arguments via inputMapping`);
    } else {
      console.log(`   ⚠️  No inputMapping found, using fallback logic`);
      this.logger.debug(
        `No inputMapping found for step ${currentStep}, using fallback logic`
      );

      // ENHANCED FALLBACK: For common chain patterns, apply standard argument mapping
      let fallbackCount = 0;

      if (currentStep === 0) {
        // First step: pass all original arguments
        Object.assign(stepArgs, originalArgs);
        fallbackCount = Object.keys(originalArgs).length;
        console.log(
          `     ✅ First step: passed all ${fallbackCount} original arguments`
        );
      } else {
        // Subsequent steps: intelligent fallback with quality validation

        // 1. Always pass through critical original arguments
        [
          "content",
          "topic",
          "data",
          "input",
          "text",
          "query",
          "information",
          "task",
          "request",
        ].forEach((criticalArg) => {
          if (
            originalArgs[criticalArg] &&
            typeof originalArgs[criticalArg] === "string" &&
            originalArgs[criticalArg].length > 5
          ) {
            stepArgs[criticalArg] = originalArgs[criticalArg];
            console.log(`     ✅ Critical arg: ${criticalArg} <- originalArgs`);
            fallbackCount++;
          }
        });

        // 2. Add previous step results with quality filtering
        const stepKeys = Object.keys(contextData).filter(
          (key) => key.startsWith("step") && key.endsWith("_result")
        );
        stepKeys.forEach((stepKey) => {
          const stepResult = contextData[stepKey];
          // Only use results that look substantial (not placeholders)
          if (
            stepResult &&
            typeof stepResult === "string" &&
            stepResult.length > 20 &&
            !stepResult.includes("{{") &&
            !stepResult.includes("[Please check")
          ) {
            // Map to common argument names based on step position
            const stepNumber = parseInt(stepKey.match(/step(\d+)/)?.[1] || "0");

            if (stepNumber === 1) {
              stepArgs.initial_analysis = stepResult;
              stepArgs.previous_result = stepResult;
              console.log(
                `     ✅ Quality result: initial_analysis <- ${stepKey}`
              );
            } else if (stepNumber === 2) {
              stepArgs.analysis = stepResult;
              stepArgs.previous_result = stepResult;
              console.log(`     ✅ Quality result: analysis <- ${stepKey}`);
            } else if (stepNumber === 3) {
              stepArgs.notes = stepResult;
              stepArgs.previous_result = stepResult;
              console.log(`     ✅ Quality result: notes <- ${stepKey}`);
            } else {
              // Generic mapping for other steps
              stepArgs.previous_result = stepResult;
              stepArgs[`step${stepNumber}_output`] = stepResult;
              console.log(
                `     ✅ Quality result: step${stepNumber}_output <- ${stepKey}`
              );
            }
            fallbackCount++;
          } else {
            console.log(
              `     ⚠️ Skipping low-quality result: ${stepKey} (length: ${
                stepResult?.length || 0
              })`
            );
          }
        });

        // 3. If no quality results found, provide the most recent available
        if (fallbackCount === 0 && stepKeys.length > 0) {
          const mostRecentKey = stepKeys[stepKeys.length - 1];
          const mostRecentResult = contextData[mostRecentKey];
          if (mostRecentResult) {
            stepArgs.previous_result = mostRecentResult;
            stepArgs.context = mostRecentResult;
            console.log(
              `     🚨 Fallback: using most recent result ${mostRecentKey} despite quality issues`
            );
            fallbackCount++;
          }
        }

        // Additional enhanced fallback patterns
        if (fallbackCount === 0) {
          // If no standard patterns matched, be more aggressive
          console.log(
            `     🔍 No standard fallback patterns matched, trying enhanced patterns`
          );

          // Pass through any original args that seem relevant
          ["topic", "data", "input", "text", "query", "information"].forEach(
            (commonArg) => {
              if (originalArgs[commonArg]) {
                stepArgs[commonArg] = originalArgs[commonArg];
                console.log(
                  `     ✅ Enhanced fallback: ${commonArg} <- originalArgs`
                );
                fallbackCount++;
              }
            }
          );

          // Use the most recent context result if available
          const lastStepKey = `step${currentStep}_result`;
          const prevStepKey = `step${currentStep - 1}_result`;
          if (contextData[prevStepKey]) {
            stepArgs.previous_result = contextData[prevStepKey];
            console.log(
              `     ✅ Enhanced fallback: previous_result <- ${prevStepKey}`
            );
            fallbackCount++;
          }
        }
      }

      console.log(
        `   📊 Fallback result: ${fallbackCount} arguments mapped via fallback logic`
      );
    }

    console.log(
      `   🎯 Final step arguments (${Object.keys(stepArgs).length} total):`,
      Object.keys(stepArgs).length > 0
        ? Object.keys(stepArgs)
            .map((k) => `${k}=${typeof stepArgs[k]}`)
            .join(", ")
        : "NONE"
    );

    this.logger.debug(`Final step arguments:`, stepArgs);
    return stepArgs;
  }

  /**
   * Format step command with arguments - Enhanced to handle complex values
   */
  private formatStepCommand(
    promptId: string,
    stepArgs: Record<string, any>
  ): string {
    console.log(`\n📝 [Chain Debug] Formatting command for ${promptId}:`);
    console.log(
      `   🎯 Arguments to format:`,
      Object.keys(stepArgs).length > 0 ? Object.keys(stepArgs) : "NONE"
    );

    if (Object.keys(stepArgs).length === 0) {
      console.log(`   📤 Final command: >>${promptId} (no arguments)`);
      return `>>${promptId}`;
    }

    // Enhanced argument formatting to handle complex values
    const argStrings = Object.entries(stepArgs)
      .filter(
        ([key, value]) => value !== undefined && value !== null && value !== ""
      ) // Skip empty values
      .map(([key, value]) => {
        // Convert value to string and handle special cases
        let valueStr: string;

        if (typeof value === "object") {
          // Handle objects by JSON stringifying
          valueStr = JSON.stringify(value);
        } else if (typeof value === "string") {
          // Handle multi-line strings by preserving newlines but ensuring valid command format
          if (value.includes("\n") || value.includes('"')) {
            // For complex strings, truncate for command display but log the issue
            if (value.length > 200) {
              valueStr =
                value.substring(0, 200).replace(/\n/g, " ") + "...[truncated]";
              console.log(
                `     ⚠️  Truncated long ${key} value (${value.length} chars -> ${valueStr.length} chars)`
              );
            } else {
              valueStr = value.replace(/\n/g, " ").replace(/"/g, "'"); // Replace problematic characters
            }
          } else {
            valueStr = value;
          }
        } else {
          valueStr = String(value);
        }

        // Escape quotes in the value
        const escapedValue = valueStr.replace(/"/g, '\\"');
        console.log(
          `     ✅ ${key}="${escapedValue.substring(0, 50)}${
            escapedValue.length > 50 ? "..." : ""
          }"`
        );

        return `${key}="${escapedValue}"`;
      });

    const finalCommand = `>>${promptId} ${argStrings.join(" ")}`;
    console.log(
      `   📤 Final command: ${finalCommand.substring(0, 100)}${
        finalCommand.length > 100 ? "..." : ""
      }`
    );

    return finalCommand;
  }

  /**
   * Inject gate guidance into prompt arguments (Phase 2 implementation)
   */
  private async injectGateGuidance(
    prompt: ConvertedPrompt,
    args: Record<string, any>
  ): Promise<Record<string, any>> {
    // Check if gates are enabled in config
    const config = this.configManager.getConfig();
    if (!config.gates?.enabled || !config.gates?.enableGuidanceInjection) {
      return args; // Not enabled, return original args
    }

    // Get gate IDs from prompt data
    const promptData = this.promptsData.find((p) => p.id === prompt.id);
    if (!promptData?.gates || promptData.gates.length === 0) {
      return args; // No gates defined, return original args
    }

    // Convert legacy gate definitions to gate IDs
    const gateIds = promptData.gates.map((gate) =>
      typeof gate === "string" ? gate : gate.id
    );

    try {
      // Get guidance text from lightweight gate system
      const guidanceText = await this.lightweightGateSystem.getGuidanceText(
        gateIds,
        {
          promptCategory: this.categorizePrompt(prompt.id),
          framework: "CAGEERF", // TODO: Get from execution context
          explicitRequest: true,
        }
      );

      if (guidanceText.length > 0) {
        // Inject guidance as a special variable
        const enhancedArgs = {
          ...args,
          gate_guidance: guidanceText.join("\n\n"),
          _internal_gates_active: gateIds.join(", "),
        };

        this.logger.debug(`Injected guidance for gates: ${gateIds.join(", ")}`);
        return enhancedArgs;
      }

      return args;
    } catch (error) {
      this.logger.error("Failed to inject gate guidance:", error);
      return args; // Return original args on error
    }
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

  /**
   * Execute chain with LLM-driven execution model
   * Uses markdown-embedded chain steps for sequential execution
   */
  private async executeChainWithDualSupport(
    convertedPrompt: ConvertedPrompt,
    promptArgs: Record<string, any>,
    enableGates: boolean,
    options: Record<string, any>,
    sessionControlArgs?: { force_restart?: boolean; session_id?: string }
  ): Promise<ToolResponse> {
    const chainId = convertedPrompt.id;

    // All chains use LLM-driven execution with markdown-embedded steps
    this.logger.info(`📋 Executing chain: ${chainId}`);

    return await this.generateChainInstructions(
      convertedPrompt,
      convertedPrompt.chainSteps || [],
      enableGates,
      promptArgs
    );
  }

  /**
   * MIGRATION: Chain management commands - deprecated scaffolding removed
   */
  private async executeChainManagement(
    action: string,
    parameters: Record<string, any>,
    options: Record<string, any>
  ): Promise<ToolResponse> {
    try {
      this.logger.info(`🔗 Chain management action: ${action}`);

      // Chain utilities available via this.convertedPrompts
      const promptsBasePath = this.getPromptsBasePath();

      switch (action) {
        // DEPRECATED COMMANDS - Provide migration guidance
        case "scaffold":
        case "convert":
        case "scaffold_using":
        case "add_step":
        case "remove_step":
        case "reorder_steps":
          return {
            content: [
              {
                type: "text",
                text: `🚀 **Migration to Markdown-Embedded Chains Complete!**

The '${action}' command is no longer needed because chains are now embedded directly in markdown files.

**✅ New Approach:**
1. Create chains by adding a "## Chain Steps" section to any markdown prompt
2. Define steps with gates directly in markdown:

\`\`\`markdown
## Chain Steps

1. promptId: content_analysis
   stepName: Initial Content Analysis
   gates: ["research-quality"]
   inputMapping:
     content: content
   outputMapping:
     analysis_output: step_0_output
\`\`\`

**📖 Benefits:**
- ✅ Self-contained - everything in one file
- ✅ Easier to maintain and understand
- ✅ Gate configurations embedded
- ✅ No external JSON files needed

**🔍 Example:** See \`prompts/analysis/notes.md\` for a complete chain example.

**Command '${action}' is deprecated after Phase 3 migration.**`,
              },
            ],
            isError: true,
          };

        // VALID COMMANDS - Keep functionality
        case "validate":
          return await this.handleValidateCommand(parameters, promptsBasePath);

        case "list_chains":
          return await this.handleListChainsCommand(promptsBasePath);

        case "list_templates":
        case "discover_workflows":
          // MIGRATION: Template and workflow discovery consolidated into prompt_manager
          return {
            content: [
              {
                type: "text",
                text: `🚀 **Migration to Consolidated Prompt Manager!**

The '${action}' command has been consolidated into the more powerful \`prompt_manager\` tool.

**New Commands:**
- **List prompts by category**: \`prompt_manager action=list filter=category:analysis\`
- **Search with multiple filters**: \`prompt_manager action=list filter="category:code type:chain confidence:>80"\`
- **Discover with intent**: \`prompt_manager action=list filter="intent:debugging category:development"\`

**Migration Benefits:**
- Advanced search with intelligent filtering
- Better organization and discoverability
- Consistent interface across all prompt operations
- More accurate categorization and matching

**Example Usage:**
\`\`\`
prompt_manager action=list filter="category:development type:workflow"
prompt_manager action=list filter="intent:analysis confidence:>70"
\`\`\`

See the prompt_manager tool documentation for complete filter syntax.`,
              },
            ],
            isError: true,
          };

        case "info":
          // MIGRATION: Chain info functionality consolidated into markdown-embedded chains
          return {
            content: [
              {
                type: "text",
                text: `🚀 **Migration to Markdown-Embedded Chains Complete!**

The 'info' command is no longer needed because chains are now embedded directly in markdown files.

**To view chain information:**
1. Use \`prompt_manager\` tool to list and filter chains: \`prompt_manager action=list filter=category:analysis\`
2. Read chain markdown files directly to see step definitions and configurations
3. Use framework switching with \`system_control\` for methodology-based chain execution

**Migration Benefits:**
- All chain information is self-contained in markdown files
- No external JSON dependencies to manage
- Easier to edit and maintain chain definitions
- Better integration with hot-reloading system`,
              },
            ],
            isError: true,
          };

        default:
          throw new Error(`Unknown chain management action: ${action}`);
      }
    } catch (error) {
      const errorMessage = `Chain management failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.logger.error(errorMessage);

      return {
        content: [{ type: "text", text: errorMessage }],
        isError: true,
      };
    }
  }
  // REMOVED: handleScaffoldCommand (~56 lines) - deprecated scaffolding functionality

  // REMOVED: handleConvertCommand (~42 lines) - deprecated chain conversion functionality

  /**
   * Handle validate command for markdown-embedded chains
   */
  private async handleValidateCommand(
    parameters: Record<string, any>,
    promptsBasePath: string
  ): Promise<ToolResponse> {
    const { target: chainId } = parameters;

    if (!chainId) {
      throw new Error("Chain ID is required for validate command");
    }

    // Find the chain in converted prompts
    const chainPrompt = this.convertedPrompts.find((p) => p.id === chainId);

    if (!chainPrompt) {
      throw new Error(`Chain not found: ${chainId}`);
    }

    // Check if it's actually a chain
    if (!chainPrompt.chainSteps || chainPrompt.chainSteps.length === 0) {
      throw new Error(`${chainId} is not a chain (no chain steps found)`);
    }

    // Perform validation on markdown-embedded chain
    const issues: string[] = [];

    // Validate each step
    for (const [index, step] of chainPrompt.chainSteps.entries()) {
      if (!step.promptId || !step.stepName) {
        issues.push(`Step ${index + 1}: Missing promptId or stepName`);
      }
    }

    let message = `✅ **Chain Validation Results**\n\n`;
    message += `**Chain:** ${chainId}\n`;
    message += `**Steps:** ${chainPrompt.chainSteps.length}\n`;
    message += `**Type:** Markdown-embedded chain\n`;
    message += `**Status:** ${
      issues.length === 0 ? "✅ Valid" : "❌ Issues Found"
    }\n`;

    if (issues.length > 0) {
      message += `\n**Issues:**\n`;
      issues.forEach((issue) => {
        message += `- ${issue}\n`;
      });
    } else {
      message += `\n✅ No issues found. Chain is valid.\n`;
    }

    return {
      content: [{ type: "text", text: message }],
      isError: issues.length > 0,
    };
  }

  /**
   * Handle list chains command
   */
  private async handleListChainsCommand(
    promptsBasePath: string
  ): Promise<ToolResponse> {
    let message = `📋 **Available Chains**\n\n`;

    let chainCount = 0;

    for (const prompt of this.convertedPrompts) {
      if (prompt.chainSteps && prompt.chainSteps.length > 0) {
        chainCount++;
        message += `🔗 **${prompt.id}**\n`;
        if (prompt.description) {
          message += `   ${prompt.description}\n`;
        }
        message += `   Steps: ${prompt.chainSteps.length}\n`;
        message += `\n`;
      }
    }

    if (chainCount === 0) {
      message += `No chains found.\n`;
    } else {
      message += `\n**Summary:** ${chainCount} chain${
        chainCount === 1 ? "" : "s"
      } available\n`;
    }

    return {
      content: [{ type: "text", text: message }],
      isError: false,
    };
  }

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
