// @lifecycle canonical - Parses runtime CLI options and flags.
/**
 * Runtime launch option parsing shared between the CLI entrypoint and the runtime application.
 * Centralizes CLI flag handling so verbose/quiet/test detection stays in sync.
 */

import { parseServerCliArgs, type ServerCliArgs } from './cli.js';
import { parsePathCliOptions, type PathResolverCliOptions } from './paths.js';

import type {
  ClientFamily,
  IdentityLaunchDefaults,
  IdentityPolicyMode,
} from '../shared/types/core-config.js';

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
  /** Custom frameworks directory */
  frameworksPath?: string;
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
  /** Identity policy mode from --identity-mode flag */
  identityMode?: IdentityPolicyMode;
  /** Launch-time identity defaults from identity and client CLI flags */
  identityDefaults?: IdentityLaunchDefaults;
  /** Explicit server root override from --server-root flag */
  serverRoot?: string;
}

const TEST_ARG_HINTS = ['test', 'jest', 'mocha'];
const CLIENT_PRESETS: Record<
  ClientFamily,
  Pick<IdentityLaunchDefaults, 'clientFamily' | 'clientId' | 'delegationProfile'>
> = {
  'claude-code': {
    clientFamily: 'claude-code',
    clientId: 'claude-code',
    delegationProfile: 'task_tool_v1',
  },
  codex: {
    clientFamily: 'codex',
    clientId: 'codex',
    delegationProfile: 'spawn_agent_v1',
  },
  gemini: {
    clientFamily: 'gemini',
    clientId: 'gemini',
    delegationProfile: 'gemini_subagent_v1',
  },
  opencode: {
    clientFamily: 'opencode',
    clientId: 'opencode',
    delegationProfile: 'opencode_agent_v1',
  },
  cursor: {
    clientFamily: 'cursor',
    clientId: 'cursor',
    delegationProfile: 'cursor_agent_v1',
  },
  unknown: {
    clientFamily: 'unknown',
    clientId: 'unknown',
    delegationProfile: 'neutral_v1',
  },
};
const CLIENT_PRESET_ALIASES: Record<string, ClientFamily> = {
  'claude-code': 'claude-code',
  claude: 'claude-code',
  codex: 'codex',
  'codex-cli': 'codex',
  gemini: 'gemini',
  'gemini-cli': 'gemini',
  opencode: 'opencode',
  cursor: 'cursor',
  unknown: 'unknown',
  neutral: 'unknown',
};

function normalizeString(value?: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeClientPreset(value?: string): ClientFamily | undefined {
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized == null) {
    return undefined;
  }
  return CLIENT_PRESET_ALIASES[normalized];
}

function resolveClientLaunchDefaults(
  cli: ServerCliArgs
): Pick<IdentityLaunchDefaults, 'clientFamily' | 'clientId' | 'delegationProfile'> {
  const presetFamily = normalizeClientPreset(cli.client);
  const preset = presetFamily != null ? CLIENT_PRESETS[presetFamily] : undefined;

  return compactIdentityDefaults({
    clientFamily: preset?.clientFamily,
    clientId: preset?.clientId,
    delegationProfile: preset?.delegationProfile,
  });
}

function compactIdentityDefaults(defaults: IdentityLaunchDefaults): IdentityLaunchDefaults {
  const compacted: IdentityLaunchDefaults = {};

  if (defaults.organizationId != null) {
    compacted.organizationId = defaults.organizationId;
  }
  if (defaults.workspaceId != null) {
    compacted.workspaceId = defaults.workspaceId;
  }
  if (defaults.clientFamily != null) {
    compacted.clientFamily = defaults.clientFamily;
  }
  if (defaults.clientId != null) {
    compacted.clientId = defaults.clientId;
  }
  if (defaults.clientVersion != null) {
    compacted.clientVersion = defaults.clientVersion;
  }
  if (defaults.delegationProfile != null) {
    compacted.delegationProfile = defaults.delegationProfile;
  }

  return compacted;
}

function resolveIdentityLaunchOptions(
  cli: ServerCliArgs
): Pick<RuntimeLaunchOptions, 'identityMode' | 'identityDefaults'> {
  const resolved: Pick<RuntimeLaunchOptions, 'identityMode' | 'identityDefaults'> = {};
  const identityMode = cli.identityMode;
  if (identityMode === 'permissive' || identityMode === 'locked') {
    resolved.identityMode = identityMode;
  }

  const identityDefaults = compactIdentityDefaults({
    workspaceId: normalizeString(cli.workspaceId),
    organizationId: normalizeString(cli.organizationId),
    ...resolveClientLaunchDefaults(cli),
  });

  if (Object.keys(identityDefaults).length > 0) {
    resolved.identityDefaults = identityDefaults;
  }

  return resolved;
}

/**
 * Determine whether the current process is executing under a test harness or CI.
 */
export function detectRuntimeTestEnvironment(
  fullArgv: string[] = process.argv,
  cli: ServerCliArgs = parseServerCliArgs()
): boolean {
  return (
    process.env['NODE_ENV'] === 'test' ||
    cli.suppressDebug ||
    cli.testMode ||
    process.env['GITHUB_ACTIONS'] === 'true' ||
    process.env['CI'] === 'true' ||
    fullArgv.some((arg) => TEST_ARG_HINTS.some((hint) => arg.includes(hint))) ||
    (fullArgv[1] ?? '').includes('tests/scripts/')
  );
}

/**
 * Resolve runtime launch options from pre-parsed CLI arguments.
 *
 * Zero-flag experience: When using STDIO transport (default), quiet mode is
 * automatically enabled unless --verbose is explicitly specified. This prevents
 * logging output from corrupting the MCP JSON-RPC protocol.
 */
export function resolveRuntimeLaunchOptions(
  cliArgs?: ServerCliArgs,
  fullArgv: string[] = process.argv
): RuntimeLaunchOptions {
  const cli = cliArgs ?? parseServerCliArgs();

  const isVerbose = cli.verbose || cli.debugStartup;
  const transport = cli.transport ?? 'stdio';
  const isStdioTransport = transport === 'stdio';
  const autoQuiet = isStdioTransport && !isVerbose;

  const paths = parsePathCliOptions(cli);

  const runtimeOptions: RuntimeLaunchOptions = {
    args: process.argv.slice(2),
    verbose: isVerbose,
    quiet: cli.quiet || autoQuiet,
    startupTest: cli.startupTest,
    testEnvironment: detectRuntimeTestEnvironment(fullArgv, cli),
    paths,
  };

  if (cli.logLevel !== undefined) {
    runtimeOptions.logLevel = cli.logLevel;
  }

  // Wire identity and client-profile CLI flags
  Object.assign(runtimeOptions, resolveIdentityLaunchOptions(cli));

  if (cli.serverRoot !== undefined) {
    runtimeOptions.serverRoot = cli.serverRoot;
  }

  return runtimeOptions;
}
