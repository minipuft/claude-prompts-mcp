/**
 * Reload prompts from disk, synchronizing downstream managers (PromptManager,
 * MCP tools, API caches) so every transport observes the same prompt metadata.
 */
export async function reloadPromptData(options) {
    const promptsFilePath = options.configManager.getResolvedPromptsFilePath(options.promptsFileOverride);
    // Clear loader cache to ensure fresh content is read from disk
    // (fixes hot-reload not picking up direct file edits)
    options.promptManager.clearLoaderCache();
    const result = await options.promptManager.loadAndConvertPrompts(promptsFilePath);
    if (options.mcpToolsManager) {
        options.mcpToolsManager.updateData(result.promptsData, result.convertedPrompts, result.categories);
    }
    return {
        ...result,
        promptsFilePath,
    };
}
//# sourceMappingURL=prompt-refresh-service.js.map