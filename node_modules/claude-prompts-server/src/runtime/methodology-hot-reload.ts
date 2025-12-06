// @lifecycle canonical - Builds methodology hot-reload config for prompt hot-reload manager.
import type { Logger } from '../logging/index.js';
import type { McpToolsManager } from '../mcp-tools/index.js';
import { createMethodologyHotReloadRegistration } from '../frameworks/methodology/index.js';
import type { AuxiliaryReloadConfig } from '../prompts/hot-reload-manager.js';

export function buildMethodologyAuxiliaryReloadConfig(
  logger: Logger,
  mcpToolsManager?: McpToolsManager
): AuxiliaryReloadConfig | undefined {
  const frameworkManager = mcpToolsManager?.getFrameworkManager?.();
  if (!frameworkManager) {
    logger.debug('Framework manager unavailable; skipping methodology hot reload wiring.');
    return undefined;
  }

  try {
    const registry = frameworkManager.getMethodologyRegistry();
    const registration = createMethodologyHotReloadRegistration(logger, registry);

    if (!registration?.directories?.length || !registration.handler) {
      return undefined;
    }

    return {
      id: 'methodology',
      directories: registration.directories,
      handler: registration.handler,
    };
  } catch (error) {
    logger.warn(
      'Failed to configure methodology hot reload; continuing with prompt-only reload:',
      error
    );
    return undefined;
  }
}
