#!/usr/bin/env node
/**
 * Dependency Graph Generator
 *
 * Uses Madge to produce DOT files (and SVG images when Graphviz is installed)
 * for key subsystems in the MCP server. Results land under server/graphs/.
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import madge from 'madge';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'graphs');
const execFileAsync = promisify(execFile);
let graphvizAvailable = false;

const CATEGORY_DEFINITIONS = [
  {
    id: 'full-codebase',
    label: 'Entire MCP Server',
    paths: ['src'],
    description: 'Complete dependency graph across all server modules.',
  },
  {
    id: 'gates-system',
    label: 'Gate System',
    paths: ['src/gates'],
    description: 'Gate definitions, validators, guidance renderers, and services.',
  },
  {
    id: 'frameworks',
    label: 'Framework Orchestration',
    paths: ['src/frameworks'],
    description: 'Framework manager, methodology guides, integrations, and guidance utilities.',
  },
  {
    id: 'execution-pipeline',
    label: 'Execution Pipeline',
    paths: ['src/execution'],
    description: 'Context resolvers, parsers, operators, and pipeline stages.',
  },
  {
    id: 'runtime-transports',
    label: 'Runtime & Transports',
    paths: ['src/runtime', 'src/server', 'src/logging'],
    description: 'Startup/runtime orchestration, transports, and logging helpers.',
  },
  {
    id: 'mcp-tools',
    label: 'MCP Tools',
    paths: ['src/mcp-tools'],
    description: 'Prompt engine, prompt manager, system control, and supporting utilities.',
  },
  {
    id: 'semantic-analysis',
    label: 'Semantic + Analysis Stack',
    paths: ['src/semantic', 'src/metrics', 'src/performance', 'src/text-references'],
    description: 'Semantic analyzers, telemetry, performance monitors, and reference trackers.',
  },
  {
    id: 'prompts-config',
    label: 'Prompts & Configuration',
    paths: ['src/prompts', 'src/config'],
    description: 'Prompt loaders, registry, and configuration utilities.',
  },
];

const MADGE_OPTIONS = {
  baseDir: ROOT_DIR,
  includeNpm: false,
  extensions: ['ts', 'tsx', 'js'],
  fileExtensions: ['ts', 'tsx', 'js'],
  tsConfig: path.join(ROOT_DIR, 'tsconfig.json'),
};

async function detectGraphviz() {
  try {
    await execFileAsync('gvpr', ['-V']);
    graphvizAvailable = true;
    console.log('ℹ️  Graphviz detected – DOT/SVG outputs enabled.');
  } catch {
    graphvizAvailable = false;
    console.warn('⚠️  Graphviz (gvpr) not found. DOT/SVG outputs will be skipped. Install graphviz to enable images.');
  }
}

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

async function writeDotFile(categoryId, dotSource) {
  if (!graphvizAvailable) {
    return null;
  }

  const dotPath = path.join(OUTPUT_DIR, `${categoryId}.dot`);
  await writeFile(dotPath, dotSource, 'utf8');
  return dotPath;
}

async function writeMetadata(category, graphResult) {
  const metadataPath = path.join(OUTPUT_DIR, `${category.id}.json`);
  const data = {
    category: category.label,
    description: category.description,
    nodes: graphResult.obj(),
    circularDependencies: graphResult.circular(),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(metadataPath, JSON.stringify(data, null, 2), 'utf8');
  return metadataPath;
}

async function writeSvg(categoryId, graphResult) {
  if (!graphvizAvailable) {
    return { imagePath: null };
  }

  const imagePath = path.join(OUTPUT_DIR, `${categoryId}.svg`);
  try {
    await graphResult.image(imagePath);
    return { imagePath };
  } catch (error) {
    console.warn(`⚠️  SVG generation skipped for ${categoryId}: ${error.message}`);
    return { imagePath: null };
  }
}

async function generateForCategory(category) {
  const paths = category.paths.map((relativePath) => path.join(ROOT_DIR, relativePath));
  console.log(`\n🔧 Generating dependency graph for ${category.label} (${category.paths.join(', ')})`);

  const graphResult = await madge(paths, MADGE_OPTIONS);
  let dotPath = null;
  if (graphvizAvailable) {
    const dotSource = await graphResult.dot();
    dotPath = await writeDotFile(category.id, dotSource);
  }
  const { imagePath } = await writeSvg(category.id, graphResult);
  const metadataPath = await writeMetadata(category, graphResult);

  if (dotPath) {
    console.log(`   • DOT: ${path.relative(ROOT_DIR, dotPath)}`);
  } else {
    console.log('   • DOT: skipped (Graphviz not available)');
  }
  if (imagePath) {
    console.log(`   • SVG: ${path.relative(ROOT_DIR, imagePath)}`);
  } else {
    console.log('   • SVG: skipped (Graphviz dot not available)');
  }
  console.log(`   • Metadata: ${path.relative(ROOT_DIR, metadataPath)}`);
}

async function main() {
  await ensureOutputDir();
  await detectGraphviz();
  for (const category of CATEGORY_DEFINITIONS) {
    try {
      await generateForCategory(category);
    } catch (error) {
      console.error(`❌ Failed to generate graph for ${category.label}:`, error);
      process.exitCode = 1;
    }
  }

  console.log('\n✅ Dependency graph generation complete.');
}

main().catch((error) => {
  console.error('Unexpected error while generating dependency graphs:', error);
  process.exit(1);
});
