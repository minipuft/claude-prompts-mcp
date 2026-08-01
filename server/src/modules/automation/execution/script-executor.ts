// @lifecycle canonical - Subprocess execution for prompt-scoped script tools.
/**
 * Script Executor
 *
 * Handles prompt-scoped script tool execution. Domain-specific concerns:
 * - Input validation against JSON Schema
 * - Runtime detection (python/node/shell/auto)
 * - JSON string normalization for typed inputs
 *
 * Delegates subprocess lifecycle (spawn, timeout, env, capture) to the
 * stateless `executeProcess` utility in shared/utils/process.ts.
 *
 * @see shared/utils/process.ts for the shared execution utility
 * @see plans/script-tools-implementation.md for the full implementation plan
 */

import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

import type { ScriptExecutorPort } from '#shared/types/index.js';
import type {
  LoadedScriptTool,
  ScriptExecutionRequest,
  ScriptExecutionResult,
  ScriptExecutorConfig,
  ScriptInputValidationResult,
  JSONSchemaDefinition,
} from '../types.js';

import { executeProcess } from '#shared/utils/process.js';

/**
 * Runtime command mappings for script execution.
 */
const RUNTIME_COMMANDS: Record<string, string[]> = {
  python: ['python3', 'python'],
  node: ['node'],
  shell: ['bash', 'sh'],
};

/**
 * Extension to runtime mapping for auto-detection.
 */
const EXTENSION_TO_RUNTIME: Record<string, string> = {
  '.py': 'python',
  '.js': 'node',
  '.mjs': 'node',
  '.cjs': 'node',
  '.ts': 'node', // Assumes ts-node or similar
  '.sh': 'shell',
  '.bash': 'shell',
};

/**
 * Script Executor Service
 *
 * Handles input validation and runtime resolution, delegating subprocess
 * execution to the stateless `executeProcess` utility.
 *
 * @example
 * ```typescript
 * const executor = new ScriptExecutor({ defaultTimeout: 30000 });
 *
 * const result = await executor.execute({
 *   toolId: 'analyze_csv',
 *   promptId: 'data_analyzer',
 *   inputs: { file: 'data.csv' },
 * }, loadedTool);
 *
 * if (result.success) {
 *   console.log('Output:', result.output);
 * }
 * ```
 */
export class ScriptExecutor implements ScriptExecutorPort {
  private readonly debug: boolean;
  private readonly defaultTimeout: number;
  private readonly maxTimeout: number;
  private readonly baseEnv: Record<string, string>;

  constructor(config: ScriptExecutorConfig = {}) {
    this.defaultTimeout = config.defaultTimeout ?? 30000;
    this.maxTimeout = config.maxTimeout ?? 300000;
    this.debug = config.debug ?? false;
    this.baseEnv = config.baseEnv ?? {};

    if (this.debug) {
      console.error('[ScriptExecutor] Initialized with config:', {
        defaultTimeout: this.defaultTimeout,
        maxTimeout: this.maxTimeout,
      });
    }
  }

  /**
   * Execute a script tool with the given inputs.
   */
  async execute(
    request: ScriptExecutionRequest,
    tool: LoadedScriptTool
  ): Promise<ScriptExecutionResult> {
    const startTime = Date.now();

    // Validate tool is enabled
    if (tool.enabled === false) {
      return this.createErrorResult(startTime, 'Tool is disabled', -1);
    }

    // Validate script exists
    if (!existsSync(tool.absoluteScriptPath)) {
      return this.createErrorResult(startTime, `Script not found: ${tool.absoluteScriptPath}`, -1);
    }

    // Validate inputs against schema
    const validation = this.validateInputs(request.inputs, tool.inputSchema);
    if (!validation.valid) {
      return this.createErrorResult(
        startTime,
        `Input validation failed: ${validation.errors.join('; ')}`,
        -1
      );
    }

    // Resolve runtime and command
    const runtime = this.resolveRuntime(tool);
    const command = this.findRuntimeCommand(runtime);
    if (!command) {
      return this.createErrorResult(startTime, `No interpreter found for runtime '${runtime}'`, -1);
    }

    // Build per-execution env vars (tool-specific + request-specific + context vars)
    const env: Record<string, string> = {
      ...(tool.env ?? {}),
      ...(request.env ?? {}),
      SCRIPT_TOOL_ID: tool.id,
      SCRIPT_PROMPT_ID: tool.promptId,
      SCRIPT_TOOL_DIR: tool.toolDir,
    };

    const timeout = this.resolveTimeout(request, tool);
    const workingDir = tool.workingDir ? join(tool.toolDir, tool.workingDir) : tool.toolDir;

    // Delegate to shared executeProcess utility
    const result = await executeProcess({
      command: [command, tool.absoluteScriptPath],
      stdin: JSON.stringify(validation.normalizedInputs ?? request.inputs),
      cwd: workingDir,
      env,
      baseEnv: this.baseEnv,
      timeout,
      maxTimeout: this.maxTimeout,
      processGroup: false,
      truncateOutput: 0,
      parseJson: true,
      debug: this.debug,
    });

    const success = result.exitCode === 0;
    const scriptResult: ScriptExecutionResult = {
      success,
      output: result.parsed ?? result.stdout,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    };

    if (!success) {
      scriptResult.error = result.timedOut
        ? `Script timed out after ${timeout}ms`
        : result.stderr || `Process exited with code ${result.exitCode}`;
    }

    return scriptResult;
  }

