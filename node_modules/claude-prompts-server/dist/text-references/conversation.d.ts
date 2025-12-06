/**
 * Conversation Management Module
 * Maintains lightweight conversation history for tooling and diagnostics.
 */
import { Logger } from '../logging/index.js';
import type { ConversationHistoryItem } from '../types/index.js';
export declare class ConversationManager {
    private readonly logger;
    private conversationHistory;
    private readonly maxHistorySize;
    constructor(logger: Logger, maxHistorySize?: number);
    /**
     * Append a conversation item with bounded history management.
     */
    addToConversationHistory(item: ConversationHistoryItem): void;
    /**
     * Locate the most recent non-template user message for template context.
     */
    getPreviousMessage(): string;
    /**
     * Return a shallow copy of the recorded history.
     */
    getConversationHistory(): ConversationHistoryItem[];
    /**
     * Short-hand helper for UIs needing limited history snapshots.
     */
    getRecentMessages(count?: number): ConversationHistoryItem[];
    /**
     * Clear all stored conversation entries.
     */
    clearHistory(): void;
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
    };
}
export declare function createConversationManager(logger: Logger, maxHistorySize?: number): ConversationManager;
