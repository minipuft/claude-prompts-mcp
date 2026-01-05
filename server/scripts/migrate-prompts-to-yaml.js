#!/usr/bin/env node
/**
 * Prompt Migration Script: JSON+MD → YAML+MD
 *
 * Migrates prompts from the old JSON format (prompts.json + markdown files)
 * to the new YAML directory format (prompt.yaml + referenced files).
 *
 * Old format:
 *   prompts/{category}/prompts.json  (array of prompt definitions)
 *   prompts/{category}/{prompt}.md   (markdown template)
 *
 * New format:
 *   prompts/{category}/{prompt-id}/prompt.yaml
 *   prompts/{category}/{prompt-id}/user-message.md
 *   prompts/{category}/{prompt-id}/system-message.md (if exists)
 *
 * Usage:
 *   node scripts/migrate-prompts-to-yaml.js [--dry-run] [--category=<cat>] [--verbose]
 *
 * Options:
 *   --dry-run    Show what would be created without writing files
 *   --category   Migrate only a specific category
 *   --verbose    Show detailed progress
 *   --force      Overwrite existing YAML directories
 *
 * @requires npm run build (imports from dist/)
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'prompts');
const DIST_SCHEMA_PATH = join(
  __dirname,
  '..',
  'dist',
  'prompts',
  'prompt-schema.js'
);

// Parse CLI arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const FORCE = args.includes('--force');
const CATEGORY = args.find((a) => a.startsWith('--category='))?.split('=')[1];

// ============================================
// DYNAMIC IMPORT OF SHARED SCHEMA
// ============================================
async function loadSchema() {
  if (!existsSync(DIST_SCHEMA_PATH)) {
    console.error('❌ Build required: Run `npm run build` first');
    console.error(`   Missing: ${DIST_SCHEMA_PATH}`);
    process.exit(1);
  }

  const { validatePromptYaml } = await import(DIST_SCHEMA_PATH);
  return validatePromptYaml;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse markdown file to extract sections
 */
