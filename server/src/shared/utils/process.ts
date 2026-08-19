// @lifecycle canonical - Stateless subprocess execution utility.
/**
 * Process Utilities
 *
 * Stateless subprocess execution. Single source of truth for spawn lifecycle,
 * timeout enforcement, env filtering, and output capture. Used by:
 * - engine/gates/shell/shell-verify-executor.ts
 * - modules/automation/execution/script-executor.ts
 * - engine/gates/core/gate-validator.ts (lazy `await import`, so a static-import
 *   search does not find it — this list is the inventory, measured 2026-08-19)
 *
 * Lives in shared/utils/ because subprocess execution is a stateless I/O
 * operation — no connection pool, no session, no lifecycle. It belongs with
 * other stateless I/O utilities (file-transactions.ts, hash.ts) rather than
 * with stateful infrastructure adapters (sqlite-engine, http transport).
 *
 * This is a function, not a class, because there is no state to encapsulate
 * across calls. Each invocation is independent.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter as pathDelimiter, isAbsolute, join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from subprocess execution.
 *
 * Domain-specific consumers map this to their own result types
 * (ShellVerifyResult, ScriptExecutionResult).
 */
export interface ProcessResult {
  /** Process exit code (0 = success) */
  exitCode: number;
  /** Standard output (may be truncated) */
  stdout: string;
  /** Standard error (may be truncated) */
  stderr: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Whether the process was killed due to timeout */
  timedOut?: boolean;
  /**
   * Whether `stdout` lost characters to `truncateOutput`.
   *
   * Reported as a FACT, never acted on here: shell verification reads its output
   * as human-facing text and a tail is fine, while script tools field-access a
   * parsed payload and a tail is a different value entirely. Each consumer owns
   * that policy — see `ScriptExecutor`, which turns this flag into a failure.
   */
  stdoutTruncated?: boolean;
  /** Parsed JSON output (when parseJson option is true and stdout is valid JSON) */
  parsed?: unknown;
  /** POSIX signal name when exit code indicates signal termination (exitCode >= 128) */
  signalName?: string;
}

/**
 * Options for subprocess execution.
 *
 * Parameterizes the differences between shell verification and script execution:
 * - processGroup: shell commands need group kill for child processes
 * - stdin: script tools send JSON input
 * - truncateOutput: shell verification caps output to prevent context overflow
 * - parseJson: script tools expect structured JSON output
 */
