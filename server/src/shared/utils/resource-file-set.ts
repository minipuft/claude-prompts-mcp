// @lifecycle canonical - Sole enumerator of the files that ARE one resource.
/**
 * Which files on disk constitute one resource — answered once, for every consumer.
 *
 * WHAT THIS DECIDES. A checkpoint records exactly this set, and a restore may write exactly this
 * set. Recorder and restorer must share one answer: a recorder that claims less than the restorer
 * loses authored content, and a restorer that claims more writes over a file nobody recorded. The
 * two halves are the same function, called twice, which is the only arrangement in which they
 * cannot disagree.
 *
 * WHAT WAS ALREADY HERE, AND WHY THIS IS NOT A PARALLEL LIST. Nothing enumerated a resource's
 * FILES. `prompt-layout.ts` owns where a prompt sits and what it is called — this module calls it
 * rather than restating it. `resource-root-lookup.ts` owns root precedence — this module calls it
 * to classify an entry's origin. `resource-indexer.ts` finds ENTRY files only (one path per
 * resource). `ResourceMutationTransaction` snapshots a whole DIRECTORY with `cp -r`, which needs
 * no enumeration and gives none. The four writers each hold a plan of the files THAT CALL writes,
 * which is a subset of the resource by construction (a guidance-only gate update plans one file)
 * and is therefore not the set a checkpoint needs. `skills-sync` projects resources into an export
 * tree and names its OUTPUT paths, not its inputs. So there was no owner to extend; there were six
 * partial re-derivations, listed here so the next reader does not go looking for a seventh.
 *
 * THE RULE, STATED ONCE. A file belongs to a resource when it is
 *   (a) the ENTRY file for the type, or
 *   (b) named by a REFERENCE the entry file declares, resolved relative to the resource root —
 *       the same joins the loaders perform (`guidanceFile`, `phasesFile`, `judgePromptFile`,
 *       `systemMessageFile`, `userMessageTemplateFile`, a script tool's `script`/`schemaFile`/
 *       `descriptionFile`), or
 *   (c) named by a LAYOUT rule a writer or loader enforces by literal name — a framework's
 *       `system-prompt.md`, a script tool's `schema.json`/`description.md` defaults, and the
 *       `tools/<id>/` directory.
 * Anything else in the directory is NOT enumerated. That bound is load-bearing: it is what keeps a
 * later restore off an operator's stray note sitting beside a gate, and it is why this function
 * reports its answer rather than "everything under the root".
 *
 * ONE RESOURCE, ONE SET — a directory inside another resource's directory is still its OWN
 * resource (owner ruling R61). A nested chain step is served under its own id and has its own
 * history rows, so it is recorded and restored under them and never as part of the chain above it;
 * a category's resource is `category.yaml` and never the prompts around it. Two resources claiming
 * one path is how a rollback of the outer one overwrites the inner with bytes the inner's own
 * history never recorded.
 *
 * WHY IT LIVES IN `shared/` (Layer 0). `cpm` records and restores through it, and `cli-shared/`
 * may not reach `runtime/`, `infra/` or `mcp/` (`.dependency-cruiser.cjs`, `cli-shared-no-runtime`).
 * Layer 0 is the only place both the server's versioning service and the CLI can import. The one
 * thing it cannot do from here — resolve the roots — arrives as an argument instead, which also
 * makes the origin classification a pure function of its inputs.
 *
 * WHAT IT DOES NOT DO. It never reads a file's contents into its result (only the entry file and a
 * tool's `tool.yaml`, to resolve their references) and it never maps a bundled path into a
 * workspace. A bundled resource is reported as `bundled` and its paths stay where they are; the
 * decision to materialise it into a workspace belongs to the caller that writes.
 */

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';

import { isPathInside } from './path-containment.js';
import {
  isExcludedCategoryDirectoryName,
  isIgnoredPromptEntryName,
  isReservedPromptDirectoryName,
  isSingleFilePromptName,
} from './prompt-layout.js';
import { resourceEntryRoots } from './resource-root-lookup.js';
import { parseYaml } from './yaml/yaml-parser.js';

