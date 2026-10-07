// @lifecycle canonical - Validates the individual McpToolRequest fields the engine reads.
/**
 * MCP Tool Request Validator
 *
 * Field-level checks (command, chain id, gate verdict) for callers inside the engine. The request
 * as a whole is validated by the `prompt_engine` tool schema (`mcp/tools/schemas/`).
 */
import { isValidGateVerdict } from '../../gates/core/gate-verdict-contract.js';

import type { McpToolRequest } from '#shared/types/execution.js';

import { CHAIN_ID_FORMAT_MESSAGE, isChainId } from '#shared/utils/chain-id-codec.js';

/**
 * Validator for McpToolRequest with comprehensive error handling
 */
type MutableMcpToolRequest = {
  -readonly [K in keyof McpToolRequest]: McpToolRequest[K];
};

export class McpToolRequestValidator {
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
    return isChainId(chainId);
  }

  /**
   * Type guard to check if a value is a valid gate verdict
   *
   * @param gateVerdict - Value to check
   * @returns True if a legacy verdict or structured review satisfies the engine contract
   */
  static isValidGateVerdict(
    gateVerdict: unknown
  ): gateVerdict is NonNullable<McpToolRequest['gate_verdict']> {
    return isValidGateVerdict(gateVerdict);
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
      throw new Error(CHAIN_ID_FORMAT_MESSAGE);
    }
    return chainId;
  }

  /**
   * Validates a gate verdict while retaining structured review data.
   *
   * @param gateVerdict - Gate verdict to validate
   * @returns Trimmed legacy string or original structured review
   * @throws {Error} If gate verdict is invalid
   */
  static validateGateVerdict(gateVerdict: unknown): NonNullable<McpToolRequest['gate_verdict']> {
    if (!this.isValidGateVerdict(gateVerdict)) {
      throw new Error('Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"');
    }
    return typeof gateVerdict === 'string' ? gateVerdict.trim() : gateVerdict;
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

    if (partialRequest.inputs !== undefined) {
      result.inputs = partialRequest.inputs;
    }

    return Object.freeze(result);
  }
}
