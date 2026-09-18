// @lifecycle canonical - Structural mutation helpers for CLI resources with optional validation rollback.
/**
 * Structural mutation operations for existing resources.
 *
 * Separate from resource-scaffold.ts (which handles creation/deletion).
 * These functions modify existing resources: rename, move, toggle, link-gate.
 *
 * Comment-preservation strategy:
 *   - rename, move, toggle: regex replacement on raw file content (preserves all YAML comments)
 *   - linkGate: full parse→serialize (comments lost, but user is adding structural content)
 *
 * Pure functions using only node:fs and node:path + cli-shared YAML utils.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

import {
  type ResourceValidationResult,
  type ResourceValidationType,
  validateResourceFile,
} from './resource-validation.js';

import { isExcludedCategoryDirectoryName } from '#shared/utils/prompt-layout.js';
import { loadYamlFileSync, serializeYaml } from '#shared/utils/yaml/index.js';

// ── Where a resource lives ──────────────────────────────────────────────────

/**
 * Where one resource lives on disk, in either of the two forms a prompt can take.
 *
 * - `dir`: the resource owns a directory and its definition is `file` inside it
 *   (`{category}/{id}/prompt.yaml`, `gates/{id}/gate.yaml`). Moving, snapshotting or deleting the
 *   resource acts on `dir`, which carries its companion files and, for a chain, its steps.
 * - `file`: a single-file prompt (`{category}/{id}.yaml`). It owns NO directory: the directory
 *   around it is a category or a chain holding its siblings, so the file is the whole resource.
 *
 * The form is explicit because `dir` is the dangerous field. A `{ id, dir }` shape made every
 * consumer build `join(dir, entryFile)`, and a single-file prompt has no `dir` of its own to put
 * there — only a parent, which `delete` would have removed whole.
 */
export type ResourceLocation =
  { form: 'dir'; dir: string; file: string } | { form: 'file'; file: string };

/** The path that IS the resource: its directory, or its single file. */
export function resourceRoot(location: ResourceLocation): string {
  return location.form === 'dir' ? location.dir : location.file;
}

/**
 * The id a resource's own YAML must declare: the last segment of the id it is served under.
 *
 * The loader serves a nested step as `chain/step` but validates its file against `step`
 * (`yaml-prompt-loader.ts`, `validationId`), so a step's `id:` names the step alone.
 */
export function declaredResourceId(location: ResourceLocation): string {
  return location.form === 'dir' ? basename(location.dir) : basename(location.file, '.yaml');
}

/** Where a resource lands when its root moves to `root`, keeping its form and entry filename. */
function relocate(location: ResourceLocation, root: string): ResourceLocation {
  return location.form === 'dir'
    ? { form: 'dir', dir: root, file: join(root, basename(location.file)) }
    : { form: 'file', file: root };
}

/** The root a resource named `name` would have inside `parentDir`, in the given form. */
function rootIn(parentDir: string, name: string, form: ResourceLocation['form']): string {
  return join(parentDir, form === 'dir' ? name : `${name}.yaml`);
}

/**
 * The path already holding `name` inside `parentDir`, in either form, or `undefined`.
 *
 * Both spellings are checked whatever the form being written, because the loader serves only one
 * of them: the directory wins, so writing one beside the other hides a prompt without an error.
 */
function occupantOf(parentDir: string, name: string): string | undefined {
  return [join(parentDir, name), join(parentDir, `${name}.yaml`)].find((path) => existsSync(path));
}

/**
 * Relocate a resource and rewrite its YAML, as one step.
 *
 * `rewrites` maps a file's path relative to the resource root (`''` for a single-file resource) to
 * its new content; the entry file is always one of them. The target is checked by the caller
 * before this runs, so nothing is written on a refused target. The rename happens first and the
 * rewrites second; if a rewrite throws, the files already written get their old content back and
 * the rename is undone, so a failure leaves the resource where it was with the content it had.
 */
function relocateWithRewrite(
  location: ResourceLocation,
  newRoot: string,
  rewrites: ReadonlyMap<string, { before: string; after: string }>
): ResourceLocation {
  const moved = relocate(location, newRoot);
  mkdirSync(dirname(newRoot), { recursive: true });
  renameSync(resourceRoot(location), newRoot);
  const written: Array<[string, string]> = [];
  try {
    for (const [relativePath, { before, after }] of rewrites) {
      const target = join(newRoot, relativePath);
      writeFileSync(target, after, 'utf8');
      written.push([target, before]);
    }
  } catch (error) {
    for (const [target, before] of written) {
      writeFileSync(target, before, 'utf8');
    }
    renameSync(newRoot, resourceRoot(location));
    throw error;
  }
  return moved;
}

