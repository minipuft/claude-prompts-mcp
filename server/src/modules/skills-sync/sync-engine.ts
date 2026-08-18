// @lifecycle canonical - Sync reconciliation + safe-prune planning for skills-sync.
import * as yaml from 'js-yaml';

export const SKILLS_SYNC_MANAGED_BY = 'claude-prompts-skills-sync';

export type SkillsSyncScope = 'user' | 'project';

export interface SyncManifestLikeEntry {
  outputFiles: string[];
}

export interface ManagedSkillMarker {
  managedBy: string;
  clientId: string;
  scope: SkillsSyncScope;
  resourceKey: string;
}

export type ManagedSkillDirMap = Map<string, Set<string>>;

export interface SyncPrunePlan {
  managedResourceKeys: string[];
  pruneResourceKeys: string[];
  pruneSkillDirs: string[];
}

interface SyncPrunePlanInput {
  desiredResourceKeys: Set<string>;
  manifestManagedSkillDirs: ManagedSkillDirMap;
  markerManagedSkillDirs: ManagedSkillDirMap;
}

interface ManagedMarkerInput {
  clientId: string;
  scope: SkillsSyncScope;
  resourceKey: string;
}

function addManagedSkillDir(
  managedSkillDirs: ManagedSkillDirMap,
  resourceKey: string,
  skillDir: string
): void {
  const existing = managedSkillDirs.get(resourceKey);
  if (existing != null) {
    existing.add(skillDir);
    return;
  }
  managedSkillDirs.set(resourceKey, new Set([skillDir]));
}

export function mergeManagedSkillDirMaps(
  left: ManagedSkillDirMap,
  right: ManagedSkillDirMap
): ManagedSkillDirMap {
  const merged: ManagedSkillDirMap = new Map();

  for (const [resourceKey, skillDirs] of left) {
    for (const skillDir of skillDirs) {
      addManagedSkillDir(merged, resourceKey, skillDir);
    }
  }

  for (const [resourceKey, skillDirs] of right) {
    for (const skillDir of skillDirs) {
      addManagedSkillDir(merged, resourceKey, skillDir);
    }
  }

  return merged;
}

export function collectManifestManagedSkillDirs(
  manifestEntries: Map<string, SyncManifestLikeEntry>
): ManagedSkillDirMap {
  const managedSkillDirs: ManagedSkillDirMap = new Map();

  for (const [resourceKey, entry] of manifestEntries) {
    for (const outputFile of entry.outputFiles) {
      const normalized = outputFile.replace(/\\/g, '/');
      const [skillDir] = normalized.split('/');
      if (skillDir == null || skillDir.length === 0 || skillDir === '.' || skillDir === '..') {
        continue;
      }
      addManagedSkillDir(managedSkillDirs, resourceKey, skillDir);
    }
  }

  return managedSkillDirs;
}

function parseManagedMarkerRecord(record: Record<string, unknown>): ManagedSkillMarker | null {
  const managedBy = record['managed-by'];
  if (managedBy !== SKILLS_SYNC_MANAGED_BY) return null;

  const clientId = record['managed-client'];
  if (typeof clientId !== 'string') return null;

  const scope = record['managed-scope'];
  if (scope !== 'user' && scope !== 'project') return null;

  const resourceKey = record['managed-resource-key'];
  if (typeof resourceKey !== 'string' || resourceKey.length === 0) return null;

  return {
    managedBy,
    clientId,
    scope,
    resourceKey,
  };
}

export function parseManagedSkillMarker(skillMarkdown: string): ManagedSkillMarker | null {
  const fmMatch = skillMarkdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fmMatch == null) return null;
  const frontmatterRaw = fmMatch[1];
  if (frontmatterRaw == null) return null;

  const frontmatter = yaml.load(frontmatterRaw);
  if (frontmatter == null || typeof frontmatter !== 'object' || Array.isArray(frontmatter))
    return null;

  return parseManagedMarkerRecord(frontmatter as Record<string, unknown>);
}

