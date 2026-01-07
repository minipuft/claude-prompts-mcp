// @lifecycle canonical - File service for methodology YAML read-merge-write operations.
/**
 * Methodology File Service
 *
 * Provides read-merge-write pattern for methodology YAML files.
 * Ensures updates are additive rather than destructive.
 */

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

import { performTransactionalFileOperations, safeWriteFile } from '../../../prompts/promptUtils.js';
import { loadYamlFile } from '../../../utils/yaml/yaml-file-loader.js';
import { serializeYaml } from '../../../utils/yaml/yaml-parser.js';

import type { ConfigManager } from '../../../config/index.js';
import type { Logger } from '../../../logging/index.js';
import type { MethodologyCreationData } from '../core/types.js';

// ============================================================================
// Types
// ============================================================================

export interface MethodologyFileServiceDependencies {
  logger: Logger;
  configManager: ConfigManager;
}

export interface ExistingMethodologyData {
  methodology: Record<string, unknown>;
  phases: Record<string, unknown> | null;
  systemPrompt: string | null;
  judgePrompt: string | null;
  methodologyPath: string;
  phasesPath: string | null;
  systemPromptPath: string;
  judgePromptPath: string | null;
}

export interface MethodologyFileResult {
  success: boolean;
  paths?: string[];
  error?: string;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class MethodologyFileService {
  private logger: Logger;
  private configManager: ConfigManager;

  constructor(deps: MethodologyFileServiceDependencies) {
    this.logger = deps.logger;
    this.configManager = deps.configManager;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Check if a methodology exists on the filesystem
   *
   * @param id - Methodology identifier
   * @returns true if methodology.yaml exists for this ID
   */
  methodologyExists(id: string): boolean {
    const methodologyDir = this.getMethodologyDir(id);
    const methodologyPath = join(methodologyDir, 'methodology.yaml');
    return existsSync(methodologyPath);
  }

  /**
   * Delete a methodology directory from the filesystem
   *
   * @param id - Methodology identifier
   * @returns true if deletion succeeded
   */
  async deleteMethodology(id: string): Promise<boolean> {
    const methodologyDir = this.getMethodologyDir(id);

    if (!existsSync(methodologyDir)) {
      return false;
    }

    try {
      const { rm } = await import('fs/promises');
      await rm(methodologyDir, { recursive: true });
      this.logger.debug(`Deleted methodology directory: ${methodologyDir}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete methodology '${id}':`, error);
      return false;
    }
  }

  /**
   * Load existing methodology files from disk
   */
  async loadExistingMethodology(id: string): Promise<ExistingMethodologyData | null> {
    const methodologyDir = this.getMethodologyDir(id);
    const methodologyPath = join(methodologyDir, 'methodology.yaml');

    if (!existsSync(methodologyPath)) {
      return null;
    }

    try {
      const methodology = await loadYamlFile<Record<string, unknown>>(methodologyPath);
      if (methodology === undefined) {
        this.logger.error(`Failed to parse methodology.yaml for ${id}`);
        return null;
      }

      // Load phases.yaml if referenced
      let phases: Record<string, unknown> | null = null;
      let phasesPath: string | null = null;
      const phasesFileRef = methodology['phasesFile'];
      if (phasesFileRef !== undefined && phasesFileRef !== null) {
        phasesPath = join(methodologyDir, String(phasesFileRef));
        if (existsSync(phasesPath)) {
          const loadedPhases = await loadYamlFile<Record<string, unknown>>(phasesPath);
          phases = loadedPhases ?? null;
        }
      }

      // Load system-prompt.md
      const systemPromptPath = join(methodologyDir, 'system-prompt.md');
      let systemPrompt: string | null = null;
      if (existsSync(systemPromptPath)) {
        systemPrompt = await readFile(systemPromptPath, 'utf8');
      }

      // Load judge-prompt.md if referenced
      let judgePrompt: string | null = null;
      let judgePromptPath: string | null = null;
      const judgePromptFileRef = methodology['judgePromptFile'];
      if (judgePromptFileRef !== undefined && judgePromptFileRef !== null) {
        judgePromptPath = join(methodologyDir, String(judgePromptFileRef));
        if (existsSync(judgePromptPath)) {
          judgePrompt = await readFile(judgePromptPath, 'utf8');
        }
      }

      return {
        methodology,
        phases,
        systemPrompt,
        judgePrompt,
        methodologyPath,
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
   * Convert raw ExistingMethodologyData to typed MethodologyCreationData.
   * Extracts and maps fields from YAML structure to the typed interface.
   *
   * @param id - Methodology identifier
   * @param existing - Raw methodology data loaded from disk
   * @returns Typed MethodologyCreationData or null if essential fields missing
   */
  toMethodologyCreationData(
    id: string,
    existing: ExistingMethodologyData
  ): MethodologyCreationData | null {
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
    const rawMethodology = methodology['methodology'];
    const data: MethodologyCreationData = {
      id,
      name,
      methodology: typeof rawMethodology === 'string' ? rawMethodology : id.toUpperCase(),
      system_prompt_guidance: systemGuidance,
    };

    // Map optional fields from methodology.yaml (use bracket notation)
    const rawDescription = methodology['description'];
    const rawType = methodology['type'];
    const rawEnabled = methodology['enabled'];
    const rawGates = methodology['gates'];
    const rawToolDescriptions = methodology['tool_descriptions'];

    if (typeof rawDescription === 'string') data.description = rawDescription;
    if (typeof rawType === 'string') data.type = rawType;
    if (typeof rawEnabled === 'boolean') data.enabled = rawEnabled;
    if (rawGates !== undefined && rawGates !== null) {
      data.gates = rawGates as NonNullable<MethodologyCreationData['gates']>;
    }
    if (rawToolDescriptions !== undefined && rawToolDescriptions !== null) {
      data.tool_descriptions = rawToolDescriptions as NonNullable<
        MethodologyCreationData['tool_descriptions']
      >;
    }

    // Map phases-related fields (may come from phases.yaml or methodology.yaml)
    // Note: YAML uses camelCase (methodologyGates), but also check snake_case for legacy support
    const phasesSource = phases ?? methodology;
    const rawPhases = phasesSource['phases'];
    const rawMethodologyGates =
      methodology['methodologyGates'] ?? phasesSource['methodology_gates'];
    const rawProcessingSteps = phasesSource['processingSteps'] ?? phasesSource['processing_steps'];
    const rawExecutionSteps = phasesSource['executionSteps'] ?? phasesSource['execution_steps'];
    const rawQualityIndicators =
      phasesSource['qualityIndicators'] ?? phasesSource['quality_indicators'];
    const rawTemplateEnhancements =
      phasesSource['templateEnhancements'] ?? phasesSource['template_enhancements'];
    const rawExecutionFlow = phasesSource['executionFlow'] ?? phasesSource['execution_flow'];
    const rawMethodologyElements =
      methodology['methodologyElements'] ?? phasesSource['methodology_elements'];
    const rawArgumentSuggestions =
      methodology['argumentSuggestions'] ?? phasesSource['argument_suggestions'];
    const rawTemplateSuggestions =
      methodology['templateSuggestions'] ?? phasesSource['template_suggestions'];

    if (Array.isArray(rawPhases)) {
      data.phases = rawPhases as NonNullable<MethodologyCreationData['phases']>;
    }
    if (Array.isArray(rawMethodologyGates)) {
      data.methodology_gates = rawMethodologyGates as NonNullable<
        MethodologyCreationData['methodology_gates']
      >;
    }
    if (Array.isArray(rawProcessingSteps)) {
      data.processing_steps = rawProcessingSteps as NonNullable<
        MethodologyCreationData['processing_steps']
      >;
    }
    if (Array.isArray(rawExecutionSteps)) {
      data.execution_steps = rawExecutionSteps as NonNullable<
        MethodologyCreationData['execution_steps']
      >;
    }
    if (rawQualityIndicators !== undefined && rawQualityIndicators !== null) {
      data.quality_indicators = rawQualityIndicators as NonNullable<
        MethodologyCreationData['quality_indicators']
      >;
    }
    if (rawTemplateEnhancements !== undefined && rawTemplateEnhancements !== null) {
      data.template_enhancements = rawTemplateEnhancements as NonNullable<
        MethodologyCreationData['template_enhancements']
      >;
    }
    if (rawExecutionFlow !== undefined && rawExecutionFlow !== null) {
      data.execution_flow = rawExecutionFlow as NonNullable<
        MethodologyCreationData['execution_flow']
      >;
    }
    if (rawMethodologyElements !== undefined && rawMethodologyElements !== null) {
      data.methodology_elements = rawMethodologyElements as NonNullable<
        MethodologyCreationData['methodology_elements']
      >;
    }
    if (Array.isArray(rawArgumentSuggestions)) {
      data.argument_suggestions = rawArgumentSuggestions as NonNullable<
        MethodologyCreationData['argument_suggestions']
      >;
    }
    if (Array.isArray(rawTemplateSuggestions)) {
      data.template_suggestions = rawTemplateSuggestions as NonNullable<
        MethodologyCreationData['template_suggestions']
      >;
    }

    return data;
  }

  /**
   * Write methodology files with optional merge from existing data
   * @param data - Methodology data (can be partial for updates)
   * @param existingData - Existing methodology data to merge with (null for create)
   */
  async writeMethodologyFiles(
    data: Partial<MethodologyCreationData> & { id: string },
    existingData?: ExistingMethodologyData | null
  ): Promise<MethodologyFileResult> {
    const methodologyDir = this.getMethodologyDir(data.id);
    const paths: string[] = [];
    const operations: Array<() => Promise<void>> = [];
    const rollbacks: Array<() => Promise<void>> = [];

    try {
      // Ensure directory exists
      await mkdir(methodologyDir, { recursive: true });
      paths.push(methodologyDir);

      // Build and merge methodology.yaml
      const newMethodologyData = this.buildMethodologyYamlData(data);
      const finalMethodologyData =
        existingData !== undefined && existingData !== null
          ? this.deepMerge(existingData.methodology, newMethodologyData)
          : newMethodologyData;

      const methodologyPath = join(methodologyDir, 'methodology.yaml');
      const methodologyContent = serializeYaml(finalMethodologyData, { sortKeys: false });
      const originalMethodologyContent =
        existingData !== undefined && existingData !== null
          ? serializeYaml(existingData.methodology, { sortKeys: false })
          : null;

      operations.push(() => safeWriteFile(methodologyPath, methodologyContent));
      rollbacks.push(async () => {
        if (originalMethodologyContent !== null) {
          await writeFile(methodologyPath, originalMethodologyContent, 'utf8');
        }
      });
      paths.push(methodologyPath);

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
          const phasesPath = join(methodologyDir, 'phases.yaml');
          const phasesContent = serializeYaml(finalPhasesData, { sortKeys: false });
          const originalPhasesContent =
            existingPhases !== null ? serializeYaml(existingPhases, { sortKeys: false }) : null;

          operations.push(() => safeWriteFile(phasesPath, phasesContent));
          rollbacks.push(async () => {
            if (originalPhasesContent !== null) {
              await writeFile(phasesPath, originalPhasesContent, 'utf8');
            }
          });
          paths.push(phasesPath);
        }
      }

      // Handle system-prompt.md
      const systemPromptPath = join(methodologyDir, 'system-prompt.md');
      const existingSystemPrompt = existingData?.systemPrompt ?? '';
      const systemPromptContent = data.system_prompt_guidance ?? existingSystemPrompt;
      if (systemPromptContent !== '') {
        operations.push(() => safeWriteFile(systemPromptPath, systemPromptContent));
        rollbacks.push(async () => {
          if (existingSystemPrompt !== '') {
            await writeFile(systemPromptPath, existingSystemPrompt, 'utf8');
          }
        });
        paths.push(systemPromptPath);
      }

      // Handle judge-prompt.md
      const existingJudgePrompt = existingData?.judgePrompt ?? null;
      const hasJudgePrompt = data.judge_prompt !== undefined || existingJudgePrompt !== null;
      if (hasJudgePrompt) {
        const judgePromptPath = join(methodologyDir, 'judge-prompt.md');
        const judgePromptContent = data.judge_prompt ?? existingJudgePrompt ?? '';
        if (judgePromptContent !== '') {
          operations.push(() => safeWriteFile(judgePromptPath, judgePromptContent));
          rollbacks.push(async () => {
            if (existingJudgePrompt !== null) {
              await writeFile(judgePromptPath, existingJudgePrompt, 'utf8');
            }
          });
          paths.push(judgePromptPath);
        }
      }

      // Execute all operations transactionally
      await performTransactionalFileOperations(operations, rollbacks);

      return { success: true, paths };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // YAML Data Builders
  // ==========================================================================

  /**
   * Build methodology.yaml data from input (only sets defined fields)
   */
  buildMethodologyYamlData(
    data: Partial<MethodologyCreationData> & { id: string }
  ): Record<string, unknown> {
    const yamlData: Record<string, unknown> = {};
    const typeValue = data.type ?? data.methodology;

    // Core fields - id is always required
    yamlData['id'] = data.id.toLowerCase();

    // Only set name if provided (for partial updates)
    if (data.name !== undefined) {
      yamlData['name'] = data.name;
    }

    // Type/methodology (both for backward compat) - only if provided
    if (typeValue !== undefined) {
      yamlData['type'] = typeValue;
      yamlData['methodology'] = typeValue;
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
      yamlData['methodologyGates'] = data.methodology_gates;
    }
    if (data.template_suggestions !== undefined && data.template_suggestions.length > 0) {
      yamlData['templateSuggestions'] = data.template_suggestions;
    }
    if (data.methodology_elements !== undefined) {
      yamlData['methodologyElements'] = data.methodology_elements;
    }
    if (data.argument_suggestions !== undefined && data.argument_suggestions.length > 0) {
      yamlData['argumentSuggestions'] = data.argument_suggestions;
    }
    if (data.judge_prompt !== undefined) {
      yamlData['judgePromptFile'] = 'judge-prompt.md';
    }

    // Always set version for new methodologies
    yamlData['version'] ??= '1.0.0';

    return yamlData;
  }

  /**
   * Build phases.yaml data from input (only sets defined fields)
   */
  buildPhasesYamlData(data: Partial<MethodologyCreationData>): Record<string, unknown> {
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
  public getMethodologyDir(id: string): string {
    const serverRoot = this.configManager.getServerRoot();
    return join(serverRoot, 'resources', 'methodologies', id.toLowerCase());
  }

  private needsPhasesFile(data: Partial<MethodologyCreationData>): boolean {
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
