// @lifecycle canonical - skills-sync registration config persistence helpers.
import { readFile, writeFile } from 'node:fs/promises';

import { parseYamlOrThrow } from '#shared/utils/yaml/index.js';
import { serializeYamlPreservingSource } from '#shared/utils/yaml/yaml-document-writer.js';

export type RegistrationScope = 'user' | 'project';

interface ScopedRegistration {
  user?: string[];
  project?: string[];
}

interface SkillsSyncConfigFile {
  registrations?: Record<string, ScopedRegistration | 'all'>;
  exports?: ScopedRegistration | 'all';
  overrides?: Record<string, unknown>;
}

export interface RegistrationMutation {
  clientId: string;
  scope: RegistrationScope;
  resourceKeys: string[];
}

export interface RegistrationMutationResult {
  updated: boolean;
  addedKeys: number;
}

const CONFIG_HEADER = `# Skills Sync Configuration
# Used by: npm run skills:export|sync|diff|patch|pull|import
#
# Client knowledge (adapters, output dirs, capabilities) is built into the CLI.
# This file controls WHAT to export. The CLI handles HOW.
`;

/**
 * Parsed with the `yaml` package, the same parser `serializeYamlPreservingSource` diffs against,
 * so a value both sides read identically never registers as a change.
 */
function parseConfig(raw: string): SkillsSyncConfigFile {
  const parsed = parseYamlOrThrow<unknown>(raw);
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed;
}

function normalizeList(values: string[] | undefined): string[] {
  if (values == null) return [];
  return [...new Set(values.filter((value) => value.length > 0))];
}

function ensureScopedRegistration(
  registrations: Record<string, ScopedRegistration | 'all'>,
  clientId: string
): ScopedRegistration | null {
  const current = registrations[clientId];
  if (current === 'all') {
    return null;
  }

  if (current == null || typeof current !== 'object' || Array.isArray(current)) {
    registrations[clientId] = {};
  }

  return registrations[clientId] as ScopedRegistration;
}

function addResourceKeys(
  scoped: ScopedRegistration,
  scope: RegistrationScope,
  resourceKeys: string[]
): number {
  const existing = normalizeList(scoped[scope]);
  const nextSet = new Set(existing);
  let added = 0;

  for (const key of resourceKeys) {
    if (nextSet.has(key)) continue;
    nextSet.add(key);
    added++;
  }

  // A scope that gained nothing keeps its authored list: one batch spans every exported client,
  // and a key registered for one must not re-sort another's hand-ordered list.
  if (added === 0) return 0;
  scoped[scope] = [...nextSet].sort();
  return added;
}

function applyMutations(
  config: SkillsSyncConfigFile,
  mutations: RegistrationMutation[]
): RegistrationMutationResult {
  if (config.registrations == null || typeof config.registrations !== 'object') {
    config.registrations = {};
  }

  let addedKeys = 0;

  for (const mutation of mutations) {
    const { clientId, scope, resourceKeys } = mutation;
    if (resourceKeys.length === 0) continue;

    const scoped = ensureScopedRegistration(config.registrations, clientId);
    if (scoped == null) continue;
    addedKeys += addResourceKeys(scoped, scope, resourceKeys);
  }

  return { updated: addedKeys > 0, addedKeys };
}

export async function applyRegistrationMutations(
  configPath: string,
  mutations: RegistrationMutation[]
): Promise<RegistrationMutationResult> {
  if (mutations.length === 0) {
    return { updated: false, addedKeys: 0 };
  }

  const raw = await readFile(configPath, 'utf-8');
  const config = parseConfig(raw);
  const mutationResult = applyMutations(config, mutations);
  if (!mutationResult.updated) {
    return mutationResult;
  }

  // `skills-sync.yaml` is operator-edited, so its comments and key order survive the write. A key
  // added to a list is structural and takes the writer's document tier, which may re-pad a flow
  // list's brackets; the fixed header is written only when there was no prior layout to keep.
  const written = serializeYamlPreservingSource(config, raw);
  const content =
    written.fidelity === 'created' ? `${CONFIG_HEADER}\n${written.content}` : written.content;
  await writeFile(configPath, content, 'utf-8');

  return mutationResult;
}

export async function previewRegistrationMutations(
  configPath: string,
  mutations: RegistrationMutation[]
): Promise<RegistrationMutationResult> {
  if (mutations.length === 0) {
    return { updated: false, addedKeys: 0 };
  }

  const raw = await readFile(configPath, 'utf-8');
  const config = parseConfig(raw);
  return applyMutations(config, mutations);
}
