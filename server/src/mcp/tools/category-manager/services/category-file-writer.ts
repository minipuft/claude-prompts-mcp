// @lifecycle canonical - Service-layer category.yaml writes with verification and rollback guarantees.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rmdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { overlayDecidedYamlKeys } from '../../shared/yaml-key-overlay.js';

import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { FileContentChange } from '../../resource-manager/prompt/analysis/object-diff-generator.js';
import type { CategoryCreationData } from '../core/types.js';

import { CATEGORY_YAML_DECLARED_KEYS } from '#modules/prompts/category-yaml-keys.js';
import {
  ResourceMutationTransaction,
  ResourceVerificationService,
  type ResourceVerificationFailurePayload,
  type ResourceWriteCommitOptions,
} from '#modules/resources/services/index.js';
import { resolveContainedPath } from '#shared/utils/path-containment.js';
import { parseYaml, serializeYaml } from '#shared/utils/yaml/yaml-parser.js';

/** The `category.yaml` file name, in one place so reader and writer cannot disagree about it. */
export const CATEGORY_YAML_FILENAME = 'category.yaml';

/**
 * `category.yaml` keys `buildCategoryYaml` writes directly from `CategoryCreationData` — always,
 * because `CategorySchema` requires all three. Never candidates for the generic carry-forward
 * below: the code above already decides their fate.
 */
const CATEGORY_YAML_PROJECTED_KEYS = ['id', 'name', 'description'] as const;

/**
 * Authorable `category.yaml` keys `CategoryFileWriter` builds no value for — carried forward from
 * the on-disk file when the caller didn't supply one. Without this, ANY `resource_manager` update
 * on a hand-authored category setting these silently strips them back to loader defaults, which
 * is the same class already fixed for prompts (`PRESERVED_PROMPT_YAML_KEYS`) and gates
 * (`PRESERVED_GATE_YAML_KEYS`).
 *
 * Derived from `CATEGORY_YAML_DECLARED_KEYS` (the prompts-side walk of `CategorySchema`'s declared
 * object keys) minus the projected set, so a future schema field lands here automatically with
 * nothing to update by hand. There is no manual tail as there is for gates: `CategorySchema` is a
 * plain `z.object` with no `.passthrough()`, so every key it accepts is a key it declares.
 */
export const PRESERVED_CATEGORY_YAML_KEYS = CATEGORY_YAML_DECLARED_KEYS.filter(
  (key) => !(CATEGORY_YAML_PROJECTED_KEYS as readonly string[]).includes(key)
);

export { CATEGORY_YAML_PROJECTED_KEYS };

/**
 * Every `category.yaml` key a category write decides (P4.67) — the projected keys
 * `buildCategoryYaml` always writes plus the preserved keys `resolvePreservedCategoryYamlFields`
 * resolves from the call or the file. For `category.yaml` that is every key `CATEGORY_YAML_DECLARED_KEYS`
 * names, since there is no excluded set here as there is for gates' `guidance`.
 *
 * `CategorySchema` has no `.passthrough()` call, but its default Zod parse mode already strips an
 * unrecognized key without failing validation, so a hand-authored `category.yaml` may carry one
 * and `validateCategorySchema` will not refuse it. `buildCategoryYaml`'s output holds no value for
 * such a key, and BEFORE `overlayDecidedYamlKeys` was introduced here, a document rebuilt from
 * that output alone dropped it on every write — the same shape already fixed for prompts (P4.57)
 * and gates (this row).
 */
const CATEGORY_YAML_DECIDED_KEYS: ReadonlySet<string> = new Set(CATEGORY_YAML_DECLARED_KEYS);

/**
 * Decide what each preserved key should carry into the rewritten YAML: an explicitly supplied
 * value if the caller had one, otherwise whatever the file itself already declared, otherwise
 * nothing. Mirrors `resolvePreservedGateYamlFields` exactly.
 */
function resolvePreservedCategoryYamlFields(
  categoryData: Record<string, unknown>,
  existingYaml: Record<string, unknown> | undefined
): Record<string, unknown> {
  const preserved: Record<string, unknown> = {};

  for (const key of PRESERVED_CATEGORY_YAML_KEYS) {
    const supplied = categoryData[key];
    if (supplied !== undefined) {
      preserved[key] = supplied;
      continue;
    }
    const declared = existingYaml?.[key];
    if (declared !== undefined) {
      preserved[key] = declared;
    }
  }

  return preserved;
}

/**
 * The `category.yaml` a category directory declares, or `undefined` when it declares none.
 *
 * Shared by the writer (field preservation) and by `inspect` (P4.11: render from the source that
 * distinguishes an authored value from a default). One reader, because the two would otherwise
 * disagree about what "the file declares nothing" means — and that distinction is the entire
 * point on both sides.
 *
 * A missing or unparseable file is not an error here. A create has no prior file; an unparseable
 * one is about to be replaced wholesale by the write this feeds, and `inspect` reports the
 * absence of declarations rather than failing. The write itself is still validated afterward by
 * `ResourceVerificationService` inside the mutation transaction.
 */