import type { ResourceType } from '#modules/versioning/types.js';
import type { Dirent } from 'node:fs';

/**
 * The entry filename each resource type is addressed by.
 *
 * Keyed on the published `ResourceType` union (`modules/versioning/types.ts`) rather than on a
 * hand-written list, so a type added there fails to compile here instead of being silently
 * unenumerable. A single-file prompt is the one resource whose entry filename is not a constant —
 * it is `{id}.yaml`, and `isSingleFilePromptName` is what recognises it.
 */
const ENTRY_FILENAME: Readonly<Record<ResourceType, string>> = {
  prompt: 'prompt.yaml',
  gate: 'gate.yaml',
  framework: 'framework.yaml',
  category: 'category.yaml',
};

/**
 * Which class of root an entry was found under.
 *
 * Three values, not two, because that is what `resource-roots.ts` already distinguishes and what
 * the checkpoint row records. "Workspace" in prose means `primary` or `overlay`; `bundled` is the
 * package's own tree, which a restore must never write back into.
 *
 * `unknown` is a distinct answer from any of the three: it means the caller supplied no roots, or
 * none that contain this entry. Collapsing it into `primary` would let a bundled resource be
 * restored as though it were the operator's own, which is exactly the accident the origin field
 * exists to prevent.
 */
export type ResourceRootOrigin = 'primary' | 'overlay' | 'bundled' | 'unknown';

/** The roots that contribute one resource type, as `resolveResourceRoots` already reports them. */
export interface ResourceRootClassification {
  primary?: string | undefined;
  overlays?: readonly string[] | undefined;
  bundled?: string | undefined;
}

/** One file of a resource. Bytes are never read here — only the size is reported. */
export interface ResourceFileEntry {
  /** POSIX, relative to the resource's own root. Stable across machines. */
  relativePath: string;
  /** Where that file is on THIS machine. */
  absolutePath: string;
  /** Size in bytes, for the caller's own limit check. */
  size: number;
}

/** Every file that IS one resource, plus where it was found. */
export interface ResourceFileSet {
  resourceType: ResourceType;
  /** The directory `relativePath` is relative to. For a single-file prompt, its containing dir. */
  resourceRoot: string;
  /** The entry file this set was derived from. Always `files[0]`. */
  entryPath: string;
  origin: ResourceRootOrigin;
  /** Entry file first, then references, then layout-named files. Deterministic. */
  files: ResourceFileEntry[];
}

export interface ResourceFileSetOptions {
  resourceType: ResourceType;
  /** Absolute path to the resource's entry FILE. */
  entryPath: string;
  /** The type's contributing roots. Omitted, `origin` is `unknown`. */
  roots?: ResourceRootClassification | undefined;
}

/**
 * Refuse a path that escapes the resource root — including through a symlink.
 *
 * Lexical containment is not enough and that is the whole reason this is `async`. A declared
 * reference like `guidanceFile: ../../../etc/passwd` is caught lexically by {@link isPathInside};
 * a `guidance.md` that IS a symlink to `/etc/passwd` is not, because every string involved stays
 * inside the root. `realpath` is what tells them apart, and a restore that trusted the lexical
 * check alone would follow the link back out on the way in.
 *
 * Names the offending path, per the guard's own convention in `path-containment.ts`: a caller
 * debugging a refused resource needs to know which of its files answered.
 *
 * Returns `undefined` for a path that does not resolve at all — an absent file, or a dangling
 * link. That is not an escape and must not read as one: a `guidanceFile` naming a file nobody
 * created is a warning to every loader, and a refusal here would fail a checkpoint of a resource
 * the server serves without complaint.
 */
