#!/usr/bin/env node
// @lifecycle canonical - Verifies action metadata matches implementation.
/**
 * Action Inventory Verification
 *
 * Validates that action-metadata TypeScript definitions match the actual
 * implementation in MCP tool handlers. Ensures metadata stays synchronized
 * with code changes.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '..', 'src');
const DIST_DIR = path.join(__dirname, '..', 'dist');

function extractSwitchCases(source, anchor) {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex === -1) {
    throw new Error(`Unable to locate anchor "${anchor}"`);
  }
  const sliced = source.slice(anchorIndex);
  const switchMatch = sliced.match(/switch\s*\([^)]+\)\s*{([\s\S]*?)}/);
  if (!switchMatch) {
    throw new Error(`Unable to locate switch body after anchor "${anchor}"`);
  }
  const body = switchMatch[1];
  const matches = body.match(/case\s+["']([^"']+)["']/g) || [];
  return matches.map((match) => match.replace(/case\s+["']([^"']+)["'].*/, '$1'));
}

async function verifyPromptManager() {
  // Import metadata from compiled TypeScript
  const { promptManagerMetadata } = await import(
    path.join(DIST_DIR, 'tooling', 'action-metadata', 'definitions', 'prompt-manager.js')
  );

  const filePath = path.join(SRC_DIR, 'mcp-tools', 'prompt-manager', 'core', 'manager.ts');
  const source = await readFile(filePath, 'utf8');
  const actionsInCode = new Set(extractSwitchCases(source, 'switch (action)'));

  const actionsInMetadata = new Set(promptManagerMetadata.data.actions.map((action) => action.id));

  const missing = [...actionsInCode].filter((id) => !actionsInMetadata.has(id));
  if (missing.length > 0) {
    throw new Error(`prompt_manager metadata is missing actions: ${missing.join(', ')}`);
  }
}

async function verifySystemControl() {
  // Import metadata from compiled TypeScript
  const { systemControlMetadata } = await import(
    path.join(DIST_DIR, 'tooling', 'action-metadata', 'definitions', 'system-control.js')
  );

  const filePath = path.join(SRC_DIR, 'mcp-tools', 'system-control.ts');
  const source = await readFile(filePath, 'utf8');
  const actionsInCode = new Set(extractSwitchCases(source, 'switch (action)'));

  const operationsInMetadata = new Set(
    systemControlMetadata.data.operations.map((op) => op.id.split(':')[0])
  );

  const missing = [...actionsInCode].filter((id) => !operationsInMetadata.has(id));
  if (missing.length > 0) {
    throw new Error(`system_control metadata is missing action groups: ${missing.join(', ')}`);
  }
}

async function verifyPromptEngine() {
  // Import metadata from compiled TypeScript
  const { promptEngineMetadata } = await import(
    path.join(DIST_DIR, 'tooling', 'action-metadata', 'definitions', 'prompt-engine.js')
  );

  const filePath = path.join(SRC_DIR, 'types', 'execution.ts');
  const source = await readFile(filePath, 'utf8');
  const interfaceMatch = source.match(/export interface McpToolRequest\s*{([\s\S]*?)}/);
  if (!interfaceMatch) {
    throw new Error('Unable to locate McpToolRequest interface');
  }

  // Match field names but exclude fields typed as `never` (blocked parameters)
  const fieldRegex = /readonly\s+([a-zA-Z0-9_]+)\??:\s*([^;]+);/g;
  const fields = new Set();
  let match;
  while ((match = fieldRegex.exec(interfaceMatch[1])) !== null) {
    const fieldName = match[1];
    const fieldType = match[2].trim();
    // Skip fields typed as 'never' - these are intentionally blocked
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

async function main() {
  // Check if dist exists
  try {
    await readFile(path.join(DIST_DIR, 'index.js'), 'utf8');
  } catch {
    console.warn('⚠️  dist/ not found. Run `npm run build` first.');
    console.log('✅ Skipping action inventory verification (no build)');
    return;
  }

  await Promise.all([verifyPromptManager(), verifySystemControl(), verifyPromptEngine()]);
  console.log('✅ Action inventory verified');
}

main().catch((error) => {
  console.error('❌ Action inventory verification failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
