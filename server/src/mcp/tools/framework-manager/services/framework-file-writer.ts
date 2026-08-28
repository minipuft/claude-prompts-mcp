// @lifecycle canonical - File service for framework YAML read-merge-write operations.
/**
 * Framework File Service
 *
 * Provides read-merge-write pattern for framework YAML files.
 * Ensures updates are additive rather than destructive.
 */

import { existsSync } from 'fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'path';

import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { FrameworkCreationData } from '../core/types.js';

import {
  ResourceMutationTransaction,
  ResourceVerificationService,
} from '#modules/resources/services/index.js';
import { safeWriteFile } from '#shared/utils/file-transactions.js';
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
    const frameworkDir = this.getFrameworkDir(id);
    const frameworkPath = join(frameworkDir, 'framework.yaml');

    if (!existsSync(frameworkPath)) {
      return null;
    }

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
        phasesPath = join(frameworkDir, String(phasesFileRef));
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
        judgePromptPath = join(frameworkDir, String(judgePromptFileRef));
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
    existingData?: ExistingFrameworkData | null
  ): Promise<FrameworkFileResult> {
    const frameworkDir = this.getFrameworkDir(data.id);
    const frameworkYamlPath = join(frameworkDir, 'framework.yaml');

    const txResult = await this.mutationTransaction.run({
      targets: [{ path: frameworkDir, kind: 'directory' }],
      mutate: async () => {
        const paths: string[] = [];

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
  public getFrameworkDir(id: string): string {
    return join(this.configManager.getFrameworksDirectory(), id.toLowerCase());
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