/**
 * The section this emitter always writes first, from the prompt's system message.
 *
 * It is the adoption key because it is the one structural fact every skill this
 * tool has ever emitted shares. Measured 2026-08-18 against a real pre-marker
 * orphan and a current managed skill: both lead with it, and both carry LATER
 * headings drawn from their own prompt bodies — so a broader "every heading is
 * one we emit" test would reject the orphans this exists to reach.
 */
const EMITTED_LEAD_SECTION = '## Instructions';

/**
 * Decide whether an unmarked skill directory was emitted by this tool.
 *
 * Structural on purpose: it asks "did we generate this?" rather than the proxy
 * "does a resource share this name?", so a hand-written skill cannot be claimed
 * by a name collision, and a directory whose canonical resource was since
 * renamed or deleted is still reachable.
 *
 * A true answer authorizes STAMPING a marker, never a deletion — a false
 * positive must cost a revertible edit, not someone's hand-written skill.
 */
export function isAdoptableSkillMarkdown(skillMarkdown: string): boolean {
  // Already ours by declaration; adoption is for the ones that predate markers.
  if (parseManagedSkillMarker(skillMarkdown) !== null) return false;

  const fmMatch = skillMarkdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fmMatch == null) return false;
  const frontmatterRaw = fmMatch[1];
  if (frontmatterRaw == null) return false;

  const frontmatter = yaml.load(frontmatterRaw);
  if (frontmatter == null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    return false;
  }
  const fm = frontmatter as Record<string, unknown>;
  if (typeof fm['name'] !== 'string' || fm['name'].length === 0) return false;
  if (typeof fm['description'] !== 'string' || fm['description'].length === 0) return false;

  const body = skillMarkdown.slice(fmMatch[0].length);
  const firstHeading = body.match(/^## .+$/m)?.[0]?.trim();
  return firstHeading === EMITTED_LEAD_SECTION;
}

export function buildSyncPrunePlan(input: SyncPrunePlanInput): SyncPrunePlan {
  const { desiredResourceKeys, manifestManagedSkillDirs, markerManagedSkillDirs } = input;
  const managedSkillDirs = mergeManagedSkillDirMaps(
    manifestManagedSkillDirs,
    markerManagedSkillDirs
  );

  const managedResourceKeys = [...managedSkillDirs.keys()].sort();
  const pruneResourceKeys = managedResourceKeys
    .filter((resourceKey) => !desiredResourceKeys.has(resourceKey))
    .sort();

  const pruneSkillDirSet = new Set<string>();
  for (const resourceKey of pruneResourceKeys) {
    const resourceSkillDirs = managedSkillDirs.get(resourceKey);
    if (resourceSkillDirs == null) continue;
    for (const skillDir of resourceSkillDirs) {
      pruneSkillDirSet.add(skillDir);
    }
  }

  return {
    managedResourceKeys,
    pruneResourceKeys,
    pruneSkillDirs: [...pruneSkillDirSet].sort(),
  };
}

export function injectManagedSkillMarker(
  skillMarkdown: string,
  marker: ManagedMarkerInput
): string {
  const fmMatch = skillMarkdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fmMatch == null) return skillMarkdown;
  const frontmatterRaw = fmMatch[1];
  if (frontmatterRaw == null) return skillMarkdown;

  const frontmatter = yaml.load(frontmatterRaw);
  if (frontmatter == null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    return skillMarkdown;
  }

  const fm = frontmatter as Record<string, unknown>;
  fm['managed-by'] = SKILLS_SYNC_MANAGED_BY;
  fm['managed-client'] = marker.clientId;
  fm['managed-scope'] = marker.scope;
  fm['managed-resource-key'] = marker.resourceKey;

  const rest = skillMarkdown.slice(fmMatch[0].length).replace(/^\n*/, '');
  const dumped = yaml.dump(fm, { lineWidth: 120 }).trim();
  return `---\n${dumped}\n---\n\n${rest}`;
}
