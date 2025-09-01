/**
 * Execution Coordinator (Modernized)
 *
 * Thin orchestration layer that delegates all execution to ConsolidatedPromptEngine.
 * Implements three-tier execution model: prompt/template/chain with LLM-driven workflows.
 *
 * Architecture (Phase 3):
 * - All execution routed through ConsolidatedPromptEngine
 * - Simplified interface for legacy compatibility
 * - Statistical tracking and monitoring
 * - No complex orchestration - pure delegation pattern
 */

import { Logger } from "../logging/index.js";
import { PromptManager } from "../prompts/index.js";
import { ConversationManager } from "../text-references/conversation.js";
import { ConvertedPrompt, ChainExecutionResult, ToolResponse } from "../types/index.js";
import { PromptError, ValidationError } from "../utils/errorHandling.js";
import { GateEvaluator } from "../gates/evaluators/index.js";
import { FrameworkStateManager } from "../frameworks/framework-state-manager.js";
import { FrameworkManager } from "../frameworks/framework-manager.js";
import { ConsolidatedPromptEngine } from "../mcp-tools/prompt-engine.js";

export interface ExecutionResult {
  executionId: string;
  type: 'prompt' | 'template' | 'chain'; // Phase 3: Three-tier execution model
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  startTime: number;
  endTime: number;
  result: string | ChainExecutionResult; 
  error?: {
    message: string;
    code?: string;
  };
}

export interface ExecutionStats {
  totalExecutions: number;
  promptExecutions: number;
  templateExecutions: number; // Phase 3: Track template executions separately
  chainExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
}

/**
 * Modernized execution coordinator - pure delegation to ConsolidatedPromptEngine
 * Phase 3: Simplified thin orchestration layer for legacy compatibility
 */
export class ExecutionCoordinator {
  private logger: Logger;
  private promptManager: PromptManager;
  private conversationManager: ConversationManager;
  private convertedPrompts: ConvertedPrompt[] = [];

  // Core delegation engine
  private consolidatedEngine?: ConsolidatedPromptEngine;

  // Simple statistics - modernized for three-tier model
  private stats = {
    totalExecutions: 0,
    promptExecutions: 0,
    templateExecutions: 0, // Phase 3: Track template executions
    chainExecutions: 0,
    failedExecutions: 0,
    executionTimes: [] as number[],
  };

  constructor(
    logger: Logger,
    promptManager: PromptManager,
    conversationManager: ConversationManager,
    gateEvaluator?: GateEvaluator,
    frameworkStateManager?: FrameworkStateManager,
    frameworkManager?: FrameworkManager
  ) {
    this.logger = logger;
    this.promptManager = promptManager;
    this.conversationManager = conversationManager;

    // Note: ConsolidatedPromptEngine will be set later via setConsolidatedEngine()
    // This is due to circular dependency resolution in the application startup
    
    this.logger.debug("Execution coordinator initialized - will delegate to ConsolidatedPromptEngine");
  }

  /**
   * Set the consolidated engine for delegation (called after initialization)
   */
  setConsolidatedEngine(engine: ConsolidatedPromptEngine): void {
    this.consolidatedEngine = engine;
    this.logger.debug("ConsolidatedPromptEngine set for delegation");
  }

  /**
   * Update prompts data - delegate to ConsolidatedPromptEngine
   */
  updatePrompts(convertedPrompts: ConvertedPrompt[]): void {
    this.convertedPrompts = convertedPrompts;
    
    // Update the consolidated engine if available
    if (this.consolidatedEngine) {
      const promptsData = (this.promptManager as any).promptsData || [];
      this.consolidatedEngine.updateData(promptsData, convertedPrompts);
    }

    const chainCount = convertedPrompts.filter(p => p.isChain).length;
    this.logger.debug(`Updated prompts: ${convertedPrompts.length} total, ${chainCount} chains`);
  }

  /**
   * Execute by delegating to ConsolidatedPromptEngine
   * Phase 3: Pure delegation pattern - no local execution logic
   */
  async execute(
    promptId: string,
    args: Record<string, any> = {},
    options: Record<string, any> = {}
  ): Promise<ExecutionResult> {
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    if (!this.consolidatedEngine) {
      throw new ValidationError("ConsolidatedPromptEngine not available - call setConsolidatedEngine() first");
    }

    try {
      this.logger.debug(`Delegating execution to ConsolidatedPromptEngine: ${promptId}`);

      // Build command string for ConsolidatedPromptEngine
      const command = this.buildCommandString(promptId, args);
      
      // Delegate to ConsolidatedPromptEngine
      const engineResponse: ToolResponse = await (this.consolidatedEngine as any).executePromptCommand({
        command,
        execution_mode: options.execution_mode || "auto",
        gate_validation: options.gate_validation,
        step_confirmation: options.step_confirmation || false,
        auto_execute_chain: options.auto_execute_chain !== false,
        timeout: options.timeout,
        options: options
      }, {});

      const endTime = Date.now();

      // Convert ToolResponse to ExecutionResult
      const result = this.convertToExecutionResult(
        executionId,
        startTime,
        endTime,
        engineResponse,
        promptId
      );

      // Update statistics
      this.updateStats(result.type, result.endTime - result.startTime, result.status === 'failed');

      this.logger.info(`Execution completed via ConsolidatedPromptEngine: ${promptId} (${result.status})`);
      return result;

    } catch (error) {
      const endTime = Date.now();
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.updateStats('prompt', endTime - startTime, true);
      this.logger.error(`Execution failed via ConsolidatedPromptEngine: ${promptId}`, error);

      return {
        executionId,
        type: 'prompt',
        status: 'failed',
        startTime,
        endTime,
        result: '',
        error: {
          message: errorMessage,
          code: error instanceof PromptError ? 'PROMPT_ERROR' : 'EXECUTION_ERROR'
        }
      };
    }
  }

