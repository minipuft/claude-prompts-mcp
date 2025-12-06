// @lifecycle canonical - Shared interfaces and types for gate definitions.
/**
 * Gate System - Shared Definitions & Interfaces
 *
 * Centralized type definitions for all gate system components.
 * This enables clean dependencies and consistent interfaces.
 */

/**
 * Gate type classification for precedence and activation logic
 */
export type GateType = 'framework' | 'category' | 'quality' | 'security';

/**
 * Gate definition structure loaded from JSON files
 */
export interface GateDefinition {
  id: string;
  name: string;
  guidance: string;
  gate_type?: GateType; // Framework gates bypass category checks
  activation: {
    prompt_categories?: string[];
    framework_context?: string[];
    explicit_request?: boolean;
  };
}

/**
 * Context information for gate activation and rendering
 */
export interface GateContext {
  framework?: string;
  category?: string;
  promptId?: string;
  explicitGateIds?: readonly string[];
}

/**
 * Gate selection criteria for intelligent selection
 */
export interface GateSelectionCriteria {
  framework?: string;
  category?: string;
  promptId?: string;
  executionMode?: 'single' | 'prompt' | 'template' | 'chain';
  complexityLevel?: 'low' | 'medium' | 'high';
}

/**
 * Result of gate selection with reasoning
 */
export interface GateSelectionResult {
  selectedGates: string[];
  reasoning: string[];
  confidence: number;
  estimatedExecutionTime: number;
  fallbackGates: string[];
}
