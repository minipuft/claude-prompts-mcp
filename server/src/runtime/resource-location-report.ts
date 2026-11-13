// @lifecycle canonical - Collects each index sync's same-id pairs; builds the resource-location view.
/**
 * Where resources come from, as `status` and `config get paths.resources` report it, and the one
 * warning a same-id pair between two custom locations earns.
 *
 * ONE DETECTOR. The resource indexer already walks every location of all four directory-form kinds
 * in precedence order on every sync (startup and each hot reload) and records each id it saw twice
 * (`SyncResult.shadowed`, winner = the earlier location). This module does not detect anything a
 * second time: {@link ResourceLocationLedger.recordSync} takes that list, places each file in the
 * location that holds it (`PathResolver.getResourceLocations`, the one derivation of the order),
 * and keeps the result for `status`.
 *
 * ONE WARNING PER PAIR PER PROCESS. A pair is warned about only when BOTH sides sit in a custom
 * location (`project`, `profile` or `listed`). A custom definition hiding a bundled one is the
 * overlay contract (R3c) and says nothing; a hot reload that finds the same pair again says
 * nothing either, because the ledger lives as long as the process does.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { INDEXED_TYPE_DIRS } from './resource-roots.js';

import type { ShadowedResource } from '#infra/database/resource-indexer.js';
import type { Logger } from '#infra/logging/index.js';
import type {
  BundleState,
  ConfiguredLocationEntry,
  ProfileRegistryReading,
  ReportedLocation,
  ReportedResourceKind,
  ResourceLocationKind,
  ResourceLocationReport,
  ResourceLocationsView,
  ShadowedEntry,
} from '#shared/types/resource-location-report.js';
import type { PathResolver } from './paths.js';

import { parseConfigText } from '#shared/utils/config-file-format.js';

/** The registry `cpm` keeps in the PARENT folder of its workspaces (R3g). */
const PROFILE_REGISTRY_FILE_NAME = 'workspaces.jsonc';

/** The kinds whose same-id pairs warn: everything an operator placed, never the package. */
const CUSTOM_KINDS: ReadonlySet<ResourceLocationKind> = new Set(['project', 'profile', 'listed']);

const REPORTED_KINDS = Object.keys(INDEXED_TYPE_DIRS) as ReportedResourceKind[];

/** One served definition file, as the resource index holds it after a sync. */
export interface ServedResourceFile {
  type: string;
  filePath: string;
}

/** One id defined in more than one location, its serving file and every file it hides. */
interface DuplicateGroup {
  type: ReportedResourceKind;
  id: string;
  served: { file: string; kind: ResourceLocationKind | undefined };
  hidden: Array<{ file: string; kind: ResourceLocationKind | undefined }>;
}

/** One entry of `PathResolver.getResourceLocations`, as its return type states it. */
type LocatedPath = ReturnType<PathResolver['getResourceLocations']>['locations'][number];

function isReportedKind(type: string): type is ReportedResourceKind {
  return Object.hasOwn(INDEXED_TYPE_DIRS, type);
}

