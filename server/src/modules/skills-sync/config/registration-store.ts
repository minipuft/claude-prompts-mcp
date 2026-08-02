// @lifecycle canonical - skills-sync registration config persistence helpers.
import { readFile, writeFile } from 'node:fs/promises';

import * as yaml from 'js-yaml';

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

function parseConfig(raw: string): SkillsSyncConfigFile {
  const parsed = yaml.load(raw);
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

  const serialized = yaml.dump(config, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  await writeFile(configPath, `${CONFIG_HEADER}\n${serialized}`, 'utf-8');

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
