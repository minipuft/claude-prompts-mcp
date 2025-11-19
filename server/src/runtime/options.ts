// @lifecycle canonical - Parses runtime CLI options and flags.
/**
 * Runtime launch option parsing shared between the CLI entrypoint and the runtime application.
 * Centralizes CLI flag handling so verbose/quiet/test detection stays in sync.
 */

export interface RuntimeLaunchOptions {
  args: string[];
  verbose: boolean;
  quiet: boolean;
  startupTest: boolean;
  testEnvironment: boolean;
}

const TEST_ARG_HINTS = ["test", "jest", "mocha"];

/**
 * Determine whether the current process is executing under a test harness or CI.
 */
export function detectRuntimeTestEnvironment(
  fullArgv: string[] = process.argv,
  args: string[] = process.argv.slice(2)
): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    args.includes("--suppress-debug") ||
    args.includes("--test-mode") ||
    process.env.GITHUB_ACTIONS === "true" ||
    process.env.CI === "true" ||
    fullArgv.some((arg) => TEST_ARG_HINTS.some((hint) => arg.includes(hint))) ||
    (fullArgv[1] ?? "").includes("tests/scripts/")
  );
}

/**
 * Parse runtime launch options from CLI arguments.
 */
export function resolveRuntimeLaunchOptions(
  args: string[] = process.argv.slice(2),
  fullArgv: string[] = process.argv
): RuntimeLaunchOptions {
  return {
    args,
    verbose: args.includes("--verbose") || args.includes("--debug-startup"),
    quiet: args.includes("--quiet"),
    startupTest: args.includes("--startup-test"),
    testEnvironment: detectRuntimeTestEnvironment(fullArgv, args),
  };
}
