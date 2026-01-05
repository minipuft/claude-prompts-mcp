#!/usr/bin/env node
/**
 * Methodology YAML Validator
 *
 * Uses shared Zod schema from src/frameworks/methodology/methodology-schema.ts
 * Requires build to exist (imports from dist/).
 *
 * Usage:
 *   node scripts/validate-methodologies.js [--strict] [--verbose]
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const METHODOLOGIES_DIR = join(__dirname, '..', 'resources', 'methodologies');
const DIST_SCHEMA_PATH = join(__dirname, '..', 'dist', 'frameworks', 'methodology', 'methodology-schema.js');
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const VERBOSE = args.includes('--verbose');

// ============================================
// DYNAMIC IMPORT OF SHARED SCHEMA
// ============================================
async function loadSchema() {
  if (!existsSync(DIST_SCHEMA_PATH)) {
    console.error('❌ Build required: Run `npm run build` first');
    console.error(`   Missing: ${DIST_SCHEMA_PATH}`);
    process.exit(1);
  }

  const { validateMethodologySchema } = await import(DIST_SCHEMA_PATH);
  return validateMethodologySchema;
}

// ============================================
// VALIDATION (file existence checks are CI-specific)
// ============================================
function validateMethodology(dir, validateSchema) {
  const id = basename(dir);
  const yamlPath = join(dir, 'methodology.yaml');
  const errors = [];
  const warnings = [];

  // Check file exists
  if (!existsSync(yamlPath)) {
    return { id, valid: false, errors: ['Missing methodology.yaml'], warnings: [] };
  }

  // Parse YAML
  let data;
  try {
    data = yaml.load(readFileSync(yamlPath, 'utf-8'));
  } catch (e) {
    return { id, valid: false, errors: [`YAML parse error: ${e.message}`], warnings: [] };
  }

  // Use shared schema validation
  const result = validateSchema(data, id);
  errors.push(...result.errors);
  warnings.push(...result.warnings);

  // CI-specific: Check referenced files exist on disk
  if (data.phasesFile && !existsSync(join(dir, data.phasesFile))) {
    errors.push(`Referenced phasesFile not found: ${data.phasesFile}`);
  }
  if (data.judgePromptFile && !existsSync(join(dir, data.judgePromptFile))) {
    errors.push(`Referenced judgePromptFile not found: ${data.judgePromptFile}`);
  }

  return { id, valid: errors.length === 0, errors, warnings };
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('Validating methodology YAML files...\n');

  if (!existsSync(METHODOLOGIES_DIR)) {
    console.log('No methodologies directory found. Skipping.');
    process.exit(0);
  }

  const dirs = readdirSync(METHODOLOGIES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => join(METHODOLOGIES_DIR, e.name));

  if (dirs.length === 0) {
    console.log('No methodology directories found.');
    process.exit(0);
  }

  // Load shared schema
  const validateSchema = await loadSchema();

  let hasErrors = false;
  let hasWarnings = false;

  for (const dir of dirs) {
    const { id, valid, errors, warnings } = validateMethodology(dir, validateSchema);

    if (!valid) {
      hasErrors = true;
      console.log(`  ✗ ${id}`);
      errors.forEach(e => console.log(`      ✗ ${e}`));
    } else if (warnings.length > 0) {
      hasWarnings = true;
      console.log(`  ⚠ ${id} (${warnings.length} warning(s))`);
      if (VERBOSE) warnings.forEach(w => console.log(`      ⚠ ${w}`));
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

  console.log('\n✓ All methodologies valid');
}

main().catch(err => {
  console.error('Validation error:', err);
  process.exit(1);
});
