#!/usr/bin/env tsx
/**
 * Framework JSON Schema Generator
 *
 * Derives JSON Schema files from the canonical Zod schemas in framework-schema.ts.
 * Output files provide IDE autocomplete and validation for framework YAML authoring.
 *
 * Usage:
 *   tsx scripts/generate-framework-schemas.ts
 *   npm run generate:schemas
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  FrameworkSchema,
  PhasesFileSchema,
} from '../src/engine/frameworks/definitions/framework-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(__dirname, '..', 'resources', 'schemas');

mkdirSync(SCHEMAS_DIR, { recursive: true });

// Generate framework.yaml schema
const frameworkJsonSchema = zodToJsonSchema(FrameworkSchema, {
  name: 'FrameworkResourceDefinition',
  $refStrategy: 'none',
});
frameworkJsonSchema['$schema'] = 'http://json-schema.org/draft-07/schema#';
frameworkJsonSchema['title'] = 'Framework Definition';
frameworkJsonSchema['description'] =
  'Schema for framework.yaml — defines a framework with gates, guidance, and tool overlays.';

writeFileSync(
  join(SCHEMAS_DIR, 'methodology.schema.json'),
  JSON.stringify(frameworkJsonSchema, null, 2) + '\n'
);
console.log('  ✓ methodology.schema.json');

// Generate phases.yaml schema
const phasesJsonSchema = zodToJsonSchema(PhasesFileSchema, {
  name: 'PhasesDefinition',
  $refStrategy: 'none',
});
phasesJsonSchema['$schema'] = 'http://json-schema.org/draft-07/schema#';
phasesJsonSchema['title'] = 'Phases Definition';
phasesJsonSchema['description'] =
  'Schema for phases.yaml — defines processing steps, execution steps, assertions, and quality indicators for a framework.';

writeFileSync(
  join(SCHEMAS_DIR, 'phases.schema.json'),
  JSON.stringify(phasesJsonSchema, null, 2) + '\n'
);
console.log('  ✓ phases.schema.json');

console.log(`\n✓ JSON Schemas written to ${SCHEMAS_DIR}`);
