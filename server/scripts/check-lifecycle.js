#!/usr/bin/env node
/**
 * Lifecycle Annotation Checker (standalone)
 *
 * Scans all TypeScript files under src/ and verifies that the leading comments
 * include `@lifecycle <status> - <description>` with an allowed status.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SRC_ROOT = path.join(process.cwd(), 'src');
const ALLOWED_STATUSES = new Set(['canonical', 'migrating']);
const LIFECYCLE_REGEX = /@lifecycle\s+([a-z-]+)(?:\s*-\s*(.+))?/i;
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git']);

async function collectTsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...(await collectTsFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

function findLifecycleAnnotation(content) {
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }

    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      const match = LIFECYCLE_REGEX.exec(trimmed);
      if (match) {
        const status = match[1]?.toLowerCase();
        const description = match[2]?.trim() ?? '';
        return { status, description };
      }

      // keep scanning comment block
      continue;
    }

    // first non-comment token without lifecycle
    break;
  }

  return null;
}

async function main() {
  const files = await collectTsFiles(SRC_ROOT);
  const errors = [];

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    const annotation = findLifecycleAnnotation(content);
    if (!annotation) {
      errors.push({ file, message: 'Missing @lifecycle annotation at file top.' });
      continue;
    }

    if (!ALLOWED_STATUSES.has(annotation.status ?? '')) {
      errors.push({
        file,
        message: `Invalid lifecycle status "${annotation.status}". Allowed: ${Array.from(ALLOWED_STATUSES).join(', ')}`,
      });
      continue;
    }

    if (!annotation.description) {
      errors.push({ file, message: 'Lifecycle annotation must include a short description after "-".' });
    }
  }

  if (errors.length > 0) {
    console.error('❌ Lifecycle annotation check failed:');
    for (const error of errors) {
      console.error(`  - ${error.file}: ${error.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log('✅ Lifecycle annotations verified (no missing/invalid entries).');
  }
}

main().catch((error) => {
  console.error('Lifecycle check script failed:', error);
  process.exitCode = 1;
});
