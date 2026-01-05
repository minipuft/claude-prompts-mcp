// @lifecycle canonical - Subprocess execution for prompt-scoped script tools.
/**
 * Script Executor
 *
 * Executes prompt-scoped script tools via subprocess with:
 * - Configurable timeout enforcement
 * - JSON input via stdin
 * - JSON output parsing with fallback to raw string
 * - Runtime detection (python/node/shell/auto)
 * - Input validation against JSON Schema
 *
 * Security model (trust-based, developer-focused):
 * - Working directory sandboxed to tool directory
 * - Timeout enforcement prevents runaway processes
 * - Environment variables filtered via allowlist (SAFE_ENV_ALLOWLIST)
 *   to prevent accidental credential leakage
 * - Explicit env pass-through via tool.env or request.env for intentional access
 * - No filesystem or network restrictions (trusts prompt authors)
 *
 * Design rationale: Scripts are authored by developers, version-controlled,
 * and code-reviewed. This is consistent with npm/pip script execution trust
 * models where the package author is trusted.
 *
 * @see plans/script-tools-implementation.md for the full implementation plan
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { extname, join } from 'path';

import type {
  LoadedScriptTool,
  ScriptExecutionRequest,
  ScriptExecutionResult,
  ScriptExecutorConfig,
  ScriptInputValidationResult,
  JSONSchemaDefinition,
} from '../types.js';

/**
 * Runtime command mappings for script execution.
 */
const RUNTIME_COMMANDS: Record<string, string[]> = {
  python: ['python3', 'python'],
  node: ['node'],
  shell: ['bash', 'sh'],
};

/**
 * Environment variables safe to inherit from parent process.
 *
 * This allowlist prevents accidental credential leakage while maintaining
 * compatibility with common development workflows. Scripts can still receive
 * additional env vars through tool.env or request.env (explicit pass-through).
 *
 * Categories:
 * - Runtime essentials (PATH, HOME, USER, SHELL, TERM)
 * - Language runtimes (NODE_*, PYTHON*, etc.)
 * - Locale/encoding (LANG, LC_*)
 * - Development tools (EDITOR, COLORTERM)
 * - CI/CD detection (CI, GITHUB_ACTIONS - non-sensitive)
 */
const SAFE_ENV_ALLOWLIST: Set<string> = new Set([
  // Runtime essentials
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',

  // Node.js runtime
  'NODE_ENV',
  'NODE_PATH',
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'NODE_NO_WARNINGS',

  // Python runtime
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONIOENCODING',
  'PYTHONDONTWRITEBYTECODE',
  'VIRTUAL_ENV',

  // Locale and encoding
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',

  // Development conveniences
  'EDITOR',
  'VISUAL',
  'COLORTERM',
  'FORCE_COLOR',
  'NO_COLOR',

  // CI/CD detection (non-sensitive flags)
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'JENKINS_HOME',
]);

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
 * Handles subprocess execution of script tools with timeout enforcement,
 * JSON I/O, and proper cleanup.
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
export class ScriptExecutor {
  private readonly defaultTimeout: number;
  private readonly maxTimeout: number;
  private readonly debug: boolean;
  private readonly baseEnv: Record<string, string>;

  constructor(config: ScriptExecutorConfig = {}) {
    this.defaultTimeout = config.defaultTimeout ?? 30000;
    this.maxTimeout = config.maxTimeout ?? 300000; // 5 minutes
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
   *
   * @param request - Execution request with inputs and optional overrides
   * @param tool - Loaded script tool definition
   * @returns Execution result with output, timing, and error info
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

    // Build execution environment
    const env = this.buildEnvironment(request, tool);
    const timeout = this.resolveTimeout(request, tool);
    const workingDir = tool.workingDir ? join(tool.toolDir, tool.workingDir) : tool.toolDir;

    // Execute subprocess
    try {
      const result = await this.spawnProcess({
        command,
        args: [tool.absoluteScriptPath],
        input: JSON.stringify(validation.normalizedInputs ?? request.inputs),
        cwd: workingDir,
        env,
        timeout,
      });

      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createErrorResult(startTime, errorMessage, -1);
    }
  }

