// @lifecycle canonical - Validates execution requests against canonical schemas.
/**
 * MCP Tool Request Validator
 *
 * Provides comprehensive validation for McpToolRequest objects with
 * detailed error handling and type safety.
 */
import { mcpToolRequestSchema } from './schemas.js';
import type { McpToolRequest } from '../../types/execution.js';
import { ZodError } from 'zod';
import { recordParameterIssue } from '../../tooling/action-metadata/usage-tracker.js';

const LEGACY_SESSION_ID_ERROR =
  "session_id is no longer supported. Use 'chain_id' from the response footer to resume.";

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
      const result = mcpToolRequestSchema.parse(raw) as MutableMcpToolRequest & {
        gate_validation?: boolean;
      };
      const sanitized: MutableMcpToolRequest = result;
      const legacyGateValidation = result.gate_validation;
      const apiValidationValue =
        result.api_validation ??
        (legacyGateValidation !== undefined ? legacyGateValidation : false);

      if (legacyGateValidation !== undefined) {
        recordParameterIssue(
          'prompt_engine',
          'gate_validation',
          "Parameter renamed to 'api_validation'. Update requests to avoid legacy references."
        );
      }

      sanitized.api_validation = apiValidationValue;
      if ('gate_validation' in sanitized) {
        delete (sanitized as Record<string, unknown>).gate_validation;
      }

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
    return typeof chainId === 'string' && /^chain-[a-zA-Z0-9_-]+(?:#\d+)?$/.test(chainId);
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
    return (gateVerdict).trim();
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
    const legacyPartial = partialRequest as Partial<McpToolRequest> & {
      gate_validation?: boolean;
    };

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

    if (partialRequest.execution_mode !== undefined) {
      result.execution_mode = partialRequest.execution_mode;
    }

    if (partialRequest.api_validation !== undefined) {
      result.api_validation = partialRequest.api_validation;
    } else if (legacyPartial.gate_validation !== undefined) {
      recordParameterIssue(
        'prompt_engine',
        'gate_validation',
        "Parameter renamed to 'api_validation'. Update requests to avoid legacy references."
      );
      result.api_validation = legacyPartial.gate_validation;
    }

    if (partialRequest.quality_gates !== undefined) {
      result.quality_gates = partialRequest.quality_gates;
    }

    if (partialRequest.custom_checks !== undefined) {
      result.custom_checks = partialRequest.custom_checks;
    }

    if (partialRequest.temporary_gates !== undefined) {
      result.temporary_gates = partialRequest.temporary_gates;
    }

    if (partialRequest.gate_scope !== undefined) {
      result.gate_scope = partialRequest.gate_scope;
    }

    if (partialRequest.timeout !== undefined) {
      result.timeout = partialRequest.timeout;
    }

    if (partialRequest.options !== undefined) {
      result.options = partialRequest.options;
    }

    return Object.freeze(result);
  }
}
