/**
 * Conversation Management Module
 * Handles conversation history tracking and context management
 */

import { Logger } from "../logging/index.js";

/**
 * Conversation history item interface
 */
export interface ConversationHistoryItem {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isProcessedTemplate?: boolean; // Flag to indicate if this is a processed template rather than original user input
}

/**
 * Conversation Manager class
 */
export class ConversationManager {
  private logger: Logger;
  private conversationHistory: ConversationHistoryItem[] = [];
  private maxHistorySize: number;

  // NEW: Session manager integration for coordinated state management
  private chainSessionManager?: any; // ChainSessionManager (injected to avoid circular dependency)

  constructor(logger: Logger, maxHistorySize: number = 100) {
    this.logger = logger;
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * NEW: Set chain session manager for coordinated state management
   */
  setChainSessionManager(sessionManager: any): void {
    this.chainSessionManager = sessionManager;
    this.logger.debug("Chain session manager integrated with conversation manager");
  }

  /**
   * Add an item to conversation history with size management
   */
  addToConversationHistory(item: ConversationHistoryItem): void {
    this.conversationHistory.push(item);

    // Trim history if it exceeds maximum size
    if (this.conversationHistory.length > this.maxHistorySize) {
      // Remove oldest entries, keeping recent ones
      this.conversationHistory.splice(
        0,
        this.conversationHistory.length - this.maxHistorySize
      );
      this.logger.debug(
        `Trimmed conversation history to ${this.maxHistorySize} entries to prevent memory leaks`
      );
    }
  }

  /**
   * Get the previous message from conversation history
   */
  getPreviousMessage(): string {
    // Try to find the last user message in conversation history
    if (this.conversationHistory.length > 0) {
      // Start from the end and find the first non-template user message
      for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
        const historyItem = this.conversationHistory[i];
        // Only consider user messages that aren't processed templates
        if (historyItem.role === "user" && !historyItem.isProcessedTemplate) {
          this.logger.debug(
            `Found previous user message for context: ${historyItem.content.substring(
              0,
              50
            )}...`
          );
          return historyItem.content;
        }
      }
    }

    // Return a default prompt if no suitable history item is found
    return "[Please check previous messages in the conversation for context]";
  }

  /**
   * Get conversation history
   */
  getConversationHistory(): ConversationHistoryItem[] {
    return [...this.conversationHistory];
  }

  /**
   * Get conversation statistics
   */
  getConversationStats(): {
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    systemMessages: number;
    templatedMessages: number;
  } {
    const stats = {
      totalMessages: this.conversationHistory.length,
      userMessages: 0,
      assistantMessages: 0,
      systemMessages: 0,
      templatedMessages: 0,
    };

    this.conversationHistory.forEach((item) => {
      switch (item.role) {
        case "user":
          stats.userMessages++;
          break;
        case "assistant":
          stats.assistantMessages++;
          break;
        case "system":
          stats.systemMessages++;
          break;
      }

      if (item.isProcessedTemplate) {
        stats.templatedMessages++;
      }
    });

    return stats;
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
    this.logger.info("Conversation history cleared");
  }

  /**
   * Get recent messages (useful for context)
   */
  getRecentMessages(count: number = 5): ConversationHistoryItem[] {
    return this.conversationHistory.slice(-count);
  }

  // Enhanced: Chain context storage for LLM-driven iterative workflow with proper result capture
  private chainContext: Record<string, Record<number, string>> = {};
  private chainStates: Record<string, { currentStep: number; totalSteps: number; lastUpdated: number }> = {};
  
  // NEW: Track actual execution results vs placeholders
  private chainExecutionResults: Record<string, Record<number, { 
    result: string; 
    timestamp: number; 
    isPlaceholder: boolean;
    executionMetadata?: any;
  }>> = {};

  /**
   * Save step result for a chain execution with enhanced metadata
   */
  saveStepResult(chainId: string, step: number, result: string, isPlaceholder: boolean = false, metadata?: any): void {
    if (!this.chainContext[chainId]) {
      this.chainContext[chainId] = {};
    }
    if (!this.chainExecutionResults[chainId]) {
      this.chainExecutionResults[chainId] = {};
    }
    
    // Store both simple and enhanced result
    this.chainContext[chainId][step] = result;
    this.chainExecutionResults[chainId][step] = {
      result,
      timestamp: Date.now(),
      isPlaceholder,
      executionMetadata: metadata
    };
    
    this.logger.debug(`Saved step ${step} result for chain ${chainId} (placeholder: ${isPlaceholder})`);
  }

  /**
   * Get step result with metadata indicating if it's a placeholder
   */
  getStepResultWithMetadata(chainId: string, step: number): { 
    result: string; 
    isPlaceholder: boolean; 
    timestamp: number;
    metadata?: any;
  } | undefined {
    return this.chainExecutionResults[chainId]?.[step];
  }

  /**
   * Get all step results for a chain
   */
  getStepResults(chainId: string): Record<number, string> {
    return this.chainContext[chainId] || {};
  }

  /**
   * Get specific step result for a chain
   */
  getStepResult(chainId: string, step: number): string | undefined {
    return this.chainContext[chainId]?.[step];
  }

  /**
   * Set chain state (current step and total steps) with timestamp
   */
  setChainState(chainId: string, currentStep: number, totalSteps: number): void {
    this.chainStates[chainId] = { currentStep, totalSteps, lastUpdated: Date.now() };
    this.logger.debug(`Chain ${chainId}: step ${currentStep}/${totalSteps}`);
  }
  