function holds(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** The location holding `file`: the deepest one, since a location may sit inside another. */
function locationOf(file: string, locations: readonly LocatedPath[]): LocatedPath | undefined {
  let best: LocatedPath | undefined;
  for (const location of locations) {
    if (
      holds(location.path, file) &&
      (best === undefined || location.path.length > best.path.length)
    ) {
      best = location;
    }
  }
  return best;
}

/**
 * Fold the indexer's pairs into one group per id. The indexer accumulates lowest first, so for an
 * id held three times it records (2 hides 3) then (1 hides 2): the LAST winner is the one serving.
 */
function groupDuplicates(
  shadowed: readonly ShadowedResource[],
  locationsOf: (type: ReportedResourceKind) => readonly LocatedPath[]
): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  for (const pair of shadowed) {
    if (!isReportedKind(pair.type)) continue;
    const locations = locationsOf(pair.type);
    const key = `${pair.type}\u0000${pair.id}`;
    const group = groups.get(key) ?? {
      type: pair.type,
      id: pair.id,
      served: { file: pair.winner, kind: undefined },
      hidden: [],
    };
    group.served = { file: pair.winner, kind: locationOf(pair.winner, locations)?.kind };
    group.hidden.push({ file: pair.shadowed, kind: locationOf(pair.shadowed, locations)?.kind });
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The hidden files of `group` that warn: both sides custom, the bundle never. */
function customCollisions(group: DuplicateGroup): string[] {
  if (group.served.kind === undefined || !CUSTOM_KINDS.has(group.served.kind)) return [];
  return group.hidden
    .filter((entry) => entry.kind !== undefined && CUSTOM_KINDS.has(entry.kind))
    .map((entry) => entry.file);
}

/**
 * What a `workspaces.jsonc` beside the workspace's parent says about it. Optional and read-only: an
 * absent file is `none`, a malformed one is `unreadable` with its reason, never a throw.
 */
export function readProfileRegistry(workspace: string): ProfileRegistryReading {
  const registryPath = join(dirname(workspace), PROFILE_REGISTRY_FILE_NAME);
  if (!existsSync(registryPath)) return { state: 'none' };

  let parsed: unknown;
  try {
    parsed = parseConfigText(readFileSync(registryPath, 'utf8'), 'jsonc');
  } catch (error) {
    return {
      state: 'unreadable',
      registryPath,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'unreadable', registryPath, reason: 'expected an object of label to folder' };
  }
  const entries = Object.entries(parsed);
  const notAFolder = entries.find(([, folder]) => typeof folder !== 'string');
  if (notAFolder !== undefined) {
    return {
      state: 'unreadable',
      registryPath,
      reason: `label '${notAFolder[0]}' does not name a folder`,
    };
  }

  const here = resolve(workspace);
  const labels = entries.map(([label]) => label);
  const current = entries.find(
    ([, folder]) => resolve(dirname(registryPath), folder as string) === here
  );
  if (current === undefined) return { state: 'unlabelled', labels, registryPath };
  return {
    state: 'labelled',
    label: current[0],
    siblings: labels.filter((label) => label !== current[0]),
    registryPath,
  };
}

/**
 * The collector every resource-index sync reports its same-id pairs to, and the view `status`
 * reads them back from. One per process, built at the composition root; it holds the latest sync's
 * findings and the pairs already warned about.
 */
export class ResourceLocationLedger {
  private groups: DuplicateGroup[] = [];
  private served: ServedResourceFile[] = [];
  private readonly warned = new Set<string>();

  constructor(
    private readonly pathResolver: PathResolver,
    private readonly logger: Logger
  ) {}

  /**
   * Take one sync's findings: the indexer's same-id pairs and the files it now serves. Replaces
   * the previous sync's, and warns once for each custom-to-custom pair this process has not
   * warned about.
   */
  recordSync(shadowed: readonly ShadowedResource[], served: readonly ServedResourceFile[]): void {
    this.groups = groupDuplicates(shadowed, (type) => this.locationsOf(type));
    this.served = [...served];
    for (const group of this.groups) {
      const hidden = customCollisions(group);
      if (hidden.length === 0) continue;
      const key = [group.type, group.id, group.served.file, ...hidden].join('\u0000');
      if (this.warned.has(key)) continue;
      this.warned.add(key);
      this.logger.warn(
        `Resource '${group.id}' (${group.type}) is defined in ${group.served.file} and ` +
          `${hidden.join(' and ')}; the earlier location serves it`
      );
    }
  }

  /** The port `system_control` reads; every call answers from the resolver and the latest sync. */
  view(): ResourceLocationsView {
    return {
      configuredEntries: () => this.configuredEntries(),
      report: () => this.report(),
    };
  }

  private locationsOf(type: ReportedResourceKind): LocatedPath[] {
    return this.pathResolver.getResourceLocations(INDEXED_TYPE_DIRS[type]).locations;
  }

  /**
   * Each `paths.resources` entry with the kind and source `getResourceLocations` gave it. An entry
   * naming a folder an earlier location already holds is not in that list (each path once), so it
   * is reported as listed and said to repeat.
   */
  private configuredEntries(): ConfiguredLocationEntry[] {
    const locations = this.locationsOf('prompt');
    return this.pathResolver.getConfiguredResourceLocations().map((entry, index) => {
      const source = `paths.resources[${index}]`;
      const located = locations.find(
        (location) => location.source === source || location.source.startsWith(`${source} `)
      );
      if (located === undefined) {
        return { path: entry, kind: 'listed', source: `${source}, a folder already listed above` };
      }
      return located.kind === 'bundled'
        ? { path: dirname(located.path), kind: 'bundled', source: located.source }
        : { path: entry, kind: 'listed', source: located.source };
    });
  }

  private report(): ResourceLocationReport {
    const order: ReportedLocation[] = [];
    const byPath = new Map<string, ReportedLocation>();
    const perKind = new Map<ReportedResourceKind, LocatedPath[]>();
    // The prompt list first, so the stack reads in the order the prompt type is served; a folder
    // only another kind contributes from follows it.
    for (const kind of REPORTED_KINDS) {
      const locations = this.locationsOf(kind);
      perKind.set(kind, locations);
      for (const location of locations) {
        const base = dirname(location.path);
        if (byPath.has(base)) continue;
        const reported: ReportedLocation = {
          path: base,
          kind: location.kind,
          counts: { prompt: 0, gate: 0, framework: 0, style: 0 },
        };
        byPath.set(base, reported);
        order.push(reported);
      }
    }

    for (const file of this.served) {
      if (!isReportedKind(file.type)) continue;
      const location = locationOf(file.filePath, perKind.get(file.type) ?? []);
      const reported = location === undefined ? undefined : byPath.get(dirname(location.path));
      if (reported !== undefined) reported.counts[file.type] += 1;
    }

    const shadowed: ShadowedEntry[] = this.groups.flatMap((group) =>
      group.hidden.map((entry) => ({
        type: group.type,
        id: group.id,
        servedFrom: group.served.file,
        hiddenIn: entry.file,
      }))
    );

    return {
      locations: order,
      bundled: this.bundleState(),
      profile: this.pathResolver.isUsingCustomWorkspace()
        ? readProfileRegistry(this.pathResolver.getWorkspace())
        : { state: 'none' },
      shadowed,
    };
  }

  private bundleState(): BundleState {
    if (this.pathResolver.getConfiguredResourceLocations().length === 0) return 'implicit';
    return this.pathResolver.getResourceLocations('prompts').bundledImplicit ? 'absent' : 'listed';
  }
}
