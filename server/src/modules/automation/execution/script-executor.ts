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
import { extname, resolve } from 'node:path';

import type { ScriptExecutorPort } from '#shared/types/index.js';
import type {
  LoadedScriptTool,
  ScriptExecutionRequest,
  ScriptExecutionResult,
  ScriptExecutorConfig,
  ScriptInputValidationResult,
  JSONSchemaDefinition,
} from '../types.js';

import { SUPPORTED_RUNTIMES } from '#shared/types/automation.js';
import { isPathInside } from '#shared/utils/path-containment.js';
import {
  buildSafeEnvironment,
  executeProcess,
  findUnsafeEnvironmentKeys,
  resolveExecutable,
} from '#shared/utils/process.js';

/**
 * Runtime command mappings for script execution.
 */
const RUNTIME_COMMANDS: Record<string, string[]> = {
  python: ['python3', 'python'],
  node: ['node'],
  shell: ['bash', 'sh'],
};

/**
 * Default stdout ceiling for a script tool.
 *
 * Sits well above any structured payload a tool legitimately returns and well
 * below the point where one runaway script fills the context window. It is a
 * robustness bound, not a security boundary — a script author already has
 * arbitrary code execution by design, so this bounds accidents, not attacks.
 */
const DEFAULT_MAX_OUTPUT_CHARS = 50000;

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
  private readonly maxOutputChars: number;

  constructor(config: ScriptExecutorConfig = {}) {
    this.defaultTimeout = config.defaultTimeout ?? 30000;
    this.maxTimeout = config.maxTimeout ?? 300000;
    this.debug = config.debug ?? false;
    this.baseEnv = config.baseEnv ?? {};
    this.maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

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

    // Build per-execution env vars (tool-specific + request-specific + context vars)
    const env: Record<string, string> = {
      ...(tool.env ?? {}),
      ...(request.env ?? {}),
      SCRIPT_TOOL_ID: tool.id,
      SCRIPT_PROMPT_ID: tool.promptId,
      SCRIPT_TOOL_DIR: tool.toolDir,
    };

    // Checked BEFORE the interpreter lookup, not just before the spawn: the lookup
    // below resolves against this very map, so an author-supplied PATH would pick
    // which `python3` runs. `buildSafeEnvironment` throws on these too, but that
    // throw is a backstop — refusing here keeps one hostile tool from ending the
    // surrounding request and names the tool that caused it (row 1.6, ruling R7).
    const unsafeEnvKeys = findUnsafeEnvironmentKeys(env);
    if (unsafeEnvKeys.length > 0) {
      return this.createErrorResult(
        startTime,
        `Refusing to run script tool '${tool.id}': its environment sets ` +
          `${unsafeEnvKeys.join(', ')}, which decide what the interpreter resolves to ` +
          `or loads. Remove them from the tool definition; no setting permits them.`,
        -1
      );
    }

    // Resolve runtime and command. Built AFTER `env` because the interpreter has
    // to be looked up on the PATH the child will actually receive.
    const runtime = this.resolveRuntime(tool);
    if (runtime === undefined) {
      const ext = extname(tool.absoluteScriptPath).toLowerCase();
      return this.createErrorResult(
        startTime,
        `Refusing to run script tool '${tool.id}': nothing selects a runtime for ` +
          `${ext === '' ? 'a file with no extension' : `'${ext}' files`}. ` +
          `Auto-detection covers ${Object.keys(EXTENSION_TO_RUNTIME).join(', ')}. ` +
          `Declare 'runtime:' in the tool definition (${SUPPORTED_RUNTIMES.join(', ')}) to run it.`,
        -1
      );
    }

    const command = this.findRuntimeCommand(runtime, env);
    if (!command) {
      // Two different failures reached this message. An unknown runtime NAME is a
      // definition error the author can fix by reading the list; a known runtime
      // whose interpreter is missing is an operator's host problem. Reporting both
      // as "no interpreter found" sent the first one looking at their PATH.
      const known = SUPPORTED_RUNTIMES.includes(runtime as (typeof SUPPORTED_RUNTIMES)[number]);
      return this.createErrorResult(
        startTime,
        known
          ? `No interpreter found for runtime '${runtime}' — tried ${(RUNTIME_COMMANDS[runtime] ?? []).join(', ')}`
          : `Script tool '${tool.id}' declares an unknown runtime '${runtime}'. Valid: ${SUPPORTED_RUNTIMES.join(', ')}`,
        -1
      );
    }

    const timeout = this.resolveTimeout(request, tool);
    // `join` resolves `..` silently, so a tool declaring `workingDir: '../../..'` runs
    // wherever it likes. This is the same defect Tier 2.1 closed for resource writes,
    // reached through a different field, so it uses the same containment helper rather
    // than a format rule on `workingDir` — the next path-bearing field then starts
    // contained instead of starting unprotected.
    const workingDir = tool.workingDir ? resolve(tool.toolDir, tool.workingDir) : tool.toolDir;
    if (!isPathInside(resolve(tool.toolDir), workingDir)) {
      return this.createErrorResult(
        startTime,
        `Refusing to run script tool '${tool.id}': its workingDir resolves to ` +
          `${workingDir}, outside the tool's own directory (${tool.toolDir}). A script ` +
          `tool runs where it is installed.`,
        -1
      );
    }

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
      truncateOutput: this.maxOutputChars,
      parseJson: true,
      debug: this.debug,
    });

    // Truncation is a failure, not a degraded success. `tryParseJson` never
    // throws — it wraps unparseable text as `{ output: '<text>' }` — so a capped
    // JSON payload arrives looking like a valid object whose every expected
    // field is now missing, and `{{script:id.field}}` renders empty with nothing
    // anywhere reporting that the value was cut.
    const overflowed = result.stdoutTruncated === true;
    const success = result.exitCode === 0 && !overflowed;
    const scriptResult: ScriptExecutionResult = {
      success,
      output: success ? (result.parsed ?? result.stdout) : null,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    };

    if (!success) {
      scriptResult.error = overflowed
        ? `Script output exceeded the ${this.maxOutputChars}-character limit. ` +
          `Truncated output cannot be parsed or field-accessed, so this is reported ` +
          `as a failure rather than a partial result. Raise 'maxOutputChars' or have ` +
          `the script return less.`
        : result.timedOut
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

  /**
   * Pick the runtime for a tool, or `undefined` when nothing has chosen one.
   *
   * An unrecognised extension used to resolve to `shell`, so a file this table
   * knows nothing about was handed to `bash` on the strength of no evidence at
   * all — announced only at debug level, which no operator is reading. Ruling R8
   * is precise about what is wrong there: the `shell` RUNTIME builds an argv
   * array (`bash script.sh`) and carries the same risk posture as
   * `python script.py`, so the defect is `shell` being the SILENT DEFAULT for
   * files nobody classified, not `shell` existing. Declaring `runtime: shell`
   * remains entirely supported, and is now the only way to reach it for a file
   * this table does not recognise.
   *
   * Undefined rather than a throw: `execute` already owns one refusal shape for
   * "this tool cannot be run", and one hostile or malformed tool must not end
   * the surrounding request.
   */
  private resolveRuntime(tool: LoadedScriptTool): string | undefined {
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

    return undefined;
  }

  /**
   * Pick the interpreter for a runtime, honoring the declared fallbacks.
   *
   * `RUNTIME_COMMANDS` has always listed alternates (`python3` then `python`,
   * `bash` then `sh`); until 2026-08-19 this returned `commands[0]` regardless,
   * so on a host with only `python` every python tool failed with ENOENT while
   * the table claimed otherwise. The probe resolves against the SAME environment
   * the child receives, and falls back to the first candidate when it finds
   * nothing — an unresolvable name still reaches spawn and still fails there,
   * exactly as before, so this can only widen what runs.
   */
  private findRuntimeCommand(runtime: string, env: Record<string, string>): string | undefined {
    const commands = RUNTIME_COMMANDS[runtime];
    if (!commands || commands.length === 0) {
      return undefined;
    }
    const searchPath = buildSafeEnvironment(this.baseEnv, env)['PATH'];
    const resolved = resolveExecutable(commands, searchPath);

    if (this.debug && resolved !== undefined && resolved !== commands[0]) {
      // eslint-disable-next-line no-console
      console.error(
        `[ScriptExecutor] Runtime '${runtime}': '${commands[0]}' not on PATH, using '${resolved}'`
      );
    }

    return resolved ?? commands[0];
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
