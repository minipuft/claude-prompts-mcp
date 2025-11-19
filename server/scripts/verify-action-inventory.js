#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '..', 'src');
const METADATA_DIR = path.join(SRC_DIR, 'tooling', 'action-metadata');

async function readJson(relativePath) {
  const filePath = path.join(METADATA_DIR, relativePath);
  const contents = await readFile(filePath, 'utf8');
  return JSON.parse(contents);
}

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
  const matches = body.match(/case\s+"([^"]+)"/g) || [];
  return matches.map((match) => match.replace(/case\s+"([^"]+)".*/, '$1'));
}

async function verifyPromptManager() {
  const metadata = await readJson('prompt-manager.json');
  const filePath = path.join(SRC_DIR, 'mcp-tools', 'prompt-manager', 'core', 'manager.ts');
  const source = await readFile(filePath, 'utf8');
  const actionsInCode = new Set(extractSwitchCases(source, 'switch (action)'));
  const actionsInMetadata = new Set(metadata.actions.map((action) => action.id));

  const missing = [...actionsInCode].filter((id) => !actionsInMetadata.has(id));
  if (missing.length > 0) {
    throw new Error(`prompt_manager metadata is missing actions: ${missing.join(', ')}`);
  }
}

async function verifySystemControl() {
  const metadata = await readJson('system-control.json');
  const filePath = path.join(SRC_DIR, 'mcp-tools', 'system-control.ts');
  const source = await readFile(filePath, 'utf8');
  const actionsInCode = new Set(extractSwitchCases(source, 'switch (action)'));
  const operationsInMetadata = new Set(metadata.operations.map((op) => op.id.split(':')[0]));

  const missing = [...actionsInCode].filter((id) => !operationsInMetadata.has(id));
  if (missing.length > 0) {
    throw new Error(`system_control metadata is missing action groups: ${missing.join(', ')}`);
  }
}

async function verifyPromptEngine() {
  const metadata = await readJson('prompt-engine.json');
  const filePath = path.join(SRC_DIR, 'types', 'execution.ts');
  const source = await readFile(filePath, 'utf8');
  const interfaceMatch = source.match(/export interface McpToolRequest\s*{([\s\S]*?)}/);
  if (!interfaceMatch) {
    throw new Error('Unable to locate McpToolRequest interface');
  }

  const fieldRegex = /readonly\s+([a-zA-Z0-9_]+)\??:/g;
  const fields = new Set();
  let match;
  while ((match = fieldRegex.exec(interfaceMatch[1])) !== null) {
    fields.add(match[1]);
  }

  const parameterNames = new Set(metadata.parameters.map((param) => param.name));
  const missing = [...fields].filter((name) => !parameterNames.has(name));
  if (missing.length > 0) {
    throw new Error(`prompt_engine metadata missing parameters: ${missing.join(', ')}`);
  }
}

async function main() {
  await Promise.all([
    verifyPromptManager(),
    verifySystemControl(),
    verifyPromptEngine()
  ]);
  console.log('✅ Action inventory verified');
}

main().catch((error) => {
  console.error('❌ Action inventory verification failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
