/**
 * Framework Tool Registry
 *
 * Manages framework-specific tool registration and switching.
 * Instead of 3 tools with dynamic descriptions, this registry maintains
 * 12 framework-suffixed tools (3 tools × 4 frameworks), activating only
 * the 3 tools corresponding to the active framework.
 *
 * This approach attempts to trigger client tool cache refresh by changing
 * which tools exist (remove/add operations) rather than just updating descriptions.
 */
/**
 * Framework Tool Registry
 *
 * Manages registration and switching of framework-specific tools.
 * Implements GODA-style pattern: change which tools exist rather than updating descriptions.
 */
export class FrameworkToolRegistry {
    constructor(logger, mcpServer, initialFramework = "CAGEERF") {
        this.frameworkStateManager = null;
        this.toolDescriptionManager = null;
        this.toolSets = new Map();
        this.toolFactories = new Map();
        this.FRAMEWORKS = [
            "CAGEERF",
            "REACT",
            "5W1H",
            "SCAMPER",
        ];
        this.logger = logger;
        this.mcpServer = mcpServer;
        this.activeFramework = initialFramework;
        this.logger.info(`FrameworkToolRegistry initialized with active framework: ${initialFramework}`);
    }
    /**
     * Set framework state manager (called after initialization)
     */
    setFrameworkStateManager(frameworkStateManager) {
        this.frameworkStateManager = frameworkStateManager;
        this.logger.debug("FrameworkStateManager integrated with FrameworkToolRegistry");
    }
    /**
     * Set tool description manager (called after initialization)
     */
    setToolDescriptionManager(toolDescriptionManager) {
        this.toolDescriptionManager = toolDescriptionManager;
        this.logger.debug("ToolDescriptionManager integrated with FrameworkToolRegistry");
    }
    /**
     * Register tool factories for all framework variants.
     * This stores the configs and callbacks but doesn't register tools yet.
     */
    registerToolFactories(toolRegistrations) {
        this.logger.info("Registering tool factories for all frameworks...");
        for (const framework of this.FRAMEWORKS) {
            const promptEngineKey = `prompt_engine_${framework}`;
            const promptManagerKey = `prompt_manager_${framework}`;
            const systemControlKey = `system_control_${framework}`;
            this.toolFactories.set(promptEngineKey, {
                id: promptEngineKey,
                config: {
                    ...toolRegistrations.promptEngine.config,
                    description: this.getFrameworkDescription("prompt_engine", framework, toolRegistrations.promptEngine.config.description),
                },
                callback: toolRegistrations.promptEngine.callback,
            });
            this.toolFactories.set(promptManagerKey, {
                id: promptManagerKey,
                config: {
                    ...toolRegistrations.promptManager.config,
                    description: this.getFrameworkDescription("prompt_manager", framework, toolRegistrations.promptManager.config.description),
                },
                callback: toolRegistrations.promptManager.callback,
            });
            this.toolFactories.set(systemControlKey, {
                id: systemControlKey,
                config: {
                    ...toolRegistrations.systemControl.config,
                    description: this.getFrameworkDescription("system_control", framework, toolRegistrations.systemControl.config.description),
                },
                callback: toolRegistrations.systemControl.callback,
            });
            this.logger.debug(`  ✓ Registered factories for ${framework}: 3 tools`);
        }
        this.logger.info(`✅ Registered ${this.toolFactories.size} tool factories (${this.FRAMEWORKS.length} frameworks × 3 tools)`);
    }
    /**
     * Get framework-specific description for a tool.
     */
    getFrameworkDescription(baseTool, framework, fallbackDescription) {
        if (!fallbackDescription) {
            return fallbackDescription;
        }
        if (this.toolDescriptionManager) {
            return (this.toolDescriptionManager.getDescription(baseTool, true, framework, { applyMethodologyOverride: true }) ?? fallbackDescription);
        }
        return fallbackDescription.replace(/\[.*?ENHANCED\]/, `[${framework}-ENHANCED]`);
    }
    /**
     * Register tools for the active framework only.
     * This is called on startup to register the initial 3 tools.
     */
    async registerActiveFrameworkTools() {
        this.logger.info(`Registering tools for active framework: ${this.activeFramework}`);
        if (this.toolFactories.size === 0) {
            throw new Error("Tool factories not registered. Call registerToolFactories() first.");
        }
        const toolSet = await this.registerFrameworkTools(this.activeFramework);
        this.toolSets.set(this.activeFramework, toolSet);
        this.logger.info(`✅ Registered 3 tools for framework ${this.activeFramework}`);
    }
    /**
     * Register the 3 tools for a specific framework.
     */
    async registerFrameworkTools(framework) {
        const promptEngineKey = `prompt_engine_${framework}`;
        const promptManagerKey = `prompt_manager_${framework}`;
        const systemControlKey = `system_control_${framework}`;
        const promptEngineInfo = this.toolFactories.get(promptEngineKey);
        const promptManagerInfo = this.toolFactories.get(promptManagerKey);
        const systemControlInfo = this.toolFactories.get(systemControlKey);
        if (!promptEngineInfo || !promptManagerInfo || !systemControlInfo) {
            throw new Error(`Tool factories not found for framework: ${framework}`);
        }
        this.logger.debug(`  Registering tools for ${framework}:`);
        this.logger.debug(`    • ${promptEngineKey}`);
        this.logger.debug(`    • ${promptManagerKey}`);
        this.logger.debug(`    • ${systemControlKey}`);
        const promptEngine = this.mcpServer.registerTool(promptEngineInfo.id, promptEngineInfo.config, promptEngineInfo.callback);
        const promptManager = this.mcpServer.registerTool(promptManagerInfo.id, promptManagerInfo.config, promptManagerInfo.callback);
        const systemControl = this.mcpServer.registerTool(systemControlInfo.id, systemControlInfo.config, systemControlInfo.callback);
        return {
            framework,
            tools: {
                promptEngine,
                promptManager,
                systemControl,
            },
        };
    }
    /**
     * Switch from one framework to another.
     * Removes old framework's 3 tools and registers new framework's 3 tools.
     *
     * This is the core mechanism to trigger client tool cache refresh.
     */
    async switchFramework(from, to) {
        this.logger.info(`🔄 Framework switch: ${from} → ${to}`);
        const oldToolSet = this.toolSets.get(from);
        if (oldToolSet) {
            this.logger.info(`  ➖ Removing ${from} tools...`);
            if (oldToolSet.tools.promptEngine) {
                this.logger.debug(`    • Removing prompt_engine_${from}`);
                oldToolSet.tools.promptEngine.remove();
            }
            if (oldToolSet.tools.promptManager) {
                this.logger.debug(`    • Removing prompt_manager_${from}`);
                oldToolSet.tools.promptManager.remove();
            }
            if (oldToolSet.tools.systemControl) {
                this.logger.debug(`    • Removing system_control_${from}`);
                oldToolSet.tools.systemControl.remove();
            }
            this.toolSets.delete(from);
            this.logger.info(`  ✅ Removed 3 tools for ${from}`);
        }
        else {
            this.logger.warn(`  ⚠️  No tools found for framework ${from} (may not have been registered)`);
        }
        this.logger.info(`  ➕ Registering ${to} tools...`);
        const newToolSet = await this.registerFrameworkTools(to);
        this.toolSets.set(to, newToolSet);
        this.logger.info(`  ✅ Registered 3 tools for ${to}`);
        this.activeFramework = to;
        this.logger.info(`✅ Framework switch complete: ${from} → ${to}`);
        this.logger.info(`   Tools: 3 removed, 3 added (registry changed)`);
    }
    /**
     * Get active framework.
     */
    getActiveFramework() {
        return this.activeFramework;
    }
    /**
     * Get active tool IDs for current framework.
     */
    getActiveToolIds() {
        return [
            `prompt_engine_${this.activeFramework}`,
            `prompt_manager_${this.activeFramework}`,
            `system_control_${this.activeFramework}`,
        ];
    }
    /**
     * Get all registered tool IDs across all frameworks.
     */
    getAllRegisteredToolIds() {
        const toolIds = [];
        for (const toolSet of this.toolSets.values()) {
            toolIds.push(`prompt_engine_${toolSet.framework}`, `prompt_manager_${toolSet.framework}`, `system_control_${toolSet.framework}`);
        }
        return toolIds;
    }
    /**
     * Get tool count statistics.
     */
    getToolStats() {
        return {
            totalFactories: this.toolFactories.size,
            registeredFrameworks: this.toolSets.size,
            activeTools: 3,
            activeFramework: this.activeFramework,
        };
    }
}
/**
 * Factory function to create FrameworkToolRegistry.
 */
export function createFrameworkToolRegistry(logger, mcpServer, initialFramework) {
    return new FrameworkToolRegistry(logger, mcpServer, initialFramework);
}
//# sourceMappingURL=framework-tool-registry.js.map