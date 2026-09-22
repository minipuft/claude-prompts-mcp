// @lifecycle canonical - File service for framework YAML read-merge-write operations.
/**
 * Framework File Service
 *
 * Provides read-merge-write pattern for framework YAML files.
 * Ensures updates are additive rather than destructive.
 */

import { existsSync } from 'fs';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { join, relative, sep } from 'path';

import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { FileContentChange } from '../../resource-manager/prompt/analysis/object-diff-generator.js';
import type { FrameworkCreationData } from '../core/types.js';

import {
  ResourceMutationTransaction,
  ResourceVerificationService,
  type ResourceWriteCommitOptions,
} from '#modules/resources/services/index.js';
import { safeWriteFile } from '#shared/utils/file-transactions.js';
import { resolveContainedPath } from '#shared/utils/path-containment.js';
import {
  readYamlSourceSync,
  serializeYamlPreservingSource,
} from '#shared/utils/yaml/yaml-document-writer.js';
import { loadYamlFile } from '#shared/utils/yaml/yaml-file-loader.js';

// ============================================================================
// Types
// ============================================================================

export interface FrameworkFileWriterDependencies {
  logger: Logger;
  configManager: ConfigManager;
  resourceVerificationService?: ResourceVerificationService;
  resourceMutationTransaction?: ResourceMutationTransaction;
}

export interface ExistingFrameworkData {
  framework: Record<string, unknown>;
  phases: Record<string, unknown> | null;
  judgePrompt: string | null;
  frameworkPath: string;
  phasesPath: string | null;
  judgePromptPath: string | null;
}

export interface FrameworkFileResult {
  success: boolean;
  paths?: string[];
  error?: string;
}

/** A file a framework write lands, addressed relative to the framework's own directory. */
interface PlannedFrameworkFile {
  relativePath: string;
  content: string;
}

/**
 * Everything one framework write does, resolved before anything is written.
 *
 * `writeFrameworkFiles` applies it and `projectFrameworkWrite` reports it. A diff built any other
 * way — the framework's recorded fields rendered as one `framework.yaml`, say — misses
 * `phases.yaml` and `judge-prompt.md`, and shows `framework.yaml` lines the
 * merged file never holds (tutorial-rework B.20).
 */
