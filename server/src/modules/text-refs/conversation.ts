// @lifecycle canonical - Tracks conversation references for prompts.
/**
 * Conversation Management Module
 * Maintains lightweight conversation history for tooling and diagnostics.
 */

import type { Logger, ConversationHistoryItem } from '#shared/types/index.js';

export class ConversationStore {
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
}

export function createConversationStore(
  logger: Logger,
  maxHistorySize?: number
): ConversationStore {
  return new ConversationStore(logger, maxHistorySize);
}
