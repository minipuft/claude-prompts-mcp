import type { Logger } from '../logging/index.js';
import type { McpToolsManager } from '../mcp-tools/index.js';
import type { AuxiliaryReloadConfig } from '../prompts/hot-reload-manager.js';
export declare function buildMethodologyAuxiliaryReloadConfig(logger: Logger, mcpToolsManager?: McpToolsManager): AuxiliaryReloadConfig | undefined;
