// @lifecycle canonical - Exports canonical YAML resources to client-native skill packages.
/* eslint-disable -- Lifted from CLI implementation; follow-up decomposition tracked in migration plan. */
/**
 * Skills Sync CLI
 *
 * Compiler-style tool: server/resources/**\/*.yaml → client skill packages.
 * Two adapter paths: ClaudeCodeAdapter + AgentSkillsAdapter (cursor/codex/opencode variants).
 *
 * Usage: tsx scripts/skills-sync.ts export|sync|diff|patch [options]
 */
import { parseArgs } from 'node:util';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createTwoFilesPatch } from 'diff';

import { computeContentHash } from '../../shared/utils/hash.js';
import { loadHistory } from '../../cli-shared/version-history.js';
import type { DatabasePort } from '../../shared/types/persistence.js';
import {
  ResourceMutationTransaction,
  ResourceVerificationError,
  ResourceVerificationService,
  type ResourceVerificationType,
} from '../resources/services/index.js';
import {
  applyRegistrationMutations,
  previewRegistrationMutations,
  type RegistrationMutation,
} from './config/registration-store.js';
import {
  buildSyncPrunePlan,
  collectManifestManagedSkillDirs,
  injectManagedSkillMarker,
  parseManagedSkillMarker,
  type ManagedSkillDirMap,
} from './sync-engine.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveServerRoot(): string {
  const fromResourcesEnv = process.env['MCP_RESOURCES_PATH'];
  if (fromResourcesEnv && existsSync(fromResourcesEnv)) {
    const normalizedResources = path.resolve(fromResourcesEnv);
    if (path.basename(normalizedResources) === 'resources') {
      return path.dirname(normalizedResources);
    }
    if (existsSync(path.join(normalizedResources, 'resources'))) {
      return normalizedResources;
    }
    return path.dirname(normalizedResources);
  }

  const fromEnv = process.env['MCP_SERVER_ROOT'];
  if (fromEnv) {
    const normalizedRoot = path.resolve(fromEnv);
    const fromEnvServer = path.join(normalizedRoot, 'server');
    if (existsSync(path.join(fromEnvServer, 'resources'))) {
      return fromEnvServer;
    }
    if (existsSync(path.join(normalizedRoot, 'resources'))) {
      return normalizedRoot;
    }
  }

  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'server', 'resources'))) {
    return path.join(cwd, 'server');
  }
  if (existsSync(path.join(cwd, 'resources'))) {
    return cwd;
  }

  const bundleRelative = path.resolve(__dirname, '../../..');
  if (existsSync(path.join(bundleRelative, 'server', 'resources'))) {
    return path.join(bundleRelative, 'server');
  }
  if (existsSync(path.join(bundleRelative, 'resources'))) {
    return bundleRelative;
  }

  return bundleRelative;
}

function getServerRoot(): string {
  return resolveServerRoot();
}

function getResourcesDir(): string {
  return path.join(getServerRoot(), 'resources');
}

function getConfigPath(): string {
  return path.join(getServerRoot(), 'skills-sync.yaml');
}

// ─── Section 1: Types ──────────────────────────────────────────────────────

export type ResourceType = 'prompt' | 'gate' | 'framework' | 'style';

interface IRArgument {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

interface IRChainStep {
  promptId: string;
  stepName: string;
  delegation?: boolean;
  agentType?: string;
}

interface IRScriptTool {
  id: string;
  name: string;
  runtime: string;
  scriptContent: string;
  // Metadata from resource_index for full export
  inputSchema?: Record<string, unknown>;
  execution?: {
    trigger: string;
    confirm: boolean;
    strict: boolean;
    timeout?: number;
  };
  env?: Record<string, string>;
}

interface IRDocFile {
  relativePath: string; // e.g., 'intent.md' or 'templates/intent.md'
  content: string;
}

interface IRGateRef {
  id: string;
  source: 'registered' | 'inline' | 'inline_definition';
  /** For registered gates (from gates/{id}/ directory) */
  name?: string;
  description?: string;
  type?: string;
  gateYamlContent: string | null;
  guidanceContent: string | null;
  activation?: { categories?: string[]; explicitRequest?: boolean };
  /** For inline criteria strings */
  inlineCriteria?: string;
  /** For inline_gate_definitions objects */
  inlineDefinition?: Record<string, unknown>;
}

interface IRChainStepContent {
  stepId: string;
  promptYaml: string;
  systemMessage: string | null;
  userMessage: string | null;
}

interface SkillIR {
  id: string;
  name: string;
  description: string;
  resourceType: ResourceType;
  category: string | null;
  enabled: boolean;

  systemMessage: string | null;
  userMessage: string | null;
  guidanceContent: string | null;

  arguments: IRArgument[];
  chainSteps: IRChainStep[];
  scriptTools: IRScriptTool[];
  gateRefs: IRGateRef[];
  chainStepContents: IRChainStepContent[];
  docFiles: IRDocFile[];

  /** Prompt-level delegation: all chain steps default to sub-agent execution */
  delegation?: boolean;
  /** Default agent type for all delegated steps (overridden by step-level agentType) */
  delegationAgent?: string;

  gateData: { type: string; passCriteria: unknown[]; activation?: unknown } | null;
  frameworkData: {
    type: string;
    version: string;
    systemPromptGuidance: string;
    phases: unknown[];
  } | null;
  styleData: {
    priority: number;
    enhancementMode: string;
    compatibleFrameworks?: string[];
  } | null;

  extensions: Record<string, unknown>;
  sourcePaths: string[];
  sourceHash: string;
  /** Raw source file contents keyed by filename, for drift diffing */
  sourceContents?: Record<string, string>;
}

interface PromptYamlArgument {
  name: string;
  type: string;
  description: string;
  required?: boolean;
}

interface PromptYamlChainStep {
  promptId: string;
  stepName: string;
  delegation?: boolean;
  agentType?: string;
}

interface PromptYaml {
  id: string;
  name: string;
  description: string;
  category?: string;
  userMessageTemplateFile?: string;
  tools?: string[];
  chainSteps?: PromptYamlChainStep[];
  arguments?: PromptYamlArgument[];
  delegation?: boolean;
  delegationAgent?: string;
  gateConfiguration?: {
    include?: string[];
    exclude?: string[];
    framework_gates?: boolean;
    inline?: string[];
    inline_gate_definitions?: Array<{
      name: string;
      type?: string;
      scope?: string;
      severity?: string;
      description?: string;
      guidance?: string;
      pass_criteria?: unknown[];
    }>;
  };
}

interface ToolYaml {
  name?: string;
  runtime?: string;
}

interface GateYaml {
  id: string;
  name: string;
  description: string;
  guidanceFile?: string;
  enabled?: boolean;
  type?: string;
  pass_criteria?: unknown[];
  activation?: unknown;
  retry_config?: unknown;
}

interface FrameworkYaml {
  id: string;
  name: string;
  type?: string;
  enabled?: boolean;
  version?: string;
  phasesFile?: string;
  systemPromptFile?: string;
  systemPromptGuidance?: string;
  gates?: unknown;
  frameworkGates?: unknown;
}

interface StyleYaml {
  id: string;
  name: string;
  description: string;
  enabled?: boolean;
  guidanceFile?: string;
  priority?: number;
  enhancementMode?: string;
  compatibleFrameworks?: string[];
  activation?: unknown;
}

interface ClientCapabilities {
  scripts: boolean;
  references: boolean;
  assets: boolean;
  subagents: boolean;
}

interface ClientConfig {
  adapter: 'claude-code' | 'agent-skills';
  variant?: string;
  outputDir: { user: string; project: string };
  capabilities: ClientCapabilities;
  extensions?: Record<string, unknown>;
}

/** Scope-keyed exports: each resource listed under exactly one scope. */
interface ScopedExports {
  user?: string[];
  project?: string[];
}

/** Normalized export with resolved scope — used internally after parsing config. */
interface NormalizedExport {
  key: string;
  scope: 'user' | 'project';
}

interface SyncConfig {
  registrations?: Record<string, ScopedExports | 'all'>;
  /** @deprecated Legacy global export list; prefer registrations. */
  exports?: ScopedExports | 'all';
  overrides?: Record<string, { outputDir?: { user?: string; project?: string } }>;
}

type ConfigSelectionSource = 'registrations' | 'exports' | 'none';

interface ClientResourceSelection {
  source: ConfigSelectionSource;
  mode: 'all' | 'scoped' | 'unregistered';
  normalized: NormalizedExport[];
  allowList?: Set<string>;
}

/** Built-in defaults shared across adapters. */
const SYNC_DEFAULTS = { license: 'AGPL-3.0-only', adapterVersion: '1.0.0' } as const;

/**
 * Hardcoded client registry — the CLI knows everything about each client.
 * Users configure WHAT to export; the CLI handles HOW.
 */
const CLIENT_REGISTRY: Record<string, ClientConfig> = {
  'claude-code': {
    adapter: 'claude-code',
    outputDir: { user: '~/.claude/skills', project: '.claude/skills' },
    capabilities: { scripts: true, references: true, assets: false, subagents: true },
  },
  cursor: {
    adapter: 'agent-skills',
    variant: 'cursor',
    outputDir: { user: '~/.cursor/skills', project: '.cursor/skills' },
    capabilities: { scripts: true, references: true, assets: true, subagents: true },
    extensions: { alwaysApply: false },
  },
  codex: {
    adapter: 'agent-skills',
    variant: 'codex',
    outputDir: { user: '~/.codex/skills', project: '.codex/skills' },
    capabilities: { scripts: true, references: true, assets: true, subagents: false },
  },
  opencode: {
    adapter: 'agent-skills',
    variant: 'opencode',
    outputDir: { user: '~/.config/opencode/skills', project: '.opencode/skills' },
    capabilities: { scripts: false, references: false, assets: false, subagents: true },
  },
};

interface OutputFile {
  relativePath: string;
  content: string;
}

interface SyncManifestEntry {
  resourceId: string;
  resourceType: ResourceType;
  sourceHash: string;
  outputHash: string;
  outputFiles: string[];
  exportedAt: string;
  version?: number; // Version number from version_history table
  versionDate?: string; // When that version was created
  sourceSnapshot?: Record<string, string>; // Raw source files at export time, for drift diffing
}

import type { ToolIndexEntry } from '../../shared/types/persistence.js';

export interface SkillsSyncOptions {
  command: string;
  client?: string;
  scope?: 'user' | 'project';
  resourceType?: ResourceType;
  id?: string;
  prune?: boolean;
  dryRun?: boolean;
  output?: string;
  file?: string;
  category?: string;
  preview?: boolean;
  force?: boolean;
  json?: boolean;
  verbose?: boolean;
  dbManager?: DatabasePort;
}

export interface SkillsSyncOutput {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const DEFAULT_OUTPUT: SkillsSyncOutput = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const VALID_COMMANDS = new Set(['export', 'sync', 'diff', 'patch', 'pull', 'clone', 'help']);
const VALID_SCOPES = new Set(['user', 'project']);
const VALID_RESOURCE_TYPES = new Set(['prompt', 'gate', 'framework', 'style']);

export class SkillsSyncCommandError extends Error {
  constructor(
    message: string,
    public readonly exitCode: 1 | 2 = 1
  ) {
    super(message);
    this.name = 'SkillsSyncCommandError';
  }
}

function usageError(message: string): SkillsSyncCommandError {
  return new SkillsSyncCommandError(message, 2);
}

function validateSkillsSyncOptions(opts: SkillsSyncOptions): void {
  if (!VALID_COMMANDS.has(opts.command)) {
    throw usageError(`Unknown command: ${opts.command}. Run skills-sync help for usage.`);
  }

  if (opts.client != null && opts.client !== 'all' && CLIENT_REGISTRY[opts.client] == null) {
    throw usageError(
      `Unknown client: ${opts.client} (available: ${Object.keys(CLIENT_REGISTRY).join(', ')}, all)`
    );
  }

  if (opts.scope != null && !VALID_SCOPES.has(opts.scope)) {
    throw usageError(`Invalid scope: ${opts.scope}. Expected one of: user, project.`);
  }

  if (opts.resourceType != null && !VALID_RESOURCE_TYPES.has(opts.resourceType)) {
    throw usageError(
      `Invalid resource type: ${opts.resourceType}. Expected one of: prompt, gate, methodology, style.`
    );
  }

  if (opts.preview === true && opts.command !== 'pull') {
    throw usageError('--preview is only valid for the pull command.');
  }

  if (opts.output != null && opts.command !== 'diff' && opts.command !== 'patch') {
    throw usageError('--output is only valid for the diff command.');
  }

  if (
    (opts.file != null || opts.category != null || opts.force === true) &&
    opts.command !== 'clone'
  ) {
    throw usageError('--file, --category, and --force are only valid for the clone command.');
  }

  if (opts.prune != null && opts.command !== 'sync') {
    throw usageError('--prune/--no-prune are only valid for the sync command.');
  }

  if (opts.command === 'clone' && !opts.file) {
    throw usageError('clone requires --file <path> to a SKILL.md');
  }
}

// ─── Section 2: Config Loader ───────────────────────────────────────────────

async function loadSyncConfig(): Promise<SyncConfig> {
  const configPath = getConfigPath();
  try {
    const raw = await readFile(configPath, 'utf-8');
    return (yaml.load(raw) as SyncConfig | null) ?? {};
  } catch (error) {
    const example = configPath.replace('skills-sync.yaml', 'skills-sync.example.yaml');
    const message = `No skills-sync.yaml found. Copy the example to get started:\n  cp ${example} ${configPath}`;
    throw new Error(error instanceof Error ? `${message}\n(${error.message})` : message);
  }
}

/**
 * Load tools from SQLite resource_index (type='tool') via DatabasePort directly.
 * Returns empty record if DB is unavailable or no tools indexed.
 */
async function loadToolsCache(
  output: SkillsSyncOutput,
  dbManager?: DatabasePort
): Promise<Record<string, ToolIndexEntry>> {
  if (dbManager?.isInitialized()) {
    try {
      const rows = dbManager.query<{
        id: string;
        name: string | null;
        category: string | null;
        description: string | null;
        content_hash: string | null;
        metadata_json: string | null;
      }>('SELECT * FROM resource_index WHERE type = ? ORDER BY id', ['tool']);

      const result: Record<string, ToolIndexEntry> = {};
      for (const row of rows) {
        if (!row.metadata_json) continue;
        try {
          const meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
          const execution = meta['execution'] as ToolIndexEntry['execution'] | undefined;
          result[row.id] = {
            id: row.id.includes('/') ? (row.id.split('/').pop() ?? row.id) : row.id,
            name: row.name ?? row.id,
            runtime: (meta['runtime'] as string) ?? 'auto',
            inputSchema: (meta['input_schema'] as ToolIndexEntry['inputSchema']) ?? {},
            execution: execution ?? { trigger: 'schema_match', confirm: true, strict: false },
            ...(meta['env'] != null ? { env: meta['env'] as Record<string, string> } : {}),
            promptId: (meta['prompt_id'] as string) ?? '',
            category: row.category ?? '',
            description: row.description ?? '',
            toolDir: (meta['tool_dir'] as string) ?? '',
            scriptPath: (meta['script_path'] as string) ?? 'script.py',
            contentHash: row.content_hash ?? '',
          };
        } catch {
          // Skip unparseable tool metadata
        }
      }
      if (Object.keys(result).length > 0) return result;
    } catch {
      // DB read failed
    }
  }

  output.warn(
    '  Tools not found in resource index — run server once to index, or tools will export without schemas'
  );
  return {};
}

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

/** Check if a resource should be exported for the given target scope. */
function shouldExportForScope(
  resourceKey: string,
  targetScope: 'user' | 'project',
  normalized: NormalizedExport[]
): boolean {
  const entry = normalized.find((e) => e.key === resourceKey);
  if (!entry) return true; // Not in exports list → export to requested scope
  return entry.scope === targetScope;
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
      return { source: 'registrations', mode: 'unregistered', normalized: [] };
    }
    if (registration === 'all') {
      return { source: 'registrations', mode: 'all', normalized: [] };
    }
    if (isScopedExports(registration)) {
      return {
        source: 'registrations',
        mode: 'scoped',
        normalized: normalizeScopedSelections(registration),
        allowList: buildScopedAllowList(registration),
      };
    }
    return { source: 'registrations', mode: 'unregistered', normalized: [] };
  }

