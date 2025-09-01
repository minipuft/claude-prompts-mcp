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

  constructor(logger: Logger, maxHistorySize: number = 100) {
    this.logger = logger;
    this.maxHistorySize = maxHistorySize;
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

  // NEW: Chain context storage for LLM-driven iterative workflow
  private chainContext: Record<string, Record<number, string>> = {};
  private chainStates: Record<string, { currentStep: number; totalSteps: number }> = {};

  /**
   * Save step result for a chain execution
   */
  saveStepResult(chainId: string, step: number, result: string): void {
    if (!this.chainContext[chainId]) {
      this.chainContext[chainId] = {};
    }
    this.chainContext[chainId][step] = result;
    this.logger.debug(`Saved step ${step} result for chain ${chainId}`);
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
   * Set chain state (current step and total steps)
   */
  setChainState(chainId: string, currentStep: number, totalSteps: number): void {
    this.chainStates[chainId] = { currentStep, totalSteps };
    this.logger.debug(`Chain ${chainId}: step ${currentStep}/${totalSteps}`);
  }

  /**
   * Get chain state
   */
  getChainState(chainId: string): { currentStep: number; totalSteps: number } | undefined {
    return this.chainStates[chainId];
  }

  /**
   * Clear chain context and state
   */
  clearChainContext(chainId: string): void {
    delete this.chainContext[chainId];
    delete this.chainStates[chainId];
    this.logger.info(`Cleared chain context for ${chainId}`);
  }

  /**
   * Clear all chain contexts and states
   */
  clearAllChainContexts(): void {
    this.chainContext = {};
    this.chainStates = {};
    this.logger.info("Cleared all chain contexts");
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
