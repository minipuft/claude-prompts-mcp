import { resolve } from 'node:path';

import { output } from '../lib/output.js';
import {
  currentEntry,
  isHeldByRegistry,
  isValidLabel,
  LABEL_RULE,
  noRegistryMessage,
  readProfileRegistry,
  refuseAdd,
  removeProfileEntry,
  resourcesPathFolder,
  summarizeProfile,
  writeProfileEntry,
} from '../lib/profile-registry.js';
import type { ProfileEntry, ProfileRegistry } from '../lib/profile-registry.js';
import { resolveWorkspace } from '../lib/workspace.js';

type WorkspaceSubcommand = 'add' | 'remove' | 'list' | 'show' | 'use';

const SUBCOMMANDS: readonly WorkspaceSubcommand[] = ['add', 'remove', 'list', 'show', 'use'];

const USAGE =
  'Usage: cpm workspace <add <label> [dir]|remove <label>|list|show <label>|use <label>>';

interface WorkspaceOptions {
  workspace?: string;
  json: boolean;
  subcommand?: string;
  positionals: string[];
}

/** What one subcommand needs: the resolved workspace and the registry beside it. */
interface WorkspaceContext {
  options: WorkspaceOptions;
  workspace: string;
  registry: ProfileRegistry;
}

export async function workspace(options: WorkspaceOptions): Promise<number> {
  const sub = options.subcommand;
  if (!sub || !SUBCOMMANDS.includes(sub as WorkspaceSubcommand)) {
    console.error(sub ? `Unknown workspace subcommand: ${sub}\n${USAGE}` : USAGE);
    return 1;
  }

  const resolved = resolveWorkspace(options.workspace);
  let registry: ProfileRegistry;
  try {
    registry = readProfileRegistry(resolved);
  } catch (error) {
    return fail(options, error instanceof Error ? error.message : String(error));
  }
  const context: WorkspaceContext = { options, workspace: resolved, registry };

  switch (sub as WorkspaceSubcommand) {
    case 'add':
      return workspaceAdd(context);
    case 'remove':
      return workspaceRemove(context);
    case 'list':
      return workspaceList(context);
    case 'show':
      return workspaceShow(context);
    case 'use':
      return workspaceUse(context);
  }
}

/** `cpm workspace add <label> [dir]` — with no dir, the folder `MCP_RESOURCES_PATH` names. */
function workspaceAdd({ options, registry }: WorkspaceContext): number {
  const [label, dir] = options.positionals;
  if (!label) return fail(options, `${USAGE}\nA label is required.`);

  const resourcesPath = process.env['MCP_RESOURCES_PATH'];
  if (dir === undefined && !resourcesPath) {
    return fail(options, 'Give a directory or set MCP_RESOURCES_PATH.');
  }
  const folder = dir !== undefined ? resolve(dir) : resourcesPathFolder(resourcesPath as string);

  const refusal = refuseAdd(registry, label, folder);
  if (refusal !== undefined) return fail(options, refusal);

  const written = writeProfileEntry(registry, label, folder);
  if (options.json) {
    output({ label, folder, written, registry: registry.path }, { json: true });
  } else {
    console.log(`Registered '${label}' as ${written} in ${registry.path}.`);
  }
  return 0;
}

/** `cpm workspace remove <label>` — drops the entry; the folder stays on disk. */
function workspaceRemove({ options, registry }: WorkspaceContext): number {
  const found = requireEntry(registry, options, options.positionals[0]);
  if (typeof found === 'number') return found;
  if (!isValidLabel(found.label)) {
    return fail(
      options,
      `Label '${found.label}' does not follow the rule (${LABEL_RULE}); edit ${registry.path} by hand.`
    );
  }

  removeProfileEntry(registry, found.label);
  if (options.json) {
    output(
      { label: found.label, folder: found.folder, removed: true, registry: registry.path },
      { json: true }
    );
  } else {
    console.log(
      `Removed '${found.label}' from ${registry.path}; ${found.folder} was left in place.`
    );
  }
  return 0;
}

/** `cpm workspace list` — every label, the current one marked, then an unregistered resources folder. */
function workspaceList({ options, workspace, registry }: WorkspaceContext): number {
  const entries = registry.entries ?? [];
  const current = currentEntry(entries, workspace);
  const resourcesPath = process.env['MCP_RESOURCES_PATH'];
  const unregistered =
    resourcesPath && !isHeldByRegistry(entries, resourcesPath)
      ? resourcesPathFolder(resourcesPath)
      : null;

  if (options.json) {
    output(
      {
        registry: registry.path,
        exists: registry.entries !== null,
        workspaces: entries.map((entry) => ({
          label: entry.label,
          folder: entry.folder,
          current: entry === current,
        })),
        unregistered,
      },
      { json: true }
    );
    return 0;
  }

  if (registry.entries === null) {
    console.log(noRegistryMessage(registry.parent));
  } else {
    const width = Math.max(...entries.map((entry) => entry.label.length), 0);
    for (const entry of entries) {
      const marker = entry === current ? '  (current)' : '';
      console.log(`${entry.label.padEnd(width)}  ${entry.folder}${marker}`);
    }
  }
  if (unregistered !== null) {
    console.log(
      `\nunregistered:\n  ${unregistered}  (from MCP_RESOURCES_PATH; cpm workspace add <label>)`
    );
  }
  return 0;
}

/** `cpm workspace show <label>` — the folder, its config file and its resource counts. */
function workspaceShow({ options, registry }: WorkspaceContext): number {
  const found = requireEntry(registry, options, options.positionals[0]);
  if (typeof found === 'number') return found;

  const summary = summarizeProfile(found.folder);
  output(
    {
      label: found.label,
      folder: found.folder,
      config: summary.config ?? 'none',
      ...summary.counts,
    },
    { json: options.json }
  );
  return 0;
}

/** `cpm workspace use <label>` — prints the env line for the client; writes nothing. */
function workspaceUse({ options, registry }: WorkspaceContext): number {
  const found = requireEntry(registry, options, options.positionals[0]);
  if (typeof found === 'number') return found;

  const line = `MCP_WORKSPACE=${found.folder}`;
  const hint =
    "Set this in your MCP client's server env, in the env block of the claude-prompts server entry.";
  if (options.json) {
    output({ label: found.label, env: { MCP_WORKSPACE: found.folder }, hint }, { json: true });
  } else {
    console.log(line);
    console.log(hint);
  }
  return 0;
}

/** The entry named `label`, or the exit code after reporting why there is none. */
function requireEntry(
  registry: ProfileRegistry,
  options: WorkspaceOptions,
  label: string | undefined
): ProfileEntry | number {
  if (!label) return fail(options, `${USAGE}\nA label is required.`);
  if (registry.entries === null) return fail(options, noRegistryMessage(registry.parent));

  const found = registry.entries.find((entry) => entry.label === label);
  if (found !== undefined) return found;
  const known = registry.entries.map((entry) => entry.label).join(', ') || 'none';
  return fail(options, `No workspace labelled '${label}'; registered: ${known}.`);
}

function fail(options: WorkspaceOptions, message: string): number {
  if (options.json) {
    output({ error: message }, { json: true });
  } else {
    console.error(message);
  }
  return 1;
}
