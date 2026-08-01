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
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import {
  type ResourceValidationResult,
  type ResourceValidationType,
  validateResourceFile,
} from './resource-validation.js';
import { renameHistoryResource } from './version-history.js';

import { loadYamlFileSync, serializeYaml } from '#shared/utils/yaml/index.js';

// ── Result types ────────────────────────────────────────────────────────────

export interface RenameResult {
  success: boolean;
  oldDir?: string;
  newDir?: string;
  error?: string;
}

export interface MoveResult {
  success: boolean;
  oldDir?: string;
  newDir?: string;
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
  oldDir?: string;
  newDir?: string;
  error?: string;
}

export interface ValidatedMutationOptions<TMutation extends ResourceMutationResult> {
  resourceType: ResourceValidationType;
  resourceId: string;
  resourceDir: string;
  entryFile: string;
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

function restoreDirectory(snapshotDir: string, targetDir: string): void {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(dirname(targetDir), { recursive: true });
  cpSync(snapshotDir, targetDir, { recursive: true });
}

function createMutationSnapshot(resourceDir: string): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'cpm-mutation-'));
  const dir = join(root, 'snapshot');
  cpSync(resourceDir, dir, { recursive: true });
  return { root, dir };
}

function cleanupSnapshot(snapshot: { root: string; dir: string } | null): void {
  if (snapshot !== null) {
    rmSync(snapshot.root, { recursive: true, force: true });
  }
}

function rollbackMutation(snapshotDir: string, mutatedDir: string, originalDir: string): void {
  if (mutatedDir !== originalDir) {
    rmSync(mutatedDir, { recursive: true, force: true });
  }
  restoreDirectory(snapshotDir, originalDir);
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
  const mutatedDir = operation.newDir ?? options.resourceDir;
  const validationPath = join(mutatedDir, options.entryFile);
  const expectedId =
    operation.newDir !== undefined ? basename(operation.newDir) : options.resourceId;
  return validator(options.resourceType, expectedId, validationPath);
}

export function runValidatedMutation<TMutation extends ResourceMutationResult>(
  options: ValidatedMutationOptions<TMutation>
): ValidatedMutationResult<TMutation> {
  const validator = options.validator ?? validateResourceFile;
  const validateMutation = options.validate !== false;
  const snapshot = validateMutation ? createMutationSnapshot(options.resourceDir) : null;

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
      const originalDir = operation.oldDir ?? options.resourceDir;
      const mutatedDir = operation.newDir ?? options.resourceDir;
      rollbackMutation(snapshot.dir, mutatedDir, originalDir);
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

/**
 * Rename a resource: update `id:` field in YAML, rename directory, update history.
 * Uses string replacement to preserve YAML comments.
 */
export function renameResource(
  resourceDir: string,
  entryFile: string,
  oldId: string,
  newId: string
): RenameResult {
  try {
    const yamlPath = join(resourceDir, entryFile);
    let content = readFileSync(yamlPath, 'utf8');

    // Replace the id field (first match of `id: <value>` at line start)
    const idPattern = /^(id:\s*).+$/m;
    if (!idPattern.test(content)) {
      return { success: false, error: `No 'id' field found in ${entryFile}` };
    }
    content = content.replace(idPattern, `$1${newId}`);
    writeFileSync(yamlPath, content, 'utf8');

    // Rename directory
    const newDir = join(dirname(resourceDir), newId);
    if (existsSync(newDir)) {
      return { success: false, error: `Target directory already exists: ${newDir}` };
    }
    renameSync(resourceDir, newDir);

    // Update SQLite version history resource_id if present
    renameHistoryResource(newDir, oldId, newId);

    return { success: true, oldDir: resourceDir, newDir };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Move (prompt category) ──────────────────────────────────────────────────

/**
 * Move a prompt to a different category: update `category:` field, relocate directory.
 * Uses string replacement to preserve YAML comments.
 */
export function movePromptCategory(
  resourceDir: string,
  entryFile: string,
  promptId: string,
  newCategory: string,
  promptsBaseDir: string
): MoveResult {
  try {
    const yamlPath = join(resourceDir, entryFile);
    let content = readFileSync(yamlPath, 'utf8');

    // Extract current category
    const catPattern = /^(category:\s*)(.+)$/m;
    const catMatch = catPattern.exec(content);

    if (catMatch === null) {
      return { success: false, error: `No 'category' field found in ${entryFile}` };
    }

    const oldCategory = (catMatch[2] ?? '').trim();

    if (oldCategory === newCategory) {
      return {
        success: false,
        oldCategory,
        error: `Prompt is already in category '${newCategory}'`,
      };
    }

    // Replace category field
    content = content.replace(catPattern, `$1${newCategory}`);
    writeFileSync(yamlPath, content, 'utf8');

    // Move directory
    const newDir = join(promptsBaseDir, newCategory, promptId);
    mkdirSync(dirname(newDir), { recursive: true });

    if (existsSync(newDir)) {
      return { success: false, error: `Target directory already exists: ${newDir}` };
    }
    renameSync(resourceDir, newDir);

    return { success: true, oldDir: resourceDir, newDir, oldCategory };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Toggle enabled ──────────────────────────────────────────────────────────

/**
 * Flip the `enabled:` field in a resource YAML (true↔false).
 * Uses string replacement to preserve YAML comments.
 */
export function toggleEnabled(resourceDir: string, entryFile: string): ToggleResult {
  try {
    const yamlPath = join(resourceDir, entryFile);
    let content = readFileSync(yamlPath, 'utf8');

    const enabledPattern = /^(enabled:\s*)(true|false)\s*$/m;
    const match = enabledPattern.exec(content);

    if (match === null) {
      return { success: false, error: `No 'enabled' field found in ${entryFile}` };
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
export function linkGate(
  resourceDir: string,
  entryFile: string,
  gateId: string,
  remove = false
): LinkGateResult {
  try {
    const yamlPath = join(resourceDir, entryFile);
    const data = loadYamlFileSync<Record<string, unknown>>(yamlPath);

    if (data === undefined) {
      return { success: false, error: `Failed to parse ${entryFile}` };
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
