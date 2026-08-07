#!/usr/bin/env tsx
/**
 * Framework JSON Schema Generator
 *
 * Derives JSON Schema files from the canonical Zod schemas in framework-schema.ts.
 * Output files provide IDE autocomplete and validation for framework YAML authoring.
 *
 * WHY `--check` EXISTS
 * The two emitted files are committed, so they are a second copy of the Zod source. Without a
 * freshness gate the copy may drift silently: editing `FrameworkSchema` and forgetting to
 * regenerate leaves YAML authors validating against a shape the server no longer accepts, and
 * neither typecheck nor the test suite reads these files. Its sibling generators
 * (`generate-contracts`, `generate-gate-index`) both carry a `--check` for this reason; this one
 * did not, which is the gap it closes.
 *
 * Usage:
 *   tsx scripts/generate-framework-schemas.ts [--check]
 *   npm run generate:schemas
 *   npm run validate:schemas
 *
 * Options:
 *   --check   Verify committed schemas match the Zod source without writing (exit 1 if stale)
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, type ZodType } from 'zod/v4';
import {
  FrameworkSchema,
  PhasesFileSchema,
} from '../src/engine/frameworks/definitions/framework-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(__dirname, '..', 'resources', 'schemas');
const CHECK_MODE = process.argv.includes('--check');

interface SchemaArtifact {
  fileName: string;
  title: string;
  description: string;
  source: ZodType;
}

const ARTIFACTS: SchemaArtifact[] = [
  {
    fileName: 'framework.schema.json',
    title: 'Framework Definition',
    description:
      'Schema for framework.yaml — defines a framework with gates, guidance, and tool overlays.',
    source: FrameworkSchema,
  },
  {
    fileName: 'phases.schema.json',
    title: 'Phases Definition',
    description:
      'Schema for phases.yaml — defines processing steps, execution steps, assertions, and quality indicators for a framework.',
    source: PhasesFileSchema,
  },
];

/**
 * Pure: Zod schema -> the exact bytes the committed file should hold.
 *
 * zod 4 ships its own converter, so the zod-to-json-schema dependency is gone.
 * `target: 'draft-7'` preserves the dialect these files have always declared, and
 * `io: 'input'` matches what a YAML author writes (pre-transform).
 */
function render(artifact: SchemaArtifact): string {
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(artifact.source, {
    target: 'draft-7',
    io: 'input',
  });
  jsonSchema['$schema'] = 'http://json-schema.org/draft-07/schema#';
  jsonSchema['title'] = artifact.title;
  jsonSchema['description'] = artifact.description;
  return JSON.stringify(jsonSchema, null, 2) + '\n';
}

function main(): void {
  const rendered = ARTIFACTS.map((artifact) => ({
    path: join(SCHEMAS_DIR, artifact.fileName),
    fileName: artifact.fileName,
    content: render(artifact),
  }));

  if (CHECK_MODE) {
    const stale = rendered.filter((entry) => {
      const existing = existsSync(entry.path) ? readFileSync(entry.path, 'utf8') : '';
      return existing !== entry.content;
    });

    if (stale.length > 0) {
      console.error('✗ Framework JSON Schemas are stale — the Zod source has moved on:');
      for (const entry of stale) console.error(`    ${entry.fileName}`);
      console.error('\n  Run: npm run generate:schemas');
      process.exit(1);
    }

    console.log('✓ Framework JSON Schemas match the Zod source');
    return;
  }

  mkdirSync(SCHEMAS_DIR, { recursive: true });
  for (const entry of rendered) {
    writeFileSync(entry.path, entry.content);
    console.log(`  ✓ ${entry.fileName}`);
  }
  console.log(`\n✓ JSON Schemas written to ${SCHEMAS_DIR}`);
}

main();