export interface ProcessOptions {
  /** Shell command string (spawns via sh -c) OR [command, ...args] (direct spawn) */
  command: string | [string, ...string[]];
  /** Input sent via stdin (optional) */
  stdin?: string;
  /** Working directory for the subprocess */
  cwd?: string;
  /** Additional env vars merged with filtered parent env */
  env?: Record<string, string>;
  /** Base env vars always included (e.g. consumer-specific defaults) */
  baseEnv?: Record<string, string>;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Minimum timeout floor (default: 0 — no floor) */
  minTimeout?: number;
  /** Maximum timeout ceiling (default: 300000) */
  maxTimeout?: number;
  /** Kill entire process group on timeout (for shell commands with child processes) */
  processGroup?: boolean;
  /** Truncate stdout/stderr to N chars (0 or undefined = no truncation) */
  truncateOutput?: number;
  /** Attempt JSON parsing of stdout into ProcessResult.parsed */
  parseJson?: boolean;
  /** Enable debug logging to stderr */
  debug?: boolean;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_TIMEOUT = 300000; // 5 minutes

// ============================================================================
// Environment Allowlist
// ============================================================================

/**
 * Environment variables safe to inherit from parent process.
 *
 * Single source of truth for env filtering. Prevents accidental credential
 * leakage while maintaining compatibility with development workflows.
 *
 * Categories:
 * - Runtime essentials (PATH, HOME, USER, SHELL, TERM)
 * - Language runtimes (NODE_*, PYTHON*, etc.)
 * - Locale/encoding (LANG, LC_*)
 * - Development tools (EDITOR, COLORTERM)
 * - CI/CD detection (CI, GITHUB_ACTIONS — non-sensitive flags)
 */
export const SAFE_ENV_ALLOWLIST: ReadonlySet<string> = new Set([
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
 * Build a safe environment object from the current process env.
 *
 * Filters parent process env vars through the allowlist, then merges base env
 * and additional env vars.
 */
export function buildSafeEnvironment(
  baseEnv?: Record<string, string>,
  additionalEnv?: Record<string, string>
): NodeJS.ProcessEnv {
  const safeParentEnv: Record<string, string> = {};

  for (const key of SAFE_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      safeParentEnv[key] = process.env[key]!;
    }
  }

  return {
    ...safeParentEnv,
    ...(baseEnv ?? {}),
    ...(additionalEnv ?? {}),
  };
}

/**
 * Pick the first candidate executable that is actually runnable on `searchPath`.
 *
 * Lives here rather than in a caller because it must probe the SAME `PATH` the
 * spawn will use — `buildSafeEnvironment` is what decides that, and a probe run
 * against `process.env.PATH` while the child receives an overridden one measures
 * a different question than the one being asked.
 *
 * Returns `undefined` only when NO candidate resolves. Callers are expected to
 * fall back to their own first choice in that case: a probe that cannot see a
 * binary (an exotic PATH, a permission quirk, a platform this scan gets wrong)
 * must not turn a working install into "no interpreter found". The probe may
 * only ever improve the choice, never veto it.
 */
export function resolveExecutable(
  candidates: readonly string[],
  searchPath: string | undefined
): string | undefined {
  const dirs = (searchPath ?? '').split(pathDelimiter).filter((dir) => dir !== '');
  const suffixes = executableSuffixes();

  for (const candidate of candidates) {
    // An explicit path is a location, not a name to look up.
    if (candidate.includes('/') || candidate.includes('\\') || isAbsolute(candidate)) {
      if (suffixes.some((suffix) => isExecutableFile(candidate + suffix))) {
        return candidate;
      }
      continue;
    }
    for (const dir of dirs) {
      if (suffixes.some((suffix) => isExecutableFile(join(dir, candidate + suffix)))) {
        return candidate;
      }
    }
  }

  return undefined;
}

/** Windows resolves a bare name through PATHEXT; POSIX does not. */
function executableSuffixes(): string[] {
  if (process.platform !== 'win32') {
    return [''];
  }
  const pathext = process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD';
  return ['', ...pathext.split(';').filter((ext) => ext !== '')];
}

function isExecutableFile(candidatePath: string): boolean {
  try {
    // X_OK is not meaningful on Windows, where any readable file may be spawned.
    accessSync(candidatePath, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// POSIX Signal Interpretation
// ============================================================================

/**
 * Common POSIX signals mapped by signal number.
 * Exit code = 128 + signal number (e.g., SIGKILL=9 → exit 137).
 */
/**
 * Common shell convention exit codes (below 128).
 * These are not POSIX signals but are standardized by bash/sh.
 */
const SHELL_EXIT_CODES: ReadonlyMap<number, { name: string; description: string }> = new Map([
  [126, { name: 'NOPERM', description: 'Command not executable (check permissions)' }],
  [127, { name: 'NOTFOUND', description: 'Command not found (check PATH or spelling)' }],
  [128, { name: 'BADEXIT', description: 'Invalid exit argument' }],
]);

/**
 * POSIX signal numbers mapped to names and descriptions.
 * Exit codes >= 128 encode signal number as (128 + signal).
 */
const POSIX_SIGNALS: ReadonlyMap<number, { name: string; description: string }> = new Map([
  [1, { name: 'SIGHUP', description: 'Hangup' }],
  [2, { name: 'SIGINT', description: 'Interrupt (Ctrl+C)' }],
  [3, { name: 'SIGQUIT', description: 'Quit' }],
  [4, { name: 'SIGILL', description: 'Illegal instruction' }],
  [6, { name: 'SIGABRT', description: 'Abort' }],
  [8, { name: 'SIGFPE', description: 'Floating-point exception' }],
  [9, { name: 'SIGKILL', description: 'Killed (likely OOM)' }],
  [11, { name: 'SIGSEGV', description: 'Segmentation fault' }],
  [13, { name: 'SIGPIPE', description: 'Broken pipe' }],
  [14, { name: 'SIGALRM', description: 'Alarm' }],
  [15, { name: 'SIGTERM', description: 'Terminated' }],
  [24, { name: 'SIGXCPU', description: 'CPU time limit exceeded' }],
]);

/**
 * Resolve a POSIX signal name from an exit code.
 * Returns undefined if exit code does not indicate signal termination.
 */
export function resolveSignalName(exitCode: number): string | undefined {
  // Shell convention codes (126-128)
  const shellCode = SHELL_EXIT_CODES.get(exitCode);
  if (shellCode != null) return shellCode.name;

  // POSIX signals (>128)
  if (exitCode < 129) return undefined;
  const signalNum = exitCode - 128;
  const signal = POSIX_SIGNALS.get(signalNum);
  return signal?.name ?? (signalNum > 0 ? `Signal ${signalNum}` : undefined);
}

/**
 * Get the human-readable description for a signal-based exit code.
 * Returns undefined if exit code does not indicate signal termination
 * or a shell convention code.
 */
export function resolveSignalDescription(exitCode: number): string | undefined {
  // Shell convention codes (126-128)
  const shellCode = SHELL_EXIT_CODES.get(exitCode);
  if (shellCode != null) return shellCode.description;

  // POSIX signals (>128)
  if (exitCode < 129) return undefined;
  const signal = POSIX_SIGNALS.get(exitCode - 128);
  return signal?.description;
}

// ============================================================================
// Subprocess Execution
// ============================================================================

/**
 * Execute a subprocess with timeout enforcement and output capture.
 *
 * Stateless: each call is independent, no shared state.
 *
 * @example
 * ```typescript
 * // Shell command
 * const result = await executeProcess({
 *   command: 'npm test',
 *   timeout: 60000,
 *   processGroup: true,
 *   truncateOutput: 5000,
 * });
 *
 * // Direct exec with JSON stdin
 * const result = await executeProcess({
 *   command: ['python3', 'analyze.py'],
 *   stdin: JSON.stringify({ file: 'data.csv' }),
 *   parseJson: true,
 * });
 * ```
 */
export async function executeProcess(opts: ProcessOptions): Promise<ProcessResult> {
  const startTime = Date.now();

  const timeout = resolveTimeout(opts.timeout, opts.minTimeout, opts.maxTimeout);
  const env = buildSafeEnvironment(opts.baseEnv, opts.env);
  const [cmd, args] = resolveCommand(opts.command);
  const cwd = opts.cwd ?? process.cwd();

  if (opts.debug === true) {
    console.error(`[executeProcess] Spawning: ${cmd} ${args.join(' ')}`);
    console.error(`[executeProcess] cwd: ${cwd}, timeout: ${timeout}ms`);
  }

  try {
    return await spawnProcess({
      cmd,
      args,
      stdin: opts.stdin,
      cwd,
      env,
      timeout,
      startTime,
      processGroup: opts.processGroup ?? false,
      truncateOutput: opts.truncateOutput ?? 0,
      parseJson: opts.parseJson ?? false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: -1,
      stdout: '',
      stderr: `Execution error: ${message}`,
      durationMs: Date.now() - startTime,
    };
  }
}

function resolveCommand(command: string | [string, ...string[]]): [string, string[]] {
  if (typeof command === 'string') {
    return ['sh', ['-c', command]];
  }
  const [cmd, ...args] = command;
  return [cmd, args];
}

function resolveTimeout(timeout?: number, minTimeout?: number, maxTimeout?: number): number {
  const max = maxTimeout ?? DEFAULT_MAX_TIMEOUT;
  const min = minTimeout ?? 0;
  const resolved = timeout ?? DEFAULT_TIMEOUT;
  return Math.min(Math.max(resolved, min), max);
}

interface SpawnOptions {
  cmd: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  startTime: number;
  processGroup: boolean;
  truncateOutput: number;
  parseJson: boolean;
}

function spawnProcess(opts: SpawnOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const {
      cmd,
      args,
      stdin,
      cwd,
      env,
      timeout,
      startTime,
      processGroup,
      truncateOutput,
      parseJson,
    } = opts;

    const proc = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: processGroup,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    // Characters the streaming slice below discarded before `truncate` ever ran.
    // Without these the reported count is bounded by the buffer rather than by
    // what the process actually wrote: a 10k-char stdout under a 1k cap keeps
    // the last 2k, so `truncate` alone can only ever report 1k of the 9k lost.
    let stdoutDropped = 0;
    let stderrDropped = 0;
    const maxChars = truncateOutput > 0 ? truncateOutput * 2 : 0;

    // Timeout enforcement: SIGTERM first, then SIGKILL after 1s
    const timeoutId = setTimeout(() => {
      timedOut = true;
      killProcess(proc, processGroup);
      setTimeout(() => {
        if (!proc.killed) {
          killProcess(proc, processGroup, 'SIGKILL');
        }
      }, 1000);
    }, timeout);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (maxChars > 0 && stdout.length > maxChars) {
        stdoutDropped += stdout.length - maxChars;
        stdout = stdout.slice(-maxChars);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (maxChars > 0 && stderr.length > maxChars) {
        stderrDropped += stderr.length - maxChars;
        stderr = stderr.slice(-maxChars);
      }
    });

    // A child that never reads stdin is legitimate: `printf "%s" "$VAR"`, `true`, or any script
    // that only inspects env vars. Such a child can exit before this write lands, leaving the pipe
    // closed — and Node then emits EPIPE on the stdin stream. With no listener that is an unhandled
    // 'error' event, which took down the whole verification and surfaced as a bare `write EPIPE`
    // from a gate whose command had in fact worked. Because it is a race between the write and the
    // child's exit, it only lost under load, which is what made it look like test-order pollution.
    proc.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
        return; // The child chose not to read stdin. Not a failure of the command.
      }
      // Any other pipe failure is real and must stay visible rather than be swallowed here.
      stderr += `stdin error: ${error.message}\n`;
    });

    if (stdin !== undefined && stdin !== '' && proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(stdin);
    }
    proc.stdin?.end();

    proc.on('close', (code) => {
      clearTimeout(timeoutId);

      const exitCode = code ?? (timedOut ? -1 : 0);
      const stdoutLost =
        truncateOutput > 0 ? droppedChars(stdout, truncateOutput, stdoutDropped) : 0;
      const finalStdout =
        truncateOutput > 0 ? truncate(stdout, truncateOutput, stdoutDropped) : stdout;
      const finalStderr =
        truncateOutput > 0 ? truncate(stderr, truncateOutput, stderrDropped) : stderr;

      const result: ProcessResult = {
        exitCode,
        stdout: finalStdout,
        stderr: finalStderr,
        durationMs: Date.now() - startTime,
      };

      if (timedOut) {
        result.timedOut = true;
      }

      if (stdoutLost > 0) {
        result.stdoutTruncated = true;
      }

      if (parseJson) {
        result.parsed = tryParseJson(finalStdout);
      }

      const signal = resolveSignalName(exitCode);
      if (signal !== undefined) {
        result.signalName = signal;
      }

      resolve(result);
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: -1,
        stdout,
        stderr: `Spawn error: ${error.message}`,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

function killProcess(
  proc: ReturnType<typeof spawn>,
  processGroup: boolean,
  signal: NodeJS.Signals = 'SIGTERM'
): void {
  try {
    if (processGroup && proc.pid !== undefined) {
      process.kill(-proc.pid, signal);
    } else {
      proc.kill(signal);
    }
  } catch {
    // Process might have already exited
    proc.kill(signal);
  }
}

/**
 * Total characters lost, counting what the streaming slice already discarded.
 * Separated from `truncate` so the caller can report truncation without having
 * to re-derive the count from the formatted string it just produced.
 */
function droppedChars(output: string, maxChars: number, alreadyDropped: number): number {
  return alreadyDropped + Math.max(0, output.length - maxChars);
}

function truncate(output: string, maxChars: number, alreadyDropped = 0): string {
  const dropped = droppedChars(output, maxChars, alreadyDropped);
  if (dropped === 0) {
    return output;
  }
  const truncated = output.slice(-maxChars);
  return `[...truncated ${dropped} chars...]\n${truncated}`;
}

function tryParseJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return { output: trimmed };
  }
}
