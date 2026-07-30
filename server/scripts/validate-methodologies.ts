#!/usr/bin/env tsx
/**
 * Methodology YAML Validator
 *
 * Imports Zod schemas directly from TypeScript source (via tsx).
 * No build step required.
 *
 * Usage:
 *   tsx scripts/validate-frameworks.ts [--strict] [--verbose]
 *   npm run validate:frameworks
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  validateFrameworkSchema,
  validatePhasesSchema,
  type FrameworkSchemaValidationResult,
} from '../src/engine/frameworks/methodology/methodology-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const METHODOLOGIES_DIR = join(__dirname, '..', 'resources', 'frameworks');
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const VERBOSE = args.includes('--verbose');

interface ValidationResult {
  id: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================
// VALIDATION (file existence checks are CI-specific)
// ============================================
function validateMethodology(dir: string): ValidationResult {
  const id = basename(dir);
  const yamlPath = join(dir, 'framework.yaml');
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check file exists
  if (!existsSync(yamlPath)) {
    return { id, valid: false, errors: ['Missing framework.yaml'], warnings: [] };
  }

  // Parse YAML
  let data: Record<string, unknown>;
  try {
    data = yaml.load(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { id, valid: false, errors: [`YAML parse error: ${message}`], warnings: [] };
  }

  // Use shared schema validation
  const result: FrameworkSchemaValidationResult = validateFrameworkSchema(data, id);
  errors.push(...result.errors);
  warnings.push(...result.warnings);

  // CI-specific: Check referenced files exist on disk
  if (data['phasesFile'] && !existsSync(join(dir, data['phasesFile'] as string))) {
    errors.push(`Referenced phasesFile not found: ${data['phasesFile']}`);
  }
  if (data['judgePromptFile'] && !existsSync(join(dir, data['judgePromptFile'] as string))) {
    errors.push(`Referenced judgePromptFile not found: ${data['judgePromptFile']}`);
  }

  // Validate phases.yaml if it exists
  if (data['phasesFile']) {
    const phasesPath = join(dir, data['phasesFile'] as string);
    if (existsSync(phasesPath)) {
      try {
        const phasesData = yaml.load(readFileSync(phasesPath, 'utf-8'));
        const phasesResult: FrameworkSchemaValidationResult = validatePhasesSchema(phasesData);
        errors.push(...phasesResult.errors.map((e) => `phases.yaml: ${e}`));
        warnings.push(...phasesResult.warnings.map((w) => `phases.yaml: ${w}`));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`phases.yaml parse error: ${message}`);
      }
    }
  }

  return { id, valid: errors.length === 0, errors, warnings };
}

// ============================================
// MAIN
// ============================================
function main(): void {
  console.log('Validating methodology YAML files...\n');

  if (!existsSync(METHODOLOGIES_DIR)) {
    console.log('No frameworks directory found. Skipping.');
    process.exit(0);
  }

  const dirs = readdirSync(METHODOLOGIES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(METHODOLOGIES_DIR, e.name));

  if (dirs.length === 0) {
    console.log('No methodology directories found.');
    process.exit(0);
  }

  let hasErrors = false;
  let hasWarnings = false;

  for (const dir of dirs) {
    const { id, valid, errors, warnings } = validateMethodology(dir);

    if (!valid) {
      hasErrors = true;
      console.log(`  ✗ ${id}`);
      errors.forEach((e) => console.log(`      ✗ ${e}`));
    } else if (warnings.length > 0) {
      hasWarnings = true;
      console.log(`  ⚠ ${id} (${warnings.length} warning(s))`);
      if (VERBOSE) warnings.forEach((w) => console.log(`      ⚠ ${w}`));
    } else {
      console.log(`  ✓ ${id}`);
    }
  }

  console.log(`\nValidation complete: ${dirs.length} methodology(ies)`);

  if (hasErrors) {
    console.error('\n✗ Validation failed');
    process.exit(1);
  }

  if (STRICT && hasWarnings) {
    console.error('\n✗ Validation failed (strict mode)');
    process.exit(1);
  }

  console.log('\n✓ All frameworks valid');
}

main();
