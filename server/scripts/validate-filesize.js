#!/usr/bin/env node
/**
 * File Size Validation Script
 *
 * Enforces the 500-line module boundary standard defined in REFACTORING.md.
 * This script validates that TypeScript files in /server/src do not exceed
 * the hard limit of 500 lines, with exemptions for:
 * 1. Files with @lifecycle canonical annotation
 * 2. Grandfathered files (current violators being migrated)
 *
 * Exit Codes:
 * - 0: All files compliant or exempted
 * - 1: New violations detected (files over 500 lines without exemption)
 *
 * Usage:
 *   npm run validate:filesize
 *   node scripts/validate-filesize.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const HARD_LIMIT = 500; // Maximum lines per file (REFACTORING.md standard)
const SOFT_LIMIT = 300; // Target for new code (informational)
const SRC_DIR = path.join(__dirname, '..', 'src');

// Grandfathered files - current violators being tracked for decomposition
// These files are temporarily exempted until they are refactored
const GRANDFATHERED_FILES = [
  'mcp-tools/system-control.ts', // 2717 lines - needs service decomposition
  'mcp-tools/prompt-engine/core/engine.ts', // 2343 lines
  'mcp-tools/index.ts', // 1487 lines
  'runtime/application.ts', // 1303 lines
  'frameworks/prompt-guidance/template-enhancer.ts', // 1167 lines
  'execution/parsers/argument-parser.ts', // 1012 lines
  'metrics/analytics-service.ts', // 1004 lines
  'chain-session/manager.ts', // 982 lines
  'frameworks/integration/framework-semantic-integration.ts', // 889 lines
  'mcp-tools/prompt-manager/core/manager.ts', // 799 lines
  'semantic/configurable-semantic-analyzer.ts', // 792 lines
  'frameworks/methodology/guides/cageerf-guide.ts', // 764 lines
  'execution/parsers/command-parser.ts', // 750 lines
  'frameworks/framework-state-manager.ts', // 744 lines
  'frameworks/methodology/guides/scamper-guide.ts', // 722 lines
  'frameworks/prompt-guidance/system-prompt-injector.ts', // 720 lines
  'frameworks/methodology/guides/5w1h-guide.ts', // 718 lines
  'execution/context/context-resolver.ts', // 715 lines
  'frameworks/methodology/guides/react-guide.ts', // 715 lines
  'frameworks/prompt-guidance/methodology-tracker.ts', // 687 lines
  'frameworks/prompt-guidance/service.ts', // 664 lines
  'prompts/loader.ts', // 632 lines
  'index.ts', // 623 lines - main entry point
  'prompts/file-observer.ts', // 620 lines
  'mcp-tools/tool-description-manager.ts', // 616 lines
  'prompts/hot-reload-manager.ts', // 599 lines
  'mcp-tools/types/shared-types.ts', // 590 lines
  'prompts/promptUtils.ts', // 590 lines
  'mcp-tools/prompt-manager/operations/file-operations.ts', // 550 lines
  'execution/pipeline/stages/gate-enhancement-stage.ts', // 524 lines
  'mcp-tools/prompt-engine/utils/category-extractor.ts', // 509 lines
  'mcp-tools/prompt-engine/utils/validation.ts', // 504 lines
];

/**
 * Recursively get all TypeScript files in a directory
 */
function getAllTypeScriptFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Skip node_modules, dist, and tests directories
      if (!['node_modules', 'dist', 'tests', 'test'].includes(file)) {
        getAllTypeScriptFiles(filePath, fileList);
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts')) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Count lines in a file
 */
function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').length;
}

/**
 * Check if file has @lifecycle canonical annotation
 */
function hasCanonicalAnnotation(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').slice(0, 10); // Check first 10 lines
  return lines.some((line) => line.includes('@lifecycle canonical'));
}

/**
 * Get relative path from src directory
 */
function getRelativePath(filePath) {
  return path.relative(SRC_DIR, filePath);
}

/**
 * Check if file is grandfathered
 */
function isGrandfathered(relativePath) {
  return GRANDFATHERED_FILES.includes(relativePath);
}

/**
 * Validate all TypeScript files for size compliance
 */
