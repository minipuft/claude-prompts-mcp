// @lifecycle canonical - Type definitions for inline script reference resolution.
/**
 * Script Reference Resolution Types
 *
 * Types for resolving {{script:id}} template references.
 * Enables inline script execution where templates can invoke
 * pre-registered scripts and inline their JSON output.
 *
 * Syntax variants:
 * - {{script:analyzer}}                 - Full JSON output
 * - {{script:analyzer.field}}           - Extract specific field
 * - {{script:analyzer key='value'}}     - Pass inline arguments
 */

import type { ScriptExecutionResult } from '../../scripts/types.js';

/**
 * Detected script reference in a template.
 */
export interface DetectedScriptReference {
  /** The full match string (e.g., "{{script:analyzer file='data.csv'}}") */
  fullMatch: string;
  /** The script ID being referenced */
  scriptId: string;
  /** Optional field to extract from JSON output (e.g., "row_count") */
  fieldAccess?: string;
  /** Parsed inline arguments (e.g., { file: 'data.csv' }) */
  inlineArgs?: Record<string, unknown>;
  /** Start index in the template */
  startIndex: number;
  /** End index in the template */
  endIndex: number;
}

/**
 * Result of pre-resolving all script references in a template.
 */
export interface ScriptPreResolveResult {
  /** Template with all {{script:...}} placeholders replaced with output */
  resolvedTemplate: string;
  /** All script results keyed by script ID */
  scriptResults: Map<string, ScriptExecutionResult>;
  /** Diagnostics about the resolution process */
  diagnostics: ScriptResolutionDiagnostics;
}

/**
 * Diagnostics collected during script reference resolution.
 */
export interface ScriptResolutionDiagnostics {
  /** Number of script references resolved */
  scriptsResolved: number;
  /** Warnings generated during resolution */
  warnings: string[];
  /** Total resolution time in milliseconds */
  resolutionTimeMs: number;
}

/**
 * Options for script reference resolution.
 */
export interface ScriptResolutionOptions {
  /** Timeout for script execution in milliseconds (default: 5000) */
  scriptTimeout?: number;
  /** Whether to pretty-print JSON output (default: false) */
  prettyPrint?: boolean;
}

/**
 * Default options for script reference resolution.
 */
export const DEFAULT_SCRIPT_RESOLUTION_OPTIONS: Required<ScriptResolutionOptions> = {
  scriptTimeout: 5000,
  prettyPrint: false,
};
