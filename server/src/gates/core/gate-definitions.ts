/**
 * Gate System - Shared Definitions & Interfaces
 *
 * Centralized type definitions for all gate system components.
 * This enables clean dependencies and consistent interfaces.
 */

/**
 * Gate definition structure loaded from JSON files
 */
export interface GateDefinition {
  id: string;
  name: string;
  guidance: string;
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
}

/**
 * Gate selection criteria for intelligent selection
 */
export interface GateSelectionCriteria {
  framework?: string;
  category?: string;
  promptId?: string;
  executionMode?: 'prompt' | 'template' | 'chain';
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

/**
 * Performance metrics for individual gates
 */
export interface GatePerformanceMetrics {
  gateId: string;
  avgExecutionTime: number;
  successRate: number;
  retryRate: number;
  lastUsed: Date;
  usageCount: number;
}

/**
 * Overall gate system analytics
 */
export interface GateSystemAnalytics {
  totalGates: number;
  avgExecutionTime: number;
  overallSuccessRate: number;
  topPerformingGates: string[];
  underperformingGates: string[];
  recommendations: string[];
}