  if (config.exports === 'all') {
    return { source: 'exports', mode: 'all', normalized: [] };
  }
  if (isScopedExports(config.exports)) {
    return {
      source: 'exports',
      mode: 'scoped',
      normalized: normalizeScopedSelections(config.exports),
      allowList: buildScopedAllowList(config.exports),
    };
  }

  return { source: 'none', mode: 'all', normalized: [] };
}

function filterResourcesForScope(
  resources: SkillIR[],
  scope: 'user' | 'project',
  selection: ClientResourceSelection,
  ignoreSelection: boolean
): SkillIR[] {
  const candidateResources =
    !ignoreSelection && selection.allowList
      ? resources.filter((ir) => selection.allowList!.has(manifestKey(ir)))
      : resources;

  if (ignoreSelection || selection.mode !== 'scoped') {
    return candidateResources;
  }

  return candidateResources.filter((ir) =>
    shouldExportForScope(manifestKey(ir), scope, selection.normalized)
  );
}

/** Resolve a client config from the hardcoded registry, applying user overrides. */
function resolveClientConfig(clientId: string, config: SyncConfig): ClientConfig | null {
  const base = CLIENT_REGISTRY[clientId];
  if (!base) return null;

  const overrides = config.overrides?.[clientId];
  if (!overrides?.outputDir) return base;

  return {
    ...base,
    outputDir: {
      user: overrides.outputDir.user ?? base.outputDir.user,
      project: overrides.outputDir.project ?? base.outputDir.project,
    },
  };
}

function resolveOutputDir(clientConfig: ClientConfig, scope: 'user' | 'project'): string {
  const dir = clientConfig.outputDir[scope];
  let resolved: string;
  if (dir.startsWith('~')) {
    resolved = path.join(process.env['HOME'] ?? '', dir.slice(1));
  } else if (path.isAbsolute(dir)) {
    resolved = dir;
  } else if (scope === 'project') {
    resolved = path.resolve(resolveProjectRoot(), dir);
  } else {
    resolved = path.resolve(dir);
  }

  // Resolve symlinks so two clients can't silently map to the same physical directory
  try {
    if (existsSync(resolved)) {
      resolved = realpathSync(resolved);
    }
  } catch {
    // Directory doesn't exist yet or can't be resolved — use logical path
  }

  return resolved;
}

function resolveProjectRoot(): string {
  const fromWorkspaceEnv = process.env['MCP_WORKSPACE'];
  if (fromWorkspaceEnv) {
    return path.resolve(fromWorkspaceEnv);
  }

  const serverRoot = getServerRoot();
  if (path.basename(serverRoot) === 'server') {
    const repoRoot = path.dirname(serverRoot);
    if (existsSync(path.join(repoRoot, 'AGENTS.md'))) {
      return repoRoot;
    }
  }

  return process.cwd();
}

// ─── Section 3: Resource Loaders ────────────────────────────────────────────

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Resolves gate IDs that are active for a prompt based on its gateConfiguration
 * and category-based auto-activation.
 */
async function resolveActiveGateRefs(
  gateConfig: PromptYaml['gateConfiguration'],
  promptCategory: string,
  gatesRoot: string
): Promise<IRGateRef[]> {
  const refs: IRGateRef[] = [];
  const excludeSet = new Set(gateConfig?.exclude ?? []);
  const registeredIds = new Set<string>();

  // 1. Explicit includes
  for (const gateId of gateConfig?.include ?? []) {
    if (!excludeSet.has(gateId)) registeredIds.add(gateId);
  }

  // 2. Category-activated gates (scan all gate.yaml files)
  let gateDirs: string[] = [];
  try {
    gateDirs = (await readdir(gatesRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
      .map((d) => d.name);
  } catch {
    /* no gates directory */
  }

  for (const dirName of gateDirs) {
    if (excludeSet.has(dirName) || registeredIds.has(dirName)) continue;
    const gateYamlRaw = await readOptionalFile(path.join(gatesRoot, dirName, 'gate.yaml'));
    if (!gateYamlRaw) continue;
    const gate = yaml.load(gateYamlRaw) as GateYaml;
    const activation = gate.activation as Record<string, unknown> | undefined;
    const cats = activation?.['prompt_categories'] as string[] | undefined;
    const explicit = activation?.['explicit_request'] as boolean | undefined;
    if (cats?.includes(promptCategory) && explicit !== true) {
      registeredIds.add(gate.id ?? dirName);
    }
  }

  // 3. Load registered gate content
  for (const gateId of registeredIds) {
    const gateDir = path.join(gatesRoot, gateId);
    const gateYamlRaw = await readOptionalFile(path.join(gateDir, 'gate.yaml'));
    if (!gateYamlRaw) continue;
    const gate = yaml.load(gateYamlRaw) as GateYaml;
    const guidanceFile = gate.guidanceFile ?? 'guidance.md';
    const guidance = await readOptionalFile(path.join(gateDir, guidanceFile));
    const activation = gate.activation as Record<string, unknown> | undefined;

    refs.push({
      id: gateId,
      source: 'registered',
      name: gate.name,
      description: gate.description,
      type: gate.type,
      gateYamlContent: gateYamlRaw,
      guidanceContent: guidance,
      activation: {
        categories: activation?.['prompt_categories'] as string[] | undefined,
        explicitRequest: activation?.['explicit_request'] as boolean | undefined,
      },
    });
  }

  // 4. Inline criteria strings
  for (let i = 0; i < (gateConfig?.inline ?? []).length; i++) {
    const text = gateConfig!.inline![i]!;
    refs.push({
      id: `inline-${i}`,
      source: 'inline',
      gateYamlContent: null,
      guidanceContent: null,
      inlineCriteria: text,
    });
  }

  // 5. Inline gate definitions
  for (const def of gateConfig?.inline_gate_definitions ?? []) {
    refs.push({
      id: def.name,
      source: 'inline_definition',
      name: def.name,
      description: def.description,
      type: def.type,
      gateYamlContent: null,
      guidanceContent: def.guidance ?? null,
      inlineDefinition: def as Record<string, unknown>,
    });
  }

  return refs;
}

/**
 * Recursively loads all .md files from a `docs/` subdirectory within a prompt resource.
 */
async function loadDocFiles(promptDir: string): Promise<IRDocFile[]> {
  const docsDir = path.join(promptDir, 'docs');
  if (!existsSync(docsDir)) return [];

  const files: IRDocFile[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8');
        files.push({ relativePath: path.relative(docsDir, fullPath), content });
      }
    }
  }
  await walk(docsDir);
  return files;
}

async function loadPromptIR(
  promptDir: string,
  category: string,
  toolsCache: Record<string, ToolIndexEntry>
): Promise<SkillIR> {
  const yamlPath = path.join(promptDir, 'prompt.yaml');
  const raw = await readFile(yamlPath, 'utf-8');
  const data = yaml.load(raw) as PromptYaml;
  const promptId = data.id;

  const sysMsg = await readOptionalFile(path.join(promptDir, 'system-message.md'));
  const userMsgFile = data.userMessageTemplateFile ?? 'user-message.md';
  const userMsg = await readOptionalFile(path.join(promptDir, userMsgFile));

  // Load tool scripts with metadata from cache
  const scriptTools: IRScriptTool[] = [];
  const toolIds = data.tools ?? [];
  for (const toolId of toolIds) {
    const cacheKey = `${promptId}/${toolId}`;
    const cached = toolsCache[cacheKey];

    // Get script content from disk (still needed for export)
    const toolDir = path.join(promptDir, 'tools', toolId);
    const scriptFile = cached?.scriptPath ?? 'script.py';
    const scriptContent = await readOptionalFile(path.join(toolDir, scriptFile));

    // Fallback to basic YAML parsing if not in cache
    if (!cached) {
      const toolYamlPath = path.join(toolDir, 'tool.yaml');
      const toolRaw = await readOptionalFile(toolYamlPath);
      if (!toolRaw) continue;

      const toolData = yaml.load(toolRaw) as ToolYaml;
      scriptTools.push({
        id: toolId,
        name: toolData.name ?? toolId,
        runtime: toolData.runtime ?? 'unknown',
        scriptContent: scriptContent ?? '',
      });
    } else {
      // Use cached metadata with full schema and execution config
      scriptTools.push({
        id: cached.id,
        name: cached.name,
        runtime: cached.runtime,
        scriptContent: scriptContent ?? '',
        inputSchema: cached.inputSchema as Record<string, unknown>,
        execution: cached.execution,
        env: cached.env,
      });
    }
  }

  // Load chain steps (YAML uses camelCase: chainSteps, promptId, stepName)
  const chainSteps: IRChainStep[] = [];
  const rawSteps = data.chainSteps;
  if (rawSteps) {
    for (const s of rawSteps) {
      const step: IRChainStep = {
        promptId: s.promptId ?? '',
        stepName: s.stepName ?? '',
      };
      if (s.delegation === true) step.delegation = true;
      if (s.agentType) step.agentType = s.agentType;
      chainSteps.push(step);
    }
  }

  const args = (data.arguments ?? []).map((a) => ({
    name: a.name,
    type: a.type,
    description: a.description,
    required: a.required ?? false,
  }));

  // Resolve active gates for this prompt
  const gatesRoot = path.join(getResourcesDir(), 'gates');
  const gateRefs = await resolveActiveGateRefs(data.gateConfiguration, category, gatesRoot);

  // Load chain step sub-prompt content
  const chainStepContents: IRChainStepContent[] = [];
  for (const step of chainSteps) {
    // Extract local step ID (last path segment of promptId)
    const localStepId = step.promptId.includes('/')
      ? step.promptId.split('/').pop()!
      : step.promptId;
    const stepDir = path.join(promptDir, localStepId);
    const stepYamlRaw = await readOptionalFile(path.join(stepDir, 'prompt.yaml'));
    if (stepYamlRaw) {
      chainStepContents.push({
        stepId: localStepId,
        promptYaml: stepYamlRaw,
        systemMessage: await readOptionalFile(path.join(stepDir, 'system-message.md')),
        userMessage: await readOptionalFile(path.join(stepDir, 'user-message.md')),
      });
    }
  }

  const hashInputs = [raw, sysMsg ?? '', userMsg ?? ''];
  const sourceContentsMap: Record<string, string> = { 'prompt.yaml': raw };
  if (sysMsg) sourceContentsMap['system-message.md'] = sysMsg;
  if (userMsg) sourceContentsMap[userMsgFile] = userMsg;

  // Include gate content in hash and sourceContents for drift detection + diff patches
  for (const ref of gateRefs) {
    if (ref.gateYamlContent) {
      hashInputs.push(ref.gateYamlContent);
      sourceContentsMap[`gates/${ref.id}/gate.yaml`] = ref.gateYamlContent;
    }
    if (ref.guidanceContent) {
      hashInputs.push(ref.guidanceContent);
      sourceContentsMap[`gates/${ref.id}/guidance.md`] = ref.guidanceContent;
    }
    if (ref.inlineCriteria) hashInputs.push(ref.inlineCriteria);
  }
  // Include chain step content in hash and sourceContents
  for (const sc of chainStepContents) {
    hashInputs.push(sc.promptYaml);
    sourceContentsMap[`resources/${sc.stepId}/prompt.yaml`] = sc.promptYaml;
    if (sc.systemMessage) {
      hashInputs.push(sc.systemMessage);
      sourceContentsMap[`resources/${sc.stepId}/system-message.md`] = sc.systemMessage;
    }
    if (sc.userMessage) {
      hashInputs.push(sc.userMessage);
      sourceContentsMap[`resources/${sc.stepId}/user-message.md`] = sc.userMessage;
    }
  }

  // Include docs/ directory content in hash and sourceContents
  const docFiles = await loadDocFiles(promptDir);
  for (const doc of docFiles) {
    hashInputs.push(doc.content);
    sourceContentsMap[`docs/${doc.relativePath}`] = doc.content;
  }

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    resourceType: 'prompt',
    category,
    enabled: true,
    systemMessage: sysMsg,
    userMessage: userMsg,
    guidanceContent: null,
    arguments: args,
    chainSteps,
    scriptTools,
    gateRefs,
    chainStepContents,
    docFiles,
    delegation: data.delegation === true ? true : undefined,
    delegationAgent: data.delegationAgent ? data.delegationAgent : undefined,
    gateData: null,
    frameworkData: null,
    styleData: null,
    extensions: {},
    sourcePaths: [yamlPath],
    sourceHash: computeContentHash(hashInputs),
    sourceContents: sourceContentsMap,
  };
}

