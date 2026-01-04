// @lifecycle canonical - Parses runtime CLI options and flags.
/**
 * Runtime launch option parsing shared between the CLI entrypoint and the runtime application.
 * Centralizes CLI flag handling so verbose/quiet/test detection stays in sync.
 */
import { parsePathCliOptions } from './paths.js';
const TEST_ARG_HINTS = ['test', 'jest', 'mocha'];
/**
 * Determine whether the current process is executing under a test harness or CI.
 */
export function detectRuntimeTestEnvironment(fullArgv = process.argv, args = process.argv.slice(2)) {
    return (process.env['NODE_ENV'] === 'test' ||
        args.includes('--suppress-debug') ||
        args.includes('--test-mode') ||
        process.env['GITHUB_ACTIONS'] === 'true' ||
        process.env['CI'] === 'true' ||
        fullArgv.some((arg) => TEST_ARG_HINTS.some((hint) => arg.includes(hint))) ||
        (fullArgv[1] ?? '').includes('tests/scripts/'));
}
/**
 * Parse --log-level flag from arguments
 */
function parseLogLevel(args) {
    const logLevelArg = args.find((arg) => arg.startsWith('--log-level='));
    if (logLevelArg) {
        const level = logLevelArg.split('=')[1]?.toLowerCase();
        const validLevels = ['debug', 'info', 'warn', 'error'];
        if (level && validLevels.includes(level)) {
            return level;
        }
    }
    return undefined;
}
/**
 * Parse runtime launch options from CLI arguments.
 *
 * Zero-flag experience: When using STDIO transport (default), quiet mode is
 * automatically enabled unless --verbose is explicitly specified. This prevents
 * logging output from corrupting the MCP JSON-RPC protocol.
 *
 * Supported path flags:
 *   --workspace=/path       Base directory for user assets
 *   --config=/path          Direct path to config.json
 *   --prompts=/path         Direct path to prompts configuration
 *   --methodologies=/path   Custom methodologies directory
 *   --gates=/path           Custom gates directory
 *   --log-level=LEVEL       Log level (debug, info, warn, error)
 */
export function resolveRuntimeLaunchOptions(args = process.argv.slice(2), fullArgv = process.argv) {
    const isVerbose = args.includes('--verbose') || args.includes('--debug-startup');
    const explicitQuiet = args.includes('--quiet');
    // Detect transport mode (default is STDIO)
    const transportArg = args.find((arg) => arg.startsWith('--transport='));
    const transport = transportArg ? transportArg.split('=')[1] : 'stdio';
    const isStdioTransport = transport === 'stdio';
    // Auto-enable quiet mode for STDIO transport to prevent protocol corruption
    // unless --verbose is explicitly specified (for debugging)
    const autoQuiet = isStdioTransport && !isVerbose;
    // Parse path-related CLI options
    const paths = parsePathCliOptions(args);
    // Parse log level
    const logLevel = parseLogLevel(args);
    const runtimeOptions = {
        args,
        verbose: isVerbose,
        quiet: explicitQuiet || autoQuiet,
        startupTest: args.includes('--startup-test'),
        testEnvironment: detectRuntimeTestEnvironment(fullArgv, args),
        paths,
    };
    if (logLevel) {
        runtimeOptions.logLevel = logLevel;
    }
    return runtimeOptions;
}
//# sourceMappingURL=options.js.map