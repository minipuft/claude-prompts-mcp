// @lifecycle canonical - Shared interfaces and types for gate definitions.
/**
 * Gate System - Shared Definitions & Interfaces
 *
 * Centralized type definitions for all gate system components.
 * This enables clean dependencies and consistent interfaces.
 */

import type { ArtifactKind } from '../utils/artifact-kinds.js';

/**
 * Context information for gate activation and rendering
 */
export interface GateContext {
  /**
   * Whether this render belongs to the chain criteria pipeline. Single prompts only receive
   * guidance; an absent value must not promise that criteria execute or results are recorded.
   */
  criteriaExecution?: 'guidance-only' | 'pipeline';
  framework?: string;
  category?: string;
  promptId?: string;
  explicitGateIds?: readonly string[];
  /**
   * Artifact kinds this run declares (ruling B13), the same set the gate-set resolver selected
   * with. Carried onto the RENDER context because the renderer re-runs activation per gate: an
   * artifact-scoped gate resolved at rank 20 would otherwise be dropped here and attach with no
   * guidance at all.
   */
  artifacts?: readonly ArtifactKind[];
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