async function loadGateIR(gateDir: string): Promise<SkillIR> {
  const yamlPath = path.join(gateDir, 'gate.yaml');
  const raw = await readFile(yamlPath, 'utf-8');
  const data = yaml.load(raw) as GateYaml;

  const guidanceFile = data.guidanceFile ?? 'guidance.md';
  const guidance = await readOptionalFile(path.join(gateDir, guidanceFile));

  const sourceContentsMap: Record<string, string> = { 'gate.yaml': raw };
  if (guidance) sourceContentsMap[guidanceFile] = guidance;

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    resourceType: 'gate',
    category: null,
    enabled: data.enabled ?? true,
    systemMessage: null,
    userMessage: null,
    guidanceContent: guidance,
    arguments: [],
    chainSteps: [],
    scriptTools: [],
    gateRefs: [],
    chainStepContents: [],
    docFiles: [],
    gateData: {
      type: data.type ?? 'validation',
      passCriteria: data.pass_criteria ?? [],
      activation: data.activation,
    },
    frameworkData: null,
    styleData: null,
    extensions: { retryConfig: data.retry_config },
    sourcePaths: [yamlPath],
    sourceHash: computeContentHash([raw, guidance ?? '']),
    sourceContents: sourceContentsMap,
  };
}

async function loadFrameworkIR(methDir: string): Promise<SkillIR> {
  const yamlPath = path.join(methDir, 'framework.yaml');
  const raw = await readFile(yamlPath, 'utf-8');
  const data = yaml.load(raw) as FrameworkYaml;

  const phasesFile = data.phasesFile ?? 'phases.yaml';
  const phasesRaw = await readOptionalFile(path.join(methDir, phasesFile));
  const phases = phasesRaw ? (yaml.load(phasesRaw) as unknown[]) : [];

  const sysPromptFile = data.systemPromptFile;
  const sysPromptContent = sysPromptFile
    ? await readOptionalFile(path.join(methDir, sysPromptFile))
    : null;

  const guidance = data.systemPromptGuidance ?? sysPromptContent ?? '';

  const sourceContentsMap: Record<string, string> = { 'framework.yaml': raw };
  if (phasesRaw) sourceContentsMap[phasesFile] = phasesRaw;
  if (sysPromptFile && sysPromptContent) sourceContentsMap[sysPromptFile] = sysPromptContent;

  return {
    id: data.id,
    name: data.name,
    description: `${data.name} methodology (${data.type})`,
    resourceType: 'framework',
    category: null,
    enabled: data.enabled ?? true,
    systemMessage: null,
    userMessage: null,
    guidanceContent: guidance,
    arguments: [],
    chainSteps: [],
    scriptTools: [],
    gateRefs: [],
    chainStepContents: [],
    docFiles: [],
    gateData: null,
    frameworkData: {
      type: data.type ?? '',
      version: data.version ?? '1.0.0',
      systemPromptGuidance: guidance,
      phases,
    },
    styleData: null,
    extensions: {
      gates: data.gates,
      frameworkGates: data.frameworkGates,
    },
    sourcePaths: [yamlPath],
    sourceHash: computeContentHash([raw, phasesRaw ?? '', guidance]),
    sourceContents: sourceContentsMap,
  };
}

async function loadStyleIR(styleDir: string): Promise<SkillIR> {
  const yamlPath = path.join(styleDir, 'style.yaml');
  const raw = await readFile(yamlPath, 'utf-8');
  const data = yaml.load(raw) as StyleYaml;

  const guidanceFile = data.guidanceFile ?? 'guidance.md';
  const guidance = await readOptionalFile(path.join(styleDir, guidanceFile));

  const sourceContentsMap: Record<string, string> = { 'style.yaml': raw };
  if (guidance) sourceContentsMap[guidanceFile] = guidance;

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    resourceType: 'style',
    category: null,
    enabled: data.enabled ?? true,
    systemMessage: null,
    userMessage: null,
    guidanceContent: guidance,
    arguments: [],
    chainSteps: [],
    scriptTools: [],
    gateRefs: [],
    chainStepContents: [],
    docFiles: [],
    gateData: null,
    frameworkData: null,
    styleData: {
      priority: data.priority ?? 0,
      enhancementMode: data.enhancementMode ?? 'prepend',
      compatibleFrameworks: data.compatibleFrameworks,
    },
    extensions: { activation: data.activation },
    sourcePaths: [yamlPath],
    sourceHash: computeContentHash([raw, guidance ?? '']),
    sourceContents: sourceContentsMap,
  };
}

interface LoadFilters {
  resourceType?: ResourceType;
  id?: string;
  exportAllowList?: Set<string>;
}

async function loadAllResources(
  filters: LoadFilters | undefined,
  output: SkillsSyncOutput,
  dbManager?: DatabasePort
): Promise<SkillIR[]> {
  const resources: SkillIR[] = [];

  // Load tools cache for full metadata (schema, execution config)
  const toolsCache = await loadToolsCache(output, dbManager);

  // Prompts: resources/prompts/{category}/{id}/prompt.yaml
  if (!filters?.resourceType || filters.resourceType === 'prompt') {
    const promptsBase = path.join(getResourcesDir(), 'prompts');
    try {
      const categories = await readdir(promptsBase, { withFileTypes: true });
      for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        const catDir = path.join(promptsBase, cat.name);
        const promptDirs = await readdir(catDir, { withFileTypes: true });
        for (const pd of promptDirs) {
          if (!pd.isDirectory()) continue;
          if (filters?.id && pd.name !== filters.id) continue;
          try {
            resources.push(await loadPromptIR(path.join(catDir, pd.name), cat.name, toolsCache));
          } catch (e) {
            output.error(`  skip prompt ${cat.name}/${pd.name}: ${(e as Error).message}`);
          }
        }
      }
    } catch {
      /* no prompts dir */
    }
  }

  // Gates: resources/gates/{id}/gate.yaml
  if (!filters?.resourceType || filters.resourceType === 'gate') {
    const gatesBase = path.join(getResourcesDir(), 'gates');
    try {
      const gateDirs = await readdir(gatesBase, { withFileTypes: true });
      for (const gd of gateDirs) {
        if (!gd.isDirectory()) continue;
        if (!existsSync(path.join(gatesBase, gd.name, 'gate.yaml'))) continue;
        if (filters?.id && gd.name !== filters.id) continue;
        try {
          resources.push(await loadGateIR(path.join(gatesBase, gd.name)));
        } catch (e) {
          output.error(`  skip gate ${gd.name}: ${(e as Error).message}`);
        }
      }
    } catch {
      /* no gates dir */
    }
  }

  // Frameworks: resources/frameworks/{id}/framework.yaml
  if (!filters?.resourceType || filters.resourceType === 'framework') {
    const methBase = path.join(getResourcesDir(), 'frameworks');
    try {
      const methDirs = await readdir(methBase, { withFileTypes: true });
      for (const md of methDirs) {
        if (!md.isDirectory()) continue;
        if (filters?.id && md.name !== filters.id) continue;
        try {
          resources.push(await loadFrameworkIR(path.join(methBase, md.name)));
        } catch (e) {
          output.error(`  skip methodology ${md.name}: ${(e as Error).message}`);
        }
      }
    } catch {
      /* no frameworks dir */
    }
  }

  // Styles: resources/styles/{id}/style.yaml
  if (!filters?.resourceType || filters.resourceType === 'style') {
    const stylesBase = path.join(getResourcesDir(), 'styles');
    try {
      const styleDirs = await readdir(stylesBase, { withFileTypes: true });
      for (const sd of styleDirs) {
        if (!sd.isDirectory()) continue;
        if (filters?.id && sd.name !== filters.id) continue;
        try {
          resources.push(await loadStyleIR(path.join(stylesBase, sd.name)));
        } catch (e) {
          output.error(`  skip style ${sd.name}: ${(e as Error).message}`);
        }
      }
    } catch {
      /* no styles dir */
    }
  }

  // Filter disabled resources
  const enabled = resources.filter((r) => {
    if (!r.enabled) {
      output.log(`  skip disabled: ${r.resourceType}/${r.id}`);
    }
    return r.enabled;
  });

  // Filter by export allow-list (if provided)
  if (filters?.exportAllowList) {
    const allowed = filters.exportAllowList;
    const filtered = enabled.filter((r) => allowed.has(manifestKey(r)));
    const skipped = enabled.length - filtered.length;
    if (skipped > 0) {
      output.log(`  ${skipped} resource(s) not in configured allow-list (skipped)`);
    }
    return filtered;
  }

  return enabled;
}

/** Qualified manifest key: prevents collisions across categories and resource types. */
function manifestKey(ir: SkillIR): string {
  if (ir.resourceType === 'prompt' && ir.category) {
    return `prompt:${ir.category}/${ir.id}`;
  }
  return `${ir.resourceType}:${ir.id}`;
}

// ─── Template Compiler ──────────────────────────────────────────────────────

/**
 * Compiles Nunjucks templates to Claude Code skill syntax.
 * - {{argName}} → {argName} (named placeholder — Claude Code auto-appends $ARGUMENTS)
 * - {% if argName %}content{% endif %} → content (markers stripped, content kept)
 * - {% else %}content{% endif %} → removed (optional fallback not supported)
 */
function compileTemplate(template: string, _args: IRArgument[]): string {
  let result = template;

  // Replace {% if argName %}...{% endif %} blocks (keep inner content)
  // Handle {% if %}...{% else %}...{% endif %} — keep the if-branch, drop else-branch
  result = result.replace(
    /\{%-?\s*if\s+(\w+)\s*-?%\}([\s\S]*?)(?:\{%-?\s*else\s*-?%\}[\s\S]*?)?\{%-?\s*endif\s*-?%\}/g,
    (_match, _varName: string, ifContent: string) => {
      return ifContent.trim();
    }
  );

  // Replace {{argName}} with {argName} (readable named placeholder)
  result = result.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, varName: string) => `{${varName}}`);

  return result;
}

/** Detect Nunjucks control flow syntax ({% if %}, {% for %}, etc.) in content. */
function hasNunjucksControlFlow(content: string): boolean {
  return /\{%-?\s*(if|for|macro|block|set)\s/.test(content);
}

/**
 * Compiles Nunjucks templates to plain text for Agent Skills (no template syntax).
 * - {{argName}} → {argName} (readable placeholder)
 * - {% if argName %}content{% endif %} → content (always included)
 */
function compileTemplateToPlaintext(template: string, _args: IRArgument[]): string {
  let result = template;

  // Strip {% if %}...{% else %}...{% endif %} — keep if-branch
  result = result.replace(
    /\{%-?\s*if\s+(\w+)\s*-?%\}([\s\S]*?)(?:\{%-?\s*else\s*-?%\}[\s\S]*?)?\{%-?\s*endif\s*-?%\}/g,
    (_match, _varName: string, ifContent: string) => ifContent.trim()
  );

  // Replace {{argName}} with readable {argName}
  result = result.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, varName: string) => `{${varName}}`);

  return result;
}

/** Output subdirectory for a resource. Flat structure — clients expect one level. */
function outputSubDir(ir: SkillIR, duplicateIds?: Set<string>): string {
  if (ir.resourceType === 'prompt') {
    // Prefix with category only when IDs collide across categories
    if (duplicateIds?.has(ir.id) && ir.category) {
      return `${ir.category}-${ir.id}`;
    }
    return ir.id;
  }
  const plural = ir.resourceType === 'framework' ? 'frameworks' : ir.resourceType + 's';
  return `${plural}-${ir.id}`;
}

/** Build argument-hint string from arguments list. */
function buildArgumentHint(args: IRArgument[]): string {
  return args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ');
}

// ─── Expected Section Content (for section-aware pull) ───────────────────────

/**
 * Forward-compiles canonical IR sections to produce the expected SKILL.md content.
 * Used by pullCommand to detect which sections the user actually edited:
 * if parsed section matches expected → user didn't edit → skip (preserve conditionals).
 */
function buildExpectedSectionContent(
  ir: SkillIR,
  isClaudeCode: boolean
): { systemMessage: string | null; userMessage: string | null; guidanceContent: string | null } {
  const compile = isClaudeCode ? compileTemplate : compileTemplateToPlaintext;
  return {
    systemMessage: ir.systemMessage ? compile(ir.systemMessage.trim(), ir.arguments) : null,
    userMessage: ir.userMessage ? compile(ir.userMessage.trim(), ir.arguments) : null,
    guidanceContent: ir.guidanceContent ? compile(ir.guidanceContent.trim(), ir.arguments) : null,
  };
}

// ─── Reverse Template Compiler ────────────────────────────────────────────────

/**
 * Reverse-compiles Claude Code {argName} syntax back to Nunjucks {{argName}}.
 * Same as Agent Skills reverse since both formats now use named placeholders.
 */
function reverseCompileTemplate(compiled: string, _args: IRArgument[]): string {
  return compiled.replace(/\{(\w+)\}/g, '{{$1}}');
}

/**
 * Reverse-compiles Agent Skills {argName} syntax back to Nunjucks {{argName}}.
 */
function reverseCompilePlaintext(compiled: string): string {
  return compiled.replace(/\{(\w+)\}/g, '{{$1}}');
}

// ─── SKILL.md Parser ─────────────────────────────────────────────────────────

interface ParsedArgument {
  index: number;
  name: string;
  required: boolean;
  description: string;
}

interface ParsedSkillMd {
  format: 'claude-code' | 'agent-skills';
  frontmatter: Record<string, unknown>;
  sections: Map<string, string>;
  name: string;
  description: string;
  systemMessage: string | null;
  userMessage: string | null;
  guidanceContent: string | null;
  arguments: ParsedArgument[];
  qualityGates: Array<{ id: string; source: string }>;
  chainResources: Array<{ stepId: string; promptId: string }>;
}

/**
 * Parses a SKILL.md file into structured sections.
 * Detects claude-code vs agent-skills format from frontmatter.
 */
