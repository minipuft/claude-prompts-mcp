#!/usr/bin/env tsx
// @lifecycle canonical - Verifies action metadata matches implementation.
/**
 * Action Inventory Verification
 *
 * Validates that action-metadata TypeScript definitions match the actual implementation in MCP
 * tool handlers, so metadata cannot drift from the code it describes.
 *
 * WHY THIS READS SOURCE, NOT `dist/`
 * ----------------------------------
 * The previous version imported metadata from `dist/mcp/metadata/definitions/*.js` and skipped
 * itself when those files were absent. `npm run build` is an esbuild *bundle* — it emits
 * `dist/index.js` plus `.d.ts` declarations and no individual modules — so that probe never
 * resolved, the early return was taken on every run, and the check printed a green tick without
 * comparing anything. It had been inert since the build became a bundle.
 *
 * Two of the three source paths it read had also been renamed by the 5-layer migration
 * (`prompt-resource-service.ts` -> `prompt-resource-handler.ts`, `mcp/tools/system-control.ts` ->
 * `mcp/tools/system-control/system-control-router.ts`). The skip hid that too: a guard that
 * returns before it reads anything cannot notice that what it reads is gone.
 *
 * So: metadata is imported from `src/` via tsx, there is no build dependency, and there is no
 * skip path. A MISSING TARGET IS NOW A FAILURE, not a silent pass — that is the property whose
 * absence let this rot for two refactors.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { promptEngineMetadata } from '../src/mcp/metadata/definitions/prompt-engine.js';
import { promptResourceMetadata } from '../src/mcp/metadata/definitions/prompt-resource.js';
import { systemControlMetadata } from '../src/mcp/metadata/definitions/system-control.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '..', 'src');

/**
 * Read a file the verification depends on. Unlike a plain `readFile`, this states which check
 * the target belongs to, because the failure mode being guarded against is the path silently
 * moving out from under the guard.
 */
async function readTarget(relativePath: string, check: string): Promise<string> {
  const filePath = path.join(SRC_DIR, relativePath);
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    throw new Error(
      `${check}: target file no longer exists: src/${relativePath}\n` +
        `  It was probably moved or renamed. Update the path in scripts/verify-action-inventory.ts.\n` +
        `  This check reads implementation source; a stale path means it verifies nothing.`
    );
  }
}

function extractSwitchCases(source: string, anchor: string, check: string): string[] {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex === -1) {
    throw new Error(`${check}: unable to locate anchor "${anchor}"`);
  }
  const sliced = source.slice(anchorIndex);
  const switchMatch = sliced.match(/switch\s*\([^)]+\)\s*{([\s\S]*?)}/);
  if (!switchMatch) {
    throw new Error(`${check}: unable to locate switch body after anchor "${anchor}"`);
  }
  const body = switchMatch[1];
  const matches: string[] = body.match(/case\s+["']([^"']+)["']/g) ?? [];
  return matches.map((caseLine) => caseLine.replace(/case\s+["']([^"']+)["'].*/, '$1'));
}

async function verifyPromptResource(): Promise<void> {
  const check = 'prompt_resource';
  const source = await readTarget(
    'mcp/tools/resource-manager/prompt/prompt-resource-handler.ts',
    check
  );
  const actionsInCode = new Set(extractSwitchCases(source, 'switch (action)', check));
  const actionsInMetadata = new Set(promptResourceMetadata.data.actions.map((action) => action.id));

  const missing = [...actionsInCode].filter((id) => !actionsInMetadata.has(id));
  if (missing.length > 0) {
    throw new Error(`prompt resource metadata is missing actions: ${missing.join(', ')}`);
  }
}

async function verifySystemControl(): Promise<void> {
  const check = 'system_control';
  const source = await readTarget('mcp/tools/system-control/system-control-router.ts', check);
  const actionsInCode = new Set(extractSwitchCases(source, 'switch (action)', check));

  const operationsInMetadata = new Set(
    systemControlMetadata.data.operations.map((op) => op.id.split(':')[0])
  );

  const missing = [...actionsInCode].filter((id) => !operationsInMetadata.has(id));
  if (missing.length > 0) {
    throw new Error(`system_control metadata is missing action groups: ${missing.join(', ')}`);
  }
}

async function verifyPromptEngine(): Promise<void> {
  const check = 'prompt_engine';
  const source = await readTarget('shared/types/execution.ts', check);
  const interfaceMatch = source.match(/export interface McpToolRequest\s*{([\s\S]*?)}/);
  if (!interfaceMatch) {
    throw new Error(`${check}: unable to locate McpToolRequest interface`);
  }

  // Match field names but exclude fields typed as `never` (blocked parameters).
  const fieldRegex = /readonly\s+([a-zA-Z0-9_]+)\??:\s*([^;]+);/g;
  const fields = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(interfaceMatch[1])) !== null) {
    const fieldName = match[1];
    const fieldType = match[2].trim();
    if (fieldType !== 'never') {
      fields.add(fieldName);
    }
  }

  const parameterNames = new Set(promptEngineMetadata.data.parameters.map((param) => param.name));
  const missing = [...fields].filter((name) => !parameterNames.has(name));
  if (missing.length > 0) {
    throw new Error(`prompt_engine metadata missing parameters: ${missing.join(', ')}`);
  }
}

async function main(): Promise<void> {
  await Promise.all([verifyPromptResource(), verifySystemControl(), verifyPromptEngine()]);
  console.log('✅ Action inventory verified (3 checks against src/)');
}

main().catch((error: unknown) => {
  console.error('❌ Action inventory verification failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
