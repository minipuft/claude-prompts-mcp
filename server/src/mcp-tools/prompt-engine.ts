/**
 * Consolidated Prompt Engine - Unified Execution Tool
 *
 * Consolidates all prompt execution functionality into a single systematic tool:
 * - execute_prompt (from index.ts)
 * - Chain execution with progress tracking
 * - Structural execution mode detection
 * - Gate validation and retry logic
 */

import { z } from "zod";
import { Logger } from "../logging/index.js";
import { PromptManager } from "../prompts/index.js";
import {
  ToolResponse,
  ConvertedPrompt,
  PromptData,
  ExecutionState,
  ChainExecutionProgress,
  GateDefinition,
} from "../types/index.js";
import {
  ValidationError,
  PromptError,
  handleError as utilsHandleError,
} from "../utils/index.js";
// Gate evaluation removed - now using Framework methodology validation
import { ConfigurableSemanticAnalyzer } from "../analysis/configurable-semantic-analyzer.js";
import { ConversationManager } from "../text-references/conversation.js";
import { FrameworkStateManager } from "../frameworks/framework-state-manager.js";
import {
  FrameworkManager,
  FrameworkExecutionContext,
  createFrameworkManager,
} from "../frameworks/framework-manager.js";
import {
  GateEvaluationService,
  createGateEvaluator,
} from "../gates/evaluators/index.js";
// Phase 3: Removed ExecutionCoordinator import - no longer needed for server-side chain execution
// New unified parsing system
import {
  createParsingSystem,
  type ParsingSystem,
  type CommandParseResult,
  type ArgumentParsingResult,
  type ExecutionContext,
} from "../execution/parsers/index.js";

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
  private semanticAnalyzer: ConfigurableSemanticAnalyzer;
  private conversationManager: ConversationManager;
  private frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  private gateEvaluationService: GateEvaluationService;
  // Phase 3: Removed executionCoordinator - chains now use LLM-driven execution model

  // New unified parsing system
  private parsingSystem: ParsingSystem;

  // Data references
  private promptsData: PromptData[] = [];
  private convertedPrompts: ConvertedPrompt[] = [];

  // Execution state tracking
  private currentExecutionState: ExecutionState | null = null;
  private executionHistory: ExecutionState[] = [];
  private chainProgressState: ChainExecutionProgress | null = null;

  // Analytics - 3-Tier Execution Model
  private executionAnalytics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageExecutionTime: 0,
    executionsByMode: {
      prompt: 0, // Basic variable substitution
      template: 0, // Framework-aware execution
      chain: 0, // LLM-driven multi-step execution
    },
  };

  constructor(
    logger: Logger,
    mcpServer: any,
    promptManager: PromptManager,
    semanticAnalyzer: ConfigurableSemanticAnalyzer,
    conversationManager: ConversationManager,
    gateEvaluationService: GateEvaluationService
    // Phase 3: Removed executionCoordinator parameter - no longer needed
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.promptManager = promptManager;
    this.semanticAnalyzer = semanticAnalyzer;
    this.conversationManager = conversationManager;
    this.gateEvaluationService = gateEvaluationService;
    // Phase 3: Removed executionCoordinator assignment - using LLM-driven chain model

    // Initialize new parsing system
    this.parsingSystem = createParsingSystem(logger);
    this.logger.info(
      "ConsolidatedPromptEngine initialized with new unified parsing system"
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
   * Get framework-enhanced system prompt injection
   */
  private async getFrameworkExecutionContext(
    prompt: ConvertedPrompt
  ): Promise<FrameworkExecutionContext | null> {
    if (!this.frameworkManager || !this.frameworkStateManager) {
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
   * Register the consolidated prompt engine tool
   */
  registerTool(): void {
    this.mcpServer.tool(
      "prompt_engine",
      "🚀 INTELLIGENT PROMPT ENGINE: Unified execution system with MANDATORY quality gate validation and active framework methodology guidance. Always follow gate criteria and framework-specific validation shown in structured response metadata sections. Handles all execution types with intelligent analysis.",
      {
        command: z
          .string()
          .describe(
            "SIMPLE: >>prompt_name content | ADVANCED: JSON with execution options"
          ),

        execution_mode: z
          .enum(["auto", "prompt", "template", "chain"])
          .optional()
          .describe("Override intelligent auto-detection (default: auto)"),

        gate_validation: z
          .boolean()
          .optional()
          .describe(
            "Quality gate validation (MANDATORY for chains, auto-detected by default, see metadata sections for gate details)"
          ),

        step_confirmation: z
          .boolean()
          .optional()
          .describe("Require confirmation between chain steps"),

        auto_execute_chain: z
          .boolean()
          .optional()
          .describe("Automatically execute all chain steps sequentially"),

        timeout: z
          .number()
          .optional()
          .describe("Execution timeout in milliseconds"),

        options: z
          .record(z.any())
          .optional()
          .describe("Additional execution options"),
      },
      async (
        args: {
          command: string;
          execution_mode?: "auto" | "prompt" | "template" | "chain";
          gate_validation?: boolean;
          step_confirmation?: boolean;
          auto_execute_chain?: boolean;
          timeout?: number;
          options?: Record<string, any>;
        },
        extra: any
      ) => {
        try {
          return await this.executePromptCommand(args, extra);
        } catch (error) {
          return this.handleError(error, "prompt_engine");
        }
      }
    );

    this.logger.info("Consolidated Prompt Engine registered successfully");
  }

  /**
   * Main prompt execution handler
   */
  private async executePromptCommand(
    args: {
      command: string;
      execution_mode?: "auto" | "prompt" | "template" | "chain";
      gate_validation?: boolean;
      step_confirmation?: boolean;
      auto_execute_chain?: boolean;
      timeout?: number;
      options?: Record<string, any>;
    },
    extra: any
  ): Promise<ToolResponse> {
    const {
      command,
      execution_mode = "auto",
      gate_validation,
      step_confirmation = false,
      auto_execute_chain = true, // Default to auto-execute for LLM-driven chain execution
      timeout,
      options = {},
    } = args;

    this.logger.info(
      `🚀 Prompt Engine: Executing "${command}" (mode: ${execution_mode})`
    );

    // Parse command to extract prompt and arguments using new unified system
    const {
      promptId,
      arguments: promptArgs,
      convertedPrompt,
    } = await this.parseCommandUnified(command);

    // Perform intelligent execution mode detection (Phase 2: 3-tier model)
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

    // Determine gate validation settings
    const effectiveGateValidation =
      gate_validation ?? effectiveExecutionMode === "chain";

    this.logger.debug(
      `Effective settings: mode=${effectiveExecutionMode}, gates=${effectiveGateValidation}`
    );

    // Create execution state
    this.currentExecutionState = {
      type: convertedPrompt.isChain ? "chain" : "single",
      promptId: convertedPrompt.id,
      status: "pending",
      gates: [],
      results: {},
      metadata: {
        startTime: Date.now(),
        executionMode: effectiveExecutionMode,
        stepConfirmation: step_confirmation,
        gateValidation: effectiveGateValidation,
      },
    };

    // Route to appropriate execution strategy - THREE-TIER MODEL
    switch (effectiveExecutionMode) {
      case "prompt":
        // NEW: Basic variable substitution without framework processing (fastest)
        return await this.executePrompt(convertedPrompt, promptArgs);

      case "template":
        // Framework-aware execution with methodology guidance
        return await this.executeTemplateWithFramework(
          convertedPrompt,
          promptArgs,
          effectiveGateValidation
        );

      case "chain":
        // Strategic Phase 3: Return chain instructions for LLM-driven execution
        // Chains are instruction templates, not server executables
        return this.generateChainInstructions(
          convertedPrompt,
          convertedPrompt.chainSteps || [],
          effectiveGateValidation,
          step_confirmation
        );

      default:
        throw new ValidationError(
          `Unknown execution mode: ${effectiveExecutionMode}`
        );
    }
  }

  /**
   * Parse command string using unified parsing system
   */
  private async parseCommandUnified(command: string): Promise<{
    promptId: string;
    arguments: Record<string, any>;
    convertedPrompt: ConvertedPrompt;
  }> {
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
  private createDisabledAnalysisFallback(prompt: ConvertedPrompt): PromptClassification {
    const hasChainSteps = Boolean(prompt.chainSteps?.length) || Boolean(prompt.isChain);
    const argCount = prompt.arguments?.length || 0;
    const hasTemplateVars = /\{\{.*?\}\}/g.test(prompt.userMessageTemplate || '');
    
    // Reliable structural detection: only use verifiable indicators
    const hasComplexTemplateLogic = /\{\{.*?\|.*?\}\}|\{%-.*?-%\}|\{%.*?if.*?%\}|\{%.*?for.*?%\}/g.test(prompt.userMessageTemplate || '');
    const hasMultipleArgs = argCount > 1; // More than one argument suggests complexity
    
    // Three-tier detection based on structural indicators only
    let executionType: 'prompt' | 'template' | 'chain' = 'prompt';
    
    if (hasChainSteps) {
      executionType = 'chain';
    } else if (hasComplexTemplateLogic) {
      // Complex Nunjucks logic always needs template mode
      executionType = 'template';
    } else if (hasTemplateVars && hasMultipleArgs) {
      // Template variables with multiple args suggests framework benefit
      executionType = 'template';
    }
    // Default to 'prompt' for simple cases (no vars, single arg, or static content)
    
    return {
      executionType,
      requiresExecution: true,
      confidence: 0.9, // High confidence in structural detection
      reasoning: [
        "Structural auto detection (semantic analysis disabled)",
        `Args: ${argCount}, Template vars: ${hasTemplateVars}, Complex logic: ${hasComplexTemplateLogic}`,
        `Selected ${executionType} mode based on verifiable structural indicators`
      ],
      suggestedGates: ['basic_validation'],
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
   * @todo Implement when ConfigurableSemanticAnalyzer LLM integration is enabled
   * @todo Design proper interface for semantic intent classification
   * @todo Add confidence scoring and reasoning for intent decisions
   */
  private async detectAnalysisIntentLLM(prompt: ConvertedPrompt): Promise<boolean> {
    // STUB: Always return false until LLM semantic analysis is implemented
    // When implemented, this will use the LLM to intelligently detect:
    // - Analysis vs formatting tasks
    // - Complex reasoning requirements  
    // - Domain-specific analytical patterns
    // - Context-dependent intent signals
    
    this.logger.debug(`LLM analysis intent detection not yet implemented for ${prompt.id}`);
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
      this.logger.debug(`Semantic analysis disabled for ${prompt.id} - using structural fallback`);
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
        executionType: prompt.isChain ? "chain" : "template",
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

    // Fast variable substitution using template processor (no advanced features)
    content = await this.promptManager.processTemplateAsync(
      content,
      args,
      {}, // No special context for basic prompts
      false // No tools for basic prompts
    );

    // Update state and analytics
    this.currentExecutionState.status = "completed";
    this.currentExecutionState.metadata.endTime = Date.now();
    this.updateAnalytics();

    // Add execution type feedback for basic prompts
    const executionTime =
      Date.now() - this.currentExecutionState.metadata.startTime;
    const feedbackFooter = `\n\n---\n⚡ **Basic Prompt Execution** | 🚀 Fast variable substitution | ⏱️ ${executionTime}ms`;

    return { content: [{ type: "text", text: content + feedbackFooter }] };
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

    content = await this.promptManager.processTemplateAsync(
      content,
      args,
      { previous_message: "{{previous_message}}" },
      prompt.tools || false
    );

    // Apply gate validation if enabled
    if (enableGates) {
      const gateResult = await this.validateWithGates(content, prompt);
      if (!gateResult.success) {
        return (
          gateResult.response || {
            content: [{ type: "text", text: "Gate validation failed" }],
          }
        );
      }
    }

    // Update state and analytics
    this.currentExecutionState.status = "completed";
    this.currentExecutionState.metadata.endTime = Date.now();
    this.updateAnalytics();

    // Add execution type feedback for framework-aware templates
    const executionTime =
      Date.now() - this.currentExecutionState.metadata.startTime;
    const gateInfo = enableGates ? " | ✅ Quality gates applied" : "";
    // Dynamic framework footer based on active framework
    const activeFrameworkName = this.frameworkStateManager
      ? this.frameworkStateManager.getActiveFramework().name
      : "CAGEERF Framework";

    const feedbackFooter = `\n\n---\n🧠 **Framework Template Execution** | 🎯 ${activeFrameworkName}${gateInfo} | ⏱️ ${executionTime}ms`;

    return { content: [{ type: "text", text: content + feedbackFooter }] };
  }

  /**
   * Extract gate status information for LLM guidance
   */
  private getGateInfo(enableGates: boolean): {
    status: string;
    gates: Array<{ name: string; file: string; criteria: string }>;
  } {
    const gates = [
      {
        name: "Content Analysis",
        file: "@server/src/gates/evaluators/strategies/content-analysis-evaluators.ts",
        criteria: enableGates
          ? "✅ Active - Minimum length, structure validation, quality checks"
          : "⚠️ Disabled",
      },
      {
        name: "Pattern Matching",
        file: "@server/src/gates/evaluators/strategies/pattern-matching-evaluators.ts",
        criteria: enableGates
          ? "✅ Active - Template variables, argument validation, format compliance"
          : "⚠️ Disabled",
      },
      {
        name: "Structure Validation",
        file: "@server/src/gates/evaluators/strategies/structure-validation-evaluators.ts",
        criteria: enableGates
          ? "✅ Active - Markdown structure, section requirements"
          : "⚠️ Disabled",
      },
      {
        name: "Custom Logic",
        file: "@server/src/gates/evaluators/strategies/custom-logic-evaluators.ts",
        criteria: enableGates
          ? "✅ Active - Framework-specific validation rules"
          : "⚠️ Disabled",
      },
    ];

    return {
      status: enableGates
        ? "✅ Quality Gates ENABLED - Validation MANDATORY"
        : "⚠️ Quality Gates DISABLED",
      gates,
    };
  }

  /**
   * Generate structured metadata section for LLM guidance
   */
  private generateMetadataSection(
    chainId: string,
    currentStep: number,
    totalSteps: number,
    stepData: any,
    contextData: Record<string, any>,
    enableGates: boolean
  ): string {
    const gateInfo = this.getGateInfo(enableGates);
    const progressPercent = Math.round(((currentStep + 1) / totalSteps) * 100);

    let metadata = `\n## 🛡️ Quality Gate Status\n`;
    metadata += `**${gateInfo.status}**\n\n`;

    gateInfo.gates.forEach((gate) => {
      metadata += `- **${gate.name}**: ${gate.criteria}\n`;
      metadata += `  - Location: ${gate.file}\n`;
    });

    // Framework section removed - details available via system_control status

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
   * NEW: Smart iterative execution with step-by-step LLM guidance
   */
  private generateChainInstructions(
    prompt: ConvertedPrompt,
    steps: any[],
    enableGates: boolean,
    stepConfirmation: boolean
  ): ToolResponse {
    const chainId = prompt.id;
    const totalSteps = steps.length;

    // Get or initialize chain state
    let chainState = this.conversationManager.getChainState(chainId);
    if (!chainState) {
      // Initialize chain execution
      this.conversationManager.setChainState(chainId, 0, totalSteps);
      chainState = { currentStep: 0, totalSteps };
      this.logger.info(
        `🔗 Initializing chain execution: ${chainId} (${totalSteps} steps)`
      );
    }

    const currentStep = chainState.currentStep;

    // Check if chain is complete
    if (currentStep >= totalSteps) {
      this.logger.info(`🎉 Chain ${chainId} completed successfully`);

      // Get final result and clear chain context
      const finalResult =
        this.conversationManager.getStepResult(chainId, totalSteps - 1) ||
        "Chain execution completed";
      this.conversationManager.clearChainContext(chainId);

      return {
        content: [
          {
            type: "text",
            text: `🎉 **Chain Complete**: ${prompt.name}\n\n${finalResult}`,
          },
        ],
        // Removed ignored nextAction field - MCP protocol doesn't pass it to LLMs
      };
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

    if (currentStep === 0) {
      // First step - use original content
      primaryInstructions += `**Execute**: Call \`prompt_engine\` with:\n`;
      primaryInstructions += `\`\`\`\n>>${stepData.promptId}\n\`\`\`\n\n`;
    } else {
      // Subsequent steps - include previous step results
      primaryInstructions += `**Execute**: Call \`prompt_engine\` with step context:\n`;
      primaryInstructions += `\`\`\`\n>>${stepData.promptId}\n\`\`\`\n\n`;
      primaryInstructions += `**Context from previous steps**:\n`;
      Object.keys(contextData).forEach((key) => {
        const value = contextData[key];
        const truncated =
          value.length > 100 ? value.substring(0, 100) + "..." : value;
        primaryInstructions += `- ${key}: ${truncated}\n`;
      });
      primaryInstructions += `\n`;
    }

    primaryInstructions += `**Next**: After execution, call \`prompt_engine\` again to continue to step ${
      currentStep + 2
    }/${totalSteps}`;

    // Generate structured metadata section for LLM guidance
    const metadataSection = this.generateMetadataSection(
      chainId,
      currentStep,
      totalSteps,
      stepData,
      contextData,
      enableGates
    );

    // Advance to next step for next iteration
    this.conversationManager.setChainState(
      chainId,
      currentStep + 1,
      totalSteps
    );

    // Return structured response with separate content sections
    return {
      content: [
        {
          type: "text",
          text: primaryInstructions,
        },
        {
          type: "text",
          text: metadataSection,
        },
      ],
      // Removed ignored nextAction field - MCP protocol doesn't pass it to LLMs
    };
  }

  /**
   * Validate content with optional gate evaluation
   * Gates are only applied if specified in the prompt template
   */
  private async validateWithGates(
    content: string,
    prompt: ConvertedPrompt
  ): Promise<{ success: boolean; response?: ToolResponse }> {
    // Basic content validation first
    if (!content || content.trim().length === 0) {
      return {
        success: false,
        response: {
          content: [
            {
              type: "text",
              text: `❌ **Content Validation Failed**\n\nGenerated content is empty or invalid.`,
            },
          ],
          isError: true,
        },
      };
    }

    // Check if prompt specifies gates for validation
    const promptData = this.promptsData.find((p) => p.id === prompt.id);
    if (!promptData?.gates || promptData.gates.length === 0) {
      this.logger.debug(
        `No gates specified for prompt ${prompt.id}, skipping gate validation`
      );
      return { success: true };
    }

    this.logger.debug(
      `Evaluating ${promptData.gates.length} gates for prompt ${prompt.id}`
    );

    try {
      // Evaluate gates using the gate evaluation service
      const gateResults = await this.gateEvaluationService.evaluateGates(
        content,
        promptData.gates,
        {
          prompt: promptData,
          timestamp: Date.now(),
          framework: this.frameworkStateManager?.getActiveFramework(),
        }
      );

      // Check if all gates passed
      const failedGates = gateResults.filter((result) => !result.passed);

      if (failedGates.length > 0) {
        const failureMessages = failedGates
          .map(
            (gate) =>
              `- **${gate.gateId}**: ${gate.evaluationResults
                .map((r) => r.message)
                .join(", ")}`
          )
          .join("\n");

        return {
          success: false,
          response: {
            content: [
              {
                type: "text",
                text: `❌ **Gate Validation Failed**\n\n${failedGates.length} gate(s) did not pass:\n${failureMessages}\n\n📝 **Generated Content**:\n${content}`,
              },
            ],
            isError: false,
          },
        };
      }

      this.logger.debug(
        `All ${gateResults.length} gates passed for prompt ${prompt.id}`
      );
      return { success: true };
    } catch (error) {
      this.logger.error(
        `Gate evaluation failed for prompt ${prompt.id}:`,
        error
      );

      return {
        success: false,
        response: {
          content: [
            {
              type: "text",
              text: `⚠️ **Gate Evaluation Error**\n\nFailed to evaluate gates: ${
                error instanceof Error ? error.message : "Unknown error"
              }\n\nProceeding without gate validation.\n\n📝 **Generated Content**:\n${content}`,
            },
          ],
          isError: false,
        },
      };
    }
  }

  /**
   * Update execution analytics
   */
  private updateAnalytics(): void {
    if (!this.currentExecutionState) return;

    this.executionAnalytics.totalExecutions++;

    if (this.currentExecutionState.status === "completed") {
      this.executionAnalytics.successfulExecutions++;
    } else if (this.currentExecutionState.status === "failed") {
      this.executionAnalytics.failedExecutions++;
    }

    // Update execution time
    const duration =
      (this.currentExecutionState.metadata.endTime || Date.now()) -
      this.currentExecutionState.metadata.startTime;
    this.executionAnalytics.averageExecutionTime =
      (this.executionAnalytics.averageExecutionTime *
        (this.executionAnalytics.totalExecutions - 1) +
        duration) /
      this.executionAnalytics.totalExecutions;

    // Update mode statistics
    const mode = this.currentExecutionState.metadata.executionMode;
    if (mode && this.executionAnalytics.executionsByMode[mode] !== undefined) {
      this.executionAnalytics.executionsByMode[mode]++;
    }

    // Store in history
    this.executionHistory.push({ ...this.currentExecutionState });
    if (this.executionHistory.length > 100) {
      this.executionHistory.shift();
    }
  }

  /**
   * Get execution analytics
   */
  getAnalytics(): typeof this.executionAnalytics {
    return { ...this.executionAnalytics };
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
    const { message, isError } = utilsHandleError(error, context, this.logger);
    return {
      content: [{ type: "text", text: message }],
      isError,
    };
  }
}

/**
 * Create consolidated prompt engine with enhanced parsing system
 */
export function createConsolidatedPromptEngine(
  logger: Logger,
  mcpServer: any,
  promptManager: PromptManager,
  semanticAnalyzer: ConfigurableSemanticAnalyzer,
  conversationManager: ConversationManager
  // Phase 3: Removed executionCoordinator parameter - using LLM-driven chain model
): ConsolidatedPromptEngine {
  // Initialize gate evaluation service
  const gateEvaluationService = createGateEvaluator(logger);

  const engine = new ConsolidatedPromptEngine(
    logger,
    mcpServer,
    promptManager,
    semanticAnalyzer,
    conversationManager,
    gateEvaluationService
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
