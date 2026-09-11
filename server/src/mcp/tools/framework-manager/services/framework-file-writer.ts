// @lifecycle canonical - File service for framework YAML read-merge-write operations.
/**
 * Framework File Service
 *
 * Provides read-merge-write pattern for framework YAML files.
 * Ensures updates are additive rather than destructive.
 */

import { existsSync } from 'fs';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'path';

import type { ConfigManager, Logger } from '#shared/types/index.js';
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

// ============================================================================
// Service Implementation
// ============================================================================

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
    const frameworkDir = this.getFrameworkDir(data.id);
    const frameworkYamlPath = join(frameworkDir, 'framework.yaml');

    // P1.2 — copy the whole source subtree up before editing, when the framework lives in the
    // bundled tree and the write goes elsewhere. Same reasoning as prompts: the merge below
    // reconstructs `framework.yaml` and `phases.yaml` from data, so anything else in the
    // directory — `judge-prompt.md`, `system-prompt.md`, any file a future framework carries —
    // would simply not exist at the destination.
    const existingDir = this.resolveExistingFrameworkDir(data.id);
    const copyOnWriteSource =
      existingDir !== null && existingDir !== frameworkDir && !existsSync(frameworkDir)
        ? existingDir
        : null;

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

        // Build and merge framework.yaml
        const newFrameworkData = this.buildFrameworkYamlData(data);
        const finalFrameworkData =
          existingData !== undefined && existingData !== null
            ? this.deepMerge(existingData.framework, newFrameworkData)
            : newFrameworkData;

        const frameworkContent = serializeYaml(finalFrameworkData, { sortKeys: false });
        await safeWriteFile(frameworkYamlPath, frameworkContent);
        paths.push(frameworkYamlPath);

        // Handle phases.yaml
        const existingPhases = existingData?.phases ?? null;
        const needsPhasesFile = this.needsPhasesFile(data) || existingPhases !== null;
        if (needsPhasesFile) {
          const newPhasesData = this.buildPhasesYamlData(data);
          const hasNewPhasesData = Object.keys(newPhasesData).length > 0;
          const finalPhasesData =
            existingPhases !== null && hasNewPhasesData
              ? this.deepMerge(existingPhases, newPhasesData)
              : (existingPhases ?? newPhasesData);

          if (Object.keys(finalPhasesData).length > 0) {
            const phasesPath = join(frameworkDir, 'phases.yaml');
            const phasesContent = serializeYaml(finalPhasesData, { sortKeys: false });
            await safeWriteFile(phasesPath, phasesContent);
            paths.push(phasesPath);
          }
        }

        // Handle system-prompt.md
        const systemPromptPath = join(frameworkDir, 'system-prompt.md');
        const systemPromptContent = data.system_prompt_guidance ?? existingData?.systemPrompt ?? '';
        if (systemPromptContent !== '') {
          await safeWriteFile(systemPromptPath, systemPromptContent);
          paths.push(systemPromptPath);
        }

        // Handle judge-prompt.md
        const existingJudgePrompt = existingData?.judgePrompt ?? null;
        const hasJudgePrompt = data.judge_prompt !== undefined || existingJudgePrompt !== null;
        if (hasJudgePrompt) {
          const judgePromptPath = join(frameworkDir, 'judge-prompt.md');
          const judgePromptContent = data.judge_prompt ?? existingJudgePrompt ?? '';
          if (judgePromptContent !== '') {
            await safeWriteFile(judgePromptPath, judgePromptContent);
            paths.push(judgePromptPath);
          }
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

  // ==========================================================================
  // YAML Data Builders
  // ==========================================================================

  /**
   * Build framework.yaml data from input (only sets defined fields)
   */
  buildFrameworkYamlData(
    data: Partial<FrameworkCreationData> & { id: string }
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

    // Check if phases.yaml is needed
    if (this.needsPhasesFile(data)) {
      yamlData['phasesFile'] = 'phases.yaml';
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
      yamlData['judgePromptFile'] = 'judge-prompt.md';
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
