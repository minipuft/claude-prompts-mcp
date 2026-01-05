// @lifecycle canonical - Barrel exports for scripts/hot-reload module.
/**
 * Script Tools Hot-Reload Module
 *
 * Provides cache invalidation for script tools when files change.
 */

export {
  createScriptHotReloadRegistration,
  isScriptToolFile,
  extractPromptDirFromPath,
  extractToolIdFromPath,
  type ScriptHotReloadRegistration,
} from './script-hot-reload.js';