/** Every YAML file a resource owns: the single file, or each `.yaml` anywhere in its directory. */
function ownedYamlFiles(location: ResourceLocation): string[] {
  if (location.form === 'file') {
    return [location.file];
  }
  const nested = readdirSync(location.dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.yaml'))
    .map((entry) => join(location.dir, entry));
  return [location.file, ...nested.filter((file) => file !== location.file)];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Point a renamed prompt's own step references at the new id.
 *
 * A chain names its steps by composite id (`promptId: chain/step`), and those ids are paths below
 * the chain's directory, so renaming the chain changes every one of them. Only references to ids
 * below the renamed one are rewritten, and only in files the renamed resource owns: a reference
 * from anywhere else is another resource's content, which `cpm rename` reports and leaves alone.
 */
function rewriteStepReferences(content: string, oldId: string, newId: string): string {
  const pattern = new RegExp(`^(\\s*(?:-\\s+)?promptId:\\s*['"]?)${escapeRegExp(oldId)}/`, 'gm');
  return content.replace(pattern, `$1${newId}/`);
}

// ── Result types ────────────────────────────────────────────────────────────

export interface RenameResult {
  success: boolean;
  oldPath?: string;
  newPath?: string;
  moved?: ResourceLocation;
  error?: string;
}

export interface MoveResult {
  success: boolean;
  oldPath?: string;
  newPath?: string;
  moved?: ResourceLocation;
  oldCategory?: string;
  error?: string;
}

export interface ToggleResult {
  success: boolean;
  previousValue?: boolean;
  newValue?: boolean;
  error?: string;
}

export interface LinkGateResult {
  success: boolean;
  action?: 'added' | 'removed';
  include?: string[];
  error?: string;
}

export interface ResourceMutationResult {
  success: boolean;
  /** Set when the mutation relocated the resource; validation and rollback follow it. */
  moved?: ResourceLocation;
  error?: string;
}

export interface ValidatedMutationOptions<TMutation extends ResourceMutationResult> {
  resourceType: ResourceValidationType;
  location: ResourceLocation;
  mutate: () => TMutation;
  validate?: boolean;
  validator?: (
    resourceType: ResourceValidationType,
    resourceId: string,
    filePath: string
  ) => ResourceValidationResult;
}

export interface ValidatedMutationResult<TMutation extends ResourceMutationResult> {
  success: boolean;
  operation: TMutation;
  validation?: ResourceValidationResult;
  rolledBack?: boolean;
  error?: string;
}

/** Put the snapshot back at `target`. Works on a directory or a single file alike. */
function restoreResource(snapshotPath: string, target: string): void {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(snapshotPath, target, { recursive: true });
}

/** Copy the resource root — a directory with its companions, or the single file — aside. */
function createMutationSnapshot(resourcePath: string): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'cpm-mutation-'));
  const dir = join(root, 'snapshot');
  cpSync(resourcePath, dir, { recursive: true });
  return { root, dir };
}

function cleanupSnapshot(snapshot: { root: string; dir: string } | null): void {
  if (snapshot !== null) {
    rmSync(snapshot.root, { recursive: true, force: true });
  }
}

function rollbackMutation(snapshotPath: string, mutatedPath: string, originalPath: string): void {
  if (mutatedPath !== originalPath) {
    rmSync(mutatedPath, { recursive: true, force: true });
  }
  restoreResource(snapshotPath, originalPath);
}

