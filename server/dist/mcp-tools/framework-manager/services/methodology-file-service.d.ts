/**
 * Methodology File Service
 *
 * Provides read-merge-write pattern for methodology YAML files.
 * Ensures updates are additive rather than destructive.
 */
import type { ConfigManager } from '../../../config/index.js';
import type { Logger } from '../../../logging/index.js';
import type { MethodologyCreationData } from '../core/types.js';
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
export declare class MethodologyFileService {
    private logger;
    private configManager;
    constructor(deps: MethodologyFileServiceDependencies);
    /**
     * Check if a methodology exists on the filesystem
     *
     * @param id - Methodology identifier
     * @returns true if methodology.yaml exists for this ID
     */
    methodologyExists(id: string): boolean;
    /**
     * Delete a methodology directory from the filesystem
     *
     * @param id - Methodology identifier
     * @returns true if deletion succeeded
     */
    deleteMethodology(id: string): Promise<boolean>;
    /**
     * Load existing methodology files from disk
     */
    loadExistingMethodology(id: string): Promise<ExistingMethodologyData | null>;
    /**
     * Convert raw ExistingMethodologyData to typed MethodologyCreationData.
     * Extracts and maps fields from YAML structure to the typed interface.
     *
     * @param id - Methodology identifier
     * @param existing - Raw methodology data loaded from disk
     * @returns Typed MethodologyCreationData or null if essential fields missing
     */
    toMethodologyCreationData(id: string, existing: ExistingMethodologyData): MethodologyCreationData | null;
    /**
     * Write methodology files with optional merge from existing data
     * @param data - Methodology data (can be partial for updates)
     * @param existingData - Existing methodology data to merge with (null for create)
     */
    writeMethodologyFiles(data: Partial<MethodologyCreationData> & {
        id: string;
    }, existingData?: ExistingMethodologyData | null): Promise<MethodologyFileResult>;
    /**
     * Build methodology.yaml data from input (only sets defined fields)
     */
    buildMethodologyYamlData(data: Partial<MethodologyCreationData> & {
        id: string;
    }): Record<string, unknown>;
    /**
     * Build phases.yaml data from input (only sets defined fields)
     */
    buildPhasesYamlData(data: Partial<MethodologyCreationData>): Record<string, unknown>;
    /**
     * Get the directory path for a methodology.
     * Used by versioning service to locate history files.
     */
    getMethodologyDir(id: string): string;
    private needsPhasesFile;
    /**
     * Deep-merge source into target
     * - Arrays: replaced (not merged)
     * - Objects: recursively merged
     * - undefined: skipped (preserves target value)
     */
    private deepMerge;
    private isPlainObject;
}