function parseMarkdownSections(content) {
  const sections = {
    systemMessage: undefined,
    userMessageTemplate: '',
    gateConfiguration: undefined,
    chainSteps: undefined,
  };

  // Extract system message
  const systemMatch = content.match(/## System Message\s*\n([\s\S]*?)(?=\n##|$)/);
  if (systemMatch) {
    sections.systemMessage = systemMatch[1].trim();
  }

  // Extract user message template
  const userMatch = content.match(/## User Message Template\s*\n([\s\S]*)$/);
  if (userMatch) {
    let userContent = userMatch[1].trim();

    // Extract and remove gate configuration
    const gateMatch = userContent.match(/## Gate Configuration\s*\n```json\s*\n([\s\S]*?)\n```/);
    if (gateMatch) {
      try {
        sections.gateConfiguration = JSON.parse(gateMatch[1].trim());
        userContent = userContent.replace(/## Gate Configuration\s*\n```json\s*\n[\s\S]*?\n```\s*/, '').trim();
      } catch (e) {
        console.warn(`  ⚠️ Could not parse gate configuration: ${e.message}`);
      }
    }

    sections.userMessageTemplate = userContent;
  }

  // Extract chain steps
  const chainMatch = content.match(/## Chain Steps\s*\n([\s\S]*?)(?=\n##|$)/);
  if (chainMatch) {
    // Parse chain steps from markdown format
    const chainContent = chainMatch[1].trim();
    const steps = [];
    const stepMatches = chainContent.matchAll(
      /(\d+)\.\s*promptId:\s*([^\n]+)\s*\n\s*stepName:\s*([^\n]+)/g
    );

    for (const match of stepMatches) {
      steps.push({
        promptId: match[2].trim(),
        stepName: match[3].trim(),
      });
    }

    if (steps.length > 0) {
      sections.chainSteps = steps;
    }
  }

  return sections;
}

/**
 * Convert a prompt definition to YAML format
 */
function convertToYaml(promptDef, markdownContent) {
  const sections = parseMarkdownSections(markdownContent);

  const yamlObj = {
    id: promptDef.id,
    name: promptDef.name,
    category: promptDef.category,
    description: promptDef.description,
  };

  // Use file references for content (cleaner than inline)
  if (sections.systemMessage) {
    yamlObj.systemMessageFile = 'system-message.md';
  }

  if (sections.userMessageTemplate) {
    yamlObj.userMessageTemplateFile = 'user-message.md';
  }

  // Arguments
  if (promptDef.arguments && promptDef.arguments.length > 0) {
    yamlObj.arguments = promptDef.arguments.map((arg) => {
      const argObj = { name: arg.name };
      if (arg.type) argObj.type = arg.type;
      if (arg.description) argObj.description = arg.description;
      if (arg.required !== undefined) argObj.required = arg.required;
      if (arg.defaultValue !== undefined) argObj.defaultValue = arg.defaultValue;
      return argObj;
    });
  }

  // Gate configuration
  if (sections.gateConfiguration || promptDef.gateConfiguration) {
    yamlObj.gateConfiguration = sections.gateConfiguration || promptDef.gateConfiguration;
  }

  // Chain steps
  if (sections.chainSteps || promptDef.chainSteps) {
    yamlObj.chainSteps = sections.chainSteps || promptDef.chainSteps;
  }

  // MCP registration
  if (promptDef.registerWithMcp !== undefined) {
    yamlObj.registerWithMcp = promptDef.registerWithMcp;
  }

  return yamlObj;
}

/**
 * Migrate a single prompt
 */
function migratePrompt(categoryDir, promptDef, validateSchema) {
  const promptId = promptDef.id;
  const promptDir = join(categoryDir, promptId);
  const results = {
    id: promptId,
    success: false,
    files: [],
    errors: [],
    warnings: [],
  };

  // Check if YAML directory already exists
  if (existsSync(promptDir) && !FORCE) {
    results.warnings.push(`Directory already exists: ${promptDir}`);
    results.success = true; // Not an error, just skipped
    return results;
  }

  // Find and read the markdown file
  const mdFile = promptDef.file || `${promptId}.md`;
  const mdPath = join(categoryDir, mdFile);

  if (!existsSync(mdPath)) {
    results.errors.push(`Markdown file not found: ${mdPath}`);
    return results;
  }

  let markdownContent;
  try {
    markdownContent = readFileSync(mdPath, 'utf-8');
  } catch (e) {
    results.errors.push(`Failed to read markdown: ${e.message}`);
    return results;
  }

  // Convert to YAML format
  const yamlObj = convertToYaml(promptDef, markdownContent);
  const sections = parseMarkdownSections(markdownContent);

  // Validate the generated YAML
  const validation = validateSchema(yamlObj, promptId);
  if (!validation.valid) {
    results.errors.push(...validation.errors);
    return results;
  }
  if (validation.warnings.length > 0) {
    results.warnings.push(...validation.warnings);
  }

  // Generate file contents
  const yamlContent = yaml.dump(yamlObj, {
    lineWidth: 100,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });

  if (DRY_RUN) {
    console.log(`  📁 Would create: ${promptDir}/`);
    console.log(`     - prompt.yaml`);
    if (sections.userMessageTemplate) console.log(`     - user-message.md`);
    if (sections.systemMessage) console.log(`     - system-message.md`);
    if (VERBOSE) {
      console.log(`     YAML content preview:`);
      console.log(yamlContent.split('\n').map((l) => `       ${l}`).join('\n'));
    }
    results.success = true;
    results.files = ['prompt.yaml'];
    if (sections.userMessageTemplate) results.files.push('user-message.md');
    if (sections.systemMessage) results.files.push('system-message.md');
    return results;
  }

  // Create directory and write files
  try {
    mkdirSync(promptDir, { recursive: true });

    // Write prompt.yaml
    writeFileSync(join(promptDir, 'prompt.yaml'), yamlContent, 'utf-8');
    results.files.push('prompt.yaml');

    // Write user-message.md
    if (sections.userMessageTemplate) {
      writeFileSync(
        join(promptDir, 'user-message.md'),
        sections.userMessageTemplate,
        'utf-8'
      );
      results.files.push('user-message.md');
    }

    // Write system-message.md
    if (sections.systemMessage) {
      writeFileSync(
        join(promptDir, 'system-message.md'),
        sections.systemMessage,
        'utf-8'
      );
      results.files.push('system-message.md');
    }

    results.success = true;
  } catch (e) {
    results.errors.push(`Failed to write files: ${e.message}`);
  }

  return results;
}

/**
 * Migrate a category
 */
function migrateCategory(categoryPath, validateSchema) {
  const categoryName = basename(categoryPath);
  const promptsJsonPath = join(categoryPath, 'prompts.json');

  if (!existsSync(promptsJsonPath)) {
    return {
      category: categoryName,
      success: false,
      error: 'No prompts.json found',
      prompts: [],
    };
  }

  let promptsData;
  try {
    promptsData = JSON.parse(readFileSync(promptsJsonPath, 'utf-8'));
  } catch (e) {
    return {
      category: categoryName,
      success: false,
      error: `Failed to parse prompts.json: ${e.message}`,
      prompts: [],
    };
  }

  const prompts = promptsData.prompts || [];
  const results = {
    category: categoryName,
    success: true,
    prompts: [],
    totalPrompts: prompts.length,
    migratedCount: 0,
    skippedCount: 0,
    errorCount: 0,
  };

  for (const promptDef of prompts) {
    const promptResult = migratePrompt(categoryPath, promptDef, validateSchema);
    results.prompts.push(promptResult);

    if (promptResult.success) {
      if (promptResult.warnings.some((w) => w.includes('already exists'))) {
        results.skippedCount++;
      } else {
        results.migratedCount++;
      }
    } else {
      results.errorCount++;
      results.success = false;
    }
  }

  return results;
}

// ============================================
// MAIN EXECUTION
// ============================================
async function main() {
  console.log('🔄 Prompt Migration: JSON+MD → YAML+MD');
  console.log('=====================================');

  if (DRY_RUN) {
    console.log('📝 DRY RUN MODE - No files will be written\n');
  }

  const validateSchema = await loadSchema();

  // Discover categories
  const categories = readdirSync(PROMPTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => !d.name.startsWith('.'))
    .filter((d) => !CATEGORY || d.name === CATEGORY)
    .map((d) => join(PROMPTS_DIR, d.name));

  if (categories.length === 0) {
    console.log('No categories found to migrate');
    process.exit(0);
  }

  console.log(`Found ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} to process\n`);

  const allResults = [];
  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const categoryPath of categories) {
    const categoryName = basename(categoryPath);
    console.log(`📂 Category: ${categoryName}`);

    const result = migrateCategory(categoryPath, validateSchema);
    allResults.push(result);

    if (result.error) {
      console.log(`   ❌ ${result.error}`);
      continue;
    }

    for (const prompt of result.prompts) {
      const status = prompt.success
        ? prompt.warnings.some((w) => w.includes('already exists'))
          ? '⏭️ '
          : '✅'
        : '❌';

      if (VERBOSE || !prompt.success) {
        console.log(`   ${status} ${prompt.id}`);
        if (prompt.errors.length > 0) {
          prompt.errors.forEach((e) => console.log(`      Error: ${e}`));
        }
        if (prompt.warnings.length > 0 && VERBOSE) {
          prompt.warnings.forEach((w) => console.log(`      Warning: ${w}`));
        }
      }
    }

    totalMigrated += result.migratedCount;
    totalSkipped += result.skippedCount;
    totalErrors += result.errorCount;

    console.log(
      `   Summary: ${result.migratedCount} migrated, ${result.skippedCount} skipped, ${result.errorCount} errors\n`
    );
  }

  // Final summary
  console.log('=====================================');
  console.log('📊 Migration Summary');
  console.log(`   Categories processed: ${allResults.length}`);
  console.log(`   Prompts migrated: ${totalMigrated}`);
  console.log(`   Prompts skipped: ${totalSkipped}`);
  console.log(`   Errors: ${totalErrors}`);

  if (DRY_RUN) {
    console.log('\n📝 This was a dry run. Use without --dry-run to apply changes.');
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