async function assertContainedRealPath(
  realRoot: string,
  candidate: string
): Promise<string | undefined> {
  if (!isPathInside(realRoot, candidate)) {
    throw new Error(
      `Refusing to enumerate a resource file outside its root: ${candidate} resolves outside ` +
        `${realRoot}. A resource's files sit at or beneath its own directory.`
    );
  }
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return undefined;
  }
  if (!isPathInside(realRoot, real)) {
    throw new Error(
      `Refusing to enumerate a resource file outside its root: ${candidate} is a link to ${real}, ` +
        `which is outside ${realRoot}. A resource's files sit at or beneath its own directory.`
    );
  }
  return real;
}

/** `true` when the path exists and is a regular file. Anything else contributes nothing. */
async function isRegularFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/**
 * Accumulates the set, keyed by relative path so a file reachable two ways is recorded once.
 *
 * Insertion order IS the reported order (`Map` guarantees it), which is why every caller below
 * adds the entry file first. A checkpoint's path list is compared as one value elsewhere, so a
 * non-deterministic order would make two identical resources hash differently.
 */
class FileSetBuilder {
  private readonly entries = new Map<string, ResourceFileEntry>();

  constructor(
    private readonly resourceRoot: string,
    private readonly realRoot: string
  ) {}

  /**
   * Add `absolute` if it is a regular file inside the root; refuse it if it escapes.
   *
   * A declared reference to a file that does not exist is NOT an error: every loader treats a
   * missing `guidanceFile` as a warning and serves the resource anyway, so refusing here would
   * make a checkpoint fail on a resource the server happily loads. It contributes nothing instead.
   * An ESCAPING reference is a different thing and throws — the path is wrong, not absent.
   */
  async add(absolute: string): Promise<void> {
    const real = await assertContainedRealPath(this.realRoot, absolute);
    if (real === undefined || !(await isRegularFile(real))) return;
    const relativePath = path.relative(this.resourceRoot, absolute).split(path.sep).join('/');
    if (relativePath === '' || this.entries.has(relativePath)) return;
    this.entries.set(relativePath, {
      relativePath,
      absolutePath: absolute,
      size: (await stat(real)).size,
    });
  }

  /** Resolve a reference declared in an entry file, then add it. Throws on an escape. */
  async addReference(baseDir: string, reference: unknown): Promise<void> {
    if (typeof reference !== 'string' || reference.length === 0) return;
    if (path.isAbsolute(reference)) {
      throw new Error(
        `Refusing to enumerate a resource file outside its root: the declared reference ` +
          `'${reference}' is an absolute path. References name a file beneath the resource root.`
      );
    }
    await this.add(path.join(baseDir, reference));
  }

  list(): ResourceFileEntry[] {
    return [...this.entries.values()];
  }
}

/** Parse a YAML file into a mapping, or `undefined` when it is absent, empty or not a mapping. */
async function readYamlMapping(filePath: string): Promise<Record<string, unknown> | undefined> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const parsed = parseYaml<Record<string, unknown>>(content);
  const data = parsed.success ? parsed.data : undefined;
  // `parseYaml` types its payload as the caller's generic, so a scalar or a sequence document
  // arrives typed as a mapping and is not one. The runtime shape check is what makes the later
  // `definition?.['guidanceFile']` reads honest.
  return data !== undefined && typeof data === 'object' && !Array.isArray(data) ? data : undefined;
}

/**
 * The root class an entry belongs to.
 *
 * Checked in `resourceRootPrecedence` order — overlays, then primary, then bundled — because a
 * root may legitimately contain another (a workspace whose overlay sits under its primary), and
 * the first match must be the one a loader would have served from. Compared on REAL paths so a
 * symlinked temp root classifies the same as the directory it points at.
 */