  /**
   * Validate inputs against the tool's JSON Schema.
   *
   * Uses basic required field validation without external dependencies.
   * Full JSON Schema validation can be added by installing 'ajv' if needed.
   *
   * @param inputs - Input values to validate
   * @param schema - JSON Schema definition
   * @returns Validation result with errors and normalized inputs
   */
  validateInputs(
    inputs: Record<string, unknown>,
    schema: JSONSchemaDefinition
  ): ScriptInputValidationResult {
    const errors: string[] = [];

    // Normalize JSON string inputs to their intended types based on schema.
    // ArgumentParser converts arrays/objects to JSON strings for template
    // compatibility. Script tools need the original typed values.
    const normalizedInputs = this.normalizeJsonStringInputs(inputs, schema);

    // If no schema properties defined, accept any inputs
    if (!schema.properties || Object.keys(schema.properties).length === 0) {
      return { valid: true, errors: [], normalizedInputs };
    }

    // Validate required fields are present
    const required = schema.required ?? [];
    for (const field of required) {
      if (!(field in normalizedInputs) || normalizedInputs[field] === undefined) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Basic type validation for provided fields (use normalized inputs)
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

    // Build result with optional normalizedInputs only on success
    const result: ScriptInputValidationResult = {
      valid: errors.length === 0,
      errors,
    };
    if (errors.length === 0) {
      result.normalizedInputs = normalizedInputs;
    }
    return result;
  }

  /**
   * Get the JSON Schema type of a value.
   */
  private getJsonType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    const t = typeof value;
    if (t === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    return t; // 'string', 'boolean', 'object'
  }

  /**
   * Normalize JSON string inputs to their intended types based on schema.
   *
   * The ArgumentParser converts arrays/objects to JSON strings for template
   * compatibility (legacy type system expects string | number | boolean | null).
   * Script tools need the original typed values, so we parse them back here.
   *
   * This approach is schema-aware: only parses strings when the schema expects
   * an array or object type, preventing unintended parsing of actual string values.
   *
   * Additionally, empty strings for optional fields expecting objects/arrays are
   * converted to undefined to avoid type validation errors for placeholder values.
   *
   * @param inputs - Input values that may contain JSON strings
   * @param schema - JSON Schema definition with type expectations
   * @returns Normalized inputs with JSON strings parsed to their intended types
   */
  private normalizeJsonStringInputs(
    inputs: Record<string, unknown>,
    schema: JSONSchemaDefinition
  ): Record<string, unknown> {
    // If no schema properties, return inputs unchanged
    if (!schema.properties) {
      return { ...inputs };
    }

    const normalized: Record<string, unknown> = { ...inputs };
    const required = new Set(schema.required ?? []);

    for (const [key, value] of Object.entries(normalized)) {
      // Only process string values
      if (typeof value !== 'string') continue;

      const propSchema = schema.properties[key];
      if (!propSchema?.type) continue;

      const expectedTypes = Array.isArray(propSchema.type) ? propSchema.type : [propSchema.type];

      // If schema expects array or object but we have a string
      if (expectedTypes.includes('array') || expectedTypes.includes('object')) {
        const trimmed = value.trim();

        // Empty strings for optional fields expecting object/array should be undefined
        // This handles placeholder values from prompt argument definitions
        if (trimmed === '' && !required.has(key)) {
          delete normalized[key];
          if (this.debug) {
            console.error(
              `[ScriptExecutor] Removed empty string for optional '${key}' (expects ${expectedTypes.join(' | ')})`
            );
          }
          continue;
        }

        // Only attempt parse if it looks like JSON (starts with [ or {)
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            normalized[key] = JSON.parse(trimmed);
            if (this.debug) {
              console.error(
                `[ScriptExecutor] Normalized JSON string for '${key}': ${trimmed.substring(0, 50)}...`
              );
            }
          } catch {
            // Invalid JSON - leave as string, validation will catch the type error
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
   * Resolve the runtime to use for script execution.
   *
   * @param tool - Loaded script tool
   * @returns Resolved runtime identifier
   */
  private resolveRuntime(tool: LoadedScriptTool): string {
    if (tool.runtime && tool.runtime !== 'auto') {
      return tool.runtime;
    }

    // Auto-detect from file extension
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

    // Default to shell for unknown extensions
    if (this.debug) {
      console.error(`[ScriptExecutor] Unknown extension '${ext}', defaulting to shell`);
    }
    return 'shell';
  }

  /**
   * Find the first available command for a runtime.
   *
   * @param runtime - Runtime identifier
   * @returns Command path or undefined if not found
   */
  private findRuntimeCommand(runtime: string): string | undefined {
    const commands = RUNTIME_COMMANDS[runtime];
    if (!commands) {
      return undefined;
    }

    // For simplicity, return first command - could enhance to check PATH
    return commands[0];
  }

  /**
   * Build environment variables for script execution.
   *
   * Uses an allowlist to filter parent process env vars, preventing
   * accidental credential leakage (e.g., API keys, tokens). Scripts
   * can still receive sensitive vars through explicit tool.env or
   * request.env configuration.
   *
   * @param request - Execution request
   * @param tool - Loaded script tool
   * @returns Combined environment variables
   */
  private buildEnvironment(
    request: ScriptExecutionRequest,
    tool: LoadedScriptTool
  ): NodeJS.ProcessEnv {
    // Filter parent env to only safe variables
    const safeParentEnv: Record<string, string> = {};
    for (const key of SAFE_ENV_ALLOWLIST) {
      if (process.env[key] !== undefined) {
        safeParentEnv[key] = process.env[key]!;
      }
    }

    return {
      ...safeParentEnv,
      ...this.baseEnv,
      ...(tool.env ?? {}),
      ...(request.env ?? {}),
      // Script-specific context variables
      SCRIPT_TOOL_ID: tool.id,
      SCRIPT_PROMPT_ID: tool.promptId,
      SCRIPT_TOOL_DIR: tool.toolDir,
    };
  }

  /**
   * Resolve the timeout value with clamping.
   *
   * @param request - Execution request
   * @param tool - Loaded script tool
   * @returns Clamped timeout in milliseconds
   */
  private resolveTimeout(request: ScriptExecutionRequest, tool: LoadedScriptTool): number {
    const timeout = request.timeout ?? tool.timeout ?? this.defaultTimeout;
    return Math.min(timeout, this.maxTimeout);
  }

  /**
   * Spawn a subprocess and handle I/O.
   */
  private spawnProcess(options: {
    command: string;
    args: string[];
    input: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
  }): Promise<Omit<ScriptExecutionResult, 'durationMs'>> {
    return new Promise((resolve) => {
      const { command, args, input, cwd, env, timeout } = options;

      if (this.debug) {
        console.error(`[ScriptExecutor] Spawning: ${command} ${args.join(' ')}`);
        console.error(`[ScriptExecutor] Working directory: ${cwd}`);
        console.error(`[ScriptExecutor] Timeout: ${timeout}ms`);
      }

      const proc = spawn(command, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        // Give it a moment to terminate gracefully, then force kill
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 1000);
      }, timeout);

      // Collect stdout
      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // Collect stderr
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Write input and close stdin
      proc.stdin?.write(input);
      proc.stdin?.end();

      // Handle process exit
      proc.on('close', (code) => {
        clearTimeout(timeoutId);

        const exitCode = code ?? (killed ? -1 : 0);

        if (killed) {
          resolve({
            success: false,
            output: null,
            stdout,
            stderr,
            exitCode: -1,
            error: `Script timed out after ${timeout}ms`,
          });
          return;
        }

        // Parse output
        const output = this.parseOutput(stdout);
        const success = exitCode === 0;

        // Build result, conditionally including error on failure
        const processResult: Omit<ScriptExecutionResult, 'durationMs'> = {
          success,
          output,
          stdout,
          stderr,
          exitCode,
        };
        if (!success) {
          processResult.error = stderr || `Process exited with code ${exitCode}`;
        }
        resolve(processResult);
      });

      // Handle spawn errors
      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          output: null,
          stdout,
          stderr,
          exitCode: -1,
          error: `Spawn error: ${error.message}`,
        });
      });
    });
  }

  /**
   * Parse script output, attempting JSON first.
   *
   * @param stdout - Raw stdout from the process
   * @returns Parsed JSON or wrapped string output
   */
  private parseOutput(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      // Not valid JSON - return as wrapped string
      return { output: trimmed };
    }
  }

  /**
   * Create an error result with timing.
   */
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
  if (!defaultExecutor) {
    defaultExecutor = new ScriptExecutor();
  }
  return defaultExecutor;
}

/**
 * Reset the default executor (useful for testing).
 */
export function resetDefaultScriptExecutor(): void {
  defaultExecutor = null;
}
