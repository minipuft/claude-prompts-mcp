// @lifecycle canonical - File service for methodology YAML read-merge-write operations.
/**
 * Methodology File Service
 *
 * Provides read-merge-write pattern for methodology YAML files.
 * Ensures updates are additive rather than destructive.
 */

import { existsSync } from 'fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'path';

import {
  ResourceMutationTransaction,
  ResourceVerificationService,
} from '../../../../modules/resources/services/index.js';
import { safeWriteFile } from '../../../../shared/utils/file-transactions.js';
import { loadYamlFile } from '../../../../shared/utils/yaml/yaml-file-loader.js';
import { serializeYaml } from '../../../../shared/utils/yaml/yaml-parser.js';

import type { ConfigManager, Logger } from '../../../../shared/types/index.js';
import type { FrameworkCreationData } from '../core/types.js';

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
  methodology: Record<string, unknown>;
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
   * Check if a methodology exists on the filesystem
   *
   * @param id - Methodology identifier
   * @returns true if framework.yaml exists for this ID
   */
  frameworkExists(id: string): boolean {
    const frameworkDir = this.getFrameworkDir(id);
    const frameworkPath = join(frameworkDir, 'framework.yaml');
    return existsSync(frameworkPath);
  }

  /**
   * Delete a methodology directory from the filesystem
   *
   * @param id - Methodology identifier
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
      this.logger.debug(`Deleted methodology directory: ${frameworkDir}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete methodology '${id}':`, error);
      return false;
    }
  }

  /**
   * Load existing methodology files from disk
   */
  async loadExistingFramework(id: string): Promise<ExistingFrameworkData | null> {
    const frameworkDir = this.getFrameworkDir(id);
    const frameworkPath = join(frameworkDir, 'framework.yaml');

    if (!existsSync(frameworkPath)) {
      return null;
    }

    try {
      const methodology = await loadYamlFile<Record<string, unknown>>(frameworkPath);
      if (methodology === undefined) {
        this.logger.error(`Failed to parse framework.yaml for ${id}`);
        return null;
      }

      // Load phases.yaml if referenced
      let phases: Record<string, unknown> | null = null;
      let phasesPath: string | null = null;
      const phasesFileRef = methodology['phasesFile'];
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
      const judgePromptFileRef = methodology['judgePromptFile'];
      if (judgePromptFileRef !== undefined && judgePromptFileRef !== null) {
        judgePromptPath = join(frameworkDir, String(judgePromptFileRef));
        if (existsSync(judgePromptPath)) {
          judgePrompt = await readFile(judgePromptPath, 'utf8');
        }
      }

      return {
        methodology,
        phases,
        systemPrompt,
        judgePrompt,
        frameworkPath,
        phasesPath,
        systemPromptPath,
        judgePromptPath,
      };
    } catch (error) {
      this.logger.error(`Error loading methodology ${id}:`, error);
      return null;
    }
  }

  /**
   * Convert raw ExistingFrameworkData to typed FrameworkCreationData.
   * Extracts and maps fields from YAML structure to the typed interface.
   *
   * @param id - Methodology identifier
   * @param existing - Raw methodology data loaded from disk
   * @returns Typed FrameworkCreationData or null if essential fields missing
   */
  toFrameworkCreationData(
    id: string,
    existing: ExistingFrameworkData
  ): FrameworkCreationData | null {
    const { methodology, phases, systemPrompt } = existing;

    // Extract required fields from raw YAML (use bracket notation for Record<string, unknown>)
    const rawName = methodology['name'];
    const rawSystemGuidance = methodology['system_prompt_guidance'];
    const name = typeof rawName === 'string' ? rawName : undefined;
    const systemGuidance =
      systemPrompt ?? (typeof rawSystemGuidance === 'string' ? rawSystemGuidance : undefined);

    if (name === undefined || systemGuidance === undefined) {
      this.logger.debug(`Methodology '${id}' missing required fields for completeness check`);
      return null;
    }

    // Build typed creation data from raw YAML fields
    const rawTypeValue = methodology['type'];
    const data: FrameworkCreationData = {
      id,
      name,
      type: typeof rawTypeValue === 'string' ? rawTypeValue : id.toUpperCase(),
      system_prompt_guidance: systemGuidance,
    };

    // Map optional fields from framework.yaml (use bracket notation)
    const rawDescription = methodology['description'];
    const rawType = methodology['type'];
    const rawEnabled = methodology['enabled'];
    const rawGates = methodology['gates'];
    const rawToolDescriptions = methodology['tool_descriptions'];

    if (typeof rawDescription === 'string') data.description = rawDescription;
    if (typeof rawType === 'string') data.type = rawType;
    if (typeof rawEnabled === 'boolean') data.enabled = rawEnabled;
    if (rawGates !== undefined && rawGates !== null) {
      data.gates = rawGates as NonNullable<FrameworkCreationData['gates']>;
    }
    if (rawToolDescriptions !== undefined && rawToolDescriptions !== null) {
      data.tool_descriptions = rawToolDescriptions as NonNullable<
        FrameworkCreationData['tool_descriptions']
      >;
    }

    // Map phases-related fields (may come from phases.yaml or framework.yaml)
    // YAML uses camelCase (frameworkGates); methodologyGates is the pre-rename spelling and
    // methodology_gates the snake_case authoring-payload key. Accept all three on read.
    const phasesSource = phases ?? methodology;
    const rawPhases = phasesSource['phases'];
    const rawFrameworkGates =
      methodology['frameworkGates'] ??
      methodology['methodologyGates'] ??
      phasesSource['methodology_gates'];
    const rawProcessingSteps = phasesSource['processingSteps'] ?? phasesSource['processing_steps'];
    const rawExecutionSteps = phasesSource['executionSteps'] ?? phasesSource['execution_steps'];
    const rawQualityIndicators =
      phasesSource['qualityIndicators'] ?? phasesSource['quality_indicators'];
    const rawTemplateEnhancements =
      phasesSource['templateEnhancements'] ?? phasesSource['template_enhancements'];
    const rawExecutionFlow = phasesSource['executionFlow'] ?? phasesSource['execution_flow'];
    const rawFrameworkElements =
      methodology['frameworkElements'] ?? phasesSource['methodology_elements'];
    const rawArgumentSuggestions =
      methodology['argumentSuggestions'] ?? phasesSource['argument_suggestions'];
    const rawTemplateSuggestions =
      methodology['templateSuggestions'] ?? phasesSource['template_suggestions'];

    if (Array.isArray(rawPhases)) {
      data.phases = rawPhases as NonNullable<FrameworkCreationData['phases']>;
    }
    if (Array.isArray(rawFrameworkGates)) {
      data.methodology_gates = rawFrameworkGates as NonNullable<
        FrameworkCreationData['methodology_gates']
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
      data.template_enhancements = rawTemplateEnhancements as NonNullable<
        FrameworkCreationData['template_enhancements']
      >;
    }
    if (rawExecutionFlow !== undefined && rawExecutionFlow !== null) {
      data.execution_flow = rawExecutionFlow as NonNullable<
        FrameworkCreationData['execution_flow']
      >;
    }
    if (rawFrameworkElements !== undefined && rawFrameworkElements !== null) {
      data.methodology_elements = rawFrameworkElements as NonNullable<
        FrameworkCreationData['methodology_elements']
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
   * Write methodology files with optional merge from existing data
   * @param data - Methodology data (can be partial for updates)
   * @param existingData - Existing methodology data to merge with (null for create)
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
            ? this.deepMerge(existingData.methodology, newFrameworkData)
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
          ? `Methodology write failed and was rolled back: ${txResult.error}`
          : `Methodology write failed: ${txResult.error}`,
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

    // Advanced methodology fields (only if defined and non-empty)
    if (data.methodology_gates !== undefined && data.methodology_gates.length > 0) {
      yamlData['frameworkGates'] = data.methodology_gates;
    }
    if (data.template_suggestions !== undefined && data.template_suggestions.length > 0) {
      yamlData['templateSuggestions'] = data.template_suggestions;
    }
    if (data.methodology_elements !== undefined) {
      yamlData['frameworkElements'] = data.methodology_elements;
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
   * Get the directory path for a methodology.
   * Used by versioning service to locate history files.
   */
  public getFrameworkDir(id: string): string {
    const serverRoot = this.configManager.getServerRoot();
    return join(serverRoot, 'resources', 'frameworks', id.toLowerCase());
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
