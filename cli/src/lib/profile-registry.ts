import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { writeConfigBytesAtomic, writeConfigKeyAtomic } from '@cli-shared/config-operations.js';
import { findWorkspaceConfigFiles, parseConfigText } from '@shared/utils/config-file-format.js';

import { TYPE_CONFIG } from './types.js';
import type { ResourceType } from './types.js';
import { discoverResourcePaths, resolveResourceDir } from './workspace.js';

/** The registry's file name; the server reads the same file read-only beside the workspace. */
export const PROFILE_REGISTRY_FILE_NAME = 'workspaces.jsonc';

const LABEL_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const LABEL_RULE = 'lowercase letters, digits, "-" and "_", starting with a letter or digit';

/** One registered profile: its label, the folder text as written, and that folder resolved. */
export interface ProfileEntry {
  label: string;
  written: string;
  folder: string;
}

/** Where a workspace's registry lives and what it holds; `entries` is null when the file is absent. */
export interface ProfileRegistry {
  parent: string;
  path: string;
  entries: ProfileEntry[] | null;
}

export function isValidLabel(label: string): boolean {
  return LABEL_PATTERN.test(label);
}

/**
 * Read the registry beside `workspace`: `<dirname(workspace)>/workspaces.jsonc`, never anywhere
 * else.
 *
 * @throws {Error} When the file exists but is not a JSONC object of label to folder text
 */
export function readProfileRegistry(workspace: string): ProfileRegistry {
  const parent = dirname(resolve(workspace));
  const path = join(parent, PROFILE_REGISTRY_FILE_NAME);
  if (!existsSync(path)) return { parent, path, entries: null };

  let parsed: unknown;
  try {
    parsed = parseConfigText(readFileSync(path, 'utf8'), 'jsonc');
  } catch (error) {
    throw new Error(`${path} could not be read: ${errorText(error)}.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} could not be read: expected an object of label to folder.`);
  }
  const entries = Object.entries(parsed).map(([label, written]) => {
    if (typeof written !== 'string') {
      throw new Error(`${path} could not be read: label '${label}' does not name a folder.`);
    }
    return { label, written, folder: resolve(parent, written) };
  });
  return { parent, path, entries };
}

export function noRegistryMessage(parent: string): string {
  return `no ${PROFILE_REGISTRY_FILE_NAME} beside ${parent}; run cpm workspace add <label> <dir>`;
}

/** The entry whose folder is `workspace`, the way the server matches it. */
export function currentEntry(
  entries: readonly ProfileEntry[],
  workspace: string
): ProfileEntry | undefined {
  const here = resolve(workspace);
  return entries.find((entry) => entry.folder === here);
}

/**
 * The folder `MCP_RESOURCES_PATH` names as a profile: the variable's folder, or its parent when
 * the folder is literally named `resources` (a profile holds `resources/<type>/`).
 */
export function resourcesPathFolder(resourcesPath: string): string {
  const folder = resolve(expandHome(resourcesPath));
  return basename(folder) === 'resources' ? dirname(folder) : folder;
}

/** True when a registered folder equals `path` or contains it. */
export function isHeldByRegistry(entries: readonly ProfileEntry[], path: string): boolean {
  const target = resolve(expandHome(path));
  return entries.some((entry) => target === entry.folder || target.startsWith(entry.folder + sep));
}

/**
 * Why `folder` cannot be registered under `label`, or undefined when it can.
 * The folder must already exist and sit directly in the registry's parent.
 */
export function refuseAdd(
  registry: ProfileRegistry,
  label: string,
  folder: string
): string | undefined {
  if (!isValidLabel(label)) return `Label '${label}' is not allowed: use ${LABEL_RULE}.`;
  const existing = registry.entries?.find((entry) => entry.label === label);
  if (existing !== undefined) {
    return `Label '${label}' is already registered for ${existing.folder}; remove it first.`;
  }
  if (dirname(folder) !== registry.parent) {
    return `${folder} is not directly inside ${registry.parent}; a profile folder must sit beside ${PROFILE_REGISTRY_FILE_NAME}.`;
  }
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    return `${folder} does not exist or is not a folder; create it first.`;
  }
  return undefined;
}

/**
 * Add `label → ./<folder name>` to the registry, creating the file when absent. An existing file is
 * edited as text, so its comments and layout survive.
 */
export function writeProfileEntry(
  registry: ProfileRegistry,
  label: string,
  folder: string
): string {
  const written = `./${basename(folder)}`;
  if (registry.entries === null) {
    writeConfigBytesAtomic(registry.path, `${JSON.stringify({ [label]: written }, null, 2)}\n`);
  } else {
    writeConfigKeyAtomic(registry.path, label, written);
  }
  return written;
}

/** Drop `label` from the registry text, leaving every other line as written. */
export function removeProfileEntry(registry: ProfileRegistry, label: string): void {
  writeConfigKeyAtomic(registry.path, label, undefined);
}

export interface ProfileSummary {
  config: string | null;
  counts: Record<ResourceType, number>;
}

/** The profile's config file and how many of each resource type the CLI's discovery finds in it. */
export function summarizeProfile(folder: string): ProfileSummary {
  const counts = {} as Record<ResourceType, number>;
  for (const type of Object.keys(TYPE_CONFIG) as ResourceType[]) {
    counts[type] = countResources(folder, type);
  }
  return { config: findWorkspaceConfigFiles(folder)[0] ?? null, counts };
}

function countResources(folder: string, type: ResourceType): number {
  let baseDir: string;
  try {
    baseDir = resolveResourceDir(folder, type);
  } catch {
    return 0;
  }
  const config = TYPE_CONFIG[type];
  return discoverResourcePaths(baseDir, config.entryFile, config.nested).length;
}

function expandHome(path: string): string {
  return path.startsWith('~') ? path.replace('~', process.env['HOME'] ?? '') : path;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
