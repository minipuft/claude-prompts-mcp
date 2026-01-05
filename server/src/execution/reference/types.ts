// @lifecycle canonical - Type definitions for prompt reference resolution.
/**
 * Prompt Reference Resolution Types
 *
 * Types for resolving {{ref:prompt_id}} template references.
 * Enables modular prompt composition where templates can include
 * other prompts by ID, with automatic script execution.
 */

import type { ScriptExecutionResult, ToolDetectionMatch } from '../../scripts/types.js';

/**
 * Result of resolving a single prompt reference.
 */
export interface ReferenceResolutionResult {
  /** The rendered content from the referenced prompt */
  content: string;
  /** Script execution results keyed by tool ID */
  scriptResults: Map<string, ScriptExecutionResult>;
  /** Chain of prompt IDs that led to this resolution (for cycle detection) */
  resolutionChain: string[];
  /** All prompt IDs that were resolved (including nested) */
  resolvedPromptIds: Set<string>;
}

/**
 * Result of pre-resolving all references in a template.
 */
export interface PreResolveResult {
  /** Template with all {{ref:...}} placeholders replaced with content */
  resolvedTemplate: string;
  /** All script results from referenced prompts, keyed by "promptId:toolId" */
  scriptResults: Map<string, ScriptExecutionResult>;
  /** All prompt IDs that were resolved */
  resolvedPromptIds: Set<string>;
  /** Diagnostics about the resolution process */
  diagnostics: ResolutionDiagnostics;
}

/**
 * Diagnostics collected during reference resolution.
 */
export interface ResolutionDiagnostics {
  /** Number of references resolved */
  referencesResolved: number;
  /** Number of scripts executed */
  scriptsExecuted: number;
  /** Warnings generated during resolution */
  warnings: string[];
  /** Total resolution time in milliseconds */
  resolutionTimeMs: number;
}

/**
 * Options for reference resolution.
 */
export interface ReferenceResolutionOptions {
  /** Maximum nesting depth for recursive references (default: 10) */
  maxDepth?: number;
  /** Whether to throw on missing prompts (default: true) */
  throwOnMissing?: boolean;
  /** Whether to execute scripts in referenced prompts (default: true) */
  executeScripts?: boolean;
  /** Timeout for script execution in milliseconds (default: 5000) */
  scriptTimeout?: number;
}

/**
 * Detected reference in a template.
 */
export interface DetectedReference {
  /** The full match string (e.g., "{{ref:my_prompt}}") */
  fullMatch: string;
  /** The prompt ID being referenced */
  promptId: string;
  /** Start index in the template */
  startIndex: number;
  /** End index in the template */
  endIndex: number;
}

/**
 * Context passed to referenced prompt for rendering.
 */
export interface ReferenceContext {
  /** Parent context variables */
  parentContext: Record<string, unknown>;
  /** Explicit arguments for the referenced prompt */
  explicitArgs?: Record<string, unknown>;
  /** Script results from this reference's script execution */
  scriptResults?: Map<string, ScriptExecutionResult>;
  /** The resolution chain for cycle detection */
  resolutionChain: string[];
}

/**
 * Script detection result for a referenced prompt.
 */
export interface ReferenceScriptDetection {
  /** Tools that matched and are ready for execution */
  matchedTools: ToolDetectionMatch[];
  /** Tools that were skipped (trigger didn't match) */
  skippedTools: string[];
  /** Tools that require confirmation (not auto-executed) */
  pendingConfirmation: string[];
}

/**
 * Default options for reference resolution.
 */
export const DEFAULT_RESOLUTION_OPTIONS: Required<ReferenceResolutionOptions> = {
  maxDepth: 10,
  throwOnMissing: true,
  executeScripts: true,
  scriptTimeout: 5000,
};