function parseSkillMd(content: string): ParsedSkillMd {
  // Extract frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  const fmContent = fmMatch?.[1] ?? '';
  const frontmatter = fmContent ? (yaml.load(fmContent) as Record<string, unknown>) : {};
  const bodyStart = fmMatch ? fmMatch[0].length : 0;
  const body = content.slice(bodyStart);

  // Detect format: agent-skills has compatibility.agent-skills in frontmatter
  const hasCompatibility =
    frontmatter['compatibility'] && typeof frontmatter['compatibility'] === 'object';
  const format: 'claude-code' | 'agent-skills' = hasCompatibility ? 'agent-skills' : 'claude-code';

  // Split body into known ## sections. Content between known headings belongs to
  // the preceding known section (e.g. sub-headings inside Instructions are part of it).
  // Order-aware: once a later section is entered, earlier section names become plain content.
  // This prevents e.g. "## Instructions" inside Usage content from being treated as a boundary.
  const SECTION_ORDER = [
    'Instructions',
    'Guidance',
    'Arguments',
    'Quality Gates',
    'Usage',
    'Chain Workflow',
    'Pass Criteria',
    'Phases',
    'Style Configuration',
  ];
  const sections = new Map<string, string>();
  const sectionRegex = /^## (.+)$/gm;
  const knownHeadings: Array<{ name: string; start: number; matchEnd: number }> = [];
  let match;
  while ((match = sectionRegex.exec(body)) !== null) {
    const heading = match[1]?.trim();
    if (!heading) continue;
    const headingOrder = SECTION_ORDER.indexOf(heading);
    if (headingOrder >= 0) {
      const lastOrder =
        knownHeadings.length > 0
          ? SECTION_ORDER.indexOf(knownHeadings[knownHeadings.length - 1]!.name)
          : -1;
      if (headingOrder > lastOrder) {
        knownHeadings.push({
          name: heading,
          start: match.index,
          matchEnd: match.index + match[0].length,
        });
      }
      // else: heading appears out of order → treat as content of previous section
    }
  }
  for (let i = 0; i < knownHeadings.length; i++) {
    const current = knownHeadings[i]!;
    const next = knownHeadings[i + 1];
    const end = next ? next.start : body.length;
    sections.set(current.name, body.slice(current.matchEnd, end).trim());
  }

  // Parse arguments from ## Arguments section
  const argsSection = sections.get('Arguments') ?? '';
  const parsedArgs: ParsedArgument[] = [];
  // Claude Code: - `$0` — **name** (required): description
  const ccArgRegex = /^- `\$(\d+)` — \*\*(\w+)\*\*(?:\s*\(required\))?\s*:\s*(.+)$/gm;
  let argMatch;
  while ((argMatch = ccArgRegex.exec(argsSection)) !== null) {
    const idxStr = argMatch[1] ?? '0';
    const argName = argMatch[2] ?? '';
    const argDesc = argMatch[3] ?? '';
    parsedArgs.push({
      index: parseInt(idxStr, 10),
      name: argName,
      required: argsSection.includes(`$${idxStr}\` — **${argName}** (required)`),
      description: argDesc.trim(),
    });
  }
  // Agent Skills: - **name** (required): description  OR  - **name**: description
  if (parsedArgs.length === 0) {
    const asArgRegex = /^- \*\*(\w+)\*\*(?:\s*\(required\))?\s*:\s*(.+)$/gm;
    let idx = 0;
    while ((argMatch = asArgRegex.exec(argsSection)) !== null) {
      const argName = argMatch[1] ?? '';
      const argDesc = argMatch[2] ?? '';
      parsedArgs.push({
        index: idx++,
        name: argName,
        required: argsSection.includes(`**${argName}** (required)`),
        description: argDesc.trim(),
      });
    }
  }

  // Parse Quality Gates section
  const qualityGates: Array<{ id: string; source: string }> = [];
  const gatesSection = sections.get('Quality Gates') ?? '';
  if (gatesSection) {
    // Parse registered gate IDs from criteria table: | gate-id | type | when |
    const gateTableRegex = /^\| (\S+) \|/gm;
    let gateMatch;
    while ((gateMatch = gateTableRegex.exec(gatesSection)) !== null) {
      const id = gateMatch[1]!;
      if (id === 'Gate' || id.startsWith('---')) continue; // skip header/separator
      qualityGates.push({ id, source: 'registered' });
    }
    // Parse inline criteria: lines starting with "- " under "### Inline Criteria"
    const inlineMatch = gatesSection.match(/### Inline Criteria\n([\s\S]*?)(?=###|$)/);
    if (inlineMatch) {
      const lines = inlineMatch[1]!.split('\n').filter((l) => l.startsWith('- '));
      for (const line of lines) {
        qualityGates.push({ id: line.slice(2).trim(), source: 'inline' });
      }
    }
  }

  // Parse Chain Workflow resource references: | N | name | [`resources/stepId/`] |
  const chainResources: Array<{ stepId: string; promptId: string }> = [];
  const chainSection = sections.get('Chain Workflow') ?? '';
  if (chainSection) {
    const resourceRegex = /resources\/([^/]+)\//g;
    let resMatch;
    while ((resMatch = resourceRegex.exec(chainSection)) !== null) {
      const stepId = resMatch[1]!;
      if (!chainResources.some((r) => r.stepId === stepId)) {
        chainResources.push({ stepId, promptId: stepId });
      }
    }
  }

  return {
    format,
    frontmatter,
    sections,
    name: String(frontmatter['name'] ?? ''),
    description: String(frontmatter['description'] ?? ''),
    systemMessage: sections.get('Instructions') ?? null,
    userMessage: sections.get('Usage') ?? null,
    guidanceContent: sections.get('Guidance') ?? null,
    arguments: parsedArgs.sort((a, b) => a.index - b.index),
    qualityGates,
    chainResources,
  };
}

// ─── Section 3b: Gate & Chain Section Builders ──────────────────────────────

/**
 * Builds the Quality Gates markdown section for SKILL.md.
 * Includes criteria table, inline criteria, and enforcement protocol.
 */
function buildQualityGatesSection(gateRefs: IRGateRef[]): string {
  if (gateRefs.length === 0) return '';

  const registered = gateRefs.filter((g) => g.source === 'registered');
  const inlineCriteria = gateRefs.filter((g) => g.source === 'inline');
  const inlineDefs = gateRefs.filter((g) => g.source === 'inline_definition');

  let section = `## Quality Gates\n\n`;

  // Criteria table (registered gates)
  if (registered.length > 0) {
    section += `### Criteria\n\n`;
    section += `| Gate | Type | When Active |\n|------|------|-------------|\n`;
    for (const g of registered) {
      const cats = g.activation?.categories?.join(', ') ?? 'explicit';
      const mode = g.activation?.explicitRequest ? 'Explicit include' : `Auto (${cats})`;
      section += `| ${g.id} | ${g.type ?? 'validation'} | ${mode} |\n`;
    }
    section += `\nSee \`gates/{gateId}/guidance.md\` for detailed criteria.\n\n`;
  }

  // Inline definitions
  if (inlineDefs.length > 0) {
    section += `### Inline Gate Definitions\n\n`;
    for (const d of inlineDefs) {
      section += `- **${d.name ?? d.id}**${d.description ? `: ${d.description}` : ''}\n`;
    }
    section += '\n';
  }

  // Inline criteria strings
  if (inlineCriteria.length > 0) {
    section += `### Inline Criteria\n`;
    for (const c of inlineCriteria) {
      section += `- ${c.inlineCriteria}\n`;
    }
    section += '\n';
  }

  // Enforcement protocol
  section += `### Enforcement Protocol\n\n`;
  section += `Before completing this task, you MUST self-review against all gate criteria:\n\n`;
  section += `1. Complete all work specified in the task\n`;
  section += `2. Evaluate output against EACH gate's guidance (\`gates/{id}/guidance.md\`)\n`;
  if (inlineCriteria.length > 0) {
    section += `3. Check inline criteria above\n`;
    section += `4. Emit verdict: \`GATE_REVIEW: PASS — [rationale]\` or \`GATE_REVIEW: FAIL — [rationale]\`\n`;
    section += `5. If FAIL: address issues and re-emit until PASS\n`;
  } else {
    section += `3. Emit verdict: \`GATE_REVIEW: PASS — [rationale]\` or \`GATE_REVIEW: FAIL — [rationale]\`\n`;
    section += `4. If FAIL: address issues and re-emit until PASS\n`;
  }
  section += `\n> This is enforced by SubagentStop hook — task completion is blocked without a PASS verdict.\n\n`;

  return section;
}

/**
 * Builds the enhanced Chain Workflow section with arrow flow and resource links.
 */
function buildEnhancedChainSection(ir: SkillIR, opts: { hasSubagents?: boolean } = {}): string {
  if (ir.chainSteps.length === 0) return '';
  const hasSubagents = opts.hasSubagents ?? true;

  let section = `## Chain Workflow\n\n`;

  if (ir.delegation) {
    const agent = ir.delegationAgent ?? 'chain-executor';
    section += `> All steps delegate to sub-agents by default (agent: \`${agent}\`).\n\n`;
  }

  // Arrow flow
  const arrows = ir.chainSteps.map((s) => `>>${s.promptId.split('/').pop()}`).join(' --> ');
  section += `${arrows}\n\n`;

  // Table with resource links
  const hasResources = ir.chainStepContents.length > 0;
  if (hasResources) {
    section += `| Step | Name | Resource | Delegation |\n|------|------|----------|------------|\n`;
  } else {
    section += `| Step | Prompt | Delegation |\n|------|--------|------------|\n`;
  }

  for (const [i, step] of ir.chainSteps.entries()) {
    const delegated = step.delegation ?? ir.delegation ?? false;
    const agent = step.agentType ?? ir.delegationAgent;
    let delegationCol: string;
    if (!delegated) {
      delegationCol = 'Inline';
    } else if (hasSubagents) {
      delegationCol = `Sub-agent: \`${agent ?? 'chain-executor'}\``;
    } else {
      delegationCol = `Delegated (agent: ${agent ?? 'default'})`;
    }

    const localId = step.promptId.split('/').pop() ?? step.promptId;
    const hasContent = ir.chainStepContents.some((sc) => sc.stepId === localId);

    if (hasResources) {
      const resourceCol = hasContent ? `[\`resources/${localId}/\`](resources/${localId}/)` : '—';
      section += `| ${i + 1} | ${step.stepName} | ${resourceCol} | ${delegationCol} |\n`;
    } else {
      section += `| ${i + 1} | ${step.stepName} (\`${step.promptId}\`) | ${delegationCol} |\n`;
    }
  }

  if (hasResources) {
    section += `\n> Full step content in \`resources/{stepId}/\` directories.\n`;
  }
  if (!hasSubagents) {
    section += `\n> *Note: This client does not natively support sub-agent delegation. Delegated steps are advisory.*\n`;
  }
  section += '\n';

  return section;
}

/**
 * Emits gate output files (gate.yaml + guidance.md) for registered gates.
 */
function emitGateFiles(gateRefs: IRGateRef[], subDir: string): OutputFile[] {
  const files: OutputFile[] = [];
  for (const ref of gateRefs) {
    if (ref.source !== 'registered' || !ref.gateYamlContent) continue;
    files.push({
      relativePath: `${subDir}/gates/${ref.id}/gate.yaml`,
      content: ref.gateYamlContent,
    });
    if (ref.guidanceContent) {
      files.push({
        relativePath: `${subDir}/gates/${ref.id}/guidance.md`,
        content: ref.guidanceContent,
      });
    }
  }
  return files;
}

/**
 * Emits docs/ directory files into the skill output directory.
 */
function emitDocFiles(docFiles: IRDocFile[], subDir: string): OutputFile[] {
  return docFiles.map((doc) => ({
    relativePath: `${subDir}/docs/${doc.relativePath}`,
    content: doc.content,
  }));
}

/**
 * Emits chain step resource files (prompt.yaml, system-message.md, user-message.md).
 */
function emitChainResourceFiles(
  chainStepContents: IRChainStepContent[],
  subDir: string
): OutputFile[] {
  const files: OutputFile[] = [];
  for (const sc of chainStepContents) {
    files.push({
      relativePath: `${subDir}/resources/${sc.stepId}/prompt.yaml`,
      content: sc.promptYaml,
    });
    if (sc.systemMessage) {
      files.push({
        relativePath: `${subDir}/resources/${sc.stepId}/system-message.md`,
        content: sc.systemMessage,
      });
    }
    if (sc.userMessage) {
      files.push({
        relativePath: `${subDir}/resources/${sc.stepId}/user-message.md`,
        content: sc.userMessage,
      });
    }
  }
  return files;
}

// ─── Section 4: Claude Code Adapter ─────────────────────────────────────────

function buildClaudeCodeSkill(ir: SkillIR, duplicateIds?: Set<string>): OutputFile[] {
  const files: OutputFile[] = [];
  const subDir = outputSubDir(ir, duplicateIds);

  // Frontmatter
  const fm: Record<string, unknown> = { name: ir.name, description: ir.description };
  if (ir.scriptTools.length > 0) fm['tools'] = ir.scriptTools.map((t) => t.name);
  if (ir.arguments.length > 0) fm['argument-hint'] = buildArgumentHint(ir.arguments);

  let body = `---\n${yaml.dump(fm, { lineWidth: 120 }).trim()}\n---\n\n`;

  // Instructions section
  if (ir.systemMessage) {
    body += `## Instructions\n\n${compileTemplate(ir.systemMessage.trim(), ir.arguments)}\n\n`;
  }
  if (ir.guidanceContent) {
    body += `## Guidance\n\n${compileTemplate(ir.guidanceContent.trim(), ir.arguments)}\n\n`;
  }

  // Arguments reference
  if (ir.arguments.length > 0) {
    body += `## Arguments\n\n`;
    for (const a of ir.arguments) {
      body += `- **${a.name}**${a.required ? ' (required)' : ''}: ${a.description}\n`;
    }
    body += '\n';
  }

  // Quality Gates section (after Arguments, before Usage)
  body += buildQualityGatesSection(ir.gateRefs);

  // Usage / user message template (compiled)
  if (ir.userMessage) {
    body += `## Usage\n\n${compileTemplate(ir.userMessage.trim(), ir.arguments)}\n`;
  }

  // Chain workflow with resource links (Claude Code supports sub-agents)
  body += buildEnhancedChainSection(ir, { hasSubagents: true });

  // Gate-specific: pass criteria checklist
  if (ir.gateData) {
    body += `## Pass Criteria\n\n`;
    for (const c of ir.gateData.passCriteria) {
      const criterion = c as Record<string, unknown>;
      body += `- [${String(criterion['type'])}] ${JSON.stringify(criterion)}\n`;
    }
    body += '\n';
  }

  // Framework-specific: phase summary
  if (ir.frameworkData && Array.isArray(ir.frameworkData.phases)) {
    body += `## Phases\n\n`;
    const phases = ir.frameworkData.phases as Array<Record<string, unknown>>;
    for (const phase of phases) {
      const pName = (phase['name'] as string) ?? (phase['id'] as string) ?? 'Phase';
      body += `### ${pName}\n\n${(phase['description'] as string) ?? ''}\n\n`;
    }
  }

  // Style-specific: activation info
  if (ir.styleData) {
    body += `## Style Configuration\n\n`;
    body += `- **Priority**: ${ir.styleData.priority}\n`;
    body += `- **Enhancement Mode**: ${ir.styleData.enhancementMode}\n`;
    if (ir.styleData.compatibleFrameworks) {
      body += `- **Compatible Frameworks**: ${ir.styleData.compatibleFrameworks.join(', ')}\n`;
    }
    body += '\n';
  }

  files.push({ relativePath: `${subDir}/SKILL.md`, content: body });

  // Script files and tool metadata
  for (const tool of ir.scriptTools) {
    const toolSubDir = `${subDir}/tools/${tool.id}`;

    // Script file
    if (tool.scriptContent) {
      const ext = tool.runtime === 'python' ? '.py' : tool.runtime === 'node' ? '.js' : '';
      files.push({
        relativePath: `${toolSubDir}/script${ext}`,
        content: tool.scriptContent,
      });
    }

    // Schema file (if available from cache)
    if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
      files.push({
        relativePath: `${toolSubDir}/schema.json`,
        content: JSON.stringify(tool.inputSchema, null, 2),
      });
    }

    // Tool config file (execution settings)
    if (tool.execution) {
      const toolConfig = {
        name: tool.name,
        runtime: tool.runtime,
        trigger: tool.execution.trigger,
        confirm: tool.execution.confirm,
        strict: tool.execution.strict,
        ...(tool.execution.timeout !== undefined && { timeout: tool.execution.timeout }),
        ...(tool.env !== undefined && { env: tool.env }),
      };
      files.push({
        relativePath: `${toolSubDir}/tool.json`,
        content: JSON.stringify(toolConfig, null, 2),
      });
    }
  }

  // Gate files (gate.yaml + guidance.md)
  files.push(...emitGateFiles(ir.gateRefs, subDir));

  // Doc files (docs/*.md bundled from source prompt)
  files.push(...emitDocFiles(ir.docFiles, subDir));

  // Chain step resource files
  files.push(...emitChainResourceFiles(ir.chainStepContents, subDir));

  return files;
}

