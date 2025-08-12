/**
 * Prompt Execution Module
 * Handles direct prompt execution and chain execution logic
 */

import { Logger } from "../logging/index.js";
import { PromptManager } from "../prompts/index.js";
import { ConvertedPrompt, WorkflowExecutionResult } from "../types/index.js";
import {
  PromptError,
  ValidationError,
  handleError as utilsHandleError,
} from "../utils/errorHandling.js";
import { ConversationManager } from "./conversation-manager.js";
import { WorkflowEngine } from "./workflow-engine.js";

/**
 * Chain execution state tracking
 */
interface ChainExecutionState {
  chainId: string;
  currentStepIndex: number;
  totalSteps: number;
  stepResults: Record<string, string>;
  startTime: number;
}

/**
 * Prompt Executor class
 */
export class PromptExecutor {
  private logger: Logger;
  private promptManager: PromptManager;
  private conversationManager: ConversationManager;
  private convertedPrompts: ConvertedPrompt[] = [];
  private currentChainExecution: ChainExecutionState | null = null;
  private workflowEngine?: WorkflowEngine;

  constructor(
    logger: Logger,
    promptManager: PromptManager,
    conversationManager: ConversationManager
  ) {
    this.logger = logger;
    this.promptManager = promptManager;
    this.conversationManager = conversationManager;
  }

  /**
   * Set the workflow engine for workflow execution
   */
  setWorkflowEngine(workflowEngine: WorkflowEngine): void {
    this.workflowEngine = workflowEngine;
  }

  /**
   * Update converted prompts data
   */
  updatePrompts(convertedPrompts: ConvertedPrompt[]): void {
    this.convertedPrompts = convertedPrompts;
  }

  /**
   * Standardized error handling
   */
  private handleError(
    error: unknown,
    context: string
  ): { message: string; isError: boolean } {
    return utilsHandleError(error, context, this.logger);
  }

  /**
   * Process a prompt directly with the parsed arguments and optional system message
   */
  async runPromptDirectly(
    promptId: string,
    parsedArgs: Record<string, string>
  ): Promise<string> {
    try {
      const convertedPrompt = this.convertedPrompts.find(
        (cp) => cp.id === promptId
      );
      if (!convertedPrompt) {
        throw new PromptError(`Could not find prompt with ID: ${promptId}`);
      }

      this.logger.debug(
        `Running prompt directly: ${promptId} with arguments:`,
        parsedArgs
      );

      // Check for missing arguments but treat all as optional
      const missingArgs = convertedPrompt.arguments
        .filter((arg) => !parsedArgs[arg.name])
        .map((arg) => arg.name);

      if (missingArgs.length > 0) {
        this.logger.info(
          `Missing arguments for '${promptId}': ${missingArgs.join(
            ", "
          )}. Will attempt to use conversation context.`
        );

        // Use previous_message for all missing arguments
        missingArgs.forEach((argName) => {
          parsedArgs[argName] = `{{previous_message}}`;
        });
      }

      // Create user message with placeholders replaced
      let userMessageText = convertedPrompt.userMessageTemplate;

      // Set up special context values
      const specialContext = {
        previous_message: this.conversationManager.getPreviousMessage(),
      };

      // Process the template to replace all placeholders, passing the tools flag
      userMessageText = await this.promptManager.processTemplateAsync(
        userMessageText,
        parsedArgs,
        specialContext,
        convertedPrompt.tools || false
      );

      // Add the message to conversation history
      this.conversationManager.addToConversationHistory({
        role: "user",
        content: userMessageText,
        timestamp: Date.now(),
        isProcessedTemplate: true,
      });

      // Generate a response (echo in this MCP implementation)
      const response = `Processed prompt: ${promptId}\nWith message: ${userMessageText}`;

      // Store the response in conversation history
      this.conversationManager.addToConversationHistory({
        role: "assistant",
        content: response,
        timestamp: Date.now(),
      });

      return response;
    } catch (error) {
      const { message } = this.handleError(
        error,
        `Error executing prompt '${promptId}'`
      );
      return message;
    }
  }

