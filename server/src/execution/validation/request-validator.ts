// @lifecycle canonical - Validates execution requests against canonical schemas.
/**
 * MCP Tool Request Validator
 *
 * Provides comprehensive validation for McpToolRequest objects with
 * detailed error handling and type safety.
 */
import { ZodError } from 'zod';

import { mcpToolRequestSchema } from './schemas.js';
import { recordParameterIssue } from '../../tooling/action-metadata/usage-tracker.js';
import { CHAIN_ID_PATTERN } from '../../utils/index.js';

import type { McpToolRequest } from '../../types/execution.js';

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
   * Type guard to check if a value is a valid chain ID
   *
   * @param chainId - Value to check
   * @returns True if chain ID matches required pattern
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
   * Validates a chain ID string specifically
   *
   * @param chainId - Chain ID to validate
   * @returns Validated chain ID string
   * @throws {Error} If chain ID is invalid
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

    if (partialRequest.command !== undefined) {
      result.command = this.validateCommand(partialRequest.command);
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
