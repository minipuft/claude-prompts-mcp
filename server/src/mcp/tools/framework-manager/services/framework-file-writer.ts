// @lifecycle canonical - File service for framework YAML read-merge-write operations.
/**
 * Framework File Service
 *
 * Provides read-merge-write pattern for framework YAML files.
 * Ensures updates are additive rather than destructive.
 */

import { existsSync } from 'fs';
import { cp, mkdir, readFile } from 'node:fs/promises';
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
import { loadYamlFile } from '#shared/utils/yaml/yaml-file-loader.js';
import { serializeYaml } from '#shared/utils/yaml/yaml-parser.js';

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
  systemPrompt: string | null;
  judgePrompt: string | null;
  frameworkPath: string;
  phasesPath: string | null;
  systemPromptPath: string;
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
 * `system-prompt.md`, `phases.yaml` and `judge-prompt.md`, and shows `framework.yaml` lines the
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

      // Load system-prompt.md
      const systemPromptPath = join(frameworkDir, 'system-prompt.md');
      let systemPrompt: string | null = null;
      if (existsSync(systemPromptPath)) {
        systemPrompt = await readFile(systemPromptPath, 'utf8');
      }

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
        systemPrompt,
        judgePrompt,
        frameworkPath,
        phasesPath,
        systemPromptPath,
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
  toFrameworkCreationData(
    id: string,
    existing: ExistingFrameworkData
  ): FrameworkCreationData | null {
    const { framework, phases, systemPrompt } = existing;

    // Extract required fields from raw YAML (use bracket notation for Record<string, unknown>)
    const rawName = framework['name'];
    const rawSystemGuidance = framework['system_prompt_guidance'];
    const name = typeof rawName === 'string' ? rawName : undefined;
    const systemGuidance =
      systemPrompt ?? (typeof rawSystemGuidance === 'string' ? rawSystemGuidance : undefined);

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

    // Map optional fields from framework.yaml (use bracket notation)
    const rawDescription = framework['description'];
    const rawType = framework['type'];
    const rawEnabled = framework['enabled'];
    const rawGates = framework['gates'];
    const rawToolDescriptions = framework['tool_descriptions'];

    if (typeof rawDescription === 'string') data.description = rawDescription;
    if (typeof rawType === 'string') data.type = rawType;
    if (typeof rawEnabled === 'boolean') data.enabled = rawEnabled;
    if (rawGates !== undefined && rawGates !== null) {
      data.gates = rawGates;
    }
    if (rawToolDescriptions !== undefined && rawToolDescriptions !== null) {
      data.tool_descriptions = rawToolDescriptions as NonNullable<
        FrameworkCreationData['tool_descriptions']
      >;
    }
    // `existing.judgePrompt` is already inlined from `judgePromptFile` by `loadExistingFramework`
    // (above) — this was the one advanced field that read-back reached (P4.11 measured) but never
    // carried into `FrameworkCreationData`, so `inspect` could never surface it regardless of
    // renderer. Same "loaded and thrown away" shape as the other ten, just one call deeper.
    if (typeof existing.judgePrompt === 'string') {
      data.judge_prompt = existing.judgePrompt;
    }

    // Map phases-related fields (may come from phases.yaml or framework.yaml)
    // YAML uses camelCase (frameworkGates); framework_gates is the snake_case authoring-payload
    // key. Accept both on read.
    const phasesSource = phases ?? framework;
    const rawPhases = phasesSource['phases'];
    const rawFrameworkGates = framework['frameworkGates'] ?? phasesSource['framework_gates'];
    const rawProcessingSteps = phasesSource['processingSteps'] ?? phasesSource['processing_steps'];
    const rawExecutionSteps = phasesSource['executionSteps'] ?? phasesSource['execution_steps'];
    const rawQualityIndicators =
      phasesSource['qualityIndicators'] ?? phasesSource['quality_indicators'];
    const rawTemplateEnhancements =
      phasesSource['templateEnhancements'] ?? phasesSource['template_enhancements'];
    const rawExecutionFlow = phasesSource['executionFlow'] ?? phasesSource['execution_flow'];
    const rawExecutionTypeEnhancements =
      phasesSource['executionTypeEnhancements'] ?? phasesSource['execution_type_enhancements'];
    const rawFrameworkElements =
      framework['frameworkElements'] ?? phasesSource['framework_elements'];
    const rawArgumentSuggestions =
      framework['argumentSuggestions'] ?? phasesSource['argument_suggestions'];
    const rawTemplateSuggestions =
      framework['templateSuggestions'] ?? phasesSource['template_suggestions'];

    if (Array.isArray(rawPhases)) {
      data.phases = rawPhases as NonNullable<FrameworkCreationData['phases']>;
    }
    if (Array.isArray(rawFrameworkGates)) {
      data.framework_gates = rawFrameworkGates as NonNullable<
        FrameworkCreationData['framework_gates']
      >;
    }
    if (Array.isArray(rawProcessingSteps)) {
      data.processing_steps = rawProcessingSteps as NonNullable<
        FrameworkCreationData['processing_steps']
      >;
    }
    if (Array.isArray(rawExecutionSteps)) {
      data.execution_steps = rawExecutionSteps as NonNullable<
        FrameworkCreationData['execution_steps']
      >;
    }
    if (rawQualityIndicators !== undefined && rawQualityIndicators !== null) {
      data.quality_indicators = rawQualityIndicators as NonNullable<
        FrameworkCreationData['quality_indicators']
      >;
    }
    if (rawTemplateEnhancements !== undefined && rawTemplateEnhancements !== null) {
      data.template_enhancements = rawTemplateEnhancements;
    }
    if (rawExecutionFlow !== undefined && rawExecutionFlow !== null) {
      data.execution_flow = rawExecutionFlow;
    }
    // P4.11 measured: written by `writeFrameworkFiles` (`phasesData['executionTypeEnhancements']`
    // below) but never mapped back here — the one advanced field that had neither a read-back nor
    // a WRITTEN-then-thrown-away shape; it was simply never read. Same class as `judge_prompt`
    // above, caught by the same create-then-inspect proof.
    if (rawExecutionTypeEnhancements !== undefined && rawExecutionTypeEnhancements !== null) {
      data.execution_type_enhancements = rawExecutionTypeEnhancements;
    }
    if (rawFrameworkElements !== undefined && rawFrameworkElements !== null) {
      data.framework_elements = rawFrameworkElements as NonNullable<
        FrameworkCreationData['framework_elements']
      >;
    }
    if (Array.isArray(rawArgumentSuggestions)) {
      data.argument_suggestions = rawArgumentSuggestions as NonNullable<
        FrameworkCreationData['argument_suggestions']
      >;
    }
    if (Array.isArray(rawTemplateSuggestions)) {
      data.template_suggestions = rawTemplateSuggestions as NonNullable<
        FrameworkCreationData['template_suggestions']
      >;
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

  /** The files a framework write lands, in write order, as the exact bytes each will hold. */
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

    const newFrameworkData = this.buildFrameworkYamlData(data, companionFiles);
    const finalFrameworkData =
      existingData !== null
        ? this.deepMerge(existingData.framework, newFrameworkData)
        : newFrameworkData;
    const files: PlannedFrameworkFile[] = [
      {
        relativePath: 'framework.yaml',
        content: serializeYaml(finalFrameworkData, { sortKeys: false }),
      },
    ];

    const phasesData = this.planPhasesYamlData(data, existingData?.phases ?? null);
    if (phasesData !== null) {
      files.push({
        relativePath: companionFiles.phasesFile,
        content: serializeYaml(phasesData, { sortKeys: false }),
      });
    }

    const systemPromptContent = data.system_prompt_guidance ?? existingData?.systemPrompt ?? '';
    if (systemPromptContent !== '') {
      files.push({ relativePath: 'system-prompt.md', content: systemPromptContent });
    }

    const judgePromptContent = data.judge_prompt ?? existingData?.judgePrompt ?? '';
    if (judgePromptContent !== '') {
      files.push({ relativePath: companionFiles.judgePromptFile, content: judgePromptContent });
    }

    return files;
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

  /** The merged `phases.yaml` document, or null when the write lands no phases file. */
  private planPhasesYamlData(
    data: Partial<FrameworkCreationData>,
    existingPhases: Record<string, unknown> | null
  ): Record<string, unknown> | null {
    if (!this.needsPhasesFile(data) && existingPhases === null) {
      return null;
    }
    const newPhasesData = this.buildPhasesYamlData(data);
    const hasNewPhasesData = Object.keys(newPhasesData).length > 0;
    const finalPhasesData =
      existingPhases !== null && hasNewPhasesData
        ? this.deepMerge(existingPhases, newPhasesData)
        : (existingPhases ?? newPhasesData);
    return Object.keys(finalPhasesData).length > 0 ? finalPhasesData : null;
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
    const typeValue = data.type;

    // Core fields - id is always required
    yamlData['id'] = data.id.toLowerCase();

    // Only set name if provided (for partial updates)
    if (data.name !== undefined) {
      yamlData['name'] = data.name;
    }

    if (typeValue !== undefined) {
      yamlData['type'] = typeValue;
    }

    // `description` is read back by `toFrameworkCreationData`, carried in
    // OPTIONAL_FRAMEWORK_FIELDS, and reported in the update diff — but until 2026-08-17 it was
    // never written here, so `resource_manager framework update description:"..."` reported a
    // successful change the file never received (the old value survived only because
    // `writeFrameworkFiles` deep-merges over the existing YAML). Recording it in a version
    // snapshot while no write path could restore it is the same defect one layer up, which is
    // how it surfaced.
    if (data.description !== undefined) {
      yamlData['description'] = data.description;
    }

    // Enabled defaults to true
    yamlData['enabled'] = data.enabled ?? true;

    // System prompt guidance
    if (data.system_prompt_guidance !== undefined) {
      yamlData['systemPromptGuidance'] = data.system_prompt_guidance;
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

    // Always set version for new frameworks
    yamlData['version'] ??= '1.0.0';

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