export async function readCategoryYamlDocument(
  yamlPath: string,
  logger?: Logger
): Promise<Record<string, unknown> | undefined> {
  if (!existsSync(yamlPath)) {
    return undefined;
  }

  try {
    const raw = await readFile(yamlPath, 'utf8');
    const parsed = parseYaml<Record<string, unknown> | null>(raw, { filename: yamlPath });
    // An empty or `null` document parses successfully to a non-object — nothing declared.
    if (!parsed.success || parsed.data == null || typeof parsed.data !== 'object') {
      logger?.warn(`[CategoryFileWriter] Could not read existing category.yaml: ${yamlPath}`);
      return undefined;
    }
    return parsed.data;
  } catch (error) {
    logger?.warn(
      `[CategoryFileWriter] Could not read existing category.yaml: ${yamlPath} (${String(error)})`
    );
    return undefined;
  }
}

export interface CategoryFileWriterDependencies {
  logger: Logger;
  configManager: ConfigManager;
  resourceVerificationService?: ResourceVerificationService;
  resourceMutationTransaction?: ResourceMutationTransaction;
}

export interface CategoryFileWriteResult {
  success: boolean;
  paths?: string[];
  error?: string;
  verificationFailure?: ResourceVerificationFailurePayload;
}

/**
 * Everything one category write puts on disk, resolved before anything is written.
 *
 * `writeCategoryFiles` applies it and `projectCategoryWrite` reports it. A diff built any other
 * way — the recorded fields rendered as one `category.yaml`, say — describes no file on disk:
 * `buildCategoryYaml` decides the document's key order and carries the preserved keys forward
 * from the file itself, and a comparison of two field maps can see neither (tutorial-rework B.20).
 */
interface CategoryWritePlan {
  categoriesRoot: string;
  categoryDir: string;
  yamlPath: string;
  /** `category.yaml` alone, as the exact bytes the write leaves. A category has no second file. */
  files: Array<{ relativePath: string; content: string }>;
}

export class CategoryFileWriter {
  private readonly logger: Logger;
  private readonly configManager: ConfigManager;
  private readonly verificationService: ResourceVerificationService;
  private readonly mutationTransaction: ResourceMutationTransaction;

  constructor(dependencies: CategoryFileWriterDependencies) {
    this.logger = dependencies.logger;
    this.configManager = dependencies.configManager;
    this.verificationService =
      dependencies.resourceVerificationService ?? new ResourceVerificationService();
    this.mutationTransaction =
      dependencies.resourceMutationTransaction ?? new ResourceMutationTransaction();
  }

  /** The writable prompts root — where a category write lands, and only ever there. */
  categoriesRoot(): string {
    return this.configManager.getResolvedPromptsDirectory();
  }

  /**
   * The directory a category id names under `root`, refusing a segment that escapes it.
   *
   * Throws rather than returning a fallback: `id` is caller-supplied and `path.join` resolves
   * `..` silently, and this same join feeds a recursive delete in the lifecycle processor.
   */
  categoryDir(root: string, id: string): string {
    return resolveContainedPath(root, id);
  }

  /** The `category.yaml` path for `id` under `root`. Contained by construction. */
  categoryYamlPath(root: string, id: string): string {
    return path.join(this.categoryDir(root, id), CATEGORY_YAML_FILENAME);
  }

