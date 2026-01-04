/**
 * Runtime launch option parsing shared between the CLI entrypoint and the runtime application.
 * Centralizes CLI flag handling so verbose/quiet/test detection stays in sync.
 */
import { type PathResolverCliOptions } from './paths.js';
/**
 * Path-related options parsed from CLI flags and environment variables
 */
export interface PathOptions {
    /** Base workspace directory for user assets */
    workspace?: string;
    /** Direct path to config.json */
    configPath?: string;
    /** Direct path to prompts configuration file */
    promptsPath?: string;
    /** Custom methodologies directory */
    methodologiesPath?: string;
    /** Custom gates directory */
    gatesPath?: string;
}
export interface RuntimeLaunchOptions {
    args: string[];
    verbose: boolean;
    quiet: boolean;
    startupTest: boolean;
    testEnvironment: boolean;
    /** Path-related options from CLI flags */
    paths: PathResolverCliOptions;
    /** Log level override from --log-level flag */
    logLevel?: string;
}
/**
 * Determine whether the current process is executing under a test harness or CI.
 */
export declare function detectRuntimeTestEnvironment(fullArgv?: string[], args?: string[]): boolean;
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
export declare function resolveRuntimeLaunchOptions(args?: string[], fullArgv?: string[]): RuntimeLaunchOptions;