  /**
   * Execute a chain of prompts
   */
  async executePromptChain(
    chainPromptId: string,
    inputArgs: Record<string, string> = {}
  ): Promise<{
    results: Record<string, string>;
    messages: {
      role: "user" | "assistant";
      content: { type: "text"; text: string };
    }[];
  }> {
    try {
      // Find the chain prompt
      const chainPrompt = this.convertedPrompts.find(
        (cp) => cp.id === chainPromptId
      );

      if (!chainPrompt) {
        throw new PromptError(
          `Could not find chain prompt with ID: ${chainPromptId}`
        );
      }

      // Validate that this is a chain prompt with steps
      if (
        !chainPrompt.isChain ||
        !chainPrompt.chainSteps ||
        chainPrompt.chainSteps.length === 0
      ) {
        throw new ValidationError(
          `Prompt '${chainPromptId}' is not a valid chain or has no steps.`
        );
      }

      const totalSteps = chainPrompt.chainSteps.length;
      this.logger.info(
        `Executing prompt chain: ${chainPrompt.name} (${chainPrompt.id}) with ${totalSteps} steps`
      );

      // Store results from each step that can be used as inputs for subsequent steps
      const results: Record<string, string> = { ...inputArgs };
      const messages: {
        role: "user" | "assistant";
        content: { type: "text"; text: string };
      }[] = [];

      // Add chain start message to conversation history
      this.conversationManager.addToConversationHistory({
        role: "system",
        content: `Starting prompt chain: ${chainPrompt.name} (${totalSteps} steps)`,
        timestamp: Date.now(),
      });

      // Execute each step in sequence
      for (let i = 0; i < chainPrompt.chainSteps.length; i++) {
        const step = chainPrompt.chainSteps[i];
        const currentStepNumber = i + 1;

        this.logger.info(
          `Executing chain step ${currentStepNumber}/${totalSteps}: ${step.stepName} (${step.promptId})`
        );

        // Add step context to the results object so it can be used in templates
        results["current_step_number"] = String(currentStepNumber);
        results["total_steps"] = String(totalSteps);
        results["current_step_name"] = step.stepName;

        // Prepare arguments for this step based on input mappings
        const stepArgs: Record<string, string> = {};

        // Map inputs from results according to input mappings
        if (step.inputMapping) {
          for (const [stepInput, resultKey] of Object.entries(
            step.inputMapping
          )) {
            if (results[resultKey] !== undefined) {
              stepArgs[stepInput] = results[resultKey];
            } else {
              this.logger.warn(
                `Missing input mapping for step '${step.stepName}': ${resultKey} -> ${stepInput}`
              );
            }
          }
        }

        // Add step context to the arguments
        stepArgs["step_number"] = String(currentStepNumber);
        stepArgs["total_steps"] = String(totalSteps);
        stepArgs["step_name"] = step.stepName;

        try {
          // Add step start message to conversation history
          this.conversationManager.addToConversationHistory({
            role: "system",
            content: `Executing chain step ${currentStepNumber}/${totalSteps}: ${step.stepName}`,
            timestamp: Date.now(),
          });

          // Run the prompt for this step
          const stepResult = await this.runPromptDirectly(
            step.promptId,
            stepArgs
          );

          // Store the result
          if (step.outputMapping) {
            for (const [resultKey, stepOutput] of Object.entries(
              step.outputMapping
            )) {
              // For now, we only support mapping the entire output to a result key
              results[resultKey] = stepResult;
            }
          }

          // Add more detailed step messages to conversation history
          messages.push({
            role: "user",
            content: {
              type: "text",
              text: `[Chain Step ${currentStepNumber}/${totalSteps}: ${step.stepName} (${step.promptId})]`,
            },
          });

          messages.push({
            role: "assistant",
            content: {
              type: "text",
              text: stepResult,
            },
          });

          // Add step completion message to conversation history
          this.conversationManager.addToConversationHistory({
            role: "system",
            content: `Completed chain step ${currentStepNumber}/${totalSteps}: ${step.stepName}`,
            timestamp: Date.now(),
          });
        } catch (stepError) {
          const { message, isError } = this.handleError(
            stepError,
            `Error executing chain step '${step.stepName}'`
          );

          // Add error message to the results
          results[`error_${step.promptId}`] = message;

          // Add error message to conversation history
          messages.push({
            role: "user",
            content: {
              type: "text",
              text: `[Chain Step ${currentStepNumber}/${totalSteps}: ${step.stepName} (${step.promptId})]`,
            },
          });

          messages.push({
            role: "assistant",
            content: {
              type: "text",
              text: message,
            },
          });

          // If this is a critical error, we may want to stop the chain execution
          if (isError) {
            throw new PromptError(
              `Chain execution stopped due to error in step ${currentStepNumber}/${totalSteps} '${step.stepName}': ${message}`
            );
          }
        }
      }

      // Add chain completion message to conversation history
      this.conversationManager.addToConversationHistory({
        role: "system",
        content: `Completed prompt chain: ${chainPrompt.name} (all ${totalSteps} steps)`,
        timestamp: Date.now(),
      });

      this.logger.info(
        `Chain execution completed successfully: ${chainPrompt.id}`
      );

      return {
        results,
        messages,
      };
    } catch (error) {
      const { message } = this.handleError(
        error,
        `Error executing prompt chain '${chainPromptId}'`
      );

      return {
        results: { error: message },
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: message,
            },
          },
        ],
      };
    }
  }

  /**
   * Get current chain execution state
   */
  getCurrentChainExecution(): ChainExecutionState | null {
    return this.currentChainExecution;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    inputs: Record<string, any> = {}
  ): Promise<WorkflowExecutionResult> {
    if (!this.workflowEngine) {
      throw new PromptError("Workflow engine not available");
    }

    try {
      this.logger.info(`Executing workflow: ${workflowId}`);
      
      // Add workflow execution to conversation history
      this.conversationManager.addToConversationHistory({
        role: "system",
        content: `Starting workflow execution: ${workflowId}`,
        timestamp: Date.now(),
      });

      const result = await this.workflowEngine.executeWorkflow(
        workflowId,
        inputs,
        { gateValidation: true }, // Enable gate validation by default
        'server' // Default to server runtime
      );

      // Add completion to conversation history
      this.conversationManager.addToConversationHistory({
        role: "system",
        content: `Workflow execution completed: ${workflowId} (${result.status})`,
        timestamp: Date.now(),
      });

      this.logger.info(`Workflow execution completed: ${workflowId} (${result.status})`);
      return result;

    } catch (error) {
      const { message } = this.handleError(
        error,
        `Error executing workflow '${workflowId}'`
      );
      
      // Add error to conversation history
      this.conversationManager.addToConversationHistory({
        role: "system",
        content: `Workflow execution failed: ${workflowId} - ${message}`,
        timestamp: Date.now(),
      });

      throw error;
    }
  }

  /**
   * Get executor statistics
   */
  getExecutorStats(): {
    currentChain: ChainExecutionState | null;
    totalPrompts: number;
    conversationStats: any;
    workflowsAvailable: number;
    activeWorkflowExecutions: number;
  } {
    return {
      currentChain: this.currentChainExecution,
      totalPrompts: this.convertedPrompts.length,
      conversationStats: this.conversationManager.getConversationStats(),
      workflowsAvailable: this.workflowEngine?.listWorkflows().length || 0,
      activeWorkflowExecutions: this.workflowEngine?.getActiveExecutions().length || 0,
    };
  }
}

/**
 * Create and configure a prompt executor
 */
export function createPromptExecutor(
  logger: Logger,
  promptManager: PromptManager,
  conversationManager: ConversationManager
): PromptExecutor {
  return new PromptExecutor(logger, promptManager, conversationManager);
}