  async writeCategoryFiles(
    data: CategoryCreationData,
    options: ResourceWriteCommitOptions = {}
  ): Promise<CategoryFileWriteResult> {
    // Every byte this write lands is decided here, before the transaction opens; the mutation
    // below applies the plan and decides nothing of its own, which is what keeps
    // `projectCategoryWrite` reporting the same file and the same contents.
    let plan: CategoryWritePlan;
    try {
      plan = await this.planCategoryWrite(data);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    const { categoryDir, yamlPath } = plan;

    const directoryExisted = existsSync(categoryDir);

    const transactionResult = await this.mutationTransaction.run({
      // The FILE, not the directory — and this is the one place this writer differs from its
      // gate and framework siblings on purpose. For those two the directory IS the resource, so
      // snapshotting it is snapshotting the thing being written. A category directory holds
      // every PROMPT in the category, which this write never touches: targeting the directory
      // would copy and restore hundreds of unrelated files on a metadata edit, and a rollback
      // defect there would delete prompts. The document is the resource; the directory is its
      // container.
      targets: [{ path: yamlPath, kind: 'file' }],
      mutate: async () => {
        const paths: string[] = [];
        // `recursive: true` rather than a create/update branch. A category directory that does
        // not exist in the WRITABLE root is the ordinary case under a workspace overlay: the
        // category may be served entirely from the bundled tree, and writing its declaration
        // here is what makes the workspace copy exist. The bundled prompts keep loading from the
        // bundled root — a category write deliberately does NOT copy the subtree the way a
        // prompt write does (P1.2), because for a category the subtree is other resources.
        await mkdir(categoryDir, { recursive: true });

        for (const file of plan.files) {
          const filePath = path.join(categoryDir, file.relativePath);
          await writeFile(filePath, file.content, 'utf8');
          paths.push(filePath);
        }

        return { paths };
      },
      // The whole reason this writer validates at all: `loader.ts` reads `category.yaml` with a
      // bare `as Partial<Category>` cast and validates NOTHING, so a malformed document degrades
      // silently to derived defaults instead of failing. A writer that assumed the loader would
      // catch its output would be assuming a check that does not exist.
      validate: () => this.verificationService.validateFile('categories', data.id, yamlPath),
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
    });

    if (!transactionResult.success) {
      // The transaction restores the FILE (removing it when it did not exist). It knows nothing
      // about the directory `mutate` may have created, so a failed create would otherwise leave
      // an empty directory behind — which the loader reads as a real, empty category. Removed
      // only when this call created it AND nothing else landed in it.
      if (!directoryExisted) {
        await this.removeDirectoryIfEmpty(categoryDir);
      }

      const verificationFailure =
        transactionResult.verificationFailure ??
        (transactionResult.validation !== undefined && !transactionResult.validation.valid
          ? this.verificationService.toFailurePayload(
              transactionResult.validation,
              transactionResult.rolledBack
            )
          : undefined);

      if (transactionResult.verificationFailure !== undefined) {
        this.logger.warn(
          `[CategoryFileWriter] Verification failed for category '${data.id}' (rolledBack=${String(
            transactionResult.verificationFailure.rolledBack
          )})`
        );
      }

      return {
        success: false,
        verificationFailure,
        error: transactionResult.error,
      };
    }

    return { success: true, paths: transactionResult.result?.paths ?? [] };
  }

  /**
   * What `writeCategoryFiles(data)` would change on disk, file by file, without writing anything.
   *
   * Resolves the plan that method applies, so the file and its contents are exactly that call's.
   * The path is relative to the prompts root — `<id>/category.yaml` — and it is the only path this
   * ever names: a category write touches the declaration and none of the prompts the directory
   * holds, so neither does its diff. A category with no declaration in the WRITABLE root yet — a
   * create, or a category so far served only from the bundled tree — has no prior content, because
   * the write authors its declaration here rather than editing the bundled one.
   *
   * Mirrors `projectGateWrite` and `projectFrameworkWrite`; it takes no `suppliedKeys` because a
   * category write has one file and nothing to narrow to.
   */
  async projectCategoryWrite(data: CategoryCreationData): Promise<FileContentChange[]> {
    const plan = await this.planCategoryWrite(data);
    const prefix = path.relative(plan.categoriesRoot, plan.categoryDir);

    const changes: FileContentChange[] = [];
    for (const file of plan.files) {
      const priorPath = path.join(plan.categoryDir, file.relativePath);
      const relativePath = path.join(prefix, file.relativePath).split(path.sep).join('/');
      changes.push({
        path: relativePath,
        previousPath: relativePath,
        before: existsSync(priorPath) ? await readFile(priorPath, 'utf8') : null,
        after: file.content,
      });
    }
    return changes;
  }

  /**
   * Resolve the file one category write lands, reading the disk but writing nothing.
   *
   * The single place that content is decided, so `writeCategoryFiles` and `projectCategoryWrite`
   * share one answer. Throws when `data.id` escapes the prompts root — `categoryDir` is the
   * containment check, and both callers are responsible for a caller-supplied id.
   */
  private async planCategoryWrite(data: CategoryCreationData): Promise<CategoryWritePlan> {
    const categoriesRoot = this.categoriesRoot();
    const categoryDir = this.categoryDir(categoriesRoot, data.id);
    const yamlPath = path.join(categoryDir, CATEGORY_YAML_FILENAME);

    // Read BEFORE anything is written — an update overwrites this same path, and a create has
    // nothing here yet. This read is also what a projection reports as the file's prior state.
    const existingYaml = await readCategoryYamlDocument(yamlPath, this.logger);

    return {
      categoriesRoot,
      categoryDir,
      yamlPath,
      files: [
        {
          relativePath: CATEGORY_YAML_FILENAME,
          content: serializeYaml(
            overlayDecidedYamlKeys(
              existingYaml,
              this.buildCategoryYaml(data, existingYaml),
              CATEGORY_YAML_DECIDED_KEYS
            ),
            { sortKeys: false }
          ),
        },
      ],
    };
  }

  private buildCategoryYaml(
    data: CategoryCreationData,
    existingYaml?: Record<string, unknown>
  ): Record<string, unknown> {
    const yamlData: Record<string, unknown> = {
      id: data.id,
      name: data.name,
      description: data.description,
    };

    // Carry forward the fields this writer builds no value for. Without this, every update
    // silently strips them back to loader defaults (registerWithMcp, mcpPromptMode, ...).
    Object.assign(
      yamlData,
      resolvePreservedCategoryYamlFields(data as unknown as Record<string, unknown>, existingYaml)
    );

    return yamlData;
  }

  private async removeDirectoryIfEmpty(directory: string): Promise<void> {
    try {
      const entries = await readdir(directory);
      if (entries.length === 0) {
        await rmdir(directory);
      }
    } catch {
      // Already gone, or not removable. Either way there is nothing further to clean up, and the
      // caller is already reporting a failure — a second error here would replace the real one.
    }
  }
}