// ─── Section 5: Agent Skills Adapter ────────────────────────────────────────

function buildAgentSkillsSkill(
  ir: SkillIR,
  config: ClientConfig,
  duplicateIds?: Set<string>
): OutputFile[] {
  const files: OutputFile[] = [];
  const subDir = outputSubDir(ir, duplicateIds);
  const variant = config.variant ?? 'codex';

  // Core Agent Skills frontmatter
  const fm: Record<string, unknown> = {
    name: ir.name,
    description: ir.description,
    license: SYNC_DEFAULTS.license,
    compatibility: { 'agent-skills': SYNC_DEFAULTS.adapterVersion },
  };

  // Metadata
  const metadata: Record<string, unknown> = {
    'resource-type': ir.resourceType,
    'source-hash': ir.sourceHash,
  };
  if (ir.category) metadata['category'] = ir.category;
  fm['metadata'] = metadata;

  // Allowed tools
  if (ir.scriptTools.length > 0) {
    fm['allowed-tools'] = ir.scriptTools.map((t) => t.id);
  }

  // Variant-specific extensions
  if (variant === 'cursor') {
    fm['alwaysApply'] = config.extensions?.['alwaysApply'] ?? false;
    if (ir.category) fm['category'] = ir.category;
  }
  // OpenCode: strict subset — only name, description, license, compatibility, metadata
  if (variant === 'opencode') {
    delete fm['allowed-tools'];
  }

  let body = `---\n${yaml.dump(fm, { lineWidth: 120 }).trim()}\n---\n\n`;

  // Body content (compiled to plain markdown — Agent Skills has no template syntax)
  if (ir.systemMessage) {
    body += `## Instructions\n\n${compileTemplateToPlaintext(ir.systemMessage.trim(), ir.arguments)}\n\n`;
  }
  if (ir.guidanceContent) {
    body += `## Guidance\n\n${compileTemplateToPlaintext(ir.guidanceContent.trim(), ir.arguments)}\n\n`;
  }

  // Arguments (descriptive — no positional syntax in Agent Skills)
  if (ir.arguments.length > 0) {
    body += `## Arguments\n\n`;
    for (const a of ir.arguments) {
      body += `- **${a.name}**${a.required ? ' (required)' : ''}: ${a.description}\n`;
    }
    body += '\n';
  }

  // Quality Gates section (after Arguments, before Usage)
  body += buildQualityGatesSection(ir.gateRefs);

  if (ir.userMessage) {
    body += `## Usage\n\n${compileTemplateToPlaintext(ir.userMessage.trim(), ir.arguments)}\n`;
  }

  // Chain workflow with resource links (capability-aware)
  body += buildEnhancedChainSection(ir, { hasSubagents: config.capabilities.subagents });

  // Gate pass criteria
  if (ir.gateData) {
    body += `## Pass Criteria\n\n`;
    for (const c of ir.gateData.passCriteria) {
      const criterion = c as Record<string, unknown>;
      body += `- [${String(criterion['type'])}] ${JSON.stringify(criterion)}\n`;
    }
    body += '\n';
  }

  // Framework phases
  if (ir.frameworkData && Array.isArray(ir.frameworkData.phases)) {
    body += `## Phases\n\n`;
    const phases = ir.frameworkData.phases as Array<Record<string, unknown>>;
    for (const phase of phases) {
      const pName = (phase['name'] as string) ?? (phase['id'] as string) ?? 'Phase';
      body += `### ${pName}\n\n${(phase['description'] as string) ?? ''}\n\n`;
    }
  }

  // Style config
  if (ir.styleData) {
    body += `## Style Configuration\n\n`;
    body += `- **Priority**: ${ir.styleData.priority}\n`;
    body += `- **Enhancement Mode**: ${ir.styleData.enhancementMode}\n`;
    if (ir.styleData.compatibleFrameworks) {
      body += `- **Compatible Frameworks**: ${ir.styleData.compatibleFrameworks.join(', ')}\n`;
    }
    body += '\n';
  }

  files.push({ relativePath: `${subDir}/SKILL.md`, content: body });

  // Scripts and tool metadata (if client supports)
  if (config.capabilities.scripts) {
    for (const tool of ir.scriptTools) {
      const toolSubDir = `${subDir}/tools/${tool.id}`;

      // Script file
      if (tool.scriptContent) {
        const ext = tool.runtime === 'python' ? '.py' : tool.runtime === 'node' ? '.js' : '';
        files.push({
          relativePath: `${toolSubDir}/script${ext}`,
          content: tool.scriptContent,
        });
      }

      // Schema file (if available from cache)
      if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
        files.push({
          relativePath: `${toolSubDir}/schema.json`,
          content: JSON.stringify(tool.inputSchema, null, 2),
        });
      }

      // Tool config file (execution settings)
      if (tool.execution) {
        const toolConfig = {
          name: tool.name,
          runtime: tool.runtime,
          trigger: tool.execution.trigger,
          confirm: tool.execution.confirm,
          strict: tool.execution.strict,
          ...(tool.execution.timeout !== undefined && { timeout: tool.execution.timeout }),
          ...(tool.env !== undefined && { env: tool.env }),
        };
        files.push({
          relativePath: `${toolSubDir}/tool.json`,
          content: JSON.stringify(toolConfig, null, 2),
        });
      }
    }
  }

  // References (if client supports)
  if (config.capabilities.references) {
    if (ir.frameworkData?.systemPromptGuidance) {
      files.push({
        relativePath: `${subDir}/references/system-prompt.md`,
        content: ir.frameworkData.systemPromptGuidance,
      });
    }
    if (ir.frameworkData?.phases && ir.frameworkData.phases.length > 0) {
      files.push({
        relativePath: `${subDir}/references/phases.md`,
        content: `# Phases\n\n${yaml.dump(ir.frameworkData.phases, { lineWidth: 120 })}`,
      });
    }
  }

  // Gate files (gate.yaml + guidance.md)
  files.push(...emitGateFiles(ir.gateRefs, subDir));

  // Doc files (behind assets capability)
  if (config.capabilities.assets) {
    files.push(...emitDocFiles(ir.docFiles, subDir));
  }

  // Chain step resource files
  files.push(...emitChainResourceFiles(ir.chainStepContents, subDir));

  return files;
}

// ─── Section 6: Adapter Dispatch ────────────────────────────────────────────

function adaptResource(
  ir: SkillIR,
  clientConfig: ClientConfig,
  duplicateIds?: Set<string>
): OutputFile[] {
  if (clientConfig.adapter === 'claude-code') {
    return buildClaudeCodeSkill(ir, duplicateIds);
  }
  return buildAgentSkillsSkill(ir, clientConfig, duplicateIds);
}

// ─── Section 7: Manifest Operations (SQLite-backed) ────────────────────────

/** Row shape from the skills_sync_manifests table. */
interface ManifestRow {
  client: string;
  scope: string;
  resource_key: string;
  resource_id: string;
  resource_type: string;
  source_hash: string;
  output_hash: string;
  output_files: string;
  exported_at: string;
  version: number | null;
  version_date: string | null;
  config_hash: string;
  source_snapshot: string | null;
}

/** Load manifest entries from SQLite for a given client + scope. */
function loadManifestEntries(
  clientId: string,
  scope: 'user' | 'project',
  dbManager?: DatabasePort
): Map<string, SyncManifestEntry> {
  const map = new Map<string, SyncManifestEntry>();
  if (!dbManager?.isInitialized()) return map;

  const rows = dbManager.query<ManifestRow>(
    'SELECT * FROM skills_sync_manifests WHERE client = ? AND scope = ?',
    [clientId, scope]
  );
  for (const row of rows) {
    map.set(row.resource_key, {
      resourceId: row.resource_id,
      resourceType: row.resource_type as ResourceType,
      sourceHash: row.source_hash,
      outputHash: row.output_hash,
      outputFiles: JSON.parse(row.output_files) as string[],
      exportedAt: row.exported_at,
      version: row.version ?? undefined,
      versionDate: row.version_date ?? undefined,
      sourceSnapshot: row.source_snapshot
        ? (JSON.parse(row.source_snapshot) as Record<string, string>)
        : undefined,
    });
  }
  return map;
}

