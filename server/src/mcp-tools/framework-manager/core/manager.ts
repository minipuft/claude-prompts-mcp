// @lifecycle canonical - Main framework manager implementation for MCP.
/**
 * Consolidated Framework Manager
 *
 * Provides MCP tool interface for methodology lifecycle management.
 * Follows the same pattern as ConsolidatedPromptManager.
 */

import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { VersionHistoryService } from '../../../versioning/index.js';
import { TextDiffService } from '../../prompt-manager/analysis/text-diff-service.js';
import { MethodologyFileService } from '../services/index.js';

import type {
  FrameworkManagerInput,
  FrameworkManagerDependencies,
  MethodologyCreationData,
  MethodologyValidationResult,
} from './types.js';
import type { ConfigManager } from '../../../config/index.js';
import type { FrameworkManager } from '../../../frameworks/framework-manager.js';
import type { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import type { Logger } from '../../../logging/index.js';
import type { ToolResponse } from '../../../types/index.js';

/**
 * Optional methodology fields that can be copied directly from input to methodology data.
 * Used by both create and update handlers.
 */
const OPTIONAL_METHODOLOGY_FIELDS = [
  // Basic optional fields
  'description',
  'phases',
  'gates',
  'tool_descriptions',
  // Advanced methodology fields
  'methodology_gates',
  'template_suggestions',
  'methodology_elements',
  'argument_suggestions',
  'judge_prompt',
  // Advanced phases fields
  'processing_steps',
  'execution_steps',
  'execution_type_enhancements',
  'template_enhancements',
  'execution_flow',
  'quality_indicators',
] as const;

/**
 * Consolidated Framework Manager
 */
export class ConsolidatedFrameworkManager {
  private logger: Logger;
  private frameworkManager: FrameworkManager;
  private frameworkStateManager?: FrameworkStateManager;
  private configManager: ConfigManager;
  private fileService: MethodologyFileService;
  private textDiffService: TextDiffService;
  private versionHistoryService: VersionHistoryService;
  private onRefresh?: () => Promise<void>;
  private onToolsUpdate?: () => Promise<void>;

  constructor(deps: FrameworkManagerDependencies) {
    this.logger = deps.logger;
    this.frameworkManager = deps.frameworkManager;
    if (deps.frameworkStateManager !== undefined) {
      this.frameworkStateManager = deps.frameworkStateManager;
    }
    this.configManager = deps.configManager;
    this.fileService = new MethodologyFileService({
      logger: deps.logger,
      configManager: deps.configManager,
    });
    this.textDiffService = new TextDiffService();
    this.versionHistoryService = new VersionHistoryService({
      logger: deps.logger,
      configManager: deps.configManager,
    });
    if (deps.onRefresh !== undefined) {
      this.onRefresh = deps.onRefresh;
    }
    if (deps.onToolsUpdate !== undefined) {
      this.onToolsUpdate = deps.onToolsUpdate;
    }

    this.logger.debug('ConsolidatedFrameworkManager initialized');
  }

  /**
   * Set framework state manager (called during initialization)
   */
  setFrameworkStateManager(fsm: FrameworkStateManager): void {
    this.frameworkStateManager = fsm;
  }

  /**
   * Copy defined optional fields from input to methodology data
   */
  private assignOptionalFields(
    target: MethodologyCreationData,
    source: FrameworkManagerInput
  ): void {
    for (const field of OPTIONAL_METHODOLOGY_FIELDS) {
      const value = source[field];
      if (value !== undefined) {
        (target as unknown as Record<string, unknown>)[field] = value;
      }
    }
  }

  // ============================================================================
  // State Synchronization Helpers
  // ============================================================================

  /**
   * Comprehensive existence check across all methodology state sources.
   *
   * Checks filesystem, registry, and framework map to prevent "already exists"
   * false positives and ensure state consistency.
   */
  private checkMethodologyExists(id: string): {
    inAnySource: boolean;
    sources: string[];
    filesystem: boolean;
    registry: boolean;
    frameworkMap: boolean;
  } {
    const normalizedId = id.toLowerCase();
    const sources: string[] = [];

    // Check filesystem
    const fsExists = this.fileService.methodologyExists(normalizedId);
    if (fsExists) sources.push('filesystem');

    // Check registry (via FrameworkManager's methodology registry)
    const registry = this.frameworkManager.getMethodologyRegistry();
    const registryExists = registry.hasGuide(normalizedId);
    if (registryExists) sources.push('registry');

    // Check framework map
    const frameworkExists = this.frameworkManager.getFramework(id) !== undefined;
    if (frameworkExists) sources.push('framework-map');

    return {
      inAnySource: sources.length > 0,
      sources,
      filesystem: fsExists,
      registry: registryExists,
      frameworkMap: frameworkExists,
    };
  }

  /**
   * Atomic methodology creation with rollback on failure.
   *
   * Steps:
   * 1. Write files to disk
   * 2. Clear loader cache
   * 3. Register in methodology registry
   * 4. Register in framework manager
   *
   * If any step fails, previous steps are rolled back.
   */
  private async createMethodologyAtomic(
    id: string,
    methodologyData: MethodologyCreationData
  ): Promise<{ success: boolean; error?: string; paths?: string[] }> {
    const normalizedId = id.toLowerCase();
    const registry = this.frameworkManager.getMethodologyRegistry();

    // Step 1: Write files to disk
    const writeResult = await this.fileService.writeMethodologyFiles(methodologyData, null);
    if (!writeResult.success) {
      return { success: false, error: `File write failed: ${writeResult.error}` };
    }

    // Step 2: Clear loader cache to force fresh load
    const loader = registry.getRuntimeLoader();
    loader.clearCache();

    // Step 3: Register in methodology registry
    const registryResult = await registry.loadAndRegisterById(normalizedId);
    if (!registryResult) {
      // Rollback: delete files
      await this.fileService.deleteMethodology(normalizedId);
      return { success: false, error: 'Registry registration failed - files rolled back' };
    }

    // Step 4: Register in framework manager
    const frameworkResult = await this.frameworkManager.registerFramework(id);
    if (!frameworkResult) {
      // Rollback: unregister from registry and delete files
      registry.unregisterGuide(normalizedId);
      await this.fileService.deleteMethodology(normalizedId);
      return {
        success: false,
        error: 'Framework registration failed - registry and files rolled back',
      };
    }

    return { success: true, paths: writeResult.paths };
  }

  /**
   * Validate methodology with strict requirements.
   *
   * Required fields (80% threshold):
   * - system_prompt_guidance (core LLM guidance)
   * - phases (methodology structure)
   * - methodology_gates (quality validation)
   *
   * Returns structured errors for focused user guidance.
   */
  private validateMethodology(data: MethodologyCreationData): MethodologyValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields one at a time for focused feedback
    const hasPhases = Array.isArray(data.phases) && data.phases.length > 0;
    const hasGates = Array.isArray(data.methodology_gates) && data.methodology_gates.length > 0;

    if (!data.system_prompt_guidance?.trim()) {
      errors.push('system_prompt_guidance is required - defines core LLM guidance');
    } else if (!hasPhases) {
      errors.push('phases is required - defines methodology structure');
    } else if (!hasGates) {
      errors.push('methodology_gates is required - enables quality validation');
    }

    // Calculate score
    let score = 0;
    if (data.system_prompt_guidance?.trim()) score += 30;
    if (hasPhases) score += 30;
    if (hasGates) score += 20;
    if (data.methodology_elements !== undefined) score += 10;
    if (data.template_suggestions !== undefined && data.template_suggestions.length > 0) {
      score += 5;
    }
    if (data.description?.trim()) score += 5;

    // RECOMMENDED fields - only warn if passed required checks
    if (errors.length === 0) {
      if (data.methodology_elements === undefined) {
        warnings.push('Add methodology_elements for structured prompt guidance');
      }
      if (data.template_suggestions === undefined || data.template_suggestions.length === 0) {
        warnings.push('Add template_suggestions for system/user prompt hints');
      }
      if (!data.description?.trim()) {
        warnings.push('Add description for methodology overview');
      }
    }

    const level: 'incomplete' | 'standard' | 'full' =
      score >= 80 ? 'full' : score >= 50 ? 'standard' : 'incomplete';
    const valid = errors.length === 0;

    return {
      valid,
      score,
      level,
      errors,
      warnings,
      nextStep: errors[0] ?? warnings[0],
    };
  }

  /**
   * Create structured error response for validation failures.
   * Shows one focused error with helpful example.
   */
  private createValidationErrorResponse(
    id: string,
    validation: MethodologyValidationResult
  ): ToolResponse {
    let message = `❌ Methodology '${id}' validation failed (${validation.score}% complete)\n\n`;
    message += `**Issue:** ${validation.errors[0]}\n\n`;

    // Show contextual example based on what's missing
    if (validation.errors[0]?.includes('phases')) {
      message += `**Example phases:**\n\`\`\`json\n${JSON.stringify(
        [
          { id: 'analyze', name: 'Analyze', description: 'Understand the problem' },
          { id: 'design', name: 'Design', description: 'Plan the solution' },
          { id: 'implement', name: 'Implement', description: 'Build the solution' },
        ],
        null,
        2
      )}\n\`\`\``;
    } else if (validation.errors[0]?.includes('methodology_gates')) {
      message += `**Example methodology_gates:**\n\`\`\`json\n${JSON.stringify(
        [
          {
            id: 'analysis-complete',
            name: 'Analysis Gate',
            description: 'Validates analysis phase',
            methodologyArea: 'analysis',
            priority: 'high',
            validationCriteria: ['Problem clearly defined', 'Constraints identified'],
          },
        ],
        null,
        2
      )}\n\`\`\``;
    }

    return { content: [{ type: 'text', text: message }], isError: true };
  }

  /**
   * Format validation result into human-readable success message.
   */
  private formatValidationSuccess(
    id: string,
    validation: MethodologyValidationResult,
    paths: string[]
  ): string {
    let message = `✅ Methodology '${id}' created (${validation.score}% - ${validation.level})\n\n`;
    message += `**Files:**\n${paths.map((p) => `  • ${p}`).join('\n')}\n\n`;

    if (validation.warnings.length > 0) {
      message += `**Recommendations:**\n${validation.warnings
        .slice(0, 3)
        .map((w) => `  • ${w}`)
        .join('\n')}`;
    }

    return message;
  }

  /**
   * Handle framework manager action
   */
  async handleAction(
    args: FrameworkManagerInput,
    _context: Record<string, unknown>
  ): Promise<ToolResponse> {
    const { action } = args;

    try {
      switch (action) {
        case 'create':
          return await this.handleCreate(args);
        case 'update':
          return await this.handleUpdate(args);
        case 'delete':
          return await this.handleDelete(args);
        case 'list':
          return await this.handleList(args);
        case 'inspect':
          return await this.handleInspect(args);
        case 'reload':
          return await this.handleReload(args);
        case 'switch':
          return await this.handleSwitch(args);
        case 'history':
          return await this.handleHistory(args);
        case 'rollback':
          return await this.handleRollback(args);
        case 'compare':
          return await this.handleCompare(args);
        default:
          return this.createErrorResponse(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.logger.error(`framework_manager error:`, error);
      return this.createErrorResponse(
        `Error in framework_manager: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ============================================================================
  // Action Handlers
  // ============================================================================

  private async handleCreate(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, name, methodology, system_prompt_guidance } = args;

    // Validate basic required fields (id and name)
    if (id === undefined || id === '') {
      return this.createErrorResponse('Methodology ID is required for create action');
    }
    if (name === undefined || name === '') {
      return this.createErrorResponse('Methodology name is required for create action');
    }

    // Auto-derive type from id if methodology not provided
    const derivedType =
      methodology !== undefined && methodology !== ''
        ? methodology
        : id.toUpperCase().replace(/-/g, '_');

    // Comprehensive existence check across all state sources
    const exists = this.checkMethodologyExists(id);
    if (exists.inAnySource) {
      return this.createErrorResponse(
        `Methodology '${id}' already exists in: ${exists.sources.join(', ')}. Use update action to modify.`
      );
    }

    // Create methodology data with available fields
    const methodologyData: MethodologyCreationData = {
      id,
      name,
      type: derivedType,
      methodology: derivedType,
      system_prompt_guidance: system_prompt_guidance ?? '',
      enabled: true,
    };

    // Assign all optional fields (basic + advanced)
    this.assignOptionalFields(methodologyData, args);

    // Smart validation - block if required fields missing
    const validation = this.validateMethodology(methodologyData);
    if (!validation.valid) {
      return this.createValidationErrorResponse(id, validation);
    }

    // Atomic create with rollback on failure
    const result = await this.createMethodologyAtomic(id, methodologyData);
    if (!result.success) {
      return this.createErrorResponse(`Failed to create methodology: ${result.error}`);
    }

    // Trigger refresh for any dependent systems
    await this.onRefresh?.();

    // Build success response with recommendations
    return this.createSuccessResponse(
      this.formatValidationSuccess(id, validation, result.paths ?? [])
    );
  }

  private async handleUpdate(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (id === undefined || id === '') {
      return this.createErrorResponse('Methodology ID is required for update action');
    }

    // Check if methodology exists in runtime registry
    const existingFramework = this.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.createErrorResponse(
        `Methodology '${id}' not found. Use create action to add new methodology.`
      );
    }

    // Load existing YAML files from disk (contains all fields, not just runtime fields)
    const existingData = await this.fileService.loadExistingMethodology(id);
    if (existingData === null) {
      return this.createErrorResponse(
        `Failed to load methodology files for '${id}'. Files may be corrupted.`
      );
    }

    // Capture before state for diff generation (bracket notation for index signature)
    const beforeState: Record<string, unknown> = {
      id: existingData.methodology['id'],
      name: existingData.methodology['name'],
      type: existingData.methodology['type'],
      description: existingData.methodology['description'],
      enabled: existingData.methodology['enabled'],
    };

    // Build update data with ONLY the fields provided in the request
    // The fileService will deep-merge this with existing data
    // Using Partial<MethodologyCreationData> pattern - only set defined fields
    const methodologyData: Partial<MethodologyCreationData> & { id: string; methodology: string } =
      {
        id,
        methodology: args.methodology ?? '', // Required by type but service handles undefined via deep merge
      };

    // Only add fields that were explicitly provided
    if (args.name !== undefined) methodologyData.name = args.name;
    if (args.methodology !== undefined) {
      methodologyData.type = args.methodology;
      methodologyData.methodology = args.methodology;
    }
    if (args.system_prompt_guidance !== undefined) {
      methodologyData.system_prompt_guidance = args.system_prompt_guidance;
    }
    if (args.enabled !== undefined) methodologyData.enabled = args.enabled;

    // Assign all optional fields from input (only defined fields)
    this.assignOptionalFields(methodologyData as MethodologyCreationData, args);

    // Build after state for diff generation (merge existing with updates, bracket notation)
    const afterState: Record<string, unknown> = {
      id,
      name: methodologyData.name ?? existingData.methodology['name'],
      type: methodologyData.type ?? existingData.methodology['type'],
      description: methodologyData.description ?? existingData.methodology['description'],
      enabled: methodologyData.enabled ?? existingData.methodology['enabled'],
    };

    // Save version before update (auto-versioning)
    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    if (this.versionHistoryService.isAutoVersionEnabled() && !skipVersion) {
      const methodologyDir = this.fileService.getMethodologyDir(id);

      // Calculate diff summary
      const diffForVersion = this.textDiffService.generateObjectDiff(
        beforeState,
        afterState,
        `${id}/methodology.yaml`
      );
      const diffSummary = `+${diffForVersion.stats.additions}/-${diffForVersion.stats.deletions}`;

      const versionResult = await this.versionHistoryService.saveVersion(
        methodologyDir,
        'methodology',
        id,
        beforeState,
        {
          description: args.version_description ?? 'Update via resource_manager',
          diff_summary: diffSummary,
        }
      );

      if (versionResult.success) {
        versionSaved = versionResult.version;
        this.logger.debug(`Saved version ${versionSaved} for methodology ${id}`);
      } else {
        this.logger.warn(`Failed to save version for methodology ${id}: ${versionResult.error}`);
      }
    }

    // Write methodology files with merge from existing data
    const result = await this.fileService.writeMethodologyFiles(methodologyData, existingData);

    if (!result.success) {
      return this.createErrorResponse(`Failed to update methodology: ${result.error}`);
    }

    // Trigger refresh to reload methodologies
    await this.onRefresh?.();

    // Generate diff view
    const diffResult = this.textDiffService.generateObjectDiff(
      beforeState,
      afterState,
      `${id}/methodology.yaml`
    );

    let response =
      `✅ Methodology '${id}' updated successfully\n\n` +
      `📁 Files updated:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}\n\n`;

    // Include version info if saved
    if (versionSaved !== undefined) {
      response += `📜 **Version ${versionSaved}** saved (use \`action:"history"\` to view)\n\n`;
    }

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n\n`;
    }

    response += `🔄 Framework registry reloaded`;

    return this.createSuccessResponse(response);
  }

  private async handleDelete(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, confirm } = args;

    if (id === undefined || id === '') {
      return this.createErrorResponse('Methodology ID is required for delete action');
    }

    if (confirm !== true) {
      return this.createErrorResponse(
        `⚠️ Delete requires confirmation.\n\nTo delete methodology '${id}', set confirm: true`
      );
    }

    // Check if methodology exists
    const existingFramework = this.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.createErrorResponse(`Methodology '${id}' not found`);
    }

    // Prevent deleting built-in methodologies
    const builtInMethodologies = ['cageerf', 'react', '5w1h', 'scamper'];
    if (builtInMethodologies.includes(id.toLowerCase())) {
      return this.createErrorResponse(
        `Cannot delete built-in methodology '${id}'. Only custom methodologies can be deleted.`
      );
    }

    // Get methodology directory path
    const serverRoot = this.configManager.getServerRoot();
    const methodologyDir = path.join(serverRoot, 'resources', 'methodologies', id.toLowerCase());

    if (!existsSync(methodologyDir)) {
      return this.createErrorResponse(`Methodology directory not found: ${methodologyDir}`);
    }

    // Remove methodology directory
    try {
      await fs.rm(methodologyDir, { recursive: true });
    } catch (error) {
      return this.createErrorResponse(
        `Failed to delete methodology directory: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Unregister framework from in-memory registry
    const unregistered = this.frameworkManager.unregister(id);
    if (!unregistered) {
      this.logger.warn(`Framework '${id}' was not found in registry during deletion`);
    }

    // Trigger refresh for any dependent systems
    await this.onRefresh?.();

    return this.createSuccessResponse(
      `✅ Methodology '${id}' deleted successfully\n\n` +
        `📁 Directory removed: ${methodologyDir}\n\n` +
        `🔄 Framework registry updated`
    );
  }

  private async handleList(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { enabled_only = true } = args;

    const frameworks = this.frameworkManager.listFrameworks(enabled_only);
    const activeFramework = this.frameworkStateManager?.getActiveFramework();

    if (frameworks.length === 0) {
      return this.createSuccessResponse(
        `📋 No methodologies found${enabled_only ? ' (enabled only)' : ''}\n\n` +
          `Use resource_manager(resource_type:"methodology", action:"create", ...) to add a new methodology.`
      );
    }

    const frameworkList = frameworks
      .map((fw) => {
        // Use id comparison only to avoid multiple frameworks showing as active
        const isActive = activeFramework !== undefined && activeFramework.id === fw.id;
        const activeIndicator = isActive ? ' ← Active' : '';
        return `  🧭 ${fw.id}: ${fw.name}${activeIndicator}`;
      })
      .join('\n');

    const activeInfo =
      activeFramework !== undefined
        ? `\n📍 Active Framework: ${activeFramework.type !== '' ? activeFramework.type : activeFramework.id}`
        : '\n📍 No active framework';

    return this.createSuccessResponse(
      `📋 Methodologies (${frameworks.length} total)\n\n` + `${frameworkList}\n` + `${activeInfo}`
    );
  }

  private async handleInspect(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (id === undefined || id === '') {
      return this.createErrorResponse('Methodology ID is required for inspect action');
    }

    const framework = this.frameworkManager.getFramework(id);

    if (framework === undefined) {
      return this.createErrorResponse(`Methodology '${id}' not found`);
    }

    const activeFramework = this.frameworkStateManager?.getActiveFramework();
    const isActive = activeFramework !== undefined && activeFramework.id === framework.id;
    const activeStatus = isActive ? 'Active' : 'Inactive';

    // Load methodology data from disk to calculate validation score
    let validationInfo = '';
    try {
      const existingData = await this.fileService.loadExistingMethodology(id);
      if (existingData !== null) {
        const creationData = this.fileService.toMethodologyCreationData(id, existingData);
        if (creationData !== null) {
          const validation = this.validateMethodology(creationData);
          validationInfo = `\n\n**Quality:** ${validation.score}% (${validation.level})`;
          if (validation.warnings.length > 0) {
            validationInfo += `\n**Recommendations:**\n${validation.warnings
              .slice(0, 3)
              .map((w) => `  • ${w}`)
              .join('\n')}`;
          }
        }
      }
    } catch (error) {
      this.logger.debug(`Could not load methodology data for validation: ${id}`, { error });
      // Non-fatal: validation info will be omitted
    }

    return this.createSuccessResponse(
      `Methodology: ${framework.name}\n\n` +
        `Details:\n` +
        `  ID: ${framework.id}\n` +
        `  Type: ${framework.type}\n` +
        `  Status: ${activeStatus}\n` +
        `  Enabled: ${framework.enabled ? 'Yes' : 'No'}\n` +
        `  Description: ${framework.description || '(none)'}` +
        `${validationInfo}`
    );
  }

  private async handleReload(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    if (id === undefined || id === '') {
      return this.createErrorResponse('Methodology ID is required for reload action');
    }

    // Check if methodology exists
    const existingFramework = this.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.createErrorResponse(`Methodology '${id}' not found`);
    }

    // Trigger full refresh (methodology registry doesn't have per-item reload)
    await this.onRefresh?.();

    const reasonText = reason !== undefined && reason !== '' ? ` (reason: ${reason})` : '';

    return this.createSuccessResponse(`🔄 Methodology '${id}' reloaded successfully${reasonText}`);
  }

  private async handleSwitch(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    if (id === undefined || id === '') {
      return this.createErrorResponse('Methodology ID is required for switch action');
    }

    // Check if methodology exists
    const targetFramework = this.frameworkManager.getFramework(id);
    if (targetFramework === undefined) {
      const availableFrameworks = this.frameworkManager
        .listFrameworks(true)
        .map((f) => f.id)
        .join(', ');
      return this.createErrorResponse(
        `Methodology '${id}' not found.\n\nAvailable: ${availableFrameworks}`
      );
    }

    // Check if already active (compare by ID, not type - multiple frameworks can share a type)
    const currentFramework = this.frameworkStateManager?.getActiveFramework();
    if (currentFramework !== undefined && currentFramework.id === targetFramework.id) {
      return this.createSuccessResponse(`ℹ️ Framework '${id}' is already active`);
    }

    // Switch framework using state manager
    if (this.frameworkStateManager === undefined) {
      return this.createErrorResponse('Framework state manager not initialized');
    }

    let success = false;
    try {
      success = await this.frameworkStateManager.switchFramework({
        targetFramework: targetFramework.id,
        reason: reason ?? `Switched via resource_manager`,
      });
    } catch (error) {
      return this.createErrorResponse(
        `Failed to switch framework: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!success) {
      return this.createErrorResponse(
        `Failed to switch to framework '${targetFramework.name}'. Check server logs for details.`
      );
    }

    // Trigger tools update if available (for description changes)
    await this.onToolsUpdate?.();

    const reasonText = reason !== undefined && reason !== '' ? `\n📝 Reason: ${reason}` : '';

    return this.createSuccessResponse(
      `✅ Switched to framework '${targetFramework.name}'${reasonText}\n\n` +
        `🧭 Active type: ${targetFramework.type}`
    );
  }

  // ============================================================================
  // Versioning Actions
  // ============================================================================

  private async handleHistory(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, limit } = args;

    if (id === undefined || id === '') {
      return this.createErrorResponse('Methodology ID is required for history action');
    }

    // Check if methodology exists
    const framework = this.frameworkManager.getFramework(id);
    if (framework === undefined) {
      return this.createErrorResponse(`Methodology '${id}' not found`);
    }

    const methodologyDir = this.fileService.getMethodologyDir(id);
    const history = await this.versionHistoryService.loadHistory(methodologyDir);

    if (!history || history.versions.length === 0) {
      return this.createSuccessResponse(
        `📜 No version history for methodology '${id}'\n\n` +
          `💡 Version history is created automatically when updates are made.`
      );
    }

    const formatted = this.versionHistoryService.formatHistoryForDisplay(history, limit ?? 10);
    return this.createSuccessResponse(formatted);
  }

  private async handleRollback(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, version, confirm } = args;

    if (id === undefined || id === '') {
      return this.createErrorResponse('Methodology ID is required for rollback action');
    }
    if (version === undefined) {
      return this.createErrorResponse('Version number is required for rollback action');
    }
    if (confirm !== true) {
      return this.createErrorResponse(
        `⚠️ Rollback requires confirmation.\n\n` +
          `To rollback methodology '${id}' to version ${version}, set confirm: true`
      );
    }

    // Check if methodology exists
    const existingFramework = this.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.createErrorResponse(`Methodology '${id}' not found`);
    }

    const methodologyDir = this.fileService.getMethodologyDir(id);

    // Load existing data to capture current state
    const existingData = await this.fileService.loadExistingMethodology(id);
    if (existingData === null) {
      return this.createErrorResponse(`Failed to load current methodology state`);
    }

    // Capture current state (bracket notation for index signature)
    const currentState: Record<string, unknown> = {
      id: existingData.methodology['id'],
      name: existingData.methodology['name'],
      type: existingData.methodology['type'],
      description: existingData.methodology['description'],
      enabled: existingData.methodology['enabled'],
    };

    // Perform rollback
    const result = await this.versionHistoryService.rollback(
      methodologyDir,
      'methodology',
      id,
      version,
      currentState
    );

    if (!result.success) {
      return this.createErrorResponse(`Rollback failed: ${result.error}`);
    }

    // Restore the snapshot
    const snapshot = result.snapshot;
    if (!snapshot) {
      return this.createErrorResponse('Rollback failed: No snapshot found in target version');
    }

    // Rebuild methodology data from snapshot
    const methodologyData: Partial<MethodologyCreationData> & { id: string; methodology: string } =
      {
        id,
        name: String(snapshot['name'] ?? existingFramework.name),
        methodology: String(snapshot['type'] ?? existingData.methodology['type'] ?? ''),
        type: String(snapshot['type'] ?? existingData.methodology['type']),
        description: String(snapshot['description'] ?? existingData.methodology['description']),
        enabled: (snapshot['enabled'] as boolean) ?? existingData.methodology['enabled'],
        system_prompt_guidance: existingData.systemPrompt ?? '',
      };

    // Write restored methodology files
    const writeResult = await this.fileService.writeMethodologyFiles(methodologyData, existingData);
    if (!writeResult.success) {
      return this.createErrorResponse(`Rollback write failed: ${writeResult.error}`);
    }

    // Trigger refresh
    await this.onRefresh?.();

    return this.createSuccessResponse(
      `✅ Methodology '${id}' rolled back to version ${version}\n\n` +
        `📜 Current state saved as version ${result.saved_version}\n` +
        `🔄 Framework registry reloaded`
    );
  }

  private async handleCompare(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, from_version, to_version } = args;

    if (id === undefined || id === '') {
      return this.createErrorResponse('Methodology ID is required for compare action');
    }
    if (from_version === undefined || to_version === undefined) {
      return this.createErrorResponse(
        'Both from_version and to_version are required for compare action'
      );
    }

    // Check if methodology exists
    const framework = this.frameworkManager.getFramework(id);
    if (framework === undefined) {
      return this.createErrorResponse(`Methodology '${id}' not found`);
    }

    const methodologyDir = this.fileService.getMethodologyDir(id);

    const result = await this.versionHistoryService.compareVersions(
      methodologyDir,
      from_version,
      to_version
    );

    if (!result.success) {
      return this.createErrorResponse(`Compare failed: ${result.error}`);
    }

    // Generate diff between versions
    const diffResult = this.textDiffService.generateObjectDiff(
      result.from!.snapshot,
      result.to!.snapshot,
      `${id}/methodology.yaml`
    );

    let response =
      `📊 **Version Comparison**: ${id}\n\n` +
      `| Property | Version ${from_version} | Version ${to_version} |\n` +
      `|----------|-----------|------------|\n` +
      `| Date | ${new Date(result.from!.date).toLocaleString()} | ${new Date(result.to!.date).toLocaleString()} |\n` +
      `| Description | ${result.from!.description} | ${result.to!.description} |\n\n`;

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n`;
    } else {
      response += `No differences found between versions.\n`;
    }

    return this.createSuccessResponse(response);
  }

  // ============================================================================
  // Response Helpers
  // ============================================================================

  private createSuccessResponse(text: string): ToolResponse {
    return {
      content: [{ type: 'text', text }],
      isError: false,
    };
  }

  private createErrorResponse(text: string): ToolResponse {
    return {
      content: [{ type: 'text', text: `Error: ${text}` }],
      isError: true,
    };
  }
}

/**
 * Create consolidated framework manager
 */
export function createConsolidatedFrameworkManager(
  deps: FrameworkManagerDependencies
): ConsolidatedFrameworkManager {
  return new ConsolidatedFrameworkManager(deps);
}
