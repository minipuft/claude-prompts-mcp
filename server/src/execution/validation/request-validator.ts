// @lifecycle canonical - Validates execution requests against canonical schemas.
/**
 * MCP Tool Request Validator
 *
 * Provides comprehensive validation for McpToolRequest objects with
 * detailed error handling and type safety.
 */
import { ZodError } from 'zod';

import { mcpToolRequestSchema } from './schemas.js';
import { CHAIN_ID_PATTERN } from '../../utils/index.js';
import { recordParameterIssue } from '../../tooling/action-metadata/usage-tracker.js';

import type { McpToolRequest } from '../../types/execution.js';

const LEGACY_SESSION_ID_ERROR =
  "session_id is no longer supported. Use 'chain_id' from the response footer to resume.";
const LEGACY_GATE_VALIDATION_ERROR =
  "gate_validation has been retired. Use 'gates' parameter to specify quality gates.";
const LEGACY_API_VALIDATION_ERROR =
  "api_validation has been removed. Use 'gates' parameter to specify quality gates.";
const LEGACY_LLM_VALIDATION_ERROR =
  "llm_validation is experimental and not yet implemented. Use 'gates' parameter with gate_verdict for gate-based validation. See docs/enhanced-gate-system.md for current gate features.";
const LEGACY_GUIDED_PARAM_ERROR =
  "guided parameter is deprecated. Use %judge (alias %guided) in the command to trigger judge mode.";
const LEGACY_SELECTION_PARAM_ERROR =
  'selected_framework/selected_gates/selected_style parameters are deprecated. Use @framework, ::gates, and #style(<id>) inline in the command.';
const LEGACY_TIMEOUT_PARAM_ERROR =
  'timeout parameter has been removed. The pipeline manages timing; rely on defaults or chain-level controls.';

/**
 * Validator for McpToolRequest with comprehensive error handling
 */
type MutableMcpToolRequest = {
  -readonly [K in keyof McpToolRequest]: McpToolRequest[K];
};

