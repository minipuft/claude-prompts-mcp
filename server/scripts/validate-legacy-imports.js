#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'src');
const LEGACY_TOKENS = ['ChainExecutor', 'ConsolidatedPromptEngine'];
const VIOLATIONS = new Map();

function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath);
      continue;
    }

    if (!/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) {
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    for (const token of LEGACY_TOKENS) {
      if (content.includes(token)) {
        const relativePath = fullPath.replace(`${process.cwd()}/`, '');
        if (!VIOLATIONS.has(token)) {
          VIOLATIONS.set(token, new Set());
        }
        VIOLATIONS.get(token).add(relativePath);
      }
    }
  }
}

if (fs.existsSync(ROOT)) {
  scanDirectory(ROOT);
}

if (VIOLATIONS.size > 0) {
  console.error('❌ Legacy references detected in source files:');
  for (const [token, files] of VIOLATIONS.entries()) {
    console.error(` - ${token}:`);
    for (const file of files) {
      console.error(`   • ${file}`);
    }
  }
  console.error(
    'Remove references to legacy executors; the PromptExecutionPipeline is the canonical path.'
  );
  process.exit(1);
}

console.log('✅ Legacy import scan passed (no ChainExecutor references found).');
