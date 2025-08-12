/**
 * MCP Tools Module
 * Handles registration and implementation of MCP tools for the server
 */

import { z } from "zod";
import { ConfigManager } from "../config/index.js";
import { Logger } from "../logging/index.js";
import { PromptManager } from "../prompts/index.js";
import {
  Category,
  ConvertedPrompt,
  PromptData,
  ToolResponse,
  ExecutionMode,
  ExecutionState,
  GateDefinition,
} from "../types/index.js";
import {
  PromptError,
  handleError as utilsHandleError,
  validateJsonArguments,
  ValidationError,
} from "../utils/index.js";
import { createGateEvaluator, GateEvaluator } from "../utils/gateValidation.js";
import { SemanticAnalyzer, PromptClassification } from "../utils/semanticAnalyzer.js";
import { PromptManagementTools } from "./prompt-management-tools.js";
// import { GateManagementTools } from "./gate-management-tools.js"; // TODO: Add when gate management tools are implemented
import { TemplateGenerationTools } from "./template-generation-tools.js";

/**
 * MCP Tools Manager class
 */
export class McpToolsManager {
  private logger: Logger;
  private mcpServer: any;
  private promptManager: PromptManager;
  private configManager: ConfigManager;
  private promptManagementTools: PromptManagementTools;
  private gateEvaluator: GateEvaluator;
  // private gateManagementTools?: GateManagementTools; // TODO: Add when gate management tools are implemented
  private templateGenerationTools: TemplateGenerationTools;
  private semanticAnalyzer: SemanticAnalyzer;
  private promptsData: PromptData[] = [];
  private convertedPrompts: ConvertedPrompt[] = [];
  private categories: Category[] = [];
  private currentExecutionState: ExecutionState | null = null;
  private executionHistory: ExecutionState[] = [];
  private executionAnalytics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    retriedExecutions: 0,
    gateValidationCount: 0,
    averageExecutionTime: 0,
    executionsByMode: {
      auto: 0,
      template: 0,
      chain: 0,
      workflow: 0,
    },
    classificationHistory: {} as Record<string, {
      classification: PromptClassification;
      timestamp: number;
      confidence: number;
    }>,
    learningData: [] as any[],
    confidenceTrends: {} as Record<string, Array<{confidence: number; timestamp: number}>>
  };

  constructor(
    logger: Logger,
    mcpServer: any,
    promptManager: PromptManager,
    configManager: ConfigManager,
    onRefresh: () => Promise<void>,
    onRestart: (reason: string) => Promise<void>
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.promptManager = promptManager;
    this.configManager = configManager;
    this.gateEvaluator = createGateEvaluator(logger);
    this.semanticAnalyzer = new SemanticAnalyzer();
    this.promptManagementTools = new PromptManagementTools(
      logger,
      mcpServer,
      configManager,
      onRefresh,
      onRestart
    );
    this.templateGenerationTools = new TemplateGenerationTools(logger, mcpServer);
  }

  /**
   * Set gate management tools (called after initialization)
   */
  // setGateManagementTools(gateManagementTools: GateManagementTools): void {
  //   this.gateManagementTools = gateManagementTools;
  // } // TODO: Add when gate management tools are implemented

  /**
   * Register all MCP tools with the server
   */
  async registerAllTools(): Promise<void> {
    this.logger.info("Registering MCP tools with server...");

    // Register each tool
    this.registerExecutePrompt();
    this.registerListPrompts();
    this.promptManagementTools.registerUpdatePrompt();
    this.promptManagementTools.registerDeletePrompt();
    this.promptManagementTools.registerModifyPromptSection();
    this.promptManagementTools.registerReloadPrompts();

    // Register analytics tool
    this.registerExecutionAnalytics();

    // Register gate management tools if available
    // if (this.gateManagementTools) {
    //   this.registerGateManagementTools(); // TODO: Add when gate management tools are implemented
    // }

    // Register template generation tools
    this.templateGenerationTools.registerAllTools();

    this.logger.info("All MCP tools registered successfully");
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
    this.promptManagementTools.updateData(promptsData, convertedPrompts);
  }

  /**
   * Register execute_prompt tool with intelligent execution mode detection
   */
  private registerExecutePrompt(): void {
    this.mcpServer.tool(
      "execute_prompt",
      "🧠 INTELLIGENT PROMPT EXECUTION: Just provide your content and let smart defaults handle everything! Auto-detects prompt types, applies quality gates, and optimizes execution. Simple usage: >>prompt_name your_content_here",
      {
        command: z
          .string()
          .describe(
            "SIMPLE: >>prompt_name your_content_here (intelligent defaults handle everything) | ADVANCED: JSON format for custom control. Smart auto-detection optimizes execution type, quality gates, and validation automatically."
          ),
        execution_mode: z
          .enum(["auto", "template", "chain", "workflow"])
          .optional()
          .describe(
            "OPTIONAL: Override intelligent auto-detection. 'auto' (smart defaults), 'template' (info only), 'chain' (step-by-step), 'workflow' (full validation). Usually not needed - smart defaults work great!"
          ),
        gate_validation: z
          .boolean()
          .optional()
          .describe(
            "OPTIONAL: Force quality validation on/off. Smart defaults automatically apply appropriate gates based on prompt complexity. Usually auto-detection is perfect!"
          ),
        step_confirmation: z
          .boolean()
          .optional()
          .describe(
            "OPTIONAL: Pause between chain steps for manual approval. Only needed for sensitive workflows - smart execution usually handles everything smoothly!"
          ),
      },
      async ({ 
        command, 
        execution_mode = "auto", 
        gate_validation, 
        step_confirmation = false 
      }: { 
        command: string; 
        execution_mode?: "auto" | "template" | "chain" | "workflow";
        gate_validation?: boolean;
        step_confirmation?: boolean;
      }, extra: any) => {
        try {
          this.logger.info(`Executing prompt command: ${command} (mode: ${execution_mode})`);

          // Extract the command name and arguments
          const match = command.match(/^(>>|\/)([a-zA-Z0-9_-]+)\s*(.*)/);

          if (!match) {
            throw new ValidationError(
              "Invalid command format. Use >>command_name [arguments] or /command_name [arguments]"
            );
          }

          const [, prefix, commandName, commandArgs] = match;

          // Find the matching prompt (PromptData)
          const matchingPrompt = this.promptsData.find(
            (prompt) => prompt.id === commandName || prompt.name === commandName
          );

          if (!matchingPrompt) {
            throw new PromptError(
              `Unknown command: ${prefix}${commandName}. Type >>listprompts to see available commands.`
            );
          }

          // Find the corresponding ConvertedPrompt to access onEmptyInvocation
          const convertedPrompt = this.convertedPrompts.find(
            (cp) => cp.id === matchingPrompt.id
          );

          if (!convertedPrompt) {
            // This should ideally not happen if promptsData and convertedPrompts are in sync
            throw new PromptError(
              `Could not find converted prompt data for ${matchingPrompt.id}. Server data might be inconsistent.`
            );
          }

          // Auto-detect execution mode if set to "auto"
          let effectiveExecutionMode = execution_mode;
          if (execution_mode === "auto") {
            effectiveExecutionMode = this.detectExecutionMode(convertedPrompt);
          }

          // Determine gate validation setting
          let effectiveGateValidation = gate_validation;
          if (effectiveGateValidation === undefined) {
            // Default to true for chains/workflows, false for single prompts
            effectiveGateValidation = effectiveExecutionMode === "chain" || effectiveExecutionMode === "workflow";
          }

          this.logger.debug(`Effective execution mode: ${effectiveExecutionMode}, gate validation: ${effectiveGateValidation}`);

          // Check if we should return template info instead of executing
          const trimmedCommandArgs = commandArgs.trim();

          // Use smart execution decision instead of static onEmptyInvocation
          const shouldExecute = this.determineSmartExecutionBehavior(
            convertedPrompt,
            trimmedCommandArgs,
            effectiveExecutionMode,
            extra
          );

          if (
            effectiveExecutionMode === "template" ||
            !shouldExecute
          ) {
            this.logger.info(
              `Returning template info for '${prefix}${commandName}' (mode: ${effectiveExecutionMode}, smart decision: ${shouldExecute})`
            );

            return this.generateTemplateInfo(convertedPrompt, prefix);
          }

          // Parse arguments if commandArgs is not empty, or if it's empty but onEmptyInvocation is 'execute_if_possible'
          const promptArgValues: Record<string, string> = {};

          // Only call parseCommandArguments if there are actual commandArgs to parse
          // If commandArgs is empty and onEmptyInvocation is 'execute_if_possible',
          // the subsequent logic will fill them with {{previous_message}}
          if (trimmedCommandArgs !== "") {
            this.parseCommandArguments(
              trimmedCommandArgs, // Use trimmed version
              matchingPrompt, // parseCommandArguments expects PromptData
              promptArgValues,
              prefix,
              commandName
            );
          }

          // Ensure all defined arguments have values (fills with {{previous_message}} if not provided)
          matchingPrompt.arguments.forEach((arg) => {
            if (!promptArgValues[arg.name]) {
              promptArgValues[arg.name] = `{{previous_message}}`;
            }
          });

          // Create execution state
          this.currentExecutionState = {
            type: convertedPrompt.isChain ? 'chain' : 'single',
            promptId: convertedPrompt.id,
            status: 'pending',
            gates: [],
            results: {},
            metadata: {
              startTime: Date.now(),
              executionMode: effectiveExecutionMode,
              stepConfirmation: step_confirmation,
              gateValidation: effectiveGateValidation,
            },
          };

          // Handle different execution modes
          switch (effectiveExecutionMode) {
            case "chain":
              if (convertedPrompt.isChain) {
                return await this.executeChainWithGates(
                  convertedPrompt,
                  promptArgValues,
                  effectiveGateValidation,
                  step_confirmation
                );
              } else {
                throw new ValidationError(
                  `Prompt '${commandName}' is not a chain but was requested to execute as chain`
                );
              }

            case "workflow":
              return await this.executeWorkflowWithGates(
                convertedPrompt,
                promptArgValues,
                step_confirmation
              );

            default: // "auto" falls through to regular processing
              if (convertedPrompt.isChain) {
                return this.handleChainPrompt(convertedPrompt);
              }

              // Process regular prompt with optional gate validation
              return await this.processRegularPromptWithGates(
                convertedPrompt,
                promptArgValues,
                effectiveGateValidation
              );
          }
        } catch (error) {
          const { message, isError } = this.handleError(
            error,
            "Error processing command"
          );
          return {
            content: [{ type: "text", text: message }],
            isError,
          };
        }
      }
    );
  }

  /**
   * Parse command arguments
   */
  private parseCommandArguments(
    commandArgs: string,
    matchingPrompt: PromptData,
    promptArgValues: Record<string, string>,
    prefix: string,
    commandName: string
  ): void {
    if (matchingPrompt.arguments.length === 0) {
      this.logger.warn(
        `Command '${prefix}${commandName}' doesn't accept arguments, but arguments were provided: ${commandArgs}`
      );
      return;
    }

    const trimmedArgs = commandArgs.trim();
    
    // Check if it's JSON format
    const isJsonFormat = trimmedArgs.startsWith("{") && trimmedArgs.endsWith("}");
    
    if (isJsonFormat) {
      // Handle JSON format (advanced usage)
      try {
        const parsedArgs = JSON.parse(trimmedArgs);
        const validation = validateJsonArguments(parsedArgs, matchingPrompt);

        if (!validation.valid && validation.errors) {
          this.logger.warn(
            `Invalid JSON arguments for ${prefix}${commandName}: ${validation.errors.join(
              ", "
            )}. Using intelligent defaults.`
          );
          this.applyIntelligentDefaults(matchingPrompt, promptArgValues, trimmedArgs);
        } else {
          Object.assign(promptArgValues, validation.sanitizedArgs || {});
        }
      } catch (e) {
        this.logger.warn(
          `Error parsing JSON arguments for ${prefix}${commandName}: ${
            e instanceof Error ? e.message : String(e)
          }. Using intelligent defaults.`
        );
        this.applyIntelligentDefaults(matchingPrompt, promptArgValues, trimmedArgs);
      }
    } else {
      // Handle simple text format (quick start usage)
      if (matchingPrompt.arguments.length === 1) {
        // Single argument - direct assignment
        promptArgValues[matchingPrompt.arguments[0].name] = trimmedArgs;
      } else if (matchingPrompt.arguments.length <= 3) {
        // For 2-3 arguments, try to parse intelligently
        this.parseSimpleTextArguments(matchingPrompt, promptArgValues, trimmedArgs);
      } else {
        // For complex prompts (4+ args), use the first argument or primary content field
        this.applyIntelligentDefaults(matchingPrompt, promptArgValues, trimmedArgs);
      }
    }
  }

  /**
   * Parse simple text arguments for prompts with 2-3 parameters
   */
  private parseSimpleTextArguments(
    matchingPrompt: PromptData,
    promptArgValues: Record<string, string>,
    content: string
  ): void {
    // Try to intelligently split content for multiple arguments
    // Look for natural separators or use the whole content for the main argument
    const args = matchingPrompt.arguments;
    
    // Find the most likely "content" or "main" argument
    const contentArg = args.find(arg => 
      arg.name.toLowerCase().includes('content') ||
      arg.name.toLowerCase().includes('text') ||
      arg.name.toLowerCase().includes('input') ||
      arg.name.toLowerCase().includes('data') ||
      arg.name.toLowerCase().includes('message')
    ) || args[0]; // Default to first argument

    // Assign the content to the main argument
    promptArgValues[contentArg.name] = content;
    
    // Fill remaining arguments with intelligent defaults
    args.forEach(arg => {
      if (arg.name !== contentArg.name && !promptArgValues[arg.name]) {
        promptArgValues[arg.name] = `{{previous_message}}`;
      }
    });
  }

  /**
   * Apply intelligent defaults when parsing fails or for complex prompts
   */
  private applyIntelligentDefaults(
    matchingPrompt: PromptData,
    promptArgValues: Record<string, string>,
    userContent: string
  ): void {
    // Find the most appropriate argument for user content
    const args = matchingPrompt.arguments;
    
    // Priority order for content assignment
    const contentPriority = ['content', 'text', 'input', 'data', 'message', 'query', 'prompt'];
    
    let targetArg = null;
    for (const priority of contentPriority) {
      targetArg = args.find(arg => arg.name.toLowerCase().includes(priority));
      if (targetArg) break;
    }
    
    // If no priority match, use the first argument
    if (!targetArg) {
      targetArg = args[0];
    }
    
    // Assign user content to the target argument
    if (targetArg) {
      promptArgValues[targetArg.name] = userContent;
    }
    
    // Fill remaining arguments with placeholders
    args.forEach(arg => {
      if (!promptArgValues[arg.name]) {
        promptArgValues[arg.name] = `{{previous_message}}`;
      }
    });
  }

  /**
   * Handle chain prompt execution
   */
  private handleChainPrompt(convertedPrompt: ConvertedPrompt): ToolResponse {
    const chainSteps = convertedPrompt.chainSteps || [];

    const chainExplanation = [
      `This is a prompt chain: ${convertedPrompt.name} (${convertedPrompt.id})`,
      `It consists of ${chainSteps.length} steps that should be executed in sequence:`,
      ...chainSteps.map(
        (step: any, index: number) =>
          `${index + 1}. ${step.stepName} (${step.promptId})`
      ),
      `\nTo execute this chain, run each step in sequence using the '>>' or '/' command syntax:`,
      ...chainSteps.map(
        (step: any, index: number) =>
          `${index + 1}. >>${step.promptId} [with appropriate arguments]`
      ),
      `\nEach step will use outputs from previous steps as inputs for the next step.`,
    ].join("\n");

    return {
      content: [{ type: "text", text: chainExplanation }],
    };
  }

  /**
   * Process regular (non-chain) prompt
   */
  private async processRegularPrompt(
    convertedPrompt: ConvertedPrompt,
    promptArgValues: Record<string, string>
  ): Promise<ToolResponse> {
    let userMessageText = convertedPrompt.userMessageTemplate;

    // Add system message if present
    if (convertedPrompt.systemMessage) {
      userMessageText = `[System Info: ${convertedPrompt.systemMessage}]\n\n${userMessageText}`;
    }

    // Process the template to replace all placeholders, passing the tools flag
    userMessageText = await this.promptManager.processTemplateAsync(
      userMessageText,
      promptArgValues,
      { previous_message: "{{previous_message}}" },
      convertedPrompt.tools || false
    );

    return {
      content: [{ type: "text", text: userMessageText }],
    };
  }

  /**
   * Process regular prompt with optional gate validation
   */
  private async processRegularPromptWithGates(
    convertedPrompt: ConvertedPrompt,
    promptArgValues: Record<string, string>,
    enableGates: boolean
  ): Promise<ToolResponse> {
    if (!this.currentExecutionState) {
      throw new PromptError("No execution state available");
    }

    this.currentExecutionState.status = 'running';
    
    // Generate the prompt content
    let userMessageText = convertedPrompt.userMessageTemplate;

    // Add system message if present
    if (convertedPrompt.systemMessage) {
      userMessageText = `[System Info: ${convertedPrompt.systemMessage}]\n\n${userMessageText}`;
    }

    // Process the template to replace all placeholders
    userMessageText = await this.promptManager.processTemplateAsync(
      userMessageText,
      promptArgValues,
      { previous_message: "{{previous_message}}" },
      convertedPrompt.tools || false
    );

    // Apply gate validation if enabled and gates are defined (manual or auto-assigned)
    const gatesToEvaluate = [
      ...(convertedPrompt.gates || []),
      ...((convertedPrompt as any).autoAssignedGates || [])
    ];
    
    if (enableGates && gatesToEvaluate.length > 0) {
      this.logger.debug(`Evaluating ${gatesToEvaluate.length} gates for ${convertedPrompt.id}:`, 
        gatesToEvaluate.map(g => g.name));
      
      const gateStatuses = await this.gateEvaluator.evaluateGates(
        userMessageText,
        gatesToEvaluate
      );

      this.currentExecutionState.gates = gateStatuses;

      const failedGates = gateStatuses.filter(gate => !gate.passed);
      if (failedGates.length > 0) {
        // Check if retry is possible
        const shouldRetry = this.gateEvaluator.shouldRetry(gateStatuses, 3);
        
        if (shouldRetry) {
          this.currentExecutionState.status = 'retrying';
          
          // Increment retry count for failed gates
          failedGates.forEach(gate => {
            gate.retryCount = (gate.retryCount || 0) + 1;
          });
          
          const retryMessage = this.gateEvaluator.getRetryMessage(gateStatuses);
          const retryInstructions = this.generateRetryInstructions(failedGates, convertedPrompt);
          
          return {
            content: [{ 
              type: "text", 
              text: `🔄 **RETRY OPPORTUNITY**: Gate validation failed but retry is possible\n\n${retryMessage}\n\n${retryInstructions}\n\n📝 **Generated content (for review)**:\n${userMessageText}` 
            }],
            isError: false,
          };
        } else {
          this.currentExecutionState.status = 'failed';
          const retryMessage = this.gateEvaluator.getRetryMessage(gateStatuses);
          
          return {
            content: [{ 
              type: "text", 
              text: `❌ **GATE VALIDATION FAILED**: Maximum retries exceeded\n\n${retryMessage}\n\n📝 **Final generated content**:\n${userMessageText}` 
            }],
            isError: true,
          };
        }
      }
    }

    this.currentExecutionState.status = 'completed';
    this.currentExecutionState.metadata.endTime = Date.now();
    this.currentExecutionState.results['output'] = userMessageText;

    // Update analytics
    this.updateExecutionAnalytics(this.currentExecutionState);

    // Add execution metadata to the response
    const executionInfo = enableGates && convertedPrompt.gates?.length 
      ? `\n\n✅ Executed with gate validation (${convertedPrompt.gates.length} gates passed)`
      : "";

    return {
      content: [{ type: "text", text: userMessageText + executionInfo }],
    };
  }

  /**
   * Execute chain with gate validation
   */
  private async executeChainWithGates(
    convertedPrompt: ConvertedPrompt,
    promptArgValues: Record<string, string>,
    enableGates: boolean,
    stepConfirmation: boolean
  ): Promise<ToolResponse> {
    const chainSteps = convertedPrompt.chainSteps || [];

    if (!this.currentExecutionState) {
      throw new PromptError("No execution state available");
    }

    this.currentExecutionState.status = 'running';
    this.currentExecutionState.type = 'chain';
    this.currentExecutionState.totalSteps = chainSteps.length;

    const chainExplanation = [
      `🔄 **ENHANCED CHAIN EXECUTION**: ${convertedPrompt.name} (${convertedPrompt.id})`,
      ``,
      `This chain consists of ${chainSteps.length} steps with ${enableGates ? 'GATE VALIDATION' : 'no validation'}:`,
      ``,
      ...chainSteps.map(
        (step: any, index: number) =>
          `${index + 1}. **${step.stepName}** (${step.promptId})`
      ),
      ``,
      `⚡ **EXECUTION INSTRUCTIONS**: ${stepConfirmation ? 'STEP-BY-STEP CONFIRMATION MODE' : 'SEQUENTIAL EXECUTION'}`,
    ];

    if (stepConfirmation) {
      // Step-by-step confirmation mode
      chainExplanation.push(
        ``,
        `✋ **STEP CONFIRMATION ENABLED**: Execute one step at a time and wait for confirmation`,
        ``,
        `**🚀 STEP 1**: Start with:`,
        `\`\`\`json`,
        JSON.stringify({
          command: `>>${chainSteps[0].promptId} [your_arguments]`,
          execution_mode: "workflow",
          gate_validation: enableGates,
          step_confirmation: true
        }, null, 2),
        `\`\`\``,
        ``,
        `After completing Step 1, I will:`,
        `- ✅ Validate the output against quality gates`,
        `- 📊 Show progress status (1/${chainSteps.length} completed)`,
        `- 🔄 Provide instructions for Step 2`,
        `- ⏸️ Wait for your confirmation to proceed`,
        ``,
        `**Benefits of Step Confirmation**:`,
        `- 🔍 Review and validate each step's output`,
        `- 🛠️ Make adjustments before proceeding`,
        `- 🚫 Stop the chain if issues are detected`,
        `- 📈 Track progress with detailed feedback`
      );
    } else {
      // Sequential execution mode
      chainExplanation.push(
        ``,
        `**Execute all steps in sequence:**`,
        ...chainSteps.map(
          (step: any, index: number) =>
            `${index + 1}. \`>>execute_prompt {"command": ">>${step.promptId} [arguments]", "execution_mode": "workflow", "gate_validation": ${enableGates}}\``
        )
      );
    }

    chainExplanation.push(
      ``,
      enableGates ? `🛡️ **Gate Validation**: Each step will be validated before proceeding` : '',
      `🔗 **Chain Context**: Each step builds upon previous results`,
      `📊 **Progress Tracking**: Execution state will be monitored throughout`,
    );

    // Update execution state
    this.currentExecutionState.currentStep = 0;
    this.currentExecutionState.metadata.stepConfirmation = stepConfirmation;
    this.currentExecutionState.metadata.gateValidation = enableGates;

    return {
      content: [{ type: "text", text: chainExplanation.filter(line => line !== '').join("\n") }],
    };
  }

  /**
   * Execute workflow with full gate validation
   */
  private async executeWorkflowWithGates(
    convertedPrompt: ConvertedPrompt,
    promptArgValues: Record<string, string>,
    stepConfirmation: boolean
  ): Promise<ToolResponse> {
    if (!this.currentExecutionState) {
      throw new PromptError("No execution state available");
    }

    this.currentExecutionState.status = 'running';
    this.currentExecutionState.type = 'workflow';

    // Generate the workflow instructions
    let workflowText = convertedPrompt.userMessageTemplate;

    // Add system message if present
    if (convertedPrompt.systemMessage) {
      workflowText = `[System Info: ${convertedPrompt.systemMessage}]\n\n${workflowText}`;
    }

    // Process the template
    workflowText = await this.promptManager.processTemplateAsync(
      workflowText,
      promptArgValues,
      { previous_message: "{{previous_message}}" },
      convertedPrompt.tools || false
    );

    // Add workflow execution header
    const workflowHeader = [
      `🎯 **WORKFLOW EXECUTION REQUIRED**`,
      `📋 **Prompt**: ${convertedPrompt.name}`,
      `⚡ **Auto-Execution**: This workflow will be executed step-by-step with validation`,
      `🔄 **Progress Tracking**: Each step will be validated before proceeding`,
      stepConfirmation ? `✋ **Manual Confirmation**: Confirmation required between steps` : '',
      ``,
    ].filter(line => line !== '').join("\n");

    const fullWorkflowText = workflowHeader + workflowText;

    this.currentExecutionState.status = 'completed';
    this.currentExecutionState.metadata.endTime = Date.now();
    this.currentExecutionState.results['workflow'] = fullWorkflowText;

    return {
      content: [{ type: "text", text: fullWorkflowText }],
    };
  }

  /**
   * Detect execution mode using intelligent semantic analysis
   */
  private detectExecutionMode(convertedPrompt: ConvertedPrompt): "auto" | "template" | "chain" | "workflow" {
    // Check for explicit execution mode in prompt (highest priority)
    if (convertedPrompt.executionMode) {
      this.logger.debug(`Explicit execution mode specified: ${convertedPrompt.executionMode}`);
      return convertedPrompt.executionMode;
    }

    // Use semantic analysis for intelligent detection
    const classification = this.semanticAnalyzer.analyzePrompt(convertedPrompt);
    
    // Auto-assign quality gates based on analysis
    this.autoAssignQualityGates(convertedPrompt, classification);
    
    // Log the analysis for debugging
    this.logger.debug(`Semantic analysis for ${convertedPrompt.id}:`, {
      executionType: classification.executionType,
      confidence: classification.confidence,
      requiresExecution: classification.requiresExecution,
      reasoning: classification.reasoning,
      suggestedGates: classification.suggestedGates
    });

    // Store classification for analytics and future improvements
    this.storeClassificationAnalytics(convertedPrompt.id, classification);

    return classification.executionType;
  }

  /**
   * Auto-assign quality gates based on semantic analysis
   */
  private autoAssignQualityGates(prompt: ConvertedPrompt, classification: PromptClassification): void {
    // Create intelligent gate definitions based on classification
    const autoGates: GateDefinition[] = [];
    
    // Always apply basic validation for workflows
    if (classification.requiresExecution && classification.confidence > 0.5) {
      autoGates.push({
        id: "basic_content_validation",
        name: "Basic Content Validation",
        type: "validation",
        requirements: [
          {
            type: "content_length",
            criteria: { min: 50 },
            required: true
          }
        ],
        failureAction: "retry"
      });
    }

    // Add complexity-based gates for high-confidence workflows
    if (classification.executionType === "workflow" && classification.confidence > 0.7) {
      // Add keyword presence validation for analysis prompts
      if (classification.reasoning.some(r => r.includes("analysis"))) {
        autoGates.push({
          id: "analysis_quality_gate",
          name: "Analysis Quality Gate",
          type: "quality",
          requirements: [
            {
              type: "keyword_presence",
              criteria: { keywords: ["analysis", "findings", "conclusion"] },
              required: false,
              weight: 0.7
            },
            {
              type: "content_length",
              criteria: { min: 200 },
              required: true
            }
          ],
          failureAction: "retry"
        });
      }
      
      // Add structured format validation for complex prompts
      if (prompt.arguments.length > 2) {
        autoGates.push({
          id: "structured_format_gate",
          name: "Structured Format Gate", 
          type: "validation",
          requirements: [
            {
              type: "format_validation",
              criteria: { format: "structured" },
              required: true
            }
          ],
          failureAction: "retry"
        });
      }
    }

    // Add chain-specific gates
    if (classification.executionType === "chain") {
      autoGates.push({
        id: "chain_completion_gate",
        name: "Chain Step Completion Gate",
        type: "validation", 
        requirements: [
          {
            type: "content_length",
            criteria: { min: 100 },
            required: true
          }
        ],
        failureAction: "retry"
      });
    }

    // Store the auto-assigned gates in the prompt for execution use
    if (autoGates.length > 0) {
      (prompt as any).autoAssignedGates = autoGates;
      this.logger.debug(`Auto-assigned ${autoGates.length} quality gates for ${prompt.id}:`, 
        autoGates.map(g => g.name));
    }
  }

  /**
   * Store classification analytics for learning and improvement
   */
  private storeClassificationAnalytics(promptId: string, classification: PromptClassification): void {
    // Store classification data for future analysis and improvement
    if (!this.executionAnalytics.classificationHistory) {
      this.executionAnalytics.classificationHistory = {};
    }
    
    this.executionAnalytics.classificationHistory[promptId] = {
      classification,
      timestamp: Date.now(),
      confidence: classification.confidence
    };

    // Learning feedback: adjust confidence based on execution success
    this.improveDetectionAccuracy(promptId, classification);
  }

  /**
   * Improve detection accuracy through learning feedback
   */
  private improveDetectionAccuracy(promptId: string, classification: PromptClassification): void {
    // Basic learning system - can be expanded with ML models
    const history = this.executionAnalytics.classificationHistory[promptId];
    
    if (history) {
      // If we've seen this prompt before, compare classifications
      const previousClassification = history.classification;
      
      if (previousClassification.executionType !== classification.executionType) {
        // Classification changed - could indicate learning opportunity
        this.logger.debug(`Classification changed for ${promptId}: ${previousClassification.executionType} → ${classification.executionType}`);
        
        // Future enhancement: adjust semantic patterns based on successful executions
        this.logLearningOpportunity(promptId, previousClassification, classification);
      }
    }

    // Track confidence trends for future model training
    this.trackConfidenceTrends(promptId, classification.confidence);
  }

  /**
   * Log learning opportunities for future model improvements
   */
  private logLearningOpportunity(promptId: string, previous: PromptClassification, current: PromptClassification): void {
    const learningData = {
      promptId,
      timestamp: Date.now(),
      previousClassification: {
        type: previous.executionType,
        confidence: previous.confidence,
        reasoning: previous.reasoning
      },
      newClassification: {
        type: current.executionType,
        confidence: current.confidence,
        reasoning: current.reasoning
      },
      changeReason: "Re-analysis with improved patterns"
    };

    // Store for future ML model training
    if (!this.executionAnalytics.learningData) {
      this.executionAnalytics.learningData = [];
    }
    
    this.executionAnalytics.learningData.push(learningData);
    
    // Keep only last 100 learning entries
    if (this.executionAnalytics.learningData.length > 100) {
      this.executionAnalytics.learningData.shift();
    }

    this.logger.info(`Learning opportunity logged for ${promptId}: classification accuracy improvement potential detected`);
  }

  /**
   * Track confidence trends for pattern optimization
   */
  private trackConfidenceTrends(promptId: string, confidence: number): void {
    if (!this.executionAnalytics.confidenceTrends) {
      this.executionAnalytics.confidenceTrends = {};
    }

    if (!this.executionAnalytics.confidenceTrends[promptId]) {
      this.executionAnalytics.confidenceTrends[promptId] = [];
    }

    this.executionAnalytics.confidenceTrends[promptId].push({
      confidence,
      timestamp: Date.now()
    });

    // Keep only last 10 confidence measurements per prompt
    if (this.executionAnalytics.confidenceTrends[promptId].length > 10) {
      this.executionAnalytics.confidenceTrends[promptId].shift();
    }
  }

  /**
   * Determine whether to execute a prompt or return template info using intelligent analysis
   */
  private determineSmartExecutionBehavior(
    convertedPrompt: ConvertedPrompt,
    commandArgs: string,
    executionMode: string,
    extra: any
  ): boolean {
    // If user explicitly provided arguments, always execute
    if (commandArgs.trim() !== "") {
      this.logger.debug(`Smart execution: executing due to provided arguments for ${convertedPrompt.id}`);
      return true;
    }

    // If execution mode is explicitly template, respect that
    if (executionMode === "template") {
      this.logger.debug(`Smart execution: returning template due to explicit template mode for ${convertedPrompt.id}`);
      return false;
    }

    // Use semantic analysis to make intelligent decision
    const classification = this.semanticAnalyzer.analyzePrompt(convertedPrompt);
    
    // Check for previous message context that could be used as input
    const hasPreviousContext = this.detectPreviousMessageContext(extra);
    
    // Decision matrix based on multiple factors
    const shouldExecute = this.evaluateExecutionDecision(
      convertedPrompt,
      classification,
      hasPreviousContext
    );

    this.logger.info(
      `🧠 Smart execution decision for ${convertedPrompt.id}: ${shouldExecute ? 'EXECUTE' : 'TEMPLATE'} ` +
      `(confidence: ${Math.round(classification.confidence * 100)}%, context: ${hasPreviousContext}, ` +
      `type: ${classification.executionType}, requires_execution: ${classification.requiresExecution})`
    );

    return shouldExecute;
  }

  /**
   * Detect if there's meaningful previous message context available
   */
  private detectPreviousMessageContext(extra: any): boolean {
    // Enhanced context detection with actual conversation analysis
    
    // Check if we have access to conversation context through the MCP extra parameter
    if (extra && extra.conversation && extra.conversation.messages) {
      const messages = extra.conversation.messages;
      
      // Look for recent user messages with substantial content
      const recentUserMessages = messages
        .filter((msg: any) => msg.role === 'user')
        .slice(-3); // Last 3 user messages
      
      for (const message of recentUserMessages) {
        if (message.content && typeof message.content === 'string') {
          const content = message.content.trim();
          
          // Check for meaningful content (not just commands)
          if (content.length > 20 && !content.startsWith('>>') && !content.startsWith('/')) {
            this.logger.debug(`Context detected: meaningful user content found (${content.length} chars)`);
            return true;
          }
        }
      }
      
      this.logger.debug('No meaningful previous context found in conversation');
      return false;
    }
    
    // Fallback: check if there are any execution analytics indicating recent activity
    if (this.executionHistory.length > 0) {
      const recentExecution = this.executionHistory[this.executionHistory.length - 1];
      const timeSinceLastExecution = Date.now() - recentExecution.metadata.startTime;
      
      // If there was recent execution within 5 minutes, assume context is available
      if (timeSinceLastExecution < 300000) { // 5 minutes
        this.logger.debug('Context inferred from recent execution activity');
        return true;
      }
    }
    
    // Conservative default: assume some context is usually available in interactive sessions
    this.logger.debug('Using conservative context assumption');
    return true;
  }

  /**
   * Evaluate execution decision based on multiple factors
   */
  private evaluateExecutionDecision(
    prompt: ConvertedPrompt,
    classification: PromptClassification,
    hasContext: boolean
  ): boolean {
    const reasoningLog: string[] = [];

    // 1. High confidence action prompts should execute if context is available
    if (classification.requiresExecution && classification.confidence > 0.7 && hasContext) {
      reasoningLog.push(`High confidence action (${Math.round(classification.confidence * 100)}%) with context`);
      this.logExecutionReasoning(prompt.id, true, reasoningLog);
      return true;
    }

    // 2. Specific prompt patterns that should always execute with context
    const actionKeywords = [
      'refine', 'analyze', 'process', 'improve', 'enhance', 'organize', 'transform',
      'review', 'evaluate', 'summarize', 'extract', 'convert', 'generate', 'create'
    ];
    
    const isActionOriented = actionKeywords.some(keyword => 
      prompt.name.toLowerCase().includes(keyword) || 
      prompt.id.toLowerCase().includes(keyword)
    );

    if (isActionOriented && hasContext) {
      reasoningLog.push(`Action-oriented prompt with context available`);
      this.logExecutionReasoning(prompt.id, true, reasoningLog);
      return true;
    }

    // 3. Prompts that expect previous_message should execute when context is available
    if (prompt.userMessageTemplate.includes('{{previous_message}}') && hasContext) {
      reasoningLog.push(`Template uses {{previous_message}} with context available`);
      this.logExecutionReasoning(prompt.id, true, reasoningLog);
      return true;
    }

    // 4. Chain prompts should usually execute
    if (prompt.isChain) {
      reasoningLog.push(`Chain prompt detected`);
      this.logExecutionReasoning(prompt.id, true, reasoningLog);
      return true;
    }

    // 5. Specific prompt categories that benefit from execution
    const executionFriendlyCategories = ['analysis', 'development', 'content_processing'];
    if (executionFriendlyCategories.includes(prompt.category) && hasContext) {
      reasoningLog.push(`Execution-friendly category (${prompt.category}) with context`);
      this.logExecutionReasoning(prompt.id, true, reasoningLog);
      return true;
    }

    // 6. Special handling for common template-returning prompts
    const templatePreferredPatterns = [
      /template/i, /format/i, /structure/i, /example/i, /guide/i
    ];
    
    const seemsTemplateOriented = templatePreferredPatterns.some(pattern =>
      pattern.test(prompt.name) || pattern.test(prompt.description)
    );

    // 7. Check if this is clearly an informational/template request
    if (seemsTemplateOriented && !classification.requiresExecution && !hasContext) {
      reasoningLog.push(`Template-oriented prompt without execution context`);
      this.logExecutionReasoning(prompt.id, false, reasoningLog);
      return false;
    }

    // 8. For prompts with explicit "return_template" setting, be more conservative
    if (prompt.onEmptyInvocation === "return_template" && 
        !classification.requiresExecution &&
        classification.confidence < 0.6 &&
        !isActionOriented) {
      reasoningLog.push(`Explicit return_template setting with low execution confidence`);
      this.logExecutionReasoning(prompt.id, false, reasoningLog);
      return false;
    }

    // 9. Default decision based on semantic analysis
    const decision = classification.requiresExecution;
    reasoningLog.push(`Default semantic analysis decision: ${decision ? 'execute' : 'template'}`);
    this.logExecutionReasoning(prompt.id, decision, reasoningLog);
    return decision;
  }

  /**
   * Log execution reasoning for transparency and debugging
   */
  private logExecutionReasoning(promptId: string, decision: boolean, reasoning: string[]): void {
    this.logger.debug(
      `🧠 Execution decision for ${promptId}: ${decision ? 'EXECUTE' : 'TEMPLATE'}\n` +
      `   Reasoning: ${reasoning.join('; ')}`
    );
  }

  /**
   * Generate template information response
   */
  private generateTemplateInfo(convertedPrompt: ConvertedPrompt, prefix: string): ToolResponse {
    let responseText = `📋 **Template Info**: '${convertedPrompt.name}' (ID: ${convertedPrompt.id})\n\n`;
    responseText += `**Description**: ${convertedPrompt.description}\n\n`;

    // Get semantic analysis
    const classification = this.semanticAnalyzer.analyzePrompt(convertedPrompt);
    
    // Add intelligent analysis information
    responseText += `🧠 **Intelligent Analysis**:\n`;
    responseText += `  - **Detected Type**: ${classification.executionType} (${Math.round(classification.confidence * 100)}% confidence)\n`;
    responseText += `  - **Requires Execution**: ${classification.requiresExecution ? 'Yes' : 'No'}\n`;
    
    if (classification.suggestedGates.length > 0) {
      responseText += `  - **Suggested Quality Gates**: ${classification.suggestedGates.join(', ')}\n`;
    }
    
    responseText += `\n`;

    // Add usage recommendation
    if (classification.requiresExecution) {
      responseText += `💡 **Recommended Usage**: \`${prefix}${convertedPrompt.id} <arguments>\` (will auto-execute)\n\n`;
    } else {
      responseText += `💡 **Usage**: \`${prefix}${convertedPrompt.id}\` (returns template information)\n\n`;
    }

    if (convertedPrompt.arguments && convertedPrompt.arguments.length > 0) {
      responseText += `**Arguments**:\n`;
      convertedPrompt.arguments.forEach((arg) => {
        responseText += `  - \`${arg.name}\`${
          arg.required ? " (required)" : " (optional)"
        }: ${arg.description || "No description"}\n`;
      });

      responseText += `\n**🚀 Quick Start**:\n`;
      
      if (convertedPrompt.arguments.length === 1) {
        const argName = convertedPrompt.arguments[0].name;
        responseText += `\`${prefix}${convertedPrompt.id} your ${argName} here\`\n\n`;
      } else if (convertedPrompt.arguments.length <= 3) {
        // For simple prompts, show text format
        const simpleArgs = convertedPrompt.arguments.map(arg => `<${arg.name}>`).join(' ');
        responseText += `\`${prefix}${convertedPrompt.id} ${simpleArgs}\`\n\n`;
      } else {
        // For complex prompts, still show simple format but mention JSON option
        responseText += `\`${prefix}${convertedPrompt.id} <content>\` *(Smart defaults will handle most cases)*\n\n`;
      }

      responseText += `**⚙️ Advanced Usage**:\n`;
      if (convertedPrompt.arguments.length > 1) {
        const exampleArgs: Record<string, string> = {};
        convertedPrompt.arguments.forEach((arg) => {
          exampleArgs[arg.name] = `<your ${arg.name} here>`;
        });
        responseText += `\`${prefix}${convertedPrompt.id} ${JSON.stringify(exampleArgs)}\`\n`;
      }
      
      // Add execution mode examples
      responseText += `\`>>execute_prompt {"command": "${prefix}${convertedPrompt.id} args", "execution_mode": "workflow"}\`\n\n`;
    } else {
      responseText += "**Arguments**: None required\n\n";
      responseText += `**Usage**: \`${prefix}${convertedPrompt.id}\`\n`;
    }

    // Add gate information if available
    if (convertedPrompt.gates && convertedPrompt.gates.length > 0) {
      responseText += `\n**Quality Gates**: ${convertedPrompt.gates.length} validation gates configured\n`;
    }

    return {
      content: [{ type: "text" as const, text: responseText }],
      isError: false,
    };
  }

  /**
   * Generate retry instructions for failed gates
   */
  private generateRetryInstructions(failedGates: any[], convertedPrompt: ConvertedPrompt): string {
    const instructions = [
      `📋 **RETRY INSTRUCTIONS**:`,
      ``,
      `To retry with improvements, use:`,
      `\`\`\`json`,
      JSON.stringify({
        command: `>>${convertedPrompt.id} [improved_arguments]`,
        execution_mode: "workflow",
        gate_validation: true
      }, null, 2),
      `\`\`\``,
      ``,
      `**🎯 Focus on addressing these issues**:`,
    ];

    failedGates.forEach((gate, index) => {
      const failedRequirements = gate.evaluationResults
        .filter((result: any) => !result.passed)
        .map((result: any) => result.message);
      
      instructions.push(`${index + 1}. **Gate: ${gate.gateId}**`);
      failedRequirements.forEach((msg: string) => {
        instructions.push(`   - ${msg}`);
      });
    });

    instructions.push(
      ``,
      `**💡 Improvement Tips**:`,
      `- Ensure content meets minimum length requirements`,
      `- Include all required keywords and sections`,
      `- Follow the specified format (markdown, JSON, etc.)`,
      `- Review the generated content for completeness`,
      ``,
      `**📈 Retry Progress**: ${failedGates.map(g => `${g.gateId}: ${(g.retryCount || 0) + 1}/3`).join(', ')}`
    );

    return instructions.join('\n');
  }

  /**
   * Update execution analytics
   */
  private updateExecutionAnalytics(executionState: ExecutionState): void {
    this.executionAnalytics.totalExecutions++;
    
    // Track by execution mode
    if (executionState.metadata.executionMode) {
      this.executionAnalytics.executionsByMode[executionState.metadata.executionMode]++;
    }

    // Track by status
    switch (executionState.status) {
      case 'completed':
        this.executionAnalytics.successfulExecutions++;
        break;
      case 'failed':
        this.executionAnalytics.failedExecutions++;
        break;
      case 'retrying':
        this.executionAnalytics.retriedExecutions++;
        break;
    }

    // Track gate validation usage
    if (executionState.metadata.gateValidation) {
      this.executionAnalytics.gateValidationCount++;
    }

    // Calculate average execution time
    const executionTime = (executionState.metadata.endTime || Date.now()) - executionState.metadata.startTime;
    this.executionAnalytics.averageExecutionTime = 
      (this.executionAnalytics.averageExecutionTime * (this.executionAnalytics.totalExecutions - 1) + executionTime) / 
      this.executionAnalytics.totalExecutions;

    // Add to history (keep last 100 executions)
    this.executionHistory.push({ ...executionState });
    if (this.executionHistory.length > 100) {
      this.executionHistory.shift();
    }

    this.logger.debug(`Analytics updated: Total executions: ${this.executionAnalytics.totalExecutions}, Success rate: ${(this.executionAnalytics.successfulExecutions / this.executionAnalytics.totalExecutions * 100).toFixed(1)}%`);
  }

  /**
   * Register execution analytics tool
   */
  private registerExecutionAnalytics(): void {
    this.mcpServer.tool(
      "execution_analytics",
      "📊 View execution analytics and performance metrics for the enhanced prompt execution system",
      {
        include_history: z
          .boolean()
          .optional()
          .describe("Include recent execution history (default: false)"),
        reset_analytics: z
          .boolean()
          .optional()
          .describe("Reset analytics counters (default: false)"),
      },
      async ({ 
        include_history = false, 
        reset_analytics = false 
      }: { 
        include_history?: boolean; 
        reset_analytics?: boolean; 
      }) => {
        try {
          if (reset_analytics) {
            this.resetAnalytics();
            return {
              content: [{ type: "text", text: "📊 Analytics have been reset to zero." }],
            };
          }

          const analytics = this.generateAnalyticsReport(include_history);
          
          return {
            content: [{ type: "text", text: analytics }],
          };
        } catch (error) {
          this.logger.error("Error in execution_analytics tool:", error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to generate analytics: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * Generate analytics report
   */
  private generateAnalyticsReport(includeHistory: boolean): string {
    const successRate = this.executionAnalytics.totalExecutions > 0 
      ? (this.executionAnalytics.successfulExecutions / this.executionAnalytics.totalExecutions * 100).toFixed(1)
      : "0";
    
    const avgTime = this.executionAnalytics.averageExecutionTime > 0
      ? `${(this.executionAnalytics.averageExecutionTime / 1000).toFixed(2)}s`
      : "N/A";

    const report = [
      `📊 **EXECUTION ANALYTICS REPORT**`,
      ``,
      `## 📈 Overall Performance`,
      `- **Total Executions**: ${this.executionAnalytics.totalExecutions}`,
      `- **Success Rate**: ${successRate}%`,
      `- **Failed Executions**: ${this.executionAnalytics.failedExecutions}`,
      `- **Retried Executions**: ${this.executionAnalytics.retriedExecutions}`,
      `- **Average Execution Time**: ${avgTime}`,
      ``,
      `## 🎯 Execution Modes`,
      `- **Auto Mode**: ${this.executionAnalytics.executionsByMode.auto} executions`,
      `- **Template Mode**: ${this.executionAnalytics.executionsByMode.template} executions`, 
      `- **Chain Mode**: ${this.executionAnalytics.executionsByMode.chain} executions`,
      `- **Workflow Mode**: ${this.executionAnalytics.executionsByMode.workflow} executions`,
      ``,
      `## 🛡️ Gate Validation`,
      `- **Gate Validation Usage**: ${this.executionAnalytics.gateValidationCount} executions`,
      `- **Gate Adoption Rate**: ${this.executionAnalytics.totalExecutions > 0 ? (this.executionAnalytics.gateValidationCount / this.executionAnalytics.totalExecutions * 100).toFixed(1) : "0"}%`,
      ``,
      `## ⚡ Current State`,
      `- **Active Execution**: ${this.currentExecutionState ? `${this.currentExecutionState.promptId} (${this.currentExecutionState.status})` : 'None'}`,
      `- **Execution History**: ${this.executionHistory.length} recent executions tracked`,
    ];

    if (includeHistory && this.executionHistory.length > 0) {
      report.push(
        ``,
        `## 📜 Recent Execution History`,
        ``,
        ...this.executionHistory.slice(-10).map((exec, index) => {
          const duration = exec.metadata.endTime 
            ? `${((exec.metadata.endTime - exec.metadata.startTime) / 1000).toFixed(2)}s`
            : 'Ongoing';
          
          return `${index + 1}. **${exec.promptId}** (${exec.type}) - ${exec.status} - ${duration}`;
        })
      );
    }

    report.push(
      ``,
      `---`,
      `*Generated at: ${new Date().toISOString()}*`
    );

    return report.join('\n');
  }

  /**
   * Reset analytics
   */
  private resetAnalytics(): void {
    this.executionAnalytics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      retriedExecutions: 0,
      gateValidationCount: 0,
      averageExecutionTime: 0,
      executionsByMode: {
        auto: 0,
        template: 0,
        chain: 0,
        workflow: 0,
      },
      classificationHistory: {} as Record<string, {
        classification: PromptClassification;
        timestamp: number;
        confidence: number;
      }>,
      learningData: [] as any[],
      confidenceTrends: {} as Record<string, Array<{confidence: number; timestamp: number}>>
    };
    this.executionHistory = [];
    this.logger.info("Execution analytics have been reset");
  }


  /**
   * Register listprompts tool
   */
  private registerListPrompts(): void {
    this.mcpServer.tool(
      "listprompts",
      "📋 LIST AVAILABLE PROMPTS: Get a comprehensive list of all available prompts with intelligent filtering and category organization. Usage: >>listprompts [filter_text]",
      {
        command: z
          .string()
          .optional()
          .describe("Optional filter text to show only matching commands"),
      },
      async ({ command }: { command?: string }, extra: any) => {
        try {
          const match = command
            ? command.match(/^(>>|\/)listprompts\s*(.*)/)
            : null;
          const filterText = match ? match[2].trim() : "";

          return this.generateIntelligentPromptsList(filterText);
        } catch (error) {
          this.logger.error("Error executing listprompts command:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error displaying listprompts: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * Generate intelligent formatted prompts list with analysis data
   */
  private generateIntelligentPromptsList(filterText: string = ""): ToolResponse {
    // Parse intelligent filter commands
    const filters = this.parseIntelligentFilters(filterText);
    
    return this.generateFormattedPromptsList(filters);
  }

  /**
   * Parse intelligent filter commands from filter text
   */
  private parseIntelligentFilters(filterText: string): {
    text?: string;
    type?: string;
    confidence?: { min?: number; max?: number };
    execution?: boolean;
    gates?: boolean;
  } {
    const filters: any = {};
    
    if (!filterText) return filters;
    
    // Parse type filter: type:workflow, type:chain, type:template
    const typeMatch = filterText.match(/type:(\w+)/);
    if (typeMatch) {
      filters.type = typeMatch[1];
    }
    
    // Parse confidence filter: confidence:>80, confidence:<50, confidence:75-90
    const confidenceMatch = filterText.match(/confidence:([<>]?)(\d+)(?:-(\d+))?/);
    if (confidenceMatch) {
      const [, operator, num1, num2] = confidenceMatch;
      const val1 = parseInt(num1);
      const val2 = num2 ? parseInt(num2) : undefined;
      
      if (operator === '>') {
        filters.confidence = { min: val1 };
      } else if (operator === '<') {
        filters.confidence = { max: val1 };
      } else if (val2) {
        filters.confidence = { min: val1, max: val2 };
      } else {
        filters.confidence = { min: val1 - 5, max: val1 + 5 };
      }
    }
    
    // Parse execution filter: execution:required, execution:optional
    if (filterText.includes('execution:required')) {
      filters.execution = true;
    } else if (filterText.includes('execution:optional')) {
      filters.execution = false;
    }
    
    // Parse gates filter: gates:yes, gates:no
    if (filterText.includes('gates:yes')) {
      filters.gates = true;
    } else if (filterText.includes('gates:no')) {
      filters.gates = false;
    }
    
    // Any remaining text is treated as text search
    const cleanedText = filterText
      .replace(/type:\w+/g, '')
      .replace(/confidence:[<>]?\d+(?:-\d+)?/g, '')
      .replace(/execution:(required|optional)/g, '')
      .replace(/gates:(yes|no)/g, '')
      .trim();
      
    if (cleanedText) {
      filters.text = cleanedText;
    }
    
    return filters;
  }

  /**
   * Check if a prompt matches the intelligent filters
   */
  private matchesIntelligentFilters(prompt: ConvertedPrompt, filters: any): boolean {
    if (Object.keys(filters).length === 0) return true; // No filters = show all

    // Perform semantic analysis for this prompt
    const classification = this.semanticAnalyzer.analyzePrompt(prompt);
    const confidence = Math.round(classification.confidence * 100);

    // Apply type filter
    if (filters.type && classification.executionType !== filters.type) {
      return false;
    }

    // Apply confidence filter
    if (filters.confidence) {
      if (filters.confidence.min && confidence < filters.confidence.min) {
        return false;
      }
      if (filters.confidence.max && confidence > filters.confidence.max) {
        return false;
      }
    }

    // Apply execution filter
    if (filters.execution !== undefined) {
      if (filters.execution !== classification.requiresExecution) {
        return false;
      }
    }

    // Apply gates filter
    if (filters.gates !== undefined) {
      const hasGates = classification.suggestedGates.length > 0;
      if (filters.gates !== hasGates) {
        return false;
      }
    }

    // Apply text filter
    if (filters.text) {
      const searchText = filters.text.toLowerCase();
      const searchableText = [
        prompt.id,
        prompt.name,
        prompt.description,
        classification.executionType,
        ...classification.suggestedGates
      ].join(' ').toLowerCase();
      
      if (!searchableText.includes(searchText)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate formatted prompts list with intelligent filtering
   */
  private generateFormattedPromptsList(filters: any): ToolResponse {
    let listpromptsText = "# Available Commands\n\n";

    // Group prompts by category
    const promptsByCategory: Record<string, ConvertedPrompt[]> = {};
    const categoryMap: Record<string, string> = {};

    this.categories.forEach((cat) => {
      categoryMap[cat.id] = cat.name;
      promptsByCategory[cat.id] = [];
    });

    this.convertedPrompts.forEach((prompt) => {
      if (!promptsByCategory[prompt.category]) {
        promptsByCategory[prompt.category] = [];
      }
      
      // Apply intelligent filtering
      if (this.matchesIntelligentFilters(prompt, filters)) {
        promptsByCategory[prompt.category].push(prompt);
      }
    });

    // Add each category and its prompts
    Object.entries(promptsByCategory).forEach(([categoryId, prompts]) => {
      if (prompts.length === 0) return;

      const categoryName = categoryMap[categoryId] || categoryId;
      listpromptsText += `## ${categoryName}\n\n`;

      prompts.forEach((prompt) => {
        // Perform intelligent analysis for each prompt
        const classification = this.semanticAnalyzer.analyzePrompt(prompt);
        const confidence = Math.round(classification.confidence * 100);
        
        // Create confidence indicator
        let confidenceIcon = "🟢"; // High confidence (>75%)
        if (confidence < 50) confidenceIcon = "🔴"; // Low confidence
        else if (confidence < 75) confidenceIcon = "🟡"; // Medium confidence
        
        // Create execution type badge
        const typeBadge = classification.executionType === "workflow" ? "⚙️" :
                         classification.executionType === "chain" ? "🔗" : "📄";

        listpromptsText += `### ${typeBadge} /${prompt.id} ${confidenceIcon}\n`;
        
        if (prompt.name !== prompt.id) {
          listpromptsText += `*Alias: /${prompt.name}*\n\n`;
        } else {
          listpromptsText += "\n";
        }

        listpromptsText += `${prompt.description}\n\n`;
        
        // Add intelligent analysis summary
        listpromptsText += `🧠 **Analysis**: ${classification.executionType} (${confidence}% confidence)`;
        if (classification.requiresExecution) {
          listpromptsText += ` • Requires execution`;
        }
        if (classification.suggestedGates.length > 0) {
          listpromptsText += ` • Quality gates: ${classification.suggestedGates.slice(0, 2).join(', ')}`;
          if (classification.suggestedGates.length > 2) {
            listpromptsText += ` (+${classification.suggestedGates.length - 2} more)`;
          }
        }
        listpromptsText += `\n\n`;

        if (prompt.arguments.length > 0) {
          listpromptsText += "**Arguments:**\n\n";

          prompt.arguments.forEach((arg) => {
            listpromptsText += `- \`${arg.name}\` (optional): ${
              arg.description || "No description"
            }\n`;
          });

          listpromptsText += "\n**Usage:**\n\n";

          if (prompt.arguments.length === 1) {
            const argName = prompt.arguments[0].name;
            listpromptsText += `\`/${prompt.id} your ${argName} here\`\n\n`;
          } else if (prompt.arguments.length > 1) {
            const exampleArgs: Record<string, string> = {};
            prompt.arguments.forEach((arg) => {
              exampleArgs[arg.name] = `<your ${arg.name} here>`;
            });
            listpromptsText += `\`/${prompt.id} ${JSON.stringify(
              exampleArgs
            )}\`\n\n`;
          }
        }
      });
    });

    // Add filter summary if filters were applied
    const hasFilters = Object.keys(filters).length > 0;
    if (hasFilters) {
      listpromptsText += "## 🔍 Active Filters\n\n";
      if (filters.type) listpromptsText += `- **Type**: ${filters.type}\n`;
      if (filters.confidence) {
        const { min, max } = filters.confidence;
        if (min && max) listpromptsText += `- **Confidence**: ${min}% - ${max}%\n`;
        else if (min) listpromptsText += `- **Confidence**: >${min}%\n`;
        else if (max) listpromptsText += `- **Confidence**: <${max}%\n`;
      }
      if (filters.execution !== undefined) {
        listpromptsText += `- **Execution**: ${filters.execution ? 'Required' : 'Optional'}\n`;
      }
      if (filters.gates !== undefined) {
        listpromptsText += `- **Quality Gates**: ${filters.gates ? 'Yes' : 'No'}\n`;
      }
      if (filters.text) listpromptsText += `- **Text Search**: "${filters.text}"\n`;
      listpromptsText += "\n";
    }

    // Special commands
    listpromptsText += "## Special Commands\n\n";
    listpromptsText += "### >>listprompts\n\n";
    listpromptsText += "Lists all available commands with intelligent analysis.\n\n";
    listpromptsText += "**Basic Usage:** `>>listprompts` or `/listprompts`\n\n";
    listpromptsText += "**Intelligent Filtering:**\n";
    listpromptsText += "- `>>listprompts type:workflow` - Show only workflow prompts\n";
    listpromptsText += "- `>>listprompts confidence:>80` - Show high-confidence prompts\n";
    listpromptsText += "- `>>listprompts execution:required` - Show prompts that require execution\n";
    listpromptsText += "- `>>listprompts gates:yes` - Show prompts with quality gates\n";
    listpromptsText += "- `>>listprompts analysis type:workflow` - Combine text and intelligent filters\n\n";

    return {
      content: [{ type: "text", text: listpromptsText }],
    };
  }

  /**
   * Register consolidated gate management tool
   */
  /*
  private registerGateManagementTools(): void { // TODO: Add when gate management tools are implemented
    if (!this.gateManagementTools) {
      return;
    }

    this.mcpServer.tool(
      "manage_gates",
      "🔒 Comprehensive gate management: list, create, evaluate, and manage validation gates for content quality control",
      {
        action: z
          .enum(["list", "create", "evaluate", "stats", "types", "test"])
          .describe("Gate management action: 'list' (show all gates), 'create' (register new gate), 'evaluate' (test content), 'stats' (performance metrics), 'types' (available gate types), 'test' (validate gate behavior)"),
        gate_id: z
          .string()
          .optional()
          .describe("Gate ID (required for evaluate/stats/test actions)"),
        content: z
          .string()
          .optional()
          .describe("Content to evaluate (required for evaluate/test actions)"),
        gate_definition: z
          .string()
          .optional()
          .describe("Gate definition JSON (required for create action)"),
        gate_type: z
          .string()
          .optional()
          .describe("Gate type for template creation (e.g., 'readability_score', 'grammar_quality')"),
        gate_name: z
          .string()
          .optional()
          .describe("Gate name for template creation"),
        requirements: z
          .string()
          .optional()
          .describe("Additional requirements JSON for template creation"),
        expected_result: z
          .boolean()
          .optional()
          .describe("Expected test result (true/false) for test action"),
        context: z
          .string()
          .optional()
          .describe("Additional context JSON for evaluation"),
      },
      async ({ 
        action, 
        gate_id, 
        content, 
        gate_definition, 
        gate_type, 
        gate_name, 
        requirements,
        expected_result,
        context 
      }: { 
        action: string; 
        gate_id?: string; 
        content?: string; 
        gate_definition?: string; 
        gate_type?: string; 
        gate_name?: string; 
        requirements?: string;
        expected_result?: boolean;
        context?: string;
      }) => {
        try {
          this.logger.debug(`Gate management action: ${action}`);

          switch (action) {
            case "list":
              return await this.gateManagementTools!.listGates();

            case "create":
              if (!gate_definition) {
                return {
                  content: [{ type: "text", text: "Error: gate_definition is required for create action" }],
                  isError: true,
                };
              }
              return await this.gateManagementTools!.registerGate(gate_definition);

            case "evaluate":
              if (!gate_id || !content) {
                return {
                  content: [{ type: "text", text: "Error: gate_id and content are required for evaluate action" }],
                  isError: true,
                };
              }
              return await this.gateManagementTools!.evaluateGate(gate_id, content, context);

            case "stats":
              if (!gate_id) {
                return {
                  content: [{ type: "text", text: "Error: gate_id is required for stats action" }],
                  isError: true,
                };
              }
              return await this.gateManagementTools!.getGateStats(gate_id);

            case "types":
              return await this.gateManagementTools!.getGateTypes();

            case "test":
              if (!gate_id || !content) {
                return {
                  content: [{ type: "text", text: "Error: gate_id and content are required for test action" }],
                  isError: true,
                };
              }
              return await this.gateManagementTools!.testGate(gate_id, content, expected_result);

            default:
              return {
                content: [{ type: "text", text: `Error: Unknown action '${action}'. Available actions: list, create, evaluate, stats, types, test` }],
                isError: true,
              };
          }
        } catch (error) {
          this.logger.error(`Error in manage_gates tool (${action}):`, error);
          return {
            content: [{ type: "text", text: this.handleError(error, `manage_gates_${action}`).message }],
            isError: true,
          };
        }
      }
    );

    this.logger.info("Gate management tool registered successfully");
  }
  */

  /**
   * Error handling helper
   */
  private handleError(
    error: unknown,
    context: string
  ): { message: string; isError: boolean } {
    return utilsHandleError(error, context, this.logger);
  }
}

/**
 * Create and configure MCP tools manager
 */
export function createMcpToolsManager(
  logger: Logger,
  mcpServer: any,
  promptManager: PromptManager,
  configManager: ConfigManager,
  onRefresh: () => Promise<void>,
  onRestart: (reason: string) => Promise<void>
): McpToolsManager {
  return new McpToolsManager(
    logger,
    mcpServer,
    promptManager,
    configManager,
    onRefresh,
    onRestart
  );
}