export class McpToolRequestValidator {
  /**
   * Validates an unknown input against the McpToolRequest schema
   *
   * @param raw - Raw input to validate
   * @returns Validated and typed McpToolRequest
   * @throws {Error} If validation fails with detailed error messages
   */
  static validate(raw: unknown): McpToolRequest {
    try {
      if (
        raw &&
        typeof raw === 'object' &&
        'session_id' in (raw as Record<string, unknown>) &&
        (raw as Record<string, unknown>).session_id !== undefined
      ) {
        recordParameterIssue('prompt_engine', 'session_id', LEGACY_SESSION_ID_ERROR);
        throw new Error(LEGACY_SESSION_ID_ERROR);
      }
      if (
        raw &&
        typeof raw === 'object' &&
        'gate_validation' in (raw as Record<string, unknown>) &&
        (raw as Record<string, unknown>).gate_validation !== undefined
      ) {
        recordParameterIssue('prompt_engine', 'gate_validation', LEGACY_GATE_VALIDATION_ERROR);
        throw new Error(LEGACY_GATE_VALIDATION_ERROR);
      }
      if (
        raw &&
        typeof raw === 'object' &&
        'api_validation' in (raw as Record<string, unknown>) &&
        (raw as Record<string, unknown>).api_validation !== undefined
      ) {
        recordParameterIssue('prompt_engine', 'api_validation', LEGACY_API_VALIDATION_ERROR);
        throw new Error(LEGACY_API_VALIDATION_ERROR);
      }
      if (
        raw &&
        typeof raw === 'object' &&
        'llm_validation' in (raw as Record<string, unknown>) &&
        (raw as Record<string, unknown>).llm_validation !== undefined
      ) {
        recordParameterIssue('prompt_engine', 'llm_validation', LEGACY_LLM_VALIDATION_ERROR);
        throw new Error(LEGACY_LLM_VALIDATION_ERROR);
      }
      if (
        raw &&
        typeof raw === 'object' &&
        'guided' in (raw as Record<string, unknown>) &&
        (raw as Record<string, unknown>).guided !== undefined
      ) {
        recordParameterIssue('prompt_engine', 'guided', LEGACY_GUIDED_PARAM_ERROR);
        throw new Error(LEGACY_GUIDED_PARAM_ERROR);
      }
      if (
        raw &&
        typeof raw === 'object' &&
        ('selected_framework' in (raw as Record<string, unknown>) ||
          'selected_gates' in (raw as Record<string, unknown>) ||
          'selected_style' in (raw as Record<string, unknown>))
      ) {
        recordParameterIssue('prompt_engine', 'selected_*', LEGACY_SELECTION_PARAM_ERROR);
        throw new Error(LEGACY_SELECTION_PARAM_ERROR);
      }
      if (
        raw &&
        typeof raw === 'object' &&
        'timeout' in (raw as Record<string, unknown>) &&
        (raw as Record<string, unknown>).timeout !== undefined
      ) {
        recordParameterIssue('prompt_engine', 'timeout', LEGACY_TIMEOUT_PARAM_ERROR);
        throw new Error(LEGACY_TIMEOUT_PARAM_ERROR);
      }

      const result = mcpToolRequestSchema.parse(raw) as MutableMcpToolRequest & {};
      const sanitized: MutableMcpToolRequest = result;

      // Freeze to enforce immutability
      return Object.freeze(sanitized) as McpToolRequest;
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join('; ');
        recordParameterIssue('prompt_engine', 'mcp_request', errorMessages, {
          issues: error.errors.map((err) => ({
            path: err.path.join('.') || '(root)',
            code: err.code,
          })),
        });
        throw new Error(`McpToolRequest validation failed: ${errorMessages}`);
      }
      throw error;
    }
  }

  /**
   * Type guard to check if a value is a valid command string
   *
   * @param command - Value to check
   * @returns True if command is a non-empty string
   */
  static isValidCommand(command: unknown): command is string {
    return typeof command === 'string' && command.trim().length > 0;
  }

  /**
   * Type guard to check if a value is a valid session ID
   *
   * @param sessionId - Value to check
   * @returns True if session ID matches required pattern
   */
  /**
   * Type guard to check if a value is a valid chain ID
   */
  static isValidChainId(chainId: unknown): chainId is string {
    return typeof chainId === 'string' && CHAIN_ID_PATTERN.test(chainId);
  }

  /**
   * Type guard to check if a value is a valid gate verdict
   *
   * @param gateVerdict - Value to check
   * @returns True if gate verdict matches required format
   */
  static isValidGateVerdict(gateVerdict: unknown): gateVerdict is string {
    if (typeof gateVerdict !== 'string') {
      return false;
    }

    const normalized = gateVerdict.trim();
    if (!normalized.length) {
      return false;
    }

    return /^GATE_REVIEW:\s(PASS|FAIL)\s-\s.+$/.test(normalized);
  }

  /**
   * Validates a command string specifically
   *
   * @param command - Command to validate
   * @returns Validated command string
   * @throws {Error} If command is invalid
   */
  static validateCommand(command: unknown): string {
    if (!this.isValidCommand(command)) {
      throw new Error('Command must be a non-empty string');
    }
    return command.trim();
  }

  /**
   * Validates a session ID string specifically
   *
   * @param sessionId - Session ID to validate
   * @returns Validated session ID string
   * @throws {Error} If session ID is invalid
   */
  /**
   * Validates a chain ID string specifically
   */
  static validateChainId(chainId: unknown): string {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Chain ID must follow format: chain-{prompt} or chain-{prompt}#runNumber');
    }
    return chainId;
  }

  /**
   * Validates a gate verdict string specifically
   *
   * @param gateVerdict - Gate verdict to validate
   * @returns Validated gate verdict string
   * @throws {Error} If gate verdict is invalid
   */
  static validateGateVerdict(gateVerdict: unknown): string {
    if (!this.isValidGateVerdict(gateVerdict)) {
      throw new Error('Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"');
    }
    return gateVerdict.trim();
  }

  /**
   * Performs partial validation for optional fields
   *
   * @param partialRequest - Partial request object to validate
   * @returns Validated partial request
   * @throws {Error} If any provided fields are invalid
   */
  static validatePartial(partialRequest: Partial<McpToolRequest>): Partial<McpToolRequest> {
    const result: Partial<MutableMcpToolRequest> = {};

    if (
      partialRequest &&
      'gate_validation' in partialRequest &&
      (partialRequest as Record<string, unknown>).gate_validation !== undefined
    ) {
      recordParameterIssue('prompt_engine', 'gate_validation', LEGACY_GATE_VALIDATION_ERROR);
      throw new Error(LEGACY_GATE_VALIDATION_ERROR);
    }
    if (
      partialRequest &&
      'api_validation' in partialRequest &&
      (partialRequest as Record<string, unknown>).api_validation !== undefined
    ) {
      recordParameterIssue('prompt_engine', 'api_validation', LEGACY_API_VALIDATION_ERROR);
      throw new Error(LEGACY_API_VALIDATION_ERROR);
    }
    if (
      partialRequest &&
      'llm_validation' in partialRequest &&
      (partialRequest as Record<string, unknown>).llm_validation !== undefined
    ) {
      recordParameterIssue('prompt_engine', 'llm_validation', LEGACY_LLM_VALIDATION_ERROR);
      throw new Error(LEGACY_LLM_VALIDATION_ERROR);
    }
    if (partialRequest.command !== undefined) {
      result.command = this.validateCommand(partialRequest.command);
    }

    if (partialRequest.session_id !== undefined) {
      recordParameterIssue('prompt_engine', 'session_id', LEGACY_SESSION_ID_ERROR);
      throw new Error(LEGACY_SESSION_ID_ERROR);
    }

    if (partialRequest.chain_id !== undefined) {
      result.chain_id = this.validateChainId(partialRequest.chain_id);
    }

    if (partialRequest.gate_verdict !== undefined) {
      result.gate_verdict = this.validateGateVerdict(partialRequest.gate_verdict);
    }

    // Copy other fields as-is (they'll be validated by full schema if needed)
    if (partialRequest.force_restart !== undefined) {
      result.force_restart = partialRequest.force_restart;
    }

    if (partialRequest.gates !== undefined) {
      result.gates = partialRequest.gates;
    }

    if (partialRequest.options !== undefined) {
      result.options = partialRequest.options;
    }

    return Object.freeze(result);
  }
}