/** Bulk save manifest entries within a single transaction. */
async function saveManifestBatch(
  clientId: string,
  scope: 'user' | 'project',
  entries: Map<string, SyncManifestEntry>,
  configHash: string,
  dbManager?: DatabasePort
): Promise<void> {
  if (!dbManager?.isInitialized()) return;

  await dbManager.transaction(() => {
    // Clear previous entries for this client+scope
    dbManager.run('DELETE FROM skills_sync_manifests WHERE client = ? AND scope = ?', [
      clientId,
      scope,
    ]);
    for (const [key, entry] of entries) {
      dbManager.run(
        `INSERT INTO skills_sync_manifests
         (client, scope, resource_key, resource_id, resource_type, source_hash, output_hash,
          output_files, exported_at, version, version_date, config_hash, source_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          clientId,
          scope,
          key,
          entry.resourceId,
          entry.resourceType,
          entry.sourceHash,
          entry.outputHash,
          JSON.stringify(entry.outputFiles),
          entry.exportedAt,
          entry.version ?? null,
          entry.versionDate ?? null,
          configHash,
          entry.sourceSnapshot ? JSON.stringify(entry.sourceSnapshot) : null,
        ]
      );
    }
  });
}

function hashOutputFiles(files: OutputFile[]): string {
  return computeContentHash(files.map((f) => f.content));
}

// ─── Section 8: Export Command ──────────────────────────────────────────────

async function exportCommand(opts: SkillsSyncOptions, output: SkillsSyncOutput): Promise<void> {
  const config = await loadSyncConfig();
  const cliScope = opts.scope; // undefined = use per-resource scope; set = override all
  const clientIds =
    opts.client === 'all' || !opts.client ? Object.keys(CLIENT_REGISTRY) : [opts.client];

  const filters: LoadFilters = {};
  if (opts.resourceType) filters.resourceType = opts.resourceType;
  if (opts.id) filters.id = opts.id;

  const resources = await loadAllResources(filters, output, opts.dbManager);
  output.log(`Loaded ${resources.length} resources`);

  // Detect duplicate prompt IDs across categories
  const idCounts = new Map<string, number>();
  for (const r of resources) {
    if (r.resourceType === 'prompt') {
      idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
    }
  }
  const duplicateIds = new Set([...idCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id));
  if (duplicateIds.size > 0) {
    output.log(
      `  note: ${duplicateIds.size} duplicate prompt ID(s) will be category-prefixed: ${[...duplicateIds].join(', ')}`
    );
  }

  const configRaw = await readFile(getConfigPath(), 'utf-8');
  const configHash = computeContentHash([configRaw]);

  // Determine which scopes to export to (default: user-global only)
  const targetScopes: Array<'user' | 'project'> = cliScope ? [cliScope] : ['user'];
  const registrationMutations: RegistrationMutation[] = [];

  // Track resolved directories to detect symlink collisions (e.g., ~/.codex/skills -> ~/.claude/skills)
  const seenDirs = new Map<string, string>(); // realpath → first clientId that claimed it

  for (const clientId of clientIds) {
    const clientConfig = resolveClientConfig(clientId, config);
    if (!clientConfig) {
      throw usageError(
        `Unknown client: ${clientId} (available: ${Object.keys(CLIENT_REGISTRY).join(', ')}, all)`
      );
    }
    const selection = resolveClientResourceSelection(config, clientId);
    const ignoreSelection = opts.id != null;
    if (!ignoreSelection && selection.mode === 'unregistered') {
      output.log(`\n── ${clientId}: skipped — no registrations in skills-sync.yaml`);
      continue;
    }

    for (const scope of targetScopes) {
      const baseDir = resolveOutputDir(clientConfig, scope);

      // Collision guard: skip if another client already wrote to this physical directory
      const dirKey = `${baseDir}:${scope}`;
      const previousClient = seenDirs.get(dirKey);
      if (previousClient) {
        output.warn(
          `  skipping ${clientId} (${scope}) → ${baseDir} — directory already written by ${previousClient} (symlink collision?)`
        );
        continue;
      }
      seenDirs.set(dirKey, clientId);

      const manifestEntries = new Map<string, SyncManifestEntry>();

      const scopedResources = filterResourcesForScope(resources, scope, selection, ignoreSelection);

      if (scopedResources.length === 0) continue;

      output.log(`\n── ${clientId} (${scope}) → ${baseDir}`);

      for (const ir of scopedResources) {
        const resourceKey = manifestKey(ir);
        let outputFiles = adaptResource(ir, clientConfig, duplicateIds);
        outputFiles = attachManagedMarkerToSkillFiles(outputFiles, clientId, scope, resourceKey);
        const outputHash = hashOutputFiles(outputFiles);

        for (const file of outputFiles) {
          const fullPath = path.join(baseDir, file.relativePath);
          if (opts.dryRun) {
            output.log(`  [dry-run] ${file.relativePath}`);
          } else {
            await mkdir(path.dirname(fullPath), { recursive: true });
            await writeFile(fullPath, file.content);
            output.log(`  wrote ${file.relativePath}`);
          }
        }

        // Load version history for the resource
        const firstSourcePath = ir.sourcePaths[0];
        if (!firstSourcePath) continue;
        const resourceDir = path.dirname(firstSourcePath);
        const history = loadHistory(resourceDir);

        manifestEntries.set(resourceKey, {
          resourceId: ir.id,
          resourceType: ir.resourceType,
          sourceHash: ir.sourceHash,
          outputHash,
          outputFiles: outputFiles.map((f) => f.relativePath),
          exportedAt: new Date().toISOString(),
          sourceSnapshot: ir.sourceContents,
          ...(history && {
            version: history.current_version,
            versionDate: history.versions[0]?.date,
          }),
        });
      }

      if (!opts.dryRun) {
        await saveManifestBatch(clientId, scope, manifestEntries, configHash, opts.dbManager);
        output.log(`  manifest saved (${manifestEntries.size} entries, scope: ${scope})`);
        registrationMutations.push({
          clientId,
          scope,
          resourceKeys: scopedResources.map((resource) => manifestKey(resource)),
        });
      }
    }
  }

  if (!opts.dryRun) {
    const mutationResult = await applyRegistrationMutations(getConfigPath(), registrationMutations);
    if (mutationResult.updated) {
      output.log(`Updated skills-sync.yaml registrations (+${mutationResult.addedKeys} key(s))`);
    }
  }
}

function attachManagedMarkerToSkillFiles(
  outputFiles: OutputFile[],
  clientId: string,
  scope: 'user' | 'project',
  resourceKey: string
): OutputFile[] {
  return outputFiles.map((outputFile) => {
    if (!outputFile.relativePath.endsWith('/SKILL.md')) {
      return outputFile;
    }
    return {
      ...outputFile,
      content: injectManagedSkillMarker(outputFile.content, {
        clientId,
        scope,
        resourceKey,
      }),
    };
  });
}

async function collectManagedSkillDirsFromMarkers(
  baseDir: string,
  clientId: string,
  scope: 'user' | 'project'
): Promise<ManagedSkillDirMap> {
  const managedSkillDirs: ManagedSkillDirMap = new Map();
  if (!existsSync(baseDir)) {
    return managedSkillDirs;
  }

  const entries = await readdir(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillContent = await readOptionalFile(path.join(baseDir, entry.name, 'SKILL.md'));
    if (!skillContent) continue;
    const marker = parseManagedSkillMarker(skillContent);
    if (!marker) continue;
    if (marker.clientId !== clientId || marker.scope !== scope) continue;

    const existing = managedSkillDirs.get(marker.resourceKey);
    if (existing) {
      existing.add(entry.name);
    } else {
      managedSkillDirs.set(marker.resourceKey, new Set([entry.name]));
    }
  }

  return managedSkillDirs;
}

async function applySyncPrune(
  baseDir: string,
  pruneSkillDirs: string[],
  dryRun: boolean,
  output: SkillsSyncOutput
): Promise<void> {
  if (pruneSkillDirs.length === 0) {
    return;
  }

  for (const skillDir of pruneSkillDirs) {
    const fullPath = path.join(baseDir, skillDir);
    if (dryRun) {
      output.log(`  [dry-run] prune ${skillDir}/`);
      continue;
    }
    await rm(fullPath, { recursive: true, force: true });
    output.log(`  pruned ${skillDir}/`);
  }
}

async function syncCommand(opts: SkillsSyncOptions, output: SkillsSyncOutput): Promise<void> {
  const config = await loadSyncConfig();
  const cliScope = opts.scope;
  const shouldPrune = opts.prune ?? true;
  const clientIds =
    opts.client === 'all' || !opts.client ? Object.keys(CLIENT_REGISTRY) : [opts.client];

  const filters: LoadFilters = {};
  if (opts.resourceType) filters.resourceType = opts.resourceType;
  if (opts.id) filters.id = opts.id;

  const resources = await loadAllResources(filters, output, opts.dbManager);
  output.log(`Loaded ${resources.length} resources`);

  const idCounts = new Map<string, number>();
  for (const r of resources) {
    if (r.resourceType === 'prompt') {
      idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
    }
  }
  const duplicateIds = new Set([...idCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id));

  const targetScopes: Array<'user' | 'project'> = cliScope ? [cliScope] : ['user'];
  const seenDirs = new Map<string, string>();
  const configPath = getConfigPath();

  for (const clientId of clientIds) {
    const clientConfig = resolveClientConfig(clientId, config);
    if (!clientConfig) {
      throw usageError(
        `Unknown client: ${clientId} (available: ${Object.keys(CLIENT_REGISTRY).join(', ')}, all)`
      );
    }

    const selection = resolveClientResourceSelection(config, clientId);
    const ignoreSelection = opts.id != null;
    if (!ignoreSelection && selection.mode === 'unregistered') {
      output.log(`\n── ${clientId}: skipped — no registrations in skills-sync.yaml`);
      continue;
    }

    for (const scope of targetScopes) {
      const baseDir = resolveOutputDir(clientConfig, scope);
      const dirKey = `${baseDir}:${scope}`;
      const previousClient = seenDirs.get(dirKey);
      if (previousClient) {
        output.warn(
          `  skipping ${clientId} (${scope}) → ${baseDir} — directory already written by ${previousClient} (symlink collision?)`
        );
        continue;
      }
      seenDirs.set(dirKey, clientId);

      const scopedResources = filterResourcesForScope(resources, scope, selection, ignoreSelection);
      const desiredResourceKeys = scopedResources.map((resource) => manifestKey(resource));
      const desiredResourceKeySet = new Set(desiredResourceKeys);

      output.log(`\n── ${clientId} (${scope}) → ${baseDir}`);

      const registrationMutations: RegistrationMutation[] = [
        { clientId, scope, resourceKeys: desiredResourceKeys },
      ];
      if (opts.dryRun) {
        const previewResult = await previewRegistrationMutations(configPath, registrationMutations);
        if (previewResult.updated) {
          output.log(
            `  [dry-run] update skills-sync.yaml registrations (+${previewResult.addedKeys} key(s))`
          );
        }
      } else {
        const mutationResult = await applyRegistrationMutations(configPath, registrationMutations);
        if (mutationResult.updated) {
          output.log(
            `  updated skills-sync.yaml registrations (+${mutationResult.addedKeys} key(s))`
          );
        }
      }

      const previousManifestEntries = loadManifestEntries(clientId, scope, opts.dbManager);
      const markerManagedSkillDirs = await collectManagedSkillDirsFromMarkers(
        baseDir,
        clientId,
        scope
      );
      const manifestManagedSkillDirs = collectManifestManagedSkillDirs(previousManifestEntries);
      const prunePlan = buildSyncPrunePlan({
        desiredResourceKeys: desiredResourceKeySet,
        manifestManagedSkillDirs,
        markerManagedSkillDirs,
      });

      const manifestEntries = new Map<string, SyncManifestEntry>();
      for (const ir of scopedResources) {
        const resourceKey = manifestKey(ir);
        let outputFiles = adaptResource(ir, clientConfig, duplicateIds);
        outputFiles = attachManagedMarkerToSkillFiles(outputFiles, clientId, scope, resourceKey);
        const outputHash = hashOutputFiles(outputFiles);

        for (const file of outputFiles) {
          const fullPath = path.join(baseDir, file.relativePath);
          if (opts.dryRun) {
            output.log(`  [dry-run] ${file.relativePath}`);
          } else {
            await mkdir(path.dirname(fullPath), { recursive: true });
            await writeFile(fullPath, file.content);
            output.log(`  wrote ${file.relativePath}`);
          }
        }

        const firstSourcePath = ir.sourcePaths[0];
        if (!firstSourcePath) continue;
        const resourceDir = path.dirname(firstSourcePath);
        const history = loadHistory(resourceDir);

        manifestEntries.set(resourceKey, {
          resourceId: ir.id,
          resourceType: ir.resourceType,
          sourceHash: ir.sourceHash,
          outputHash,
          outputFiles: outputFiles.map((file) => file.relativePath),
          exportedAt: new Date().toISOString(),
          sourceSnapshot: ir.sourceContents,
          ...(history && {
            version: history.current_version,
            versionDate: history.versions[0]?.date,
          }),
        });
      }

      if (shouldPrune) {
        await applySyncPrune(baseDir, prunePlan.pruneSkillDirs, opts.dryRun === true, output);
      } else if (prunePlan.pruneSkillDirs.length > 0) {
        output.log(`  prune skipped (${prunePlan.pruneSkillDirs.length} stale managed skill(s))`);
      }

      if (opts.dryRun) {
        output.log(
          `  [dry-run] manifest update (${manifestEntries.size} entries, scope: ${scope})`
        );
      } else {
        const updatedConfigRaw = await readFile(configPath, 'utf-8');
        const configHash = computeContentHash([updatedConfigRaw]);
        await saveManifestBatch(clientId, scope, manifestEntries, configHash, opts.dbManager);
        output.log(`  manifest saved (${manifestEntries.size} entries, scope: ${scope})`);
      }
    }
  }
}

/** Strip the noisy `===...===` header and indent each line for visual hierarchy. */
function formatPatchForDisplay(rawPatch: string, indent = '    '): string {
  return rawPatch
    .replace(/^={10,}\n/gm, '') // remove === separator lines
    .trimEnd()
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}

// ─── Section 9: Diff Command ────────────────────────────────────────────────

async function diffCommand(opts: SkillsSyncOptions, output: SkillsSyncOutput): Promise<void> {
  const config = await loadSyncConfig();
  const cliScope = opts.scope;
  const clientIds =
    opts.client === 'all' || !opts.client ? Object.keys(CLIENT_REGISTRY) : [opts.client];

  const filters: LoadFilters = {};
  if (opts.resourceType) filters.resourceType = opts.resourceType;
  if (opts.id) filters.id = opts.id;
  const resources = await loadAllResources(filters, output, opts.dbManager);
  const targetScopes: Array<'user' | 'project'> = cliScope ? [cliScope] : ['user', 'project'];

  // When --output is provided, collect patches and write .patch files
  const patchOutputDir = opts.output;
  if (patchOutputDir) {
    await mkdir(patchOutputDir, { recursive: true });
  }

  const seenDirs = new Map<string, string>();

  for (const clientId of clientIds) {
    const clientConfig = resolveClientConfig(clientId, config);
    if (!clientConfig) {
      throw usageError(
        `Unknown client: ${clientId} (available: ${Object.keys(CLIENT_REGISTRY).join(', ')}, all)`
      );
    }
    const selection = resolveClientResourceSelection(config, clientId);
    const ignoreSelection = opts.id != null;
    if (!ignoreSelection && selection.mode === 'unregistered') {
      output.log(`\n── ${clientId}: skipped — no registrations in skills-sync.yaml`);
      continue;
    }

    const idCounts = new Map<string, number>();
    for (const r of resources) {
      if (r.resourceType === 'prompt') idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
    }
    const duplicateIds = new Set(
      [...idCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id)
    );

    for (const scope of targetScopes) {
      const baseDir = resolveOutputDir(clientConfig, scope);
      const dirKey = `${baseDir}:${scope}`;
      const previousClient = seenDirs.get(dirKey);
      if (previousClient) {
        output.log(`\n── ${clientId} (${scope}): skipped — same directory as ${previousClient}`);
        continue;
      }
      seenDirs.set(dirKey, clientId);

      const manifestEntries = loadManifestEntries(clientId, scope, opts.dbManager);
      if (manifestEntries.size === 0) {
        if (cliScope) {
          output.log(`${clientId} (${scope}): no manifest found (run export first)`);
        }
        continue;
      }

      output.log(`\n── ${clientId} (${scope}) drift report`);
      const scopedResources = filterResourcesForScope(resources, scope, selection, ignoreSelection);

      const driftEntries: Array<{
        type: 'new' | 'source' | 'output' | 'orphan';
        id: string;
        files: string[];
      }> = [];
      // Per-resource patch collection for --output: { resourceId → { filename → rawPatch } }
      const patchesByResource = new Map<string, Map<string, string>>();

      for (const ir of scopedResources) {
        const key = manifestKey(ir);
        const entry = manifestEntries.get(key);
        if (!entry) {
          output.log(`  [NEW] ${ir.id} — not in manifest`);
          driftEntries.push({ type: 'new', id: ir.id, files: [] });
          continue;
        }

        // Source drift: canonical YAML changed
        if (ir.sourceHash !== entry.sourceHash) {
          const changedFiles: string[] = [];
          output.log(`  [SOURCE DRIFT] ${ir.id} — canonical sources changed`);
          if (entry.sourceSnapshot && ir.sourceContents) {
            const allFiles = new Set([
              ...Object.keys(entry.sourceSnapshot),
              ...Object.keys(ir.sourceContents),
            ]);
            for (const filePath of allFiles) {
              const previousContent = entry.sourceSnapshot[filePath] ?? '';
              const currentContent = ir.sourceContents[filePath] ?? '';
              if (previousContent !== currentContent) {
                changedFiles.push(filePath);
                const patch = createTwoFilesPatch(
                  `a/${ir.id}/${filePath}`,
                  `b/${ir.id}/${filePath}`,
                  previousContent,
                  currentContent
                );
                output.log(formatPatchForDisplay(patch));
                if (patchOutputDir) {
                  if (!patchesByResource.has(ir.id)) patchesByResource.set(ir.id, new Map());
                  patchesByResource.get(ir.id)!.set(`source/${filePath}`, patch);
                }
              }
            }
          }
          driftEntries.push({ type: 'source', id: ir.id, files: changedFiles });
        }

        // Output drift: exported files edited locally since last export
        const resourceKey = manifestKey(ir);
        let outputFiles = adaptResource(ir, clientConfig, duplicateIds);
        outputFiles = attachManagedMarkerToSkillFiles(outputFiles, clientId, scope, resourceKey);
        const baseDir = resolveOutputDir(clientConfig, scope);
        const outputPatches: string[] = [];
        const changedOutputFiles: string[] = [];
        for (const file of outputFiles) {
          const fullPath = path.join(baseDir, file.relativePath);
          const existing = await readOptionalFile(fullPath);
          if (!existing) continue;
          if (existing !== file.content) {
            changedOutputFiles.push(file.relativePath);
            const patch = createTwoFilesPatch(
              `a/${file.relativePath}`,
              `b/${file.relativePath}`,
              existing,
              file.content
            );
            outputPatches.push(patch);
            if (patchOutputDir) {
              if (!patchesByResource.has(ir.id)) patchesByResource.set(ir.id, new Map());
              patchesByResource.get(ir.id)!.set(`output/${file.relativePath}`, patch);
            }
          }
        }
        if (outputPatches.length > 0) {
          output.log(`  [OUTPUT DRIFT] ${ir.id} — exported files modified locally`);
          for (const patch of outputPatches) {
            output.log(formatPatchForDisplay(patch));
          }
          driftEntries.push({ type: 'output', id: ir.id, files: changedOutputFiles });
        }
      }

      // Check for orphans (in manifest but no longer in resources)
      const resourceKeys = new Set(scopedResources.map((r) => manifestKey(r)));
      for (const [key, entry] of manifestEntries) {
        if (!resourceKeys.has(key)) {
          output.log(`  [ORPHAN] ${key} (${entry.resourceType}) — no longer in sources`);
          driftEntries.push({ type: 'orphan', id: key, files: [] });
        }
      }

      // Summary
      if (driftEntries.length === 0) {
        output.log(`  no drift detected`);
      } else {
        output.log('');
        output.log(`  ${driftEntries.length} drift(s):`);
        const byType = {
          new: [] as string[],
          source: [] as string[],
          output: [] as string[],
          orphan: [] as string[],
        };
        for (const e of driftEntries) byType[e.type].push(e.id);
        if (byType.new.length > 0) output.log(`    new      ${byType.new.join(', ')}`);
        if (byType.source.length > 0) output.log(`    source   ${byType.source.join(', ')}`);
        if (byType.output.length > 0) output.log(`    output   ${byType.output.join(', ')}`);
        if (byType.orphan.length > 0) output.log(`    orphan   ${byType.orphan.join(', ')}`);
      }

      // Write per-resource patch files + drift report when --output is provided
      if (patchOutputDir && patchesByResource.size > 0) {
        const clientDir = path.join(patchOutputDir, `${clientId}.${scope}`);
        await mkdir(clientDir, { recursive: true });

        // Write individual patch files per resource
        for (const [resourceId, filePatches] of patchesByResource) {
          const resourceDir = path.join(clientDir, resourceId);
          await mkdir(resourceDir, { recursive: true });
          for (const [fileKey, rawPatch] of filePatches) {
            // fileKey is "source/prompt.yaml" or "output/review/SKILL.md"
            const patchFileName = fileKey.replace(/\//g, '--') + '.patch';
            await writeFile(path.join(resourceDir, patchFileName), rawPatch);
          }
        }

        // Write drift-report.md with formatted inline diffs
        const reportLines = [
          `# Drift Report: ${clientId} (${scope})`,
          '',
          `Generated: ${new Date().toISOString()}`,
          '',
        ];
        for (const entry of driftEntries) {
          reportLines.push(`## [${entry.type.toUpperCase()}] ${entry.id}`);
          reportLines.push('');
          const filePatches = patchesByResource.get(entry.id);
          if (filePatches) {
            // Filter patches to only show those matching this drift type (source/* or output/*)
            const prefix = entry.type === 'source' ? 'source/' : 'output/';
            for (const [fileKey, rawPatch] of filePatches) {
              if (!fileKey.startsWith(prefix)) continue;
              reportLines.push(`### ${fileKey}`);
              reportLines.push('```diff');
              reportLines.push(formatPatchForDisplay(rawPatch, ''));
              reportLines.push('```');
              reportLines.push('');
            }
          } else if (entry.type === 'new') {
            reportLines.push('New resource — not yet in manifest.');
            reportLines.push('');
          } else if (entry.type === 'orphan') {
            reportLines.push('Resource removed from sources but still in manifest.');
            reportLines.push('');
          }
        }
        await writeFile(path.join(clientDir, 'drift-report.md'), reportLines.join('\n'));

        // Write manifest.json for machine consumption
        const manifest = {
          client: clientId,
          scope,
          generated: new Date().toISOString(),
          drifts: driftEntries.map((e) => {
            const prefix = e.type === 'source' ? 'source/' : 'output/';
            const resourcePatches = patchesByResource.get(e.id);
            const matchingPatches = resourcePatches
              ? [...resourcePatches.keys()].filter((k) => k.startsWith(prefix))
              : [];
            return { type: e.type, id: e.id, files: e.files, patches: matchingPatches };
          }),
        };
        await writeFile(
          path.join(clientDir, 'manifest.json'),
          JSON.stringify(manifest, null, 2) + '\n'
        );

        output.log(`  output → ${clientDir}/`);
      }
    }
  }
}

