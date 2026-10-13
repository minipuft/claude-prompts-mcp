// @lifecycle canonical - The client registry and the client × scope directories a skills-sync command visits.
/**
 * Client Targets
 *
 * Which clients a run reaches, what each is configured to carry, and where each scope of each
 * client is written. `export`, `sync`, `diff` and `pull` all walk the same targets; the walk lives
 * here once, and the three places the commands differ are a `ClientTargetPolicy` each passes in.
 */
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import type { SkillsSyncScope } from './sync-engine.js';

import { assertUsableDirectorySetting } from '#shared/utils/path-setting.js';

/** The one `SkillsSyncPaths` field target resolution reads, to find project scope's repository root. */
interface PackageRootPaths {
  readonly packageRoot: string;
}

/** The progress channel a target walk reports skipped clients on. */
interface TargetWalkOutput {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

/**
 * What a client's skills can carry that changes the export.
 *
 * Only the two dials an adapter reads. Scripts, references and docs are not dials: every
 * agent-skills client carries all three, and the Claude Code adapter has always emitted its tool
 * and doc files unconditionally.
 */
interface ClientCapabilities {
  /** The client runs chain steps as sub-agents, so the chain section links them as such. */
  subagents: boolean;
  /**
   * Client honors a `hooks` block in SKILL.md frontmatter, letting an exported
   * skill carry real gate enforcement instead of only describing it. Claude Code
   * registers such hooks when the skill is invoked; the Agent Skills spec assigns
   * no meaning to the key, so those variants get the prose protocol alone.
   *
   * Necessary but not sufficient: even here, a prompt still needs `enforceGateHooks: true`
   * (Ruling A3) before a hook ships. Frontmatter hooks register at SESSION scope, and an
   * Agent-tool subagent's Skill invocation was measured (2026-09-14) firing its hook at the
   * PLANNER session's own stop — enforcement is opt-in per prompt, default is prose only.
   */
  skillFrontmatterHooks: boolean;
}

interface ClientConfigBase {
  outputDir: { user: string; project: string };
  capabilities: ClientCapabilities;
}

export interface ClaudeCodeClientConfig extends ClientConfigBase {
  adapter: 'claude-code';
}

/**
 * An Agent Skills client. `variant` picks the frontmatter extensions: `cursor` adds `alwaysApply`
 * and `category`, every other variant ships the neutral agentskills.io shape.
 */
export type AgentSkillsClientConfig = ClientConfigBase & { adapter: 'agent-skills' } & (
    | { variant: 'cursor'; extensions: { alwaysApply: boolean } }
    | { variant: 'codex' | 'opencode' | 'agent-plugins' }
  );

export type ClientConfig = ClaudeCodeClientConfig | AgentSkillsClientConfig;

/** Scope-keyed exports: each resource listed under exactly one scope. */
interface ScopedExports {
  user?: string[];
  project?: string[];
}

/** Normalized export with resolved scope — used internally after parsing config. */
export interface NormalizedExport {
  key: string;
  scope: SkillsSyncScope;
}

export interface SyncConfig {
  registrations?: Record<string, ScopedExports | 'all'>;
  /** @deprecated Legacy global export list; prefer registrations. */
  exports?: ScopedExports | 'all';
  overrides?: Record<string, { outputDir?: { user?: string; project?: string } }>;
}

interface ClientResourceSelection {
  mode: 'all' | 'scoped' | 'unregistered';
  normalized: NormalizedExport[];
  allowList?: Set<string>;
}

/**
 * Hardcoded client registry — the CLI knows everything about each client.
 * Users configure WHAT to export; the CLI handles HOW.
 */
export const CLIENT_REGISTRY: Record<string, ClientConfig> = {
  'claude-code': {
    adapter: 'claude-code',
    outputDir: { user: '~/.claude/skills', project: '.claude/skills' },
    capabilities: {
      subagents: true,
      skillFrontmatterHooks: true,
    },
  },
  cursor: {
    adapter: 'agent-skills',
    variant: 'cursor',
    outputDir: { user: '~/.cursor/skills', project: '.cursor/skills' },
    capabilities: {
      subagents: true,
      skillFrontmatterHooks: false,
    },
    extensions: { alwaysApply: false },
  },
  codex: {
    adapter: 'agent-skills',
    variant: 'codex',
    outputDir: { user: '~/.codex/skills', project: '.codex/skills' },
    capabilities: {
      subagents: false,
      skillFrontmatterHooks: false,
    },
  },
  opencode: {
    adapter: 'agent-skills',
    variant: 'opencode',
    outputDir: { user: '~/.config/opencode/skills', project: '.opencode/skills' },
    capabilities: {
      subagents: true,
      skillFrontmatterHooks: false,
    },
  },
  /**
   * Agent Plugins 1.0.0 canonical tree.
   *
   * Unlike the entries above, this one does not target an installed client directory — the spec
   * fixes `skills/<name>/SKILL.md` at the PLUGIN root, so `project` is a bare `skills` and the
   * export lands in the repository beside `plugin.json` and `mcp.json`.
   *
   * `variant` deliberately matches neither the `cursor` nor the `opencode` branch below: the
   * spec says SKILL.md conforms to agentskills.io and assigns no further frontmatter, so the
   * neutral shape is the conforming one. `subagents: false` because v1 defines no core agents.
   */
  'agent-plugins': {
    adapter: 'agent-skills',
    variant: 'agent-plugins',
    outputDir: { user: '~/.agent-plugins/skills', project: 'skills' },
    capabilities: {
      subagents: false,
      skillFrontmatterHooks: false,
    },
  },
};

/** Normalize scope-keyed map to flat list with resolved scope. */
function normalizeScopedSelections(scoped: ScopedExports): NormalizedExport[] {
  const result: NormalizedExport[] = [];
  for (const key of scoped.user ?? []) {
    result.push({ key, scope: 'user' });
  }
  for (const key of scoped.project ?? []) {
    result.push({ key, scope: 'project' });
  }
  return result;
}

/** Extract all resource keys from scoped config for allow-list filtering. */
function buildScopedAllowList(scoped: ScopedExports): Set<string> {
  return new Set([...(scoped.user ?? []), ...(scoped.project ?? [])]);
}

/** Type guard: scope-keyed list object (not 'all' or undefined). */
function isScopedExports(value: unknown): value is ScopedExports {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Resolve client resource selection from canonical registrations (fallback: legacy exports). */
function resolveClientResourceSelection(
  config: SyncConfig,
  clientId: string
): ClientResourceSelection {
  if (config.registrations != null && typeof config.registrations === 'object') {
    const registration = config.registrations[clientId];
    if (registration == null) {
      return { mode: 'unregistered', normalized: [] };
    }
    if (registration === 'all') {
      return { mode: 'all', normalized: [] };
    }
    if (isScopedExports(registration)) {
      return {
        mode: 'scoped',
        normalized: normalizeScopedSelections(registration),
        allowList: buildScopedAllowList(registration),
      };
    }
    return { mode: 'unregistered', normalized: [] };
  }

  if (config.exports === 'all') {
    return { mode: 'all', normalized: [] };
  }
  if (isScopedExports(config.exports)) {
    return {
      mode: 'scoped',
      normalized: normalizeScopedSelections(config.exports),
      allowList: buildScopedAllowList(config.exports),
    };
  }

  return { mode: 'all', normalized: [] };
}

/**
 * Resolve a client config from the hardcoded registry, applying user overrides.
 *
 * Every command reaches this through `runSkillsSyncCommand`, whose `validateSkillsSyncOptions`
 * refuses an unknown client as a usage error first, so a missing entry here is a broken invariant.
 */
function resolveClientConfig(clientId: string, config: SyncConfig): ClientConfig {
  const base = Object.hasOwn(CLIENT_REGISTRY, clientId) ? CLIENT_REGISTRY[clientId] : undefined;
  if (base === undefined) {
    throw new Error(
      `skills-sync invariant: client '${clientId}' passed validation but is not in CLIENT_REGISTRY`
    );
  }

  const overrides = config.overrides?.[clientId];
  if (overrides?.outputDir == null) return base;

  return {
    ...base,
    outputDir: {
      user: overrides.outputDir.user ?? base.outputDir.user,
      project: overrides.outputDir.project ?? base.outputDir.project,
    },
  };
}

function resolveOutputDir(
  clientConfig: ClientConfig,
  scope: SkillsSyncScope,
  paths: PackageRootPaths
): string {
  const dir = clientConfig.outputDir[scope];
  let resolved: string;
  if (dir.startsWith('~')) {
    resolved = path.join(process.env['HOME'] ?? '', dir.slice(1));
  } else if (path.isAbsolute(dir)) {
    resolved = dir;
  } else if (scope === 'project') {
    resolved = path.resolve(resolveProjectRoot(paths), dir);
  } else {
    resolved = path.resolve(dir);
  }

  // Resolve symlinks so two clients can't silently map to the same physical directory
  try {
    if (existsSync(resolved)) {
      resolved = realpathSync(resolved);
    }
  } catch (_error) {
    // Directory doesn't exist yet or can't be resolved — use logical path
  }

  return resolved;
}

function resolveProjectRoot(paths: PackageRootPaths): string {
  const fromWorkspaceEnv = process.env['MCP_WORKSPACE'];
  if (fromWorkspaceEnv !== undefined && fromWorkspaceEnv !== '') {
    // Refused like the server refuses it: a project-scope export resolved against a workspace that
    // is not there writes skills into a directory tree the operator never named.
    return path.resolve(
      assertUsableDirectorySetting(
        { name: 'MCP_WORKSPACE', value: fromWorkspaceEnv },
        { verb: 'run' }
      )
    );
  }

  // A `server/` directory is a checkout's package when its parent carries `.git`; in a linked
  // worktree `.git` is a file, which `existsSync` accepts as it does a directory.
  const serverRoot = paths.packageRoot;
  if (path.basename(serverRoot) === 'server') {
    const repoRoot = path.dirname(serverRoot);
    if (existsSync(path.join(repoRoot, '.git'))) {
      return repoRoot;
    }
  }

  return process.cwd();
}

/**
 * Where the commands' target walks differ. Ruling R0C3.2: one walk, no change to any command's
 * output, so each difference is a stated policy rather than a unified behaviour.
 */
export interface ClientTargetPolicy {
  /** Scopes visited when `--scope` is absent. */
  readonly defaultScopes: readonly SkillsSyncScope[];
  /** An unregistered client's skip line opens a `── ` section, or stands bare. */
  readonly unregisteredLine: 'section' | 'bare';
  /**
   * A second client resolving to a directory an earlier one claimed, in the same scope: skipped
   * with a symlink-collision warning, skipped with a logged section line, or visited anyway.
   */
  readonly sharedDirectory: 'warn-and-skip' | 'log-and-skip' | 'visit';
}

/** `export` and `sync` write, so a directory two clients resolve to is written once. */
export const WRITER_TARGETS: ClientTargetPolicy = {
  defaultScopes: ['user'],
  unregisteredLine: 'section',
  sharedDirectory: 'warn-and-skip',
};

/** `diff` reads both scopes and reports a shared directory as part of its drift report. */
export const DIFF_TARGETS: ClientTargetPolicy = {
  defaultScopes: ['user', 'project'],
  unregisteredLine: 'section',
  sharedDirectory: 'log-and-skip',
};

/** `pull` reads both scopes, reads every client's directory, and logs no sections. */
export const PULL_TARGETS: ClientTargetPolicy = {
  defaultScopes: ['user', 'project'],
  unregisteredLine: 'bare',
  sharedDirectory: 'visit',
};

/** The options a target walk reads off the command line. */
export interface ClientTargetRequest {
  client?: string;
  scope?: SkillsSyncScope;
  id?: string;
}

/** One client × scope directory a command acts on. */
export interface ClientTarget {
  clientId: string;
  clientConfig: ClientConfig;
  selection: ClientResourceSelection;
  /** `--id` names its resource outright, so the client's registrations do not narrow it. */
  ignoreSelection: boolean;
  scope: SkillsSyncScope;
  baseDir: string;
}

/**
 * Yield every client × scope target a command visits, in client-registry order, logging each
 * client or directory it skips as it reaches it.
 *
 * Lazy on purpose: a target's directory is resolved (and its symlinks followed) only after the
 * previous target's body has run, which is when an earlier export may have created it.
 */
export function* clientScopeTargets(
  request: ClientTargetRequest,
  config: SyncConfig,
  paths: PackageRootPaths,
  output: TargetWalkOutput,
  policy: ClientTargetPolicy
): Generator<ClientTarget, void, undefined> {
  const { client } = request;
  const clientIds =
    client == null || client === '' || client === 'all' ? Object.keys(CLIENT_REGISTRY) : [client];
  const scopes = request.scope == null ? policy.defaultScopes : [request.scope];
  const ignoreSelection = request.id != null;
  const claimedDirs = new Map<string, string>(); // `${baseDir}:${scope}` → first client to claim it

  for (const clientId of clientIds) {
    const clientConfig = resolveClientConfig(clientId, config);
    const selection = resolveClientResourceSelection(config, clientId);
    if (!ignoreSelection && selection.mode === 'unregistered') {
      const opener = policy.unregisteredLine === 'section' ? '\n── ' : '';
      output.log(`${opener}${clientId}: skipped — no registrations in skills-sync.yaml`);
      continue;
    }

    for (const scope of scopes) {
      const baseDir = resolveOutputDir(clientConfig, scope, paths);
      if (!claimDirectory(claimedDirs, { clientId, scope, baseDir }, output, policy)) continue;
      yield { clientId, clientConfig, selection, ignoreSelection, scope, baseDir };
    }
  }
}

/**
 * Record that `target.clientId` claims its directory, or report the earlier client that did and
 * return false. Keyed by scope too, so one client's user and project directories never collide.
 */
function claimDirectory(
  claimedDirs: Map<string, string>,
  target: Pick<ClientTarget, 'clientId' | 'scope' | 'baseDir'>,
  output: TargetWalkOutput,
  policy: ClientTargetPolicy
): boolean {
  if (policy.sharedDirectory === 'visit') return true;
  const { clientId, scope, baseDir } = target;
  const dirKey = `${baseDir}:${scope}`;
  const previousClient = claimedDirs.get(dirKey);
  if (previousClient === undefined) {
    claimedDirs.set(dirKey, clientId);
    return true;
  }
  if (policy.sharedDirectory === 'warn-and-skip') {
    output.warn(
      `  skipping ${clientId} (${scope}) → ${baseDir} — directory already written by ${previousClient} (symlink collision?)`
    );
  } else {
    output.log(`\n── ${clientId} (${scope}): skipped — same directory as ${previousClient}`);
  }
  return false;
}
