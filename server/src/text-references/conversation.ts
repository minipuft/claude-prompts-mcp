// @lifecycle canonical - Tracks conversation references for prompts.
/**
 * Conversation Management Module
 * Maintains lightweight conversation history for tooling and diagnostics.
 */

import { Logger } from '../logging/index.js';

import type { ConversationHistoryItem } from '../types/index.js';

export class ConversationManager {
  private readonly logger: Logger;
  private conversationHistory: ConversationHistoryItem[] = [];
  private readonly maxHistorySize: number;

  constructor(logger: Logger, maxHistorySize: number = 100) {
    this.logger = logger;
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Append a conversation item with bounded history management.
   */
  addToConversationHistory(item: ConversationHistoryItem): void {
    this.conversationHistory.push(item);

    if (this.conversationHistory.length > this.maxHistorySize) {
      this.conversationHistory.splice(0, this.conversationHistory.length - this.maxHistorySize);
      this.logger.debug(
        `Trimmed conversation history to ${this.maxHistorySize} entries to prevent memory leaks`
      );
    }
  }

  /**
   * Locate the most recent non-template user message for template context.
   */
  getPreviousMessage(): string {
    for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
      const historyItem = this.conversationHistory[i];
      if (!historyItem) {
        continue;
      }

      if (historyItem.role === 'user' && !historyItem.isProcessedTemplate) {
        this.logger.debug(
          `Found previous user message for context: ${historyItem.content.substring(0, 50)}...`
        );
        return historyItem.content;
      }
    }

    return '[Please check previous messages in the conversation for context]';
  }

  /**
   * Return a shallow copy of the recorded history.
   */
  getConversationHistory(): ConversationHistoryItem[] {
    return [...this.conversationHistory];
  }

  /**
   * Short-hand helper for UIs needing limited history snapshots.
   */
  getRecentMessages(count: number = 5): ConversationHistoryItem[] {
    return this.conversationHistory.slice(-count);
  }

  /**
   * Clear all stored conversation entries.
   */
  clearHistory(): void {
    this.conversationHistory = [];
    this.logger.info('Conversation history cleared');
  }

  /**
   * Provide high-level stats for diagnostics.
   */
  getConversationStats(): {
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    processedTemplates: number;
    oldestMessage?: number;
    newestMessage?: number;
  } {
    const userMessages = this.conversationHistory.filter((item) => item.role === 'user').length;
    const assistantMessages = this.conversationHistory.filter(
      (item) => item.role === 'assistant'
    ).length;
    const processedTemplates = this.conversationHistory.filter(
      (item) => item.isProcessedTemplate
    ).length;

    const timestamps = this.conversationHistory.map((item) => item.timestamp);
    const oldestMessage = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
    const newestMessage = timestamps.length > 0 ? Math.max(...timestamps) : undefined;

    const stats: {
      totalMessages: number;
      userMessages: number;
      assistantMessages: number;
      processedTemplates: number;
      oldestMessage?: number;
      newestMessage?: number;
    } = {
      totalMessages: this.conversationHistory.length,
      userMessages,
      assistantMessages,
      processedTemplates,
    };

    if (oldestMessage !== undefined) {
      stats.oldestMessage = oldestMessage;
    }

    if (newestMessage !== undefined) {
      stats.newestMessage = newestMessage;
    }

    return stats;
  }
}

export function createConversationManager(
  logger: Logger,
  maxHistorySize?: number
): ConversationManager {
  return new ConversationManager(logger, maxHistorySize);
}