// ─── Section 10: Pull Command (Selective Prose Merge) ───────────────────────

/**
 * Reads locally-edited client skill files and merges prose changes back into
 * canonical YAML resources. Only merges safe prose sections (name, description,
 * system message, user message, guidance). Structured metadata (arguments,
 * chains, gates) is never modified.
 */
async function pullCommand(opts: SkillsSyncOptions, output: SkillsSyncOutput): Promise<void> {
  const config = await loadSyncConfig();
  const cliScope = opts.scope;
  const clientIds =
    opts.client === 'all' || !opts.client ? Object.keys(CLIENT_REGISTRY) : [opts.client];

  const filters: LoadFilters = {};
  if (opts.resourceType) filters.resourceType = opts.resourceType;
  if (opts.id) filters.id = opts.id;
  const resources = await loadAllResources(filters, output, opts.dbManager);
  const targetScopes: Array<'user' | 'project'> = cliScope ? [cliScope] : ['user', 'project'];

  for (const clientId of clientIds) {
    const clientConfig = resolveClientConfig(clientId, config);
    if (!clientConfig) {
      throw usageError(
        `Unknown client: ${clientId} (available: ${Object.keys(CLIENT_REGISTRY).join(', ')}, all)`
      );
    }
    const selection = resolveClientResourceSelection(config, clientId);
    const ignoreSelection = opts.id != null;
    if (!ignoreSelection && selection.mode === 'unregistered') {
      output.log(`${clientId}: skipped — no registrations in skills-sync.yaml`);
      continue;
    }

    const idCounts = new Map<string, number>();
    for (const r of resources) {
      if (r.resourceType === 'prompt') idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
    }
    const duplicateIds = new Set(
      [...idCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id)
    );

    for (const scope of targetScopes) {
      const baseDir = resolveOutputDir(clientConfig, scope);
      const scopedResources = filterResourcesForScope(resources, scope, selection, ignoreSelection);

      let pullCount = 0;

      for (const ir of scopedResources) {
        // Only pull the main SKILL.md, not tool files
        const outputFiles = adaptResource(ir, clientConfig, duplicateIds);
        const skillFile = outputFiles.find((f) => f.relativePath.endsWith('/SKILL.md'));
        if (!skillFile) continue;

        const fullPath = path.join(baseDir, skillFile.relativePath);
        const existing = await readOptionalFile(fullPath);
        if (!existing || existing === skillFile.content) continue;

        // Parse the local (edited) SKILL.md
        const parsed = parseSkillMd(existing);

        // Build reverse argument mapping for template decompilation
        const reverseArgs = ir.arguments.map((a, i) => ({ ...a, index: i }));
        const isClaudeCode = clientConfig.adapter === 'claude-code';

        // Forward-compile canonical sections to detect actual edits.
        // Comparing parsed SKILL.md against expected output (not raw canonical)
        // prevents false positives from lossy forward compilation (Nunjucks conditionals).
        const expected = buildExpectedSectionContent(ir, isClaudeCode);

        // Compute diffs for each prose section
        const changes: Array<{
          section: string;
          file: string;
          oldContent: string;
          newContent: string;
        }> = [];

        // Name / description from frontmatter → prompt.yaml
        if (parsed.name && parsed.name !== ir.name) {
          changes.push({
            section: 'name',
            file: 'prompt.yaml',
            oldContent: ir.name,
            newContent: parsed.name,
          });
        }
        if (parsed.description && parsed.description !== ir.description) {
          changes.push({
            section: 'description',
            file: 'prompt.yaml',
            oldContent: ir.description,
            newContent: parsed.description,
          });
        }

        // System message (## Instructions) → system-message.md
        if (parsed.systemMessage !== null && ir.systemMessage !== null) {
          // Skip if section matches expected output (user didn't edit — preserves conditionals)
          if (parsed.systemMessage.trim() !== expected.systemMessage?.trim()) {
            const reversed = isClaudeCode
              ? reverseCompileTemplate(parsed.systemMessage, reverseArgs)
              : reverseCompilePlaintext(parsed.systemMessage);
            changes.push({
              section: 'systemMessage',
              file: 'system-message.md',
              oldContent: ir.systemMessage,
              newContent: reversed,
            });
          }
        }

        // User message (## Usage) → user-message.md
        if (parsed.userMessage !== null && ir.userMessage !== null) {
          if (parsed.userMessage.trim() !== expected.userMessage?.trim()) {
            const reversed = isClaudeCode
              ? reverseCompileTemplate(parsed.userMessage, reverseArgs)
              : reverseCompilePlaintext(parsed.userMessage);
            changes.push({
              section: 'userMessage',
              file: 'user-message.md',
              oldContent: ir.userMessage,
              newContent: reversed,
            });
          }
        }

        // Guidance (## Guidance) → guidance.md
        if (parsed.guidanceContent !== null && ir.guidanceContent !== null) {
          if (parsed.guidanceContent.trim() !== expected.guidanceContent?.trim()) {
            const reversed = isClaudeCode
              ? reverseCompileTemplate(parsed.guidanceContent, reverseArgs)
              : reverseCompilePlaintext(parsed.guidanceContent);
            changes.push({
              section: 'guidanceContent',
              file: 'guidance.md',
              oldContent: ir.guidanceContent,
              newContent: reversed,
            });
          }
        }

        if (changes.length === 0) continue;

        output.log(`\n  ${ir.id} — ${changes.length} prose change(s):`);
        for (const change of changes) {
          output.log(`    [${change.section}] → ${change.file}`);
        }

        if (opts.preview) {
          for (const change of changes) {
            const patch = createTwoFilesPatch(
              `canonical/${change.file}`,
              `local/${change.file}`,
              change.oldContent,
              change.newContent
            );
            output.log(formatPatchForDisplay(patch));
          }
          continue;
        }

        if (opts.dryRun) {
          pullCount++;
          continue;
        }

        // Write changes to canonical YAML files
        const resourceDir = path.dirname(ir.sourcePaths[0] ?? '');
        if (!resourceDir) continue;

        // Map section names to canonical IR fields for Nunjucks detection
        const sectionToCanonical: Record<string, string | null> = {
          systemMessage: ir.systemMessage,
          userMessage: ir.userMessage,
          guidanceContent: ir.guidanceContent,
        };

        let wroteAny = false;
        for (const change of changes) {
          // Check if canonical content has Nunjucks control flow — skip to prevent destruction
          const canonical = sectionToCanonical[change.section];
          if (canonical && hasNunjucksControlFlow(canonical)) {
            const canonicalPath = path.join(resourceDir, change.file);
            output.warn(
              `SKIPPED [${change.section}] for ${ir.id} — canonical contains Nunjucks conditionals ({%% if %%})\n` +
                `  Pull would destroy template logic. Edit the canonical file directly:\n` +
                `  → ${canonicalPath}`
            );
            continue;
          }

          if (change.section === 'name' || change.section === 'description') {
            // Update prompt.yaml field
            const yamlPath = ir.sourcePaths[0] ?? '';
            if (!yamlPath) continue;
            const yamlContent = await readOptionalFile(yamlPath);
            if (!yamlContent) continue;
            const doc = yaml.load(yamlContent) as Record<string, unknown>;
            doc[change.section] = change.newContent;
            await writeFile(yamlPath, yaml.dump(doc, { lineWidth: 120 }));
            output.log(`    wrote ${change.section} → ${yamlPath}`);
            wroteAny = true;
          } else {
            // Write prose file (system-message.md, user-message.md, guidance.md)
            const filePath = path.join(resourceDir, change.file);
            await writeFile(filePath, change.newContent);
            output.log(`    wrote ${change.file} → ${filePath}`);
            wroteAny = true;
          }
        }
        if (wroteAny) pullCount++;
      }

      if (pullCount === 0) {
        output.log(`${clientId} (${scope}): no prose changes to pull`);
      } else {
        output.log(`\n${clientId} (${scope}): pulled ${pullCount} resource(s)`);
      }
    }
  }
}

// ─── Section 10c: Import Command (Scaffold from SKILL.md) ──────────────────

/**
 * Creates a new canonical YAML resource from an arbitrary SKILL.md file.
 * Generates a scaffold with prose content extracted and arguments inferred.
 * Detects companion gates/ and resources/ directories for round-trip fidelity:
 * - gates/{id}/ → copied to canonical gates, added to gateConfiguration.include
 * - resources/{stepId}/ → copied as sub-prompts, added to chainSteps
 */