function validateFileSizes() {
  console.log('🔍 Validating TypeScript file sizes...\n');
  console.log(`   Hard Limit: ${HARD_LIMIT} lines`);
  console.log(`   Soft Target: ${SOFT_LIMIT} lines\n`);

  const allFiles = getAllTypeScriptFiles(SRC_DIR);
  const violations = [];
  const warnings = [];
  const grandfatheredViolations = [];
  const canonicalExemptions = [];

  allFiles.forEach((filePath) => {
    const lineCount = countLines(filePath);
    const relativePath = getRelativePath(filePath);
    const hasCanonical = hasCanonicalAnnotation(filePath);
    const grandfathered = isGrandfathered(relativePath);

    if (lineCount > HARD_LIMIT) {
      if (hasCanonical) {
        // Canonical exemption - allowed but tracked
        canonicalExemptions.push({ path: relativePath, lines: lineCount });
      } else if (grandfathered) {
        // Grandfathered file - allowed but tracked for migration
        grandfatheredViolations.push({ path: relativePath, lines: lineCount });
      } else {
        // New violation - NOT allowed
        violations.push({ path: relativePath, lines: lineCount });
      }
    } else if (lineCount > SOFT_LIMIT) {
      // Over soft limit but under hard limit - informational warning
      warnings.push({ path: relativePath, lines: lineCount });
    }
  });

  // Report results
  console.log(`📊 Scanned ${allFiles.length} TypeScript files\n`);

  if (violations.length > 0) {
    console.log('🚨 NEW VIOLATIONS DETECTED!\n');
    console.log('The following files exceed 500 lines without exemption:\n');
    violations
      .sort((a, b) => b.lines - a.lines)
      .forEach(({ path, lines }) => {
        const delta = lines - HARD_LIMIT;
        console.log(`  ❌ ${path}`);
        console.log(`     ${lines} lines (+${delta} over limit)\n`);
      });
    console.log('Action Required:');
    console.log('  1. Add @lifecycle canonical annotation if this is a consolidated module');
    console.log('  2. Refactor file to stay under 500 lines');
    console.log('  3. See REFACTORING.md for decomposition strategies\n');
  }

  if (grandfatheredViolations.length > 0) {
    console.log(`📋 Grandfathered Files: ${grandfatheredViolations.length}\n`);
    console.log('These files are temporarily exempted pending decomposition:\n');
    grandfatheredViolations
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 10)
      .forEach(({ path, lines }) => {
        const delta = lines - HARD_LIMIT;
        console.log(`  ⚠️  ${path}`);
        console.log(`     ${lines} lines (+${delta} over limit)\n`);
      });
    if (grandfatheredViolations.length > 10) {
      console.log(`  ... and ${grandfatheredViolations.length - 10} more files\n`);
    }
    console.log('See /plans/file-size-baseline.md for decomposition roadmap\n');
  }

  if (canonicalExemptions.length > 0) {
    console.log(`✅ Canonical Exemptions: ${canonicalExemptions.length}\n`);
    console.log('These files have @lifecycle canonical annotation:\n');
    canonicalExemptions
      .sort((a, b) => b.lines - a.lines)
      .forEach(({ path, lines }) => {
        console.log(`  📌 ${path} (${lines} lines)`);
      });
    console.log();
  }

  if (warnings.length > 0 && warnings.length <= 10) {
    console.log(`⚠️  Files over soft limit (${SOFT_LIMIT} lines): ${warnings.length}\n`);
    warnings
      .sort((a, b) => b.lines - a.lines)
      .forEach(({ path, lines }) => {
        console.log(`  ${path} (${lines} lines)`);
      });
    console.log();
  }

  if (violations.length === 0) {
    console.log('✅ No new violations detected!\n');
    console.log('Summary:');
    console.log(`  ✅ New files: All under ${HARD_LIMIT} lines`);
    console.log(`  📋 Grandfathered: ${grandfatheredViolations.length} files tracked for migration`);
    console.log(`  📌 Canonical: ${canonicalExemptions.length} files with lifecycle annotation`);
    console.log(`  ⚠️  Warnings: ${warnings.length} files over ${SOFT_LIMIT} lines (under limit)\n`);
    return 0;
  } else {
    console.log(`\n🚨 Validation failed: ${violations.length} new violation(s)\n`);
    return 1;
  }
}

// Run validation
const exitCode = validateFileSizes();
process.exit(exitCode);
