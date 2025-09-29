/**
 * Text Reference System Module
 * Handles storage and retrieval of text references for template processing
 */

import { Logger } from "../logging/index.js";
import { TextReference, TextReferenceStore } from "../types/index.js";

/**
 * Text Reference Manager class
 */
export class TextReferenceManager {
  private store: TextReferenceStore;
  private logger: Logger;

  // Chain step results storage - single source of truth for step content
  private chainStepResults: Record<string, Record<number, {
    content: string;
    timestamp: number;
    metadata?: any;
  }>> = {};

  constructor(
    logger: Logger,
    maxAge: number = 24 * 60 * 60 * 1000,
    maxSize: number = 1000
  ) {
    this.store = {
      references: [],
      maxAge,
      maxSize,
    };
    this.logger = logger;
  }

  /**
   * Generate a title for a text using Claude (placeholder implementation)
   */
  private async generateTextTitle(text: string): Promise<string> {
    try {
      // For now, create a simple title from the first 50 characters
      // In the future, this could call Claude directly for better titles
      const title = text.substring(0, 50).trim();
      return title || `Text_${Date.now()}`;
    } catch (error) {
      this.logger.error("Error generating title:", error);
      return `Text_${Date.now()}`;
    }
  }

  /**
   * Store a text reference and return its reference ID
   */
  async storeTextReference(text: string): Promise<string> {
    try {
      const title = await this.generateTextTitle(text);
      const id = `ref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const reference: TextReference = {
        id,
        title,
        content: text,
        createdAt: Date.now(),
        lastUsed: Date.now(),
      };

      this.store.references.push(reference);

      // Clean up old references if we exceed maxSize
      if (this.store.references.length > this.store.maxSize) {
        this.cleanupOldReferences();
      }

      return `{{ref:${id}}}`;
    } catch (error) {
      this.logger.error("Error storing text reference:", error);
      throw new Error(
        `Failed to store text reference: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Retrieve a text reference by ID
   */
  getTextReference(refId: string): string | null {
    const reference = this.store.references.find((ref) => ref.id === refId);
    if (reference) {
      reference.lastUsed = Date.now();
      return reference.content;
    }
    return null;
  }

  /**
   * Clean up old references
   */
  private cleanupOldReferences(): void {
    const now = Date.now();
    this.store.references = this.store.references
      .filter((ref) => now - ref.lastUsed < this.store.maxAge)
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .slice(0, this.store.maxSize);
  }

  /**
   * List available references
   */
  listTextReferences(): Array<{
    id: string;
    title: string;
    createdAt: number;
  }> {
    return this.store.references.map((ref) => ({
      id: ref.id,
      title: ref.title,
      createdAt: ref.createdAt,
    }));
  }

  /**
   * Process template text references by replacing reference placeholders with content
   */
  processTemplateReferences(template: string): string {
    return template.replace(/{{ref:([^}]+)}}/g, (match, refId) => {
      const content = this.getTextReference(refId);
      return content || match; // Keep the reference placeholder if content not found
    });
  }

  /**
   * Get statistics about the reference store
   */
  getStats(): {
    totalReferences: number;
    oldestReference: number | null;
    newestReference: number | null;
  } {
    const references = this.store.references;

    if (references.length === 0) {
      return {
        totalReferences: 0,
        oldestReference: null,
        newestReference: null,
      };
    }

    const oldest = Math.min(...references.map((ref) => ref.createdAt));
    const newest = Math.max(...references.map((ref) => ref.createdAt));

    return {
      totalReferences: references.length,
      oldestReference: oldest,
      newestReference: newest,
    };
  }

  /**
   * Clear all references (useful for testing or memory management)
   */
  clearAllReferences(): void {
    this.store.references = [];
    this.chainStepResults = {};
    this.logger.info("Cleared all text references and chain step results");
  }

  /**
   * Set new limits for the reference store
   */
  setLimits(maxAge: number, maxSize: number): void {
    this.store.maxAge = maxAge;
    this.store.maxSize = maxSize;

    // Clean up if current size exceeds new limit
    if (this.store.references.length > maxSize) {
      this.cleanupOldReferences();
    }

    this.logger.info(
      `Updated text reference limits: maxAge=${maxAge}ms, maxSize=${maxSize}`
    );
  }

  // ===== CHAIN STEP MANAGEMENT METHODS =====
  // Single source of truth for chain step content storage

  /**
   * Store a chain step result
   */
  storeChainStepResult(chainId: string, stepNumber: number, content: string, metadata?: any): void {
    if (!this.chainStepResults[chainId]) {
      this.chainStepResults[chainId] = {};
    }

    this.chainStepResults[chainId][stepNumber] = {
      content,
      timestamp: Date.now(),
      metadata
    };

    this.logger.debug(`Stored step ${stepNumber} result for chain ${chainId} (${content.length} chars)`);
  }

  /**
   * Get all step results for a specific chain
   */
  getChainStepResults(chainId: string): Record<number, string> {
    const chainResults = this.chainStepResults[chainId] || {};
    const results: Record<number, string> = {};

    Object.entries(chainResults).forEach(([stepNum, stepData]) => {
      results[parseInt(stepNum)] = stepData.content;
    });

    return results;
  }

  /**
   * Get a specific step result
   */
  getChainStepResult(chainId: string, stepNumber: number): string | null {
    const stepData = this.chainStepResults[chainId]?.[stepNumber];
    return stepData ? stepData.content : null;
  }

  /**
   * Build template variables for chain step interpolation
   * Creates variables like {{step1_result}}, {{step2_result}}, etc.
   */
  buildChainVariables(chainId: string): Record<string, any> {
    const stepResults = this.getChainStepResults(chainId);
    const variables: Record<string, any> = {};

    // Build step-specific variables
    Object.entries(stepResults).forEach(([stepNum, content]) => {
      const stepNumber = parseInt(stepNum);
      variables[`step${stepNumber + 1}_result`] = content; // 1-based naming for user-friendliness
      variables[`previous_step_result`] = content; // Always contains the latest result
    });

    // Add chain metadata
    variables[`chain_id`] = chainId;
    variables[`step_results`] = stepResults; // Raw step results for advanced access

    return variables;
  }

  /**
   * Get chain step metadata
   */
  getChainStepMetadata(chainId: string, stepNumber: number): any | null {
    return this.chainStepResults[chainId]?.[stepNumber]?.metadata || null;
  }

  /**
   * Clear all step results for a specific chain
   */
  clearChainStepResults(chainId: string): void {
    delete this.chainStepResults[chainId];
    this.logger.debug(`Cleared all step results for chain ${chainId}`);
  }

  /**
   * Get statistics about chain step storage
   */
  getChainStats(): {
    totalChains: number;
    totalSteps: number;
    chainsWithSteps: string[];
  } {
    const chainIds = Object.keys(this.chainStepResults);
    let totalSteps = 0;

    chainIds.forEach(chainId => {
      totalSteps += Object.keys(this.chainStepResults[chainId]).length;
    });

    return {
      totalChains: chainIds.length,
      totalSteps,
      chainsWithSteps: chainIds
    };
  }

  /**
   * Check if a chain has any step results
   */
  hasChainStepResults(chainId: string): boolean {
    return !!this.chainStepResults[chainId] && Object.keys(this.chainStepResults[chainId]).length > 0;
  }
}

/**
 * Create a text reference manager instance
 */
export function createTextReferenceManager(
  logger: Logger,
  maxAge: number = 24 * 60 * 60 * 1000,
  maxSize: number = 1000
): TextReferenceManager {
  return new TextReferenceManager(logger, maxAge, maxSize);
}