  /**
   * Build command string for ConsolidatedPromptEngine
   */
  private buildCommandString(promptId: string, args: Record<string, any>): string {
    if (!args || Object.keys(args).length === 0) {
      return `>>${promptId}`;
    }

    // Convert args to command format
    const argStrings = Object.entries(args)
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
    
    return `>>${promptId} ${argStrings}`;
  }

  /**
   * Convert ToolResponse to ExecutionResult
   */
  private convertToExecutionResult(
    executionId: string,
    startTime: number,
    endTime: number,
    engineResponse: ToolResponse,
    promptId: string
  ): ExecutionResult {
    // Extract text content from ToolResponse
    const content = engineResponse.content
      .map(c => c.type === 'text' ? c.text : '')
      .join('\n');

    // Determine execution type from content analysis
    let type: 'prompt' | 'template' | 'chain' = 'prompt';
    if (content.includes('🧠 **Framework Template Execution**')) {
      type = 'template';
    } else if (content.includes('🔗 **Chain Execution**') || content.includes('Chain Complete')) {
      type = 'chain';
    }

    return {
      executionId,
      type,
      status: engineResponse.isError ? 'failed' : 'completed',
      startTime,
      endTime,
      result: content,
      error: engineResponse.isError ? {
        message: content,
        code: 'ENGINE_ERROR'
      } : undefined
    };
  }

  /**
   * Update statistics for three-tier execution model
   */
  private updateStats(type: 'prompt' | 'template' | 'chain', executionTime: number, failed: boolean): void {
    this.stats.totalExecutions++;
    this.stats.executionTimes.push(executionTime);

    if (failed) {
      this.stats.failedExecutions++;
    } else {
      switch (type) {
        case 'prompt':
          this.stats.promptExecutions++;
          break;
        case 'template':
          this.stats.templateExecutions++;
          break;
        case 'chain':
          this.stats.chainExecutions++;
          break;
      }
    }

    // Keep only last 50 execution times for memory efficiency
    if (this.stats.executionTimes.length > 50) {
      this.stats.executionTimes.shift();
    }
  }

  /**
   * Get execution statistics for three-tier model
   */
  getExecutionStats(): ExecutionStats {
    const times = this.stats.executionTimes;
    const averageExecutionTime = times.length > 0
      ? times.reduce((sum, time) => sum + time, 0) / times.length
      : 0;

    return {
      totalExecutions: this.stats.totalExecutions,
      promptExecutions: this.stats.promptExecutions,
      templateExecutions: this.stats.templateExecutions,
      chainExecutions: this.stats.chainExecutions,
      failedExecutions: this.stats.failedExecutions,
      averageExecutionTime
    };
  }

  /**
   * Get consolidated engine for direct access
   */
  getConsolidatedEngine(): ConsolidatedPromptEngine | undefined {
    return this.consolidatedEngine;
  }

  /**
   * Get converted prompts
   */
  getConvertedPrompts(): ConvertedPrompt[] {
    return this.convertedPrompts;
  }

  /**
   * Get prompt manager
   */
  getPromptManager(): PromptManager {
    return this.promptManager;
  }

  /**
   * Get conversation manager
   */
  getConversationManager(): ConversationManager {
    return this.conversationManager;
  }
}

/**
 * Create modernized execution coordinator (Phase 3)
 * Note: ConsolidatedPromptEngine must be set separately via setConsolidatedEngine()
 */
export function createExecutionCoordinator(
  logger: Logger,
  promptManager: PromptManager,
  conversationManager: ConversationManager,
  gateEvaluator?: GateEvaluator,
  frameworkStateManager?: FrameworkStateManager,
  frameworkManager?: FrameworkManager
): ExecutionCoordinator {
  const coordinator = new ExecutionCoordinator(
    logger,
    promptManager,
    conversationManager,
    gateEvaluator,
    frameworkStateManager,
    frameworkManager
  );

  logger.info("ExecutionCoordinator created (Phase 3) - delegation pattern active");
  return coordinator;
}