async function classifyOrigin(
  entryPath: string,
  roots: ResourceRootClassification | undefined
): Promise<ResourceRootOrigin> {
  if (roots === undefined) return 'unknown';
  const real = await realpath(entryPath);
  const candidates: Array<[string, ResourceRootOrigin]> = [
    ...[...(roots.overlays ?? [])]
      .reverse()
      .map((dir): [string, ResourceRootOrigin] => [dir, 'overlay']),
    ...(roots.primary !== undefined
      ? [[roots.primary, 'primary'] as [string, ResourceRootOrigin]]
      : []),
    ...(roots.bundled !== undefined
      ? [[roots.bundled, 'bundled'] as [string, ResourceRootOrigin]]
      : []),
  ];
  for (const [dir, origin] of candidates) {
    let realDir: string;
    try {
      realDir = await realpath(dir);
    } catch {
      continue;
    }
    if (isPathInside(realDir, real)) return origin;
  }
  return 'unknown';
}

/**
 * Add a script tool's files: `tool.yaml`, its `script`, and its schema/description companions.
 *
 * The defaults matter as much as the references. `script-definition-loader.ts` reads
 * `schemaFile ?? 'schema.json'` and `descriptionFile ?? 'description.md'`, so a tool that declares
 * neither still has both files read at load — enumerating only what the YAML names would drop two
 * files the loader depends on, which is the exact shape of the miss this function exists to close.
 */
async function addScriptTool(builder: FileSetBuilder, toolDir: string): Promise<void> {
  const toolYaml = path.join(toolDir, 'tool.yaml');
  if (!(await isRegularFile(toolYaml))) return;
  await builder.add(toolYaml);
  const definition = await readYamlMapping(toolYaml);
  await builder.addReference(toolDir, definition?.['script']);
  await builder.addReference(toolDir, definition?.['schemaFile'] ?? 'schema.json');
  await builder.addReference(toolDir, definition?.['descriptionFile'] ?? 'description.md');
}