interface FrameworkWritePlan {
  frameworksDir: string;
  frameworkDir: string;
  /** The framework's bundled directory, copied to `frameworkDir` first; null when none is. */
  copyOnWriteSource: string | null;
  /** Where the files this write replaces are before it runs; null when there are none. */
  priorDir: string | null;
  files: PlannedFrameworkFile[];
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Values the writer supplies itself when a CREATE names none. A new framework needs both to load:
 * the schema requires `version` and `enabled`.
 *
 * Never applied to an existing framework, where the stored value is the value. Until
 * tutorial-rework B.65, `buildFrameworkYamlData` emitted `version: 1.0.0` on every call and the
 * update merge laid it over the stored one, so a description edit took CAGEERF from 2.0.0 to 1.0.0
 * (OQ-8: an update keeps everything it was not asked to change).
 */
const FRAMEWORK_CREATION_DEFAULTS: Readonly<Record<string, unknown>> = {
  enabled: true,
  version: '1.0.0',
};

/** Which of the two YAML documents a mapped field may be read from. */
type MappedFieldSource = 'framework' | 'phases';

/** The shape a raw value must have before it is accepted into the authoring payload. */
type MappedFieldAccept = 'array' | 'present' | 'string' | 'boolean';

interface MappedFrameworkField {
  /** Key on `FrameworkCreationData` this lands under. */
  readonly key: string;
  /**
   * Documents and keys to try IN ORDER. Mirrors the `??` chains this replaced, so a `null` at an
   * earlier position falls through to a later one exactly as it did before.
   */
  readonly lookup: ReadonlyArray<readonly [MappedFieldSource, string]>;
  readonly accept: MappedFieldAccept;
}

const ACCEPTS: Record<MappedFieldAccept, (value: unknown) => boolean> = {
  array: (v) => Array.isArray(v),
  present: (v) => v !== undefined && v !== null,
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
};

/**
 * Every field `toFrameworkCreationData` reads back, declared once.
 *
 * YAML stores these camelCase (`frameworkGates`); the authoring payload spells them snake_case
 * (`framework_gates`). Both are accepted on read, which is why several entries carry two lookups.
 * ADDING A FIELD TO THE FRAMEWORK SCHEMA MEANS ADDING A ROW HERE — that coupling is the point:
 * before this table, two fields were written to disk and never read back and nothing noticed.
 */
const MAPPED_FRAMEWORK_FIELDS: readonly MappedFrameworkField[] = [
  { key: 'description', lookup: [['framework', 'description']], accept: 'string' },
  { key: 'type', lookup: [['framework', 'type']], accept: 'string' },
  { key: 'enabled', lookup: [['framework', 'enabled']], accept: 'boolean' },
  { key: 'gates', lookup: [['framework', 'gates']], accept: 'present' },
  { key: 'tool_descriptions', lookup: [['framework', 'tool_descriptions']], accept: 'present' },
  { key: 'phases', lookup: [['phases', 'phases']], accept: 'array' },
  {
    key: 'framework_gates',
    lookup: [
      ['framework', 'frameworkGates'],
      ['phases', 'framework_gates'],
    ],
    accept: 'array',
  },
  {
    key: 'processing_steps',
    lookup: [
      ['phases', 'processingSteps'],
      ['phases', 'processing_steps'],
    ],
    accept: 'array',
  },
  {
    key: 'execution_steps',
    lookup: [
      ['phases', 'executionSteps'],
      ['phases', 'execution_steps'],
    ],
    accept: 'array',
  },
  {
    key: 'quality_indicators',
    lookup: [
      ['phases', 'qualityIndicators'],
      ['phases', 'quality_indicators'],
    ],
    accept: 'present',
  },
  {
    key: 'template_enhancements',
    lookup: [
      ['phases', 'templateEnhancements'],
      ['phases', 'template_enhancements'],
    ],
    accept: 'present',
  },
  {
    key: 'execution_flow',
    lookup: [
      ['phases', 'executionFlow'],
      ['phases', 'execution_flow'],
    ],
    accept: 'present',
  },
  {
    key: 'execution_type_enhancements',
    lookup: [
      ['phases', 'executionTypeEnhancements'],
      ['phases', 'execution_type_enhancements'],
    ],
    accept: 'present',
  },
  {
    key: 'framework_elements',
    lookup: [
      ['framework', 'frameworkElements'],
      ['phases', 'framework_elements'],
    ],
    accept: 'present',
  },
  {
    key: 'argument_suggestions',
    lookup: [
      ['framework', 'argumentSuggestions'],
      ['phases', 'argument_suggestions'],
    ],
    accept: 'array',
  },
  {
    key: 'template_suggestions',
    lookup: [
      ['framework', 'templateSuggestions'],
      ['phases', 'template_suggestions'],
    ],
    accept: 'array',
  },
];

/**
 * Walk a field's lookup chain and return the first value that is neither `undefined` nor `null`.
 * Skipping `null` reproduces `??`, which is what the hand-written chains used.
 */
function resolveMappedValue(
  field: MappedFrameworkField,
  sources: Record<MappedFieldSource, Record<string, unknown>>
): unknown {
  for (const [source, key] of field.lookup) {
    const value = sources[source][key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export class FrameworkFileWriter {
  private logger: Logger;
  private configManager: ConfigManager;
  private readonly verificationService: ResourceVerificationService;
  private readonly mutationTransaction: ResourceMutationTransaction;

  constructor(deps: FrameworkFileWriterDependencies) {
    this.logger = deps.logger;
    this.configManager = deps.configManager;
    this.verificationService =
      deps.resourceVerificationService ?? new ResourceVerificationService();
    this.mutationTransaction =
      deps.resourceMutationTransaction ?? new ResourceMutationTransaction();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Check if a framework exists on the filesystem
   *
   * @param id - Framework identifier
   * @returns true if framework.yaml exists for this ID
   */
  frameworkExists(id: string): boolean {
    const frameworkDir = this.getFrameworkDir(id);
    const frameworkPath = join(frameworkDir, 'framework.yaml');
    return existsSync(frameworkPath);
  }

  /**
   * Delete a framework directory from the filesystem
   *
   * @param id - Framework identifier
   * @returns true if deletion succeeded
   */
  async deleteFramework(id: string): Promise<boolean> {
    const frameworkDir = this.getFrameworkDir(id);

    if (!existsSync(frameworkDir)) {
      return false;
    }

    try {
      const { rm } = await import('fs/promises');
      await rm(frameworkDir, { recursive: true });
      this.logger.debug(`Deleted framework directory: ${frameworkDir}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete framework '${id}':`, error);
      return false;
    }
  }

  /**
   * Load existing framework files from disk
   */
  async loadExistingFramework(id: string): Promise<ExistingFrameworkData | null> {
    // Read from wherever the framework ACTUALLY lives, which is not always where a write would go
    // (P1.2). A framework served from the bundled tree has no directory under the writable root,
    // so this returned null and `handleUpdate` reported `Files may be corrupted` — a false
    // statement about a framework that loads and serves correctly. Measured 2026-08-30: updating
    // bundled `cageerf` under a distinct resources root failed outright.
    const frameworkDir = this.resolveExistingFrameworkDir(id);
    if (frameworkDir === null) {
      return null;
    }
    const frameworkPath = join(frameworkDir, 'framework.yaml');

    try {
      const framework = await loadYamlFile<Record<string, unknown>>(frameworkPath);
      if (framework === undefined) {
        this.logger.error(`Failed to parse framework.yaml for ${id}`);
        return null;
      }

      // Load phases.yaml if referenced
      let phases: Record<string, unknown> | null = null;
      let phasesPath: string | null = null;
      const phasesFileRef = framework['phasesFile'];
      if (phasesFileRef !== undefined && phasesFileRef !== null) {
        // A file REFERENCE is caller-authorable too, and this is a read that returns its content
        // to the client — an uncontained join here discloses an arbitrary file rather than
        // writing one. Same guard, because it is the same class.
        phasesPath = resolveContainedPath(frameworkDir, String(phasesFileRef));
        if (existsSync(phasesPath)) {
          const loadedPhases = await loadYamlFile<Record<string, unknown>>(phasesPath);
          phases = loadedPhases ?? null;
        }
      }

      // No `system-prompt.md` read (R91): a framework's system prompt has one source, the inline
      // `systemPromptGuidance` in `framework.yaml`, which is the only text the runtime serves. A
      // workspace framework still carrying the file is left alone and never read.

      // Load judge-prompt.md if referenced
      let judgePrompt: string | null = null;
      let judgePromptPath: string | null = null;
      const judgePromptFileRef = framework['judgePromptFile'];
      if (judgePromptFileRef !== undefined && judgePromptFileRef !== null) {
        judgePromptPath = resolveContainedPath(frameworkDir, String(judgePromptFileRef));
        if (existsSync(judgePromptPath)) {
          judgePrompt = await readFile(judgePromptPath, 'utf8');
        }
      }

      return {
        framework,
        phases,
        judgePrompt,
        frameworkPath,
        phasesPath,
        judgePromptPath,
      };
    } catch (error) {
      this.logger.error(`Error loading framework ${id}:`, error);
      return null;
    }
  }

  /**
   * Convert raw ExistingFrameworkData to typed FrameworkCreationData.
   * Extracts and maps fields from YAML structure to the typed interface.
   *
   * @param id - Framework identifier
   * @param existing - Raw framework data loaded from disk
   * @returns Typed FrameworkCreationData or null if essential fields missing
   */
  /**
   * Read one framework.yaml/phases.yaml document back into the authoring payload shape.
   *
   * The field-by-field mapping is DECLARED in `MAPPED_FRAMEWORK_FIELDS` rather than written as one
   * `if` per field (P4.13). Fifteen near-identical blocks put this function at cognitive
   * complexity 28 against the ≤15 limit, and — the reason that mattered — two of the eleven
   * advanced fields were simply missing from the sequence with nothing to notice it: `judge_prompt`
   * and `execution_type_enhancements` were written to disk and never read back, for as long as
   * they had existed (P4-F12). A table cannot silently omit an entry the way a sequence of blocks
   * can, because the entry is the thing you add.
   */
  toFrameworkCreationData(
    id: string,
    existing: ExistingFrameworkData
  ): FrameworkCreationData | null {
    const { framework, phases } = existing;

    // Extract required fields from raw YAML (use bracket notation for Record<string, unknown>).
    // `systemPromptGuidance` is the YAML spelling `buildFrameworkYamlData` emits and the runtime
    // loader reads. This read used the payload spelling `system_prompt_guidance`, which no
    // framework.yaml carries, so every framework without a `system-prompt.md` beside it read back
    // as incomplete and `inspect` reported no quality score for it.
    const rawName = framework['name'];
    const rawSystemGuidance = framework['systemPromptGuidance'];
    const name = typeof rawName === 'string' ? rawName : undefined;
    const systemGuidance = typeof rawSystemGuidance === 'string' ? rawSystemGuidance : undefined;

    if (name === undefined || systemGuidance === undefined) {
      this.logger.debug(`Framework '${id}' missing required fields for completeness check`);
      return null;
    }

    // Build typed creation data from raw YAML fields
    const rawTypeValue = framework['type'];
    const data: FrameworkCreationData = {
      id,
      name,
      type: typeof rawTypeValue === 'string' ? rawTypeValue : id.toUpperCase(),
      system_prompt_guidance: systemGuidance,
    };

    // `existing.judgePrompt` is already inlined from `judgePromptFile` by `loadExistingFramework`
    // (above), so it is the one mapped field whose source is neither YAML document. It stays
    // outside the table for that reason rather than by oversight.
    if (typeof existing.judgePrompt === 'string') {
      data.judge_prompt = existing.judgePrompt;
    }

    // `phases.yaml` is optional; when absent every phases-side key is read off framework.yaml.
    const phasesSource = phases ?? framework;
    const sources: Record<MappedFieldSource, Record<string, unknown>> = {
      framework,
      phases: phasesSource,
    };

    for (const field of MAPPED_FRAMEWORK_FIELDS) {
      const value = resolveMappedValue(field, sources);
      if (value !== undefined && ACCEPTS[field.accept](value)) {
        (data as unknown as Record<string, unknown>)[field.key] = value;
      }
    }

    return data;
  }

  /**
   * Write framework files with optional merge from existing data
   * @param data - Framework data (can be partial for updates)
   * @param existingData - Existing framework data to merge with (null for create)
   */
  async writeFrameworkFiles(
    data: Partial<FrameworkCreationData> & { id: string },
    existingData?: ExistingFrameworkData | null,
    options: ResourceWriteCommitOptions = {}
  ): Promise<FrameworkFileResult> {
    // Every byte this write lands is decided here, before the transaction opens; the mutation
    // below applies the plan and decides nothing of its own, which is what keeps
    // `projectFrameworkWrite` reporting the same files and contents.
    const plan = this.planFrameworkWrite(data, existingData);
    const { frameworkDir, copyOnWriteSource } = plan;
    const frameworkYamlPath = join(frameworkDir, 'framework.yaml');

    const txResult = await this.mutationTransaction.run({
      targets: [{ path: frameworkDir, kind: 'directory' }],
      mutate: async () => {
        const paths: string[] = [];

        if (copyOnWriteSource !== null) {
          await cp(copyOnWriteSource, frameworkDir, { recursive: true });
          this.logger.info(
            `Copied framework '${data.id}' from ${copyOnWriteSource} into ${frameworkDir} before editing — ` +
              'this is now a separate copy, and updates to the bundled framework will not reach it'
          );
        }

        await mkdir(frameworkDir, { recursive: true });
        paths.push(frameworkDir);

        for (const file of plan.files) {
          const filePath = join(frameworkDir, file.relativePath);
          await safeWriteFile(filePath, file.content);
          paths.push(filePath);
        }

        return { paths };
      },
      validate: () =>
        this.verificationService.validateFile('frameworks', data.id, frameworkYamlPath),
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
    });

    if (!txResult.success) {
      return {
        success: false,
        error: txResult.rolledBack
          ? `Framework write failed and was rolled back: ${txResult.error}`
          : `Framework write failed: ${txResult.error}`,
      };
    }

    return { success: true, paths: txResult.result?.paths ?? [] };
  }

  /**
   * What `writeFrameworkFiles(data, existingData)` would change on disk, file by file, without
   * writing anything.
   *
   * Resolves the plan that method applies, so the files and contents are exactly that call's.
   * Paths are relative to the frameworks root. A framework copied up from the bundled tree is read
   * from its bundled files; both roots address it by the same id, so its path is the same on each
   * side.
   */
  async projectFrameworkWrite(
    data: Partial<FrameworkCreationData> & { id: string },
    existingData?: ExistingFrameworkData | null
  ): Promise<FileContentChange[]> {
    const plan = this.planFrameworkWrite(data, existingData);
    const prefix = relative(plan.frameworksDir, plan.frameworkDir);

    const changes: FileContentChange[] = [];
    for (const file of plan.files) {
      const priorPath = plan.priorDir !== null ? join(plan.priorDir, file.relativePath) : null;
      const relativePath = join(prefix, file.relativePath).split(sep).join('/');
      changes.push({
        path: relativePath,
        previousPath: relativePath,
        before:
          priorPath !== null && existsSync(priorPath) ? await readFile(priorPath, 'utf8') : null,
        after: file.content,
      });
    }
    return changes;
  }

  /**
   * Resolve where one framework write lands and the files it writes there, writing nothing.
   *
   * The single place those answers are decided, so `writeFrameworkFiles` and
   * `projectFrameworkWrite` share them.
   */
  private planFrameworkWrite(
    data: Partial<FrameworkCreationData> & { id: string },
    existingData: ExistingFrameworkData | null | undefined
  ): FrameworkWritePlan {
    const frameworkDir = this.getFrameworkDir(data.id);

    // P1.2 — copy the whole source subtree up before editing, when the framework lives in the
    // bundled tree and the write goes elsewhere. Same reasoning as prompts: the files below are
    // reconstructed from data, so anything else in the directory — `judge-prompt.md`,
    // `system-prompt.md`, any file a future framework carries — would simply not exist at the
    // destination.
    const existingDir = this.resolveExistingFrameworkDir(data.id);
    const copyOnWriteSource =
      existingDir !== null && existingDir !== frameworkDir && !existsSync(frameworkDir)
        ? existingDir
        : null;

    return {
      frameworksDir: this.configManager.getFrameworksDirectory(),
      frameworkDir,
      copyOnWriteSource,
      // A copy puts the prior tree at `frameworkDir` before any file is written, so the content a
      // write replaces is the copy source's.
      priorDir: existsSync(frameworkDir) ? frameworkDir : copyOnWriteSource,
      files: this.planFrameworkFiles(data, existingData ?? null, frameworkDir),
    };
  }

  /**
   * The files a framework write lands, in write order, as the exact bytes each will hold.
   *
   * Write-scope narrowing, the framework counterpart of `planGateWrite` and `planPromptFiles`
   * (tutorial-rework B.28 for gates, B.65 here). A create or a repair (`existingData === null`)
   * owns the whole framework and lands every file it has content for. An edit of an existing
   * framework lands a file only when merging the payload into it changes what it holds. Every file
   * it does not change stays byte-identical, comments and flow style included, because it is never
   * written. Before B.65 every update re-serialized `framework.yaml` and the phases file, including
   * a phases file the update never named.
   *
   * The test is "the merge changes it" rather than the gate writer's "a key resident in it was
   * supplied". Both give the same answer for a resident key with a new value. Only this one gives
   * the right answer for the companion references: a phases edit emits `phasesFile`, which
   * `framework.yaml` already declares with the same name. Keying on what was supplied would
   * re-serialize `framework.yaml` for that reference alone.
   */
  private planFrameworkFiles(
    data: Partial<FrameworkCreationData> & { id: string },
    existingData: ExistingFrameworkData | null,
    frameworkDir: string
  ): PlannedFrameworkFile[] {
    // The framework's OWN declared names win over the defaults — a hand-authored or seeded
    // `framework.yaml` naming `custom-phases.yaml` keeps that name across every future write.
    // Falls back to the canonical names only when nothing is declared (create, or an existing
    // framework that never named one). Resolving before `buildFrameworkYamlData` runs means the
    // `phasesFile`/`judgePromptFile` fields it writes and the file names below are always the
    // same string — the prior code hardcoded the fallback into both, which silently renamed a
    // framework's companion files the first time an update touched phases or judge_prompt, and
    // orphaned the declared file with stale content on every update after that.
    const companionFiles = {
      phasesFile: this.resolveDeclaredFileName(
        frameworkDir,
        existingData?.framework['phasesFile'],
        'phases.yaml'
      ),
      judgePromptFile: this.resolveDeclaredFileName(
        frameworkDir,
        existingData?.framework['judgePromptFile'],
        'judge-prompt.md'
      ),
    };

    const files: PlannedFrameworkFile[] = [];

    // Where the files this write replaces live RIGHT NOW. For the first local edit of a bundled
    // framework, `frameworkDir` does not exist yet and the prior text — comments included — is
    // still in the bundled tree that copy-on-write is about to duplicate. Reading `frameworkDir`
    // alone would find nothing there and re-render the framework from scratch, which is exactly
    // the layout loss this write is avoiding, on the one edit most likely to hit an authored file.
    const priorFrameworkDir = existsSync(frameworkDir)
      ? frameworkDir
      : this.resolveExistingFrameworkDir(data.id);

    const frameworkYaml = this.planFrameworkYamlData(
      data,
      existingData?.framework ?? null,
      companionFiles
    );
    if (frameworkYaml !== null) {
      files.push({
        relativePath: 'framework.yaml',
        content: serializeYamlPreservingSource(
          frameworkYaml,
          readYamlSourceSync(join(priorFrameworkDir ?? frameworkDir, 'framework.yaml'))
        ).content,
      });
    }

    const phasesData = this.planPhasesYamlData(data, existingData?.phases ?? null);
    if (phasesData !== null) {
      files.push({
        relativePath: companionFiles.phasesFile,
        content: serializeYamlPreservingSource(
          phasesData,
          readYamlSourceSync(join(priorFrameworkDir ?? frameworkDir, companionFiles.phasesFile))
        ).content,
      });
    }

    if (this.changesText(data.judge_prompt, existingData?.judgePrompt ?? null)) {
      files.push({ relativePath: companionFiles.judgePromptFile, content: data.judge_prompt });
    }

    return files;
  }

  /**
   * The `framework.yaml` document this write lands, or null when it leaves the file as it is.
   *
   * On create, the payload plus `FRAMEWORK_CREATION_DEFAULTS` for whatever it left out. On an edit,
   * the payload merged over the stored document, WITHOUT `id`: the id addresses the framework and
   * the stored one stays. Null when that merge equals the stored document.
   */
  private planFrameworkYamlData(
    data: Partial<FrameworkCreationData> & { id: string },
    existingFramework: Record<string, unknown> | null,
    companionFiles: { phasesFile: string; judgePromptFile: string }
  ): Record<string, unknown> | null {
    const supplied = this.buildFrameworkYamlData(data, companionFiles);
    if (existingFramework === null) {
      const created = { ...supplied };
      for (const [key, value] of Object.entries(FRAMEWORK_CREATION_DEFAULTS)) {
        created[key] ??= value;
      }
      return created;
    }

    const edits = Object.fromEntries(Object.entries(supplied).filter(([key]) => key !== 'id'));
    const merged = this.deepMerge(existingFramework, edits);
    return isDeepStrictEqual(merged, existingFramework) ? null : merged;
  }

  /**
   * Whether a companion text file is written: the payload supplies non-empty content for it and
   * that content differs from what the file holds. An empty string writes nothing, as before.
   */
  private changesText(supplied: string | undefined, existing: string | null): supplied is string {
    return supplied !== undefined && supplied !== '' && supplied !== existing;
  }

  /**
   * The companion file name a framework declares for one field, or `fallback` when it declares
   * none.
   *
   * Validated by name against `frameworkDir` before it is ever joined into a path — the same
   * class of guard `getFrameworkDir` applies to a caller-supplied id, just for a field the
   * framework's OWN author controls (`framework.yaml`, hand-authored or seeded). A declared name
   * like `../x.yaml` throws here rather than resolving outside the framework's folder.
   */
  private resolveDeclaredFileName(
    frameworkDir: string,
    declared: unknown,
    fallback: string
  ): string {
    if (typeof declared !== 'string' || declared === '') {
      return fallback;
    }
    resolveContainedPath(frameworkDir, declared);
    return declared;
  }

  /**
   * The merged `phases.yaml` document, or null when the write lands no phases file — including
   * when merging the payload leaves the stored phases document as it is.
   */
  private planPhasesYamlData(
    data: Partial<FrameworkCreationData>,
    existingPhases: Record<string, unknown> | null
  ): Record<string, unknown> | null {
    const newPhasesData = this.buildPhasesYamlData(data);
    if (existingPhases === null) {
      return Object.keys(newPhasesData).length > 0 ? newPhasesData : null;
    }
    const merged = this.deepMerge(existingPhases, newPhasesData);
    return isDeepStrictEqual(merged, existingPhases) ? null : merged;
  }

  // ==========================================================================
  // YAML Data Builders
  // ==========================================================================

  /**
   * Build framework.yaml data from input (only sets defined fields)
   *
   * `companionFiles` names the files `phasesFile`/`judgePromptFile` point at when this write sets
   * them — the framework's own declared names when it has any, the canonical defaults otherwise
   * (`planFrameworkFiles` resolves which). Defaulted here too, so a direct caller with no
   * declared framework still gets the canonical names rather than an undefined reference.
   */
  buildFrameworkYamlData(
    data: Partial<FrameworkCreationData> & { id: string },
    companionFiles: { phasesFile: string; judgePromptFile: string } = {
      phasesFile: 'phases.yaml',
      judgePromptFile: 'judge-prompt.md',
    }
  ): Record<string, unknown> {
    const yamlData: Record<string, unknown> = {};

    // Core fields - id is always required
    yamlData['id'] = data.id.toLowerCase();

    // Copied only when supplied, in the order a created file lists them.
    //
    // `description` is read back by `toFrameworkCreationData`, carried in
    // OPTIONAL_FRAMEWORK_FIELDS, and reported in the update diff — but until 2026-08-17 it was
    // never written here, so `resource_manager framework update description:"..."` reported a
    // successful change the file never received (the old value survived only because
    // `writeFrameworkFiles` deep-merges over the existing YAML). Recording it in a version
    // snapshot while no write path could restore it is the same defect one layer up, which is
    // how it surfaced.
    //
    // `enabled` was `data.enabled ?? true` until B.65, which laid `true` over the stored value on
    // every edit. A create with none still gets `true`, from `FRAMEWORK_CREATION_DEFAULTS`.
    const suppliedFields: ReadonlyArray<readonly [string, unknown]> = [
      ['name', data.name],
      ['type', data.type],
      ['description', data.description],
      ['enabled', data.enabled],
      ['systemPromptGuidance', data.system_prompt_guidance],
    ];
    for (const [key, value] of suppliedFields) {
      if (value !== undefined) {
        yamlData[key] = value;
      }
    }

    // Check if a phases file is needed
    if (this.needsPhasesFile(data)) {
      yamlData['phasesFile'] = companionFiles.phasesFile;
    }

    // Optional fields (only if defined)
    if (data.gates !== undefined) {
      yamlData['gates'] = data.gates;
    }
    if (data.tool_descriptions !== undefined) {
      yamlData['toolDescriptions'] = data.tool_descriptions;
    }

    // Advanced framework fields (only if defined and non-empty)
    if (data.framework_gates !== undefined && data.framework_gates.length > 0) {
      yamlData['frameworkGates'] = data.framework_gates;
    }
    if (data.template_suggestions !== undefined && data.template_suggestions.length > 0) {
      yamlData['templateSuggestions'] = data.template_suggestions;
    }
    if (data.framework_elements !== undefined) {
      yamlData['frameworkElements'] = data.framework_elements;
    }
    if (data.argument_suggestions !== undefined && data.argument_suggestions.length > 0) {
      yamlData['argumentSuggestions'] = data.argument_suggestions;
    }
    if (data.judge_prompt !== undefined) {
      yamlData['judgePromptFile'] = companionFiles.judgePromptFile;
    }

    // No `version`: the payload has no field for it. A create gets one from
    // `FRAMEWORK_CREATION_DEFAULTS`; an edit keeps the stored one (B.65).
    return yamlData;
  }

  /**
   * Build phases.yaml data from input (only sets defined fields)
   */
  buildPhasesYamlData(data: Partial<FrameworkCreationData>): Record<string, unknown> {
    const phasesData: Record<string, unknown> = {};

    if (data.phases !== undefined && data.phases.length > 0) {
      phasesData['phases'] = data.phases;
    }
    if (data.processing_steps !== undefined && data.processing_steps.length > 0) {
      phasesData['processingSteps'] = data.processing_steps;
    }
    if (data.execution_steps !== undefined && data.execution_steps.length > 0) {
      phasesData['executionSteps'] = data.execution_steps;
    }
    if (data.execution_type_enhancements !== undefined) {
      phasesData['executionTypeEnhancements'] = data.execution_type_enhancements;
    }
    if (data.template_enhancements !== undefined) {
      phasesData['templateEnhancements'] = data.template_enhancements;
    }
    if (data.execution_flow !== undefined) {
      phasesData['executionFlow'] = data.execution_flow;
    }
    if (data.quality_indicators !== undefined) {
      phasesData['qualityIndicators'] = data.quality_indicators;
    }

    return phasesData;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Get the directory path for a framework.
   * Used by versioning service to locate history files.
   */
  /**
   * The directory a framework currently lives in: the writable root when it is resident there,
   * otherwise the bundled root, otherwise null (no such framework anywhere).
   *
   * Distinct from `getFrameworkDir`, which answers where a write GOES. Keeping the two questions
   * separate is the whole of P1.2 — collapsing them is what made a bundled framework unreadable
   * to its own updater.
   */
  public resolveExistingFrameworkDir(id: string): string | null {
    const writable = this.getFrameworkDir(id);
    if (existsSync(join(writable, 'framework.yaml'))) return writable;

    const bundledRoot = this.configManager.getBundledResourceDirectory('frameworks');
    if (bundledRoot === undefined) return null;
    const bundled = resolveContainedPath(bundledRoot, id.toLowerCase());
    return existsSync(join(bundled, 'framework.yaml')) ? bundled : null;
  }

  public getFrameworkDir(id: string): string {
    // Single choke point for every framework path, so containment holds for write, delete and
    // versioning alike. Measured 2026-08-30: `id: '../../ESCAPED_FW'` wrote framework.yaml,
    // phases.yaml and system-prompt.md outside the resources root, reported as created, with a
    // benign-id control succeeding beside it.
    return resolveContainedPath(this.configManager.getFrameworksDirectory(), id.toLowerCase());
  }

  private needsPhasesFile(data: Partial<FrameworkCreationData>): boolean {
    return (
      (data.phases !== undefined && data.phases.length > 0) ||
      data.processing_steps !== undefined ||
      data.execution_steps !== undefined ||
      data.execution_type_enhancements !== undefined ||
      data.template_enhancements !== undefined ||
      data.execution_flow !== undefined ||
      data.quality_indicators !== undefined
    );
  }

  /**
   * Deep-merge source into target
   * - Arrays: replaced (not merged)
   * - Objects: recursively merged
   * - undefined: skipped (preserves target value)
   */
  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      const sourceValue = source[key];
      const targetValue = target[key];

      // Skip undefined (don't overwrite with nothing)
      if (sourceValue === undefined) {
        continue;
      }

      // Recursive merge for plain objects
      if (this.isPlainObject(sourceValue) && this.isPlainObject(targetValue)) {
        result[key] = this.deepMerge(targetValue, sourceValue);
      } else {
        // Replace for arrays, primitives, nulls
        result[key] = sourceValue;
      }
    }

    return result;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }
}