  /**
   * Validate inputs against the tool's JSON Schema.
   */
  validateInputs(
    inputs: Record<string, unknown>,
    schema: JSONSchemaDefinition
  ): ScriptInputValidationResult {
    const errors: string[] = [];
    const normalizedInputs = this.normalizeJsonStringInputs(inputs, schema);

    if (!schema.properties || Object.keys(schema.properties).length === 0) {
      return { valid: true, errors: [], normalizedInputs };
    }

    const required = schema.required ?? [];
    for (const field of required) {
      if (!(field in normalizedInputs) || normalizedInputs[field] === undefined) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    for (const [key, value] of Object.entries(normalizedInputs)) {
      const propSchema = schema.properties[key];
      if (!propSchema) continue;

      const expectedType = propSchema.type;
      if (!expectedType) continue;

      const actualType = this.getJsonType(value);
      const expectedTypes = Array.isArray(expectedType) ? expectedType : [expectedType];

      if (!expectedTypes.includes(actualType) && actualType !== 'null') {
        errors.push(`Field '${key}': expected ${expectedTypes.join(' | ')}, got ${actualType}`);
      }
    }

    const result: ScriptInputValidationResult = {
      valid: errors.length === 0,
      errors,
    };
    if (errors.length === 0) {
      result.normalizedInputs = normalizedInputs;
    }
    return result;
  }

  private getJsonType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    const t = typeof value;
    if (t === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    return t;
  }

  /**
   * Normalize JSON string inputs to their intended types based on schema.
   */
  private normalizeJsonStringInputs(
    inputs: Record<string, unknown>,
    schema: JSONSchemaDefinition
  ): Record<string, unknown> {
    if (!schema.properties) {
      return { ...inputs };
    }

    const normalized: Record<string, unknown> = { ...inputs };
    const required = new Set(schema.required ?? []);

    for (const [key, value] of Object.entries(normalized)) {
      if (typeof value !== 'string') continue;

      const propSchema = schema.properties[key];
      if (!propSchema?.type) continue;

      const expectedTypes = Array.isArray(propSchema.type) ? propSchema.type : [propSchema.type];

      if (expectedTypes.includes('array') || expectedTypes.includes('object')) {
        const trimmed = value.trim();

        if (trimmed === '' && !required.has(key)) {
          delete normalized[key];
          if (this.debug) {
            console.error(
              `[ScriptExecutor] Removed empty string for optional '${key}' (expects ${expectedTypes.join(' | ')})`
            );
          }
          continue;
        }

        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            normalized[key] = JSON.parse(trimmed);
            if (this.debug) {
              console.error(
                `[ScriptExecutor] Normalized JSON string for '${key}': ${trimmed.substring(0, 50)}...`
              );
            }
          } catch {
            if (this.debug) {
              console.error(
                `[ScriptExecutor] Failed to parse JSON string for '${key}': ${trimmed.substring(0, 50)}...`
              );
            }
          }
        }
      }
    }

    return normalized;
  }

  private resolveRuntime(tool: LoadedScriptTool): string {
    if (tool.runtime && tool.runtime !== 'auto') {
      return tool.runtime;
    }

    const ext = extname(tool.absoluteScriptPath).toLowerCase();
    const detected = EXTENSION_TO_RUNTIME[ext];

    if (detected) {
      if (this.debug) {
        console.error(
          `[ScriptExecutor] Auto-detected runtime '${detected}' from extension '${ext}'`
        );
      }
      return detected;
    }

    if (this.debug) {
      console.error(`[ScriptExecutor] Unknown extension '${ext}', defaulting to shell`);
    }
    return 'shell';
  }

  private findRuntimeCommand(runtime: string): string | undefined {
    const commands = RUNTIME_COMMANDS[runtime];
    if (!commands) {
      return undefined;
    }
    return commands[0];
  }

  private resolveTimeout(request: ScriptExecutionRequest, tool: LoadedScriptTool): number {
    const timeout = request.timeout ?? tool.timeout ?? this.defaultTimeout;
    return Math.min(timeout, this.maxTimeout);
  }

  private createErrorResult(
    startTime: number,
    error: string,
    exitCode: number
  ): ScriptExecutionResult {
    return {
      success: false,
      output: null,
      stdout: '',
      stderr: '',
      exitCode,
      durationMs: Date.now() - startTime,
      error,
    };
  }
}

/**
 * Factory function with default configuration.
 */
export function createScriptExecutor(config?: ScriptExecutorConfig): ScriptExecutor {
  return new ScriptExecutor(config);
}

// ============================================================================
// Default Instance Management (singleton pattern)
// ============================================================================

let defaultExecutor: ScriptExecutor | null = null;

/**
 * Get the default ScriptExecutor instance.
 * Creates one if it doesn't exist.
 */
export function getDefaultScriptExecutor(): ScriptExecutor {
  return (defaultExecutor ??= new ScriptExecutor());
}

/**
 * Reset the default executor (useful for testing).
 */
export function resetDefaultScriptExecutor(): void {
  defaultExecutor = null;
}
