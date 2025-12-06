import { type ToolContract } from './types.js';
/**
 * Loads and validates a tool contract JSON file.
 *
 * @param filePath - Path to the contract JSON
 */
export declare function loadToolContract(filePath: string): Promise<ToolContract>;
export { validateToolContract } from './types.js';
export type { ToolContract, ParameterDefinition, CommandDescriptor } from './types.js';