/** Directory entries, sorted by name; an unreadable directory contributes nothing. */
async function sortedEntries(dir: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

/**
 * Add one prompt directory's own files: its entry, the messages it references, its script tools.
 *
 * `tools/` is walked by NAME because that is how the script tool loader discovers tools
 * (`script-definition-loader.ts` readdirs the directory), not from `prompt.yaml`'s `tools:` list —
 * that list is a BINDING, and a tool present on disk but unbound is still loadable. Enumerating
 * from the binding would silently drop the files of an unbound tool.
 *
 * A NESTED CHAIN STEP IS NOT PART OF ITS PARENT (owner ruling R61). The loader serves a step as
 * its own prompt under `{parent}/{step}`, so it has its own id, its own history rows, and is
 * recorded and restored under them. Claiming a step's files here would put two resources on one
 * path: a rollback of the chain would overwrite the step with bytes the step's own history never
 * recorded, silently overriding it. Same rule CLAUDE.md already states for a category — its
 * resource is `category.yaml`, never the prompts around it — and the same reason.
 *
 * So there is no recursion and no descent. Every directory inside a prompt except `tools/` is
 * either another resource (enumerated by its own call) or a stray, and neither is this set.
 */
async function addPromptDirectory(builder: FileSetBuilder, promptDir: string): Promise<void> {
  const yamlPath = path.join(promptDir, 'prompt.yaml');
  await builder.add(yamlPath);
  const definition = await readYamlMapping(yamlPath);
  await builder.addReference(promptDir, definition?.['systemMessageFile']);
  await builder.addReference(promptDir, definition?.['userMessageTemplateFile']);

  for (const entry of await sortedEntries(promptDir)) {
    if (isIgnoredPromptEntryName(entry.name)) continue;
    // `isReservedPromptDirectoryName` rather than an `=== 'tools'` literal: which directory names
    // a prompt reserves is `prompt-layout.ts`'s rule, and that module's own header records what it
    // cost to have it stated in one place and implemented in another.
    if (entry.isDirectory() && isReservedPromptDirectoryName(entry.name)) {
      await addScriptToolDirectory(builder, path.join(promptDir, entry.name));
    }
  }
}

/** Every script tool under a prompt's `tools/`. */
async function addScriptToolDirectory(builder: FileSetBuilder, toolsDir: string): Promise<void> {
  for (const tool of await sortedEntries(toolsDir)) {
    if (!tool.isDirectory() || isIgnoredPromptEntryName(tool.name)) continue;
    await addScriptTool(builder, path.join(toolsDir, tool.name));
  }
}

/**
 * Every file that IS the resource whose entry file is `entryPath`.
 *
 * Throws, naming the path, when the entry filename does not match the type, when the entry file is
 * missing, or when any file the rules reach resolves outside the resource's own root — `..`
 * segments, absolute references, and symlinks alike.
 */
export async function resourceFileSet(options: ResourceFileSetOptions): Promise<ResourceFileSet> {
  const { resourceType, entryPath, roots } = options;
  const absoluteEntry = path.resolve(entryPath);
  const entryName = path.basename(absoluteEntry);
  const expected = ENTRY_FILENAME[resourceType];

  // A single-file prompt is the one entry whose name is not a constant, so its check is the
  // loader's predicate rather than an equality. Everything else must be named exactly, because a
  // caller that hands `guidance.md` as a gate's entry would otherwise enumerate a set rooted one
  // level up and a restore would write over the whole gates tree.
  const isSingleFilePrompt =
    resourceType === 'prompt' && entryName !== expected && isSingleFilePromptName(entryName);
  if (entryName !== expected && !isSingleFilePrompt) {
    throw new Error(
      `Not a ${resourceType} entry file: ${absoluteEntry}. A ${resourceType} is addressed by ` +
        `its ${expected}${resourceType === 'prompt' ? ' or by a {category}/{id}.yaml file' : ''}.`
    );
  }
  if (!(await isRegularFile(absoluteEntry))) {
    throw new Error(`Resource entry file does not exist: ${absoluteEntry}`);
  }

  const resourceRoot = path.dirname(absoluteEntry);
  const realRoot = await realpath(resourceRoot);
  const builder = new FileSetBuilder(resourceRoot, realRoot);

  if (resourceType === 'prompt') {
    if (isSingleFilePrompt) {
      // The whole resource is one file. There is no directory of its own to claim, which is why
      // nothing beside it is enumerated even though its siblings sit in the same category folder.
      await builder.add(absoluteEntry);
    } else {
      await addPromptDirectory(builder, resourceRoot);
    }
  } else if (resourceType === 'gate') {
    await builder.add(absoluteEntry);
    const definition = await readYamlMapping(absoluteEntry);
    // Reference only — `GateDefinitionLoader` inlines `guidanceFile` and looks for nothing by
    // name, so a `guidance.md` no `gate.yaml` points at is a file the server never reads.
    await builder.addReference(resourceRoot, definition?.['guidanceFile']);
  } else if (resourceType === 'framework') {
    await builder.add(absoluteEntry);
    const definition = await readYamlMapping(absoluteEntry);
    // References first, then the writer's fallback names for the same two files: an existing
    // framework that declares neither is still written to `phases.yaml`/`judge-prompt.md`
    // (`framework-file-writer.ts` `resolveDeclaredFileName`), so both halves are needed.
    await builder.addReference(resourceRoot, definition?.['phasesFile'] ?? 'phases.yaml');
    await builder.addReference(resourceRoot, definition?.['judgePromptFile'] ?? 'judge-prompt.md');
    // Layout-named, with no reference key at all: `framework-file-writer.ts` reads and writes
    // `system-prompt.md` by literal name on every framework write.
    await builder.addReference(resourceRoot, 'system-prompt.md');
  } else {
    // A category's resource is `category.yaml` and nothing else — never the prompts around it.
    // Its own writer targets the file, and its `delete` leaves every prompt in place.
    await builder.add(absoluteEntry);
  }

  return {
    resourceType,
    resourceRoot,
    entryPath: absoluteEntry,
    origin: await classifyOrigin(absoluteEntry, roots),
    files: builder.list(),
  };
}

/**
 * The entry filename a resource of this type is addressed by.
 *
 * Exported so a caller that must FIND the entry file before enumerating the set reads the same
 * table `resourceFileSet` validates against. Two statements of "a gate is addressed by gate.yaml"
 * is how a locator comes to hand this function a path it then refuses.
 */
export function resourceEntryFileName(resourceType: ResourceType): string {
  return ENTRY_FILENAME[resourceType];
}

/** What {@link locateResourceEntry} is asked. */
export interface ResourceEntryLookup {
  resourceType: ResourceType;
  /** The id the resource is SERVED under — a nested chain step's id carries its own `/`. */
  resourceId: string;
  /** Contributing roots, highest precedence first (`ResourceRoots.lookupDirs`). */
  lookupDirs: readonly string[];
}

/**
 * The absolute entry-file path for an id, or `undefined` when no contributing root holds it.
 *
 * ROOT PRECEDENCE IS NOT DECIDED HERE. `lookupDirs` arrives already ordered by
 * `resourceRootPrecedence`, and the walk below is `resourceEntryRoots` — the same first-hit-wins
 * lookup the loaders perform. This function adds exactly one thing to it: the single-file prompt
 * layout, which `resourceEntryRoot` cannot express because it probes for a DIRECTORY holding an
 * entry file and a `{category}/{id}.yaml` prompt has no directory of its own.
 *
 * `undefined` is a real answer, not an error: an id whose files were deleted, or a type served
 * from a root this process never resolved. The caller degrades — it does not fail the write that
 * asked.
 */
export async function locateResourceEntry(
  lookup: ResourceEntryLookup
): Promise<string | undefined> {
  const { resourceType, resourceId, lookupDirs } = lookup;
  const entryFileName = ENTRY_FILENAME[resourceType];

  const [base] = resourceEntryRoots([...lookupDirs], resourceId, entryFileName);
  if (base !== undefined) return path.join(base, resourceId, entryFileName);

  if (resourceType !== 'prompt') return undefined;
  return singleFilePromptEntry(lookupDirs, resourceId);
}

/**
 * The `{root}/{category}/{id}.yaml` path for a prompt with no directory of its own.
 *
 * The category directory is the one level this walk descends — matching `promptIdFromSingleFile`,
 * which derives the id by dropping exactly that first segment — and what counts as a category
 * directory is `prompt-layout.ts`'s answer, not a second one stated here.
 */
async function singleFilePromptEntry(
  lookupDirs: readonly string[],
  resourceId: string
): Promise<string | undefined> {
  const fileName = `${resourceId}.yaml`;
  if (!isSingleFilePromptName(path.basename(fileName))) return undefined;

  for (const root of lookupDirs) {
    for (const group of await categoryDirectories(root)) {
      const candidate = path.join(root, group, fileName);
      if (await isRegularFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Directory names under a prompts root that the loader treats as categories. */
async function categoryDirectories(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return []; // An absent or unreadable root contributes nothing, exactly as in the walk above.
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(
      (name) => !isExcludedCategoryDirectoryName(name) && !isReservedPromptDirectoryName(name)
    );
}

/**
 * Where a resource's files are — the one question `resourceFileSet` cannot answer for itself.
 *
 * `resourceFileSet` takes an entry PATH and the type's roots; a version record holds only a type
 * and an id. Resolving the gap needs `PathResolver` and `resolveResourceRoots`, both of which live
 * in `runtime/`, which no layer below may import (`.dependency-cruiser.cjs`,
 * `no-imports-into-runtime`). So the contract is declared here beside the consumer and the
 * implementation is built at the composition root, which is the remedy that rule names.
 */
export interface ResourceFileLocatorPort {
  locate(resourceType: ResourceType, resourceId: string): Promise<ResourceLocationResult>;
}

/**
 * Located, or refused with a reason the caller can log.
 *
 * Tagged rather than "`undefined` means no", because every refusal here degrades a checkpoint to
 * projection-only and an operator reading that warning needs to know WHICH of the reasons it was:
 * no locator wired, no root for the type, or an id no root holds.
 */
export type ResourceLocationResult =
  | { located: true; entryPath: string; roots: ResourceRootClassification }
  | { located: false; reason: string };