function executeMutation<TMutation extends ResourceMutationResult>(
  mutate: () => TMutation
): { operation?: TMutation; error?: string } {
  try {
    return { operation: mutate() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function validateMutationResult(
  options: ValidatedMutationOptions<ResourceMutationResult>,
  validator: (
    resourceType: ResourceValidationType,
    resourceId: string,
    filePath: string
  ) => ResourceValidationResult,
  operation: ResourceMutationResult
): ResourceValidationResult {
  const location = operation.moved ?? options.location;
  return validator(options.resourceType, declaredResourceId(location), location.file);
}

export function runValidatedMutation<TMutation extends ResourceMutationResult>(
  options: ValidatedMutationOptions<TMutation>
): ValidatedMutationResult<TMutation> {
  const validator = options.validator ?? validateResourceFile;
  const validateMutation = options.validate !== false;
  const snapshot = validateMutation ? createMutationSnapshot(resourceRoot(options.location)) : null;

  try {
    const executed = executeMutation(options.mutate);
    if (executed.error !== undefined) {
      return {
        success: false,
        operation: {
          success: false,
          error: executed.error,
        } as TMutation,
        error: executed.error,
      };
    }
    const operation = executed.operation as TMutation;

    if (!operation.success) {
      return {
        success: false,
        operation,
        error: operation.error,
      };
    }

    if (!validateMutation) {
      return { success: true, operation };
    }

    const validation = validateMutationResult(options, validator, operation);

    if (validation.valid) {
      return { success: true, operation, validation };
    }

    if (snapshot !== null) {
      const originalPath = resourceRoot(options.location);
      const mutatedPath = resourceRoot(operation.moved ?? options.location);
      rollbackMutation(snapshot.dir, mutatedPath, originalPath);
    }

    return {
      success: false,
      operation,
      validation,
      rolledBack: true,
      error: 'Mutation produced invalid resource state; restored previous files.',
    };
  } finally {
    cleanupSnapshot(snapshot);
  }
}

// ── Rename ──────────────────────────────────────────────────────────────────

/** Everything of a slash-joined id but its last segment; `''` for a top-level id. */
function idParent(id: string): string {
  return id.split('/').slice(0, -1).join('/');
}

/** Why `name` cannot be the last segment of an id, or `undefined` when it can. */
function invalidIdSegment(name: string): string | undefined {
  if (name === '' || name === '.' || name === '..' || /[\\/]/.test(name)) {
    return `'${name}' is not a usable id segment`;
  }
  return undefined;
}

/**
 * Every file a rename rewrites, keyed by its path relative to the resource root: the entry file
 * with its new `id:` line, and any owned YAML whose step references name an id below `oldId`.
 */
function planRenameRewrites(
  location: ResourceLocation,
  renamedEntry: string,
  oldId: string,
  newId: string
): Map<string, { before: string; after: string }> {
  const root = resourceRoot(location);
  const rewrites = new Map<string, { before: string; after: string }>();
  for (const file of ownedYamlFiles(location)) {
    const isEntry = file === location.file;
    const before = readFileSync(file, 'utf8');
    const after = rewriteStepReferences(isEntry ? renamedEntry : before, oldId, newId);
    if (after !== before) {
      rewrites.set(relative(root, file), { before, after });
    }
  }
  return rewrites;
}

/**
 * Rename a resource: its path, its `id:` line and its own step references change together.
 *
 * Only the LAST segment of an id can change. A nested prompt's id is its path below the category
 * (`chain/step`), so renaming `chain/step` to `other/step` would be a move into another chain,
 * which this refuses by name rather than performing half of it. The `id:` written is the new last
 * segment, the one the loader validates the file against.
 *
 * A chain's `chainSteps` name its steps as `chain/step`, so they are rewritten to the new id in
 * every YAML file the resource owns (a nested chain names its own steps the same way).
 *
 * The target is checked before anything is written, and every rewrite is undone with the rename
 * if one fails, so a refused or failed rename leaves the resource untouched. Uses string
 * replacement to preserve YAML comments.
 *
 * Files only. Version history is re-keyed by the caller once the rename has also passed
 * validation (`renameHistoryResource`), because a rename that validation rolls back must leave
 * the history where the files went back to.
 */
export function renameResource(
  location: ResourceLocation,
  oldId: string,
  newId: string
): RenameResult {
  try {
    if (idParent(oldId) !== idParent(newId)) {
      return {
        success: false,
        error:
          `Cannot rename '${oldId}' to '${newId}': only the last segment of an id can change, ` +
          `because the rest is the path of the directory it sits in ('${idParent(oldId) === '' ? '.' : idParent(oldId)}').`,
      };
    }
    const newName = newId.split('/').pop() ?? '';
    const badName = invalidIdSegment(newName);
    if (badName !== undefined) {
      return { success: false, error: `Cannot rename '${oldId}' to '${newId}': ${badName}.` };
    }

    const parentDir = dirname(resourceRoot(location));
    const occupant = occupantOf(parentDir, newName);
    if (occupant !== undefined) {
      return { success: false, error: `Target already exists: ${occupant}` };
    }

    const content = readFileSync(location.file, 'utf8');
    // Replace the id field (first match of `id: <value>` at line start)
    const idPattern = /^(id:\s*).+$/m;
    if (!idPattern.test(content)) {
      return { success: false, error: `No 'id' field found in ${basename(location.file)}` };
    }

    const newRoot = rootIn(parentDir, newName, location.form);
    const rewrites = planRenameRewrites(
      location,
      content.replace(idPattern, `$1${newName}`),
      oldId,
      newId
    );
    const moved = relocateWithRewrite(location, newRoot, rewrites);

    return { success: true, oldPath: resourceRoot(location), newPath: newRoot, moved };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Move (prompt category) ──────────────────────────────────────────────────

/**
 * Move a prompt to a different category: update `category:` field, relocate it.
 *
 * A prompt nested below another directory is refused: its id is its path below the category, so
 * it moves with that directory, not on its own. The target category must be one the loader serves
 * and must not already hold the id in either form; both are checked before anything is written.
 * Uses string replacement to preserve YAML comments.
 */
export function movePromptCategory(
  location: ResourceLocation,
  promptId: string,
  newCategory: string,
  promptsBaseDir: string
): MoveResult {
  try {
    if (promptId.includes('/')) {
      return {
        success: false,
        error:
          `Cannot move '${promptId}' on its own: it sits inside '${idParent(promptId)}', and its ` +
          `id is its path below the category. It moves when that directory moves.`,
      };
    }
    const badCategory = invalidIdSegment(newCategory);
    if (badCategory !== undefined || isExcludedCategoryDirectoryName(newCategory)) {
      return {
        success: false,
        error: `Cannot move '${promptId}' to '${newCategory}': the server serves no category of that name.`,
      };
    }

    const content = readFileSync(location.file, 'utf8');

    // Extract current category
    const catPattern = /^(category:\s*)(.+)$/m;
    const catMatch = catPattern.exec(content);

    if (catMatch === null) {
      return { success: false, error: `No 'category' field found in ${basename(location.file)}` };
    }

    const oldCategory = (catMatch[2] ?? '').trim();

    if (oldCategory === newCategory) {
      return {
        success: false,
        oldCategory,
        error: `Prompt is already in category '${newCategory}'`,
      };
    }

    const categoryDir = join(promptsBaseDir, newCategory);
    const occupant = occupantOf(categoryDir, promptId);
    if (occupant !== undefined) {
      return { success: false, error: `Target already exists: ${occupant}` };
    }

    const newRoot = rootIn(categoryDir, promptId, location.form);
    const moved = relocateWithRewrite(
      location,
      newRoot,
      new Map([
        [
          relative(resourceRoot(location), location.file),
          { before: content, after: content.replace(catPattern, `$1${newCategory}`) },
        ],
      ])
    );

    return { success: true, oldPath: resourceRoot(location), newPath: newRoot, moved, oldCategory };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Toggle enabled ──────────────────────────────────────────────────────────

/**
 * Flip the `enabled:` field in a resource YAML (true↔false).
 * Uses string replacement to preserve YAML comments.
 */
export function toggleEnabled(yamlPath: string): ToggleResult {
  try {
    let content = readFileSync(yamlPath, 'utf8');

    const enabledPattern = /^(enabled:\s*)(true|false)\s*$/m;
    const match = enabledPattern.exec(content);

    if (match === null) {
      return { success: false, error: `No 'enabled' field found in ${basename(yamlPath)}` };
    }

    const previousValue = match[2] === 'true';
    const newValue = !previousValue;

    content = content.replace(enabledPattern, `$1${newValue}`);
    writeFileSync(yamlPath, content, 'utf8');

    return { success: true, previousValue, newValue };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Link gate ───────────────────────────────────────────────────────────────

/**
 * Add or remove a gate from a prompt's gateConfiguration.include array.
 * Uses full parse→serialize (comments are lost, but structural edits justify reformatting).
 */
export function linkGate(yamlPath: string, gateId: string, remove = false): LinkGateResult {
  try {
    const data = loadYamlFileSync<Record<string, unknown>>(yamlPath);

    if (data === undefined) {
      return { success: false, error: `Failed to parse ${basename(yamlPath)}` };
    }

    if (remove) {
      // Remove gate from include array
      const gateCfg = data['gateConfiguration'] as Record<string, unknown> | undefined;
      const include = (gateCfg?.['include'] as string[] | undefined) ?? [];

      if (!include.includes(gateId)) {
        return { success: false, error: `Gate '${gateId}' is not linked to this prompt` };
      }

      const filtered = include.filter((g) => g !== gateId);

      if (filtered.length === 0) {
        delete data['gateConfiguration'];
      } else {
        (data['gateConfiguration'] as Record<string, unknown>)['include'] = filtered;
      }

      writeFileSync(yamlPath, serializeYaml(data), 'utf8');
      return { success: true, action: 'removed', include: filtered };
    } else {
      // Add gate to include array
      data['gateConfiguration'] ??= { include: [] };
      const gateCfg = data['gateConfiguration'] as Record<string, unknown>;
      gateCfg['include'] ??= [];
      const include = gateCfg['include'] as string[];

      if (include.includes(gateId)) {
        return { success: false, error: `Gate '${gateId}' is already linked to this prompt` };
      }

      include.push(gateId);
      writeFileSync(yamlPath, serializeYaml(data), 'utf8');
      return { success: true, action: 'added', include };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
