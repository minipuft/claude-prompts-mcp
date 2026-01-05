// @lifecycle canonical - Core resource manager exports.
export { ResourceManagerRouter, createResourceManagerRouter } from './router.js';
export type {
  ResourceType,
  ResourceAction,
  ResourceManagerInput,
  ResourceManagerDependencies,
  ActionValidationResult,
} from './types.js';
export { PROMPT_ONLY_ACTIONS, METHODOLOGY_ONLY_ACTIONS, COMMON_ACTIONS } from './types.js';
