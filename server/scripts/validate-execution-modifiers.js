// @lifecycle canonical - Prevents legacy ExecutionPlan.modifier from reappearing.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const executionTypesPath = path.resolve(process.cwd(), 'src', 'execution', 'types.ts');

const source = await readFile(executionTypesPath, 'utf8');

const match = source.match(/export interface ExecutionPlan\s*\{([\s\S]*?)\n\}/);
if (!match) {
  console.error(
    `[validate-execution-modifiers] Could not locate ExecutionPlan interface in ${executionTypesPath}`
  );
  process.exit(1);
}

const executionPlanBody = match[1] ?? '';
if (/\bmodifier\s*\?:/.test(executionPlanBody) || /\bmodifier\s*:/.test(executionPlanBody)) {
  console.error(
    `[validate-execution-modifiers] Legacy field detected: ExecutionPlan.modifier. Use ExecutionPlan.modifiers instead. (${executionTypesPath})`
  );
  process.exit(1);
}