async function cloneCommand(opts: SkillsSyncOptions, output: SkillsSyncOutput): Promise<void> {
  const filePath = opts.file;
  if (!filePath) {
    throw usageError('clone requires --file <path> to a SKILL.md');
  }

  const content = await readOptionalFile(filePath);
  if (!content) {
    throw usageError(`File not found: ${filePath}`);
  }

  const parsed = parseSkillMd(content);
  const resourceType = opts.resourceType ?? 'prompt';
  const category = opts.category ?? 'general';
  const resourceId = opts.id ?? path.basename(path.dirname(filePath));

  if (!resourceId || resourceId === '.' || resourceId === '/') {
    throw usageError('Could not infer resource ID. Use --id <name> to specify.');
  }

  const serverRoot = resolveServerRoot();
  const typeDir =
    resourceType === 'prompt'
      ? 'prompts'
      : resourceType === 'gate'
        ? 'gates'
        : resourceType === 'framework'
          ? 'frameworks'
          : 'styles';
  const targetDir =
    resourceType === 'prompt'
      ? path.join(serverRoot, 'resources', typeDir, category, resourceId)
      : path.join(serverRoot, 'resources', typeDir, resourceId);

  if (existsSync(targetDir) && !opts.force) {
    throw usageError(`Target directory exists: ${targetDir}. Use --force to overwrite.`);
  }

  // Reverse-compile templates if arguments were detected
  const reverseArgs = parsed.arguments.map((a) => ({
    name: a.name,
    type: 'string' as const,
    description: a.description,
    required: a.required,
  }));
  const isClaudeCode = parsed.format === 'claude-code';

  let systemMessage = parsed.systemMessage;
  let userMessage = parsed.userMessage;
  if (systemMessage && isClaudeCode) {
    systemMessage = reverseCompileTemplate(systemMessage, reverseArgs);
  } else if (systemMessage) {
    systemMessage = reverseCompilePlaintext(systemMessage);
  }
  if (userMessage && isClaudeCode) {
    userMessage = reverseCompileTemplate(userMessage, reverseArgs);
  } else if (userMessage) {
    userMessage = reverseCompilePlaintext(userMessage);
  }

  if (opts.dryRun) {
    output.log(`[dry-run] Would create ${resourceType} "${resourceId}" at ${targetDir}`);
    output.log(`  name: ${parsed.name}`);
    output.log(`  description: ${parsed.description}`);
    if (parsed.arguments.length > 0) {
      output.log(`  arguments: ${parsed.arguments.map((a) => a.name).join(', ')}`);
    }
    output.log(`  format detected: ${parsed.format}`);
    return;
  }

  type ImportValidationTarget = {
    resourceType: ResourceVerificationType;
    resourceId: string;
    filePath: string;
  };

  const verificationService = new ResourceVerificationService();
  const mutationTransaction = new ResourceMutationTransaction();
  const skillDir = path.dirname(filePath);
  const companionGatesDir = path.join(skillDir, 'gates');
  const companionResourcesDir = path.join(skillDir, 'resources');
  const gateDirEntries =
    resourceType === 'prompt' && existsSync(companionGatesDir)
      ? (await readdir(companionGatesDir, { withFileTypes: true })).filter((entry) =>
          entry.isDirectory()
        )
      : [];
  const stepDirEntries =
    resourceType === 'prompt' && existsSync(companionResourcesDir)
      ? (await readdir(companionResourcesDir, { withFileTypes: true })).filter((entry) =>
          entry.isDirectory()
        )
      : [];

  const resourceVerificationType: ResourceVerificationType =
    resourceType === 'prompt'
      ? 'prompts'
      : resourceType === 'gate'
        ? 'gates'
        : resourceType === 'framework'
          ? 'frameworks'
          : 'styles';
  const yamlFileName =
    resourceType === 'prompt'
      ? 'prompt.yaml'
      : resourceType === 'gate'
        ? 'gate.yaml'
        : resourceType === 'framework'
          ? 'framework.yaml'
          : 'style.yaml';

  const mutationTargets = new Map<string, { path: string; kind: 'directory' }>();
  mutationTargets.set(targetDir, { path: targetDir, kind: 'directory' });
  if (resourceType === 'prompt') {
    const categoryDir = path.join(serverRoot, 'resources', 'prompts', category);
    mutationTargets.set(categoryDir, { path: categoryDir, kind: 'directory' });
  }
  for (const gateEntry of gateDirEntries) {
    const gateTargetDir = path.join(serverRoot, 'resources', 'gates', gateEntry.name);
    mutationTargets.set(gateTargetDir, { path: gateTargetDir, kind: 'directory' });
  }
  for (const stepEntry of stepDirEntries) {
    const stepTargetDir = path.join(targetDir, stepEntry.name);
    mutationTargets.set(stepTargetDir, { path: stepTargetDir, kind: 'directory' });
  }

  let validationTargets: ImportValidationTarget[] = [];
  const transactionResult = await mutationTransaction.run({
    targets: [...mutationTargets.values()],
    mutate: async () => {
      const localValidationTargets: ImportValidationTarget[] = [];

      await mkdir(targetDir, { recursive: true });

      const yamlDoc: Record<string, unknown> = {
        id: resourceId,
        name: parsed.name || resourceId,
        ...(resourceType === 'prompt' ? { category } : {}),
        description: parsed.description || `Imported from ${path.basename(filePath)}`,
      };

      if (systemMessage) {
        yamlDoc['systemMessageFile'] = 'system-message.md';
      }
      if (userMessage) {
        yamlDoc['userMessageTemplateFile'] = 'user-message.md';
      }
      if (reverseArgs.length > 0) {
        yamlDoc['arguments'] = reverseArgs.map((a) => ({
          name: a.name,
          type: a.type,
          description: a.description,
          ...(a.required ? { required: true } : {}),
        }));
      }

      const primaryYamlPath = path.join(targetDir, yamlFileName);
      await writeFile(primaryYamlPath, yaml.dump(yamlDoc, { lineWidth: 120 }));
      output.log(`  wrote ${yamlFileName}`);
      localValidationTargets.push({
        resourceType: resourceVerificationType,
        resourceId,
        filePath: primaryYamlPath,
      });

      if (systemMessage) {
        await writeFile(path.join(targetDir, 'system-message.md'), systemMessage);
        output.log(`  wrote system-message.md`);
      }
      if (userMessage) {
        await writeFile(path.join(targetDir, 'user-message.md'), userMessage);
        output.log(`  wrote user-message.md`);
      }

      if (parsed.guidanceContent && (resourceType === 'gate' || resourceType === 'style')) {
        const guidanceContent = isClaudeCode
          ? reverseCompileTemplate(parsed.guidanceContent, reverseArgs)
          : reverseCompilePlaintext(parsed.guidanceContent);
        await writeFile(path.join(targetDir, 'guidance.md'), guidanceContent);
        output.log(`  wrote guidance.md`);
      }

      if (resourceType === 'prompt') {
        const gateIds: string[] = [];

        for (const gateEntry of gateDirEntries) {
          const gateId = gateEntry.name;
          gateIds.push(gateId);
          const gateTargetDir = path.join(serverRoot, 'resources', 'gates', gateId);
          if (existsSync(gateTargetDir) && !opts.force) {
            output.log(`  skip gate ${gateId} (exists, use --force)`);
            continue;
          }

          await mkdir(gateTargetDir, { recursive: true });
          const gateYaml = await readOptionalFile(
            path.join(companionGatesDir, gateId, 'gate.yaml')
          );
          if (gateYaml) {
            const gateYamlPath = path.join(gateTargetDir, 'gate.yaml');
            await writeFile(gateYamlPath, gateYaml);
            output.log(`  wrote gates/${gateId}/gate.yaml`);
            localValidationTargets.push({
              resourceType: 'gates',
              resourceId: gateId,
              filePath: gateYamlPath,
            });
          }

          const gateGuidance = await readOptionalFile(
            path.join(companionGatesDir, gateId, 'guidance.md')
          );
          if (gateGuidance) {
            await writeFile(path.join(gateTargetDir, 'guidance.md'), gateGuidance);
            output.log(`  wrote gates/${gateId}/guidance.md`);
          }
        }

        if (gateIds.length > 0) {
          yamlDoc['gateConfiguration'] = { include: gateIds };
          const inlineCriteria = parsed.qualityGates
            .filter((g) => g.source === 'inline')
            .map((g) => g.id);
          if (inlineCriteria.length > 0) {
            (yamlDoc['gateConfiguration'] as Record<string, unknown>)['inline'] = inlineCriteria;
          }
          await writeFile(primaryYamlPath, yaml.dump(yamlDoc, { lineWidth: 120 }));
          output.log(`  updated ${yamlFileName} with gateConfiguration`);
        }

        const chainSteps: Array<Record<string, unknown>> = [];
        for (const stepEntry of stepDirEntries) {
          const stepId = stepEntry.name;
          const stepTargetDir = path.join(targetDir, stepId);
          if (existsSync(stepTargetDir) && !opts.force) {
            output.log(`  skip resource ${stepId} (exists, use --force)`);
            continue;
          }

          await mkdir(stepTargetDir, { recursive: true });
          const stepYaml = await readOptionalFile(
            path.join(companionResourcesDir, stepId, 'prompt.yaml')
          );
          if (stepYaml) {
            const stepYamlPath = path.join(stepTargetDir, 'prompt.yaml');
            await writeFile(stepYamlPath, stepYaml);
            output.log(`  wrote resources/${stepId}/prompt.yaml`);

            let stepPromptId = stepId;
            let stepName = stepId;
            const loaded = yaml.load(stepYaml);
            if (loaded && typeof loaded === 'object') {
              const stepDoc = loaded as Record<string, unknown>;
              if (typeof stepDoc['id'] === 'string' && stepDoc['id'].trim().length > 0) {
                stepPromptId = stepDoc['id'];
              }
              if (typeof stepDoc['name'] === 'string' && stepDoc['name'].trim().length > 0) {
                stepName = stepDoc['name'];
              }
            }

            chainSteps.push({
              promptId: `${category}/${resourceId}/${stepId}`,
              stepName,
            });
            localValidationTargets.push({
              resourceType: 'prompts',
              resourceId: stepPromptId,
              filePath: stepYamlPath,
            });
          }

          const stepSys = await readOptionalFile(
            path.join(companionResourcesDir, stepId, 'system-message.md')
          );
          if (stepSys) {
            await writeFile(path.join(stepTargetDir, 'system-message.md'), stepSys);
            output.log(`  wrote resources/${stepId}/system-message.md`);
          }
          const stepUser = await readOptionalFile(
            path.join(companionResourcesDir, stepId, 'user-message.md')
          );
          if (stepUser) {
            await writeFile(path.join(stepTargetDir, 'user-message.md'), stepUser);
            output.log(`  wrote resources/${stepId}/user-message.md`);
          }
        }

        if (chainSteps.length > 0) {
          yamlDoc['chainSteps'] = chainSteps;
          await writeFile(primaryYamlPath, yaml.dump(yamlDoc, { lineWidth: 120 }));
          output.log(`  updated ${yamlFileName} with chainSteps`);
        }
      }

      validationTargets = localValidationTargets;
      return { validationTargets: localValidationTargets };
    },
    validate: async () => {
      for (const target of validationTargets) {
        const result = verificationService.validateFile(
          target.resourceType,
          target.resourceId,
          target.filePath
        );
        if (!result.valid) {
          throw new ResourceVerificationError(verificationService.toFailurePayload(result, false));
        }
      }

      const primaryValidation = verificationService.validateFile(
        resourceVerificationType,
        resourceId,
        path.join(targetDir, yamlFileName)
      );
      if (!primaryValidation.valid) {
        throw new ResourceVerificationError(
          verificationService.toFailurePayload(primaryValidation, false)
        );
      }
      return primaryValidation;
    },
  });

  if (!transactionResult.success) {
    if (transactionResult.verificationFailure) {
      throw new Error(
        `Clone validation failed\n${verificationService.formatFailurePayload(
          transactionResult.verificationFailure
        )}`
      );
    }
    throw new Error(transactionResult.error ?? 'Clone failed');
  }

  output.log(`\nImported ${resourceType} "${resourceId}" → ${targetDir}`);
}

// ─── Section 11: CLI Main ───────────────────────────────────────────────────

export function parseSkillsSyncArgs(argv: string[]): SkillsSyncOptions {
  const { values, positionals } = parseArgs({
    args: argv.slice(2),
    options: {
      client: { type: 'string' },
      scope: { type: 'string' },
      'resource-type': { type: 'string' },
      id: { type: 'string' },
      prune: { type: 'boolean' },
      'no-prune': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      output: { type: 'string' },
      file: { type: 'string' },
      category: { type: 'string' },
      preview: { type: 'boolean' },
      force: { type: 'boolean' },
      json: { type: 'boolean' },
      verbose: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });

  return {
    command: positionals[0] ?? 'help',
    client: values.client,
    scope: values.scope as 'user' | 'project' | undefined,
    resourceType: values['resource-type'] as ResourceType | undefined,
    id: values.id,
    prune: values['no-prune'] ? false : values.prune,
    dryRun: values['dry-run'] ?? false,
    output: values.output,
    file: values.file,
    category: values.category,
    preview: values.preview ?? false,
    force: values.force ?? false,
    json: values.json ?? false,
    verbose: values.verbose ?? false,
  };
}

export function printSkillsSyncHelp(): void {
  DEFAULT_OUTPUT.log(`
skills-sync — Export canonical resources to client skill packages

Usage:
  tsx scripts/skills-sync.ts <command> [options]

Commands:
  export    Export resources to client skill directories
  sync      Reconcile exported skills to registrations (export + prune)
  diff      Show drift between canonical sources and exported skills
  pull      Merge local prose edits back into canonical YAML
  clone     Create canonical resource from an external SKILL.md

Options:
  --client <id|all>           Target client (${Object.keys(CLIENT_REGISTRY).join(', ')}, all)
  --scope <user|project>      Output scope (default: user)
  --resource-type <type>      Filter by type (prompt, gate, methodology, style)
  --id <resourceId>           Filter to single resource
  --prune                     For sync: delete stale managed skills (default)
  --no-prune                  For sync: skip stale managed skill deletion
  --dry-run                   Show what would change without writing
  --output <dir>              Write .patch files to directory (diff command)
  --preview                   Show diffs without writing (pull command)
  --file <path>               Source SKILL.md file (clone command)
  --category <name>           Target category (clone command, default: general)
  --force                     Overwrite existing resource (clone command)
  --json                      Emit machine-readable JSON output summary
  --verbose                   Include infrastructure logs (DB/indexing details)
`);
}

export async function runSkillsSyncCommand(
  opts: SkillsSyncOptions,
  output: SkillsSyncOutput = DEFAULT_OUTPUT
): Promise<void> {
  validateSkillsSyncOptions(opts);

  switch (opts.command) {
    case 'export':
      await exportCommand(opts, output);
      break;
    case 'sync':
      await syncCommand({ ...opts, prune: opts.prune ?? true }, output);
      break;
    case 'diff':
      await diffCommand(opts, output);
      break;
    case 'patch':
      // Backward compat: 'patch' is now 'diff --output'
      await diffCommand(
        { ...opts, output: opts.output ?? path.join(getServerRoot(), 'runtime-state', 'patches') },
        output
      );
      break;
    case 'pull':
      await pullCommand(opts, output);
      break;
    case 'clone':
      await cloneCommand(opts, output);
      break;
    case 'help':
      printSkillsSyncHelp();
      break;
    default:
      throw usageError(`Unknown command: ${opts.command}. Run skills-sync help for usage.`);
  }
}

export async function runSkillsSyncFromArgv(argv: string[]): Promise<void> {
  await runSkillsSyncCommand(parseSkillsSyncArgs(argv));
}

export function listSupportedSkillsSyncClients(): string[] {
  return Object.keys(CLIENT_REGISTRY);
}

export function getSkillsSyncConfigPath(): string {
  return getConfigPath();
}

// @internal — exported for testing
export { parseSkillMd, hasNunjucksControlFlow };
export type { ParsedSkillMd };
