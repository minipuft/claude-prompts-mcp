// @lifecycle canonical - Entry point for tool contract validation/loading.
import { readFile } from 'node:fs/promises';

import { validateToolContract, type ToolContract } from './types.js';

/**
 * Loads and validates a tool contract JSON file.
 *
 * @param filePath - Path to the contract JSON
 */
export async function loadToolContract(filePath: string): Promise<ToolContract> {
  const contents = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(contents);
  return validateToolContract(parsed);
}

export { validateToolContract } from './types.js';
export type { ToolContract, ParameterDefinition, CommandDescriptor } from './types.js';
