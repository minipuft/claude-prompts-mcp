/**
 * Consolidated Prompt Manager - Modular Architecture Orchestration Layer
 *
 * This class maintains 100% backwards compatibility with the original API
 * while delegating operations to specialized modules for improved maintainability.
 */
import { ConfigManager } from '../../../config/index.js';
import { FrameworkManager } from '../../../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import { Logger } from '../../../logging/index.js';
import { ContentAnalyzer } from '../../../semantic/configurable-semantic-analyzer.js';
import { ToolResponse, ConvertedPrompt, PromptData, Category } from '../../../types/index.js';
import type { PromptManagerActionId } from '../../../tooling/action-metadata/definitions/prompt-manager.js';
/**
 * Consolidated Prompt Manager - Modular Architecture
 */
export declare class ConsolidatedPromptManager {
    private logger;
    private mcpServer;
    private configManager;
    private semanticAnalyzer;
    private frameworkStateManager?;
    private frameworkManager?;
    private onRefresh;
    private onRestart;
    private promptAnalyzer;
    private comparisonEngine;
    private gateAnalyzer;
    private textDiffService;
    private filterParser;
    private promptMatcher;
    private fileOperations;
    private versionHistoryService;
    private promptsData;
    private convertedPrompts;
    private categories;
    constructor(logger: Logger, mcpServer: any, configManager: ConfigManager, semanticAnalyzer: ContentAnalyzer, frameworkStateManager: FrameworkStateManager | undefined, frameworkManager: FrameworkManager | undefined, onRefresh: () => Promise<void>, onRestart: (reason: string) => Promise<void>);
    /**
     * Update data references
     */
    updateData(promptsData: PromptData[], convertedPrompts: ConvertedPrompt[], categories: Category[]): void;
    /**
     * Set framework state manager (called during initialization)
     */
    setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void;
    /**
     * Set framework manager (called during initialization)
     */
    setFrameworkManager(frameworkManager: FrameworkManager): void;
    /**
     * Main action handler - Routes to appropriate modules
     */
    handleAction(args: {
        action: PromptManagerActionId;
        [key: string]: any;
    }, extra: any): Promise<ToolResponse>;
    /**
     * Create new prompt (delegates to file operations and analysis)
     */
    private createPrompt;
    /**
     * Update existing prompt (delegates to file operations and comparison)
     */
    private updatePrompt;
    /**
     * Delete prompt with safety checks (delegates to file operations)
     */
    private deletePrompt;
    /**
     * List prompts with intelligent filtering (delegates to search modules)
     */
    private listPrompts;
    /**
     * Analyze prompt type (delegates to analysis module)
     */
    private analyzePromptType;
    /**
     * Inspect a single prompt by id.
     */
    private inspectPrompt;
    private reloadPrompts;
    private findPromptDependencies;
    private getExecutionTypeIcon;
    private handleSystemRefresh;
    /**
     * Analyze prompt gates and provide recommendations
     */
    private analyzePromptGates;
    private guidePromptActions;
    private rankActionsForGuide;
    private computeGuideScore;
    private formatActionSummary;
    private describeActionStatus;
    private appendActionWarnings;
    private handleError;
    private handleHistory;
    private handleRollback;
    private handleCompare;
}
/**
 * Create consolidated prompt manager - maintains original factory function API
 */
export declare function createConsolidatedPromptManager(logger: Logger, mcpServer: any, configManager: ConfigManager, semanticAnalyzer: ContentAnalyzer, frameworkStateManager: FrameworkStateManager | undefined, frameworkManager: FrameworkManager | undefined, onRefresh: () => Promise<void>, onRestart: (reason: string) => Promise<void>): ConsolidatedPromptManager;