  /**
   * Validate chain state integrity and recover if needed
   */
  validateChainState(chainId: string): { valid: boolean; issues?: string[]; recovered?: boolean } {
    const state = this.chainStates[chainId];
    const context = this.chainContext[chainId];
    const results = this.chainExecutionResults[chainId];
    
    const issues: string[] = [];
    let recovered = false;
    
    if (!state) {
      issues.push("No chain state found");
      return { valid: false, issues };
    }
    
    // Check for stale state (older than 1 hour)
    if (Date.now() - state.lastUpdated > 3600000) {
      issues.push("Chain state is stale (>1 hour old)");
    }
    
    // Validate step consistency
    if (state.currentStep > state.totalSteps) {
      issues.push(`Current step ${state.currentStep} exceeds total steps ${state.totalSteps}`);
      // Auto-recover by resetting to final step
      this.setChainState(chainId, state.totalSteps, state.totalSteps);
      recovered = true;
    }
    
    // Check for missing results in expected steps
    if (context && results) {
      for (let i = 0; i < Math.min(state.currentStep, state.totalSteps); i++) {
        const hasResult = context[i] || results[i];
        if (!hasResult) {
          issues.push(`Missing result for completed step ${i}`);
        }
      }
    }
    
    this.logger.debug(`Chain ${chainId} validation: ${issues.length} issues found${recovered ? ' (auto-recovered)' : ''}`);
    
    return {
      valid: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      recovered
    };
  }

  /**
   * Get chain state
   */
  getChainState(chainId: string): { currentStep: number; totalSteps: number; lastUpdated: number } | undefined {
    return this.chainStates[chainId];
  }

  /**
   * Clear chain context and state with session manager coordination
   */
  clearChainContext(chainId: string): void {
    delete this.chainContext[chainId];
    delete this.chainStates[chainId];
    delete this.chainExecutionResults[chainId];

    // NEW: Also clear session manager state if available
    if (this.chainSessionManager) {
      try {
        this.chainSessionManager.clearSessionsForChain(chainId);
      } catch (error) {
        this.logger.warn(`Failed to clear session manager state for ${chainId}:`, error);
      }
    }

    this.logger.info(`Cleared all chain state for ${chainId}`);
  }

  /**
   * Clear all chain contexts and states
   */
  clearAllChainContexts(): void {
    this.chainContext = {};
    this.chainStates = {};
    this.chainExecutionResults = {};
    this.logger.info("Cleared all chain contexts");
  }
  
  /**
   * Get chain execution summary with metadata
   */
  getChainSummary(chainId: string): {
    state?: { currentStep: number; totalSteps: number; lastUpdated: number };
    completedSteps: number;
    placeholderSteps: number;
    realSteps: number;
    totalResults: number;
  } {
    const state = this.chainStates[chainId];
    const results = this.chainExecutionResults[chainId] || {};
    
    let placeholderSteps = 0;
    let realSteps = 0;
    
    Object.values(results).forEach(result => {
      if (result.isPlaceholder) {
        placeholderSteps++;
      } else {
        realSteps++;
      }
    });
    
    return {
      state,
      completedSteps: Object.keys(results).length,
      placeholderSteps,
      realSteps,
      totalResults: Object.keys(results).length
    };
  }

  /**
   * NEW: Comprehensive state validation with session manager coordination
   */
  validateChainStateIntegrity(chainId: string): {
    conversationState: boolean;
    sessionState: boolean;
    synchronized: boolean;
    recommendations: string[];
    sessionInfo?: any;
  } {
    const hasConversationState = !!this.chainStates[chainId];
    let hasSessionState = false;
    let sessionInfo: any = undefined;

    // Check session manager state if available
    if (this.chainSessionManager) {
      try {
        hasSessionState = this.chainSessionManager.hasActiveSessionForChain(chainId);
        if (hasSessionState) {
          const session = this.chainSessionManager.getActiveSessionForChain(chainId);
          sessionInfo = {
            sessionId: session?.sessionId,
            state: session?.state,
            currentStepId: session?.currentStepId,
            executionOrder: session?.executionOrder
          };
        }
      } catch (error) {
        this.logger.warn(`Failed to check session state for ${chainId}:`, error);
      }
    }

    const recommendations: string[] = [];

    if (hasConversationState && !hasSessionState) {
      recommendations.push("Orphaned conversation state - consider force restart to clear stale LLM context");
    }
    if (!hasConversationState && hasSessionState) {
      recommendations.push("Missing conversation state - session may be from different execution type");
    }
    if (hasConversationState && hasSessionState) {
      // Both exist - check for consistency
      const conversationState = this.chainStates[chainId];
      if (conversationState && sessionInfo) {
        recommendations.push("States synchronized - both conversation and session managers have active state");
      }
    }
    if (!hasConversationState && !hasSessionState) {
      recommendations.push("Clean state - no active chain execution detected");
    }

    return {
      conversationState: hasConversationState,
      sessionState: hasSessionState,
      synchronized: hasConversationState === hasSessionState,
      recommendations,
      sessionInfo
    };
  }
}

/**
 * Create and configure a conversation manager
 */
export function createConversationManager(
  logger: Logger,
  maxHistorySize?: number
): ConversationManager {
  return new ConversationManager(logger, maxHistorySize);
}
