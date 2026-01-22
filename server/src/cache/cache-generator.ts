// @lifecycle canonical - Generates hook cache files from MCP server resources.
/**
 * Cache Generator for Claude Code Hooks
 *
 * Scans prompts and gates directories and generates JSON cache files
 * that hooks can read without needing to parse YAML at runtime.
 *
 * Output: <server-root>/cache/
 *   - prompts.cache.json
 *   - gates.cache.json
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import yaml from 'js-yaml';

import type { Logger } from '../logging/index.js';

// Stop words for keyword extraction
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'can',
  'need',
  'dare',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'and',
  'but',
  'if',
  'or',
  'because',
  'until',
  'while',
  'this',
  'that',
  'these',
  'those',
  'what',
  'which',
  'who',
  'whom',
]);

// Types
interface ArgumentInfo {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string | null;
  options?: string[];
}

interface PromptCacheEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  is_chain: boolean;
  chain_steps: number;
  chain_step_names?: string[];
  arguments: ArgumentInfo[];
  gates: string[];
  keywords: string[];
}

interface GateCacheEntry {
  id: string;
  name: string;
  type: string;
  description: string;
  triggers: string[];
}

interface OperatorValuesMeta {
  valid_styles: string[];
  valid_frameworks: string[];
}

interface PromptCache {
  version: string;
  generated_at: string;
  source: string;
  prompts: Record<string, PromptCacheEntry>;
  categories: Record<string, string[]>;
  count: number;
  _meta: OperatorValuesMeta;
}

interface GateCache {
  version: string;
  generated_at: string;
  gates: Record<string, GateCacheEntry>;
  by_type: Record<string, string[]>;
  count: number;
}

/**
 * Extract meaningful keywords from text.
 */
function extractKeywords(text: string, maxWords = 15): string[] {
  if (!text) return [];

  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const word of words) {
    if (!STOP_WORDS.has(word) && !seen.has(word)) {
      seen.add(word);
      unique.push(word);
    }
  }

  return unique.slice(0, maxWords);
}

/**
 * Extract argument options from Nunjucks template conditionals.
 * Parses {% if var == "value" %} and {% elif var == "value" %} patterns.
 */
function extractTemplateOptions(templatePath: string): Map<string, string[]> {
  const options = new Map<string, string[]>();
  try {
    // Use sync read since this runs at cache generation time
    const fsSync = require('node:fs') as typeof import('node:fs');
    const content = fsSync.readFileSync(templatePath, 'utf-8');
    // Match: {% if var == "value" %} or {% elif var == "value" %}
    const pattern = /\{%\s*(?:el)?if\s+(\w+)\s*==\s*["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const varName = match[1];
      const value = match[2];
      if (!varName || !value) continue;
      let values = options.get(varName);
      if (!values) {
        values = [];
        options.set(varName, values);
      }
      if (!values.includes(value)) values.push(value);
    }
  } catch {
    // Template file not found, skip extraction
  }
  return options;
}

/**
 * Extract argument options from description patterns.
 * Parses "foo | bar | baz" patterns from argument descriptions.
 * Examples:
 *   "Primary language: typescript | python | hybrid" -> ["typescript", "python", "hybrid"]
 *   "Package manager: npm | pnpm | yarn" -> ["npm", "pnpm", "yarn"]
 */
function extractDescriptionOptions(description: string): string[] | undefined {
  if (!description) return undefined;
  // Match: word | word | word pattern (at least 2 options separated by |)
  // Handles optional leading text like "Primary language: " before the options
  const match = description.match(/:\s*([a-zA-Z0-9_-]+(?:\s*\|\s*[a-zA-Z0-9_-]+)+)\s*$/);
  if (match?.[1]) {
    const options = match[1]
      .split(/\s*\|\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    return options.length >= 2 ? options : undefined;
  }
  return undefined;
}

/**
 * Load and parse a prompt YAML file.
 */
async function loadPromptYaml(promptDir: string): Promise<PromptCacheEntry | null> {
  const yamlPath = path.join(promptDir, 'prompt.yaml');

  try {
    const content = await fs.readFile(yamlPath, 'utf-8');
    const data = yaml.load(content) as Record<string, unknown>;

    if (!data || typeof data !== 'object') return null;

    const promptId = data['id'] as string | undefined;
    if (!promptId) return null;

    const name = (data['name'] as string) || '';
    const description = (data['description'] as string) || '';
    const chainSteps =
      (data['chainSteps'] as Array<{ promptId?: string; stepName?: string }>) ?? [];
    const isChain = chainSteps.length > 0;

    // Extract step names for chain workflow visibility
    const chainStepNames = isChain
      ? chainSteps.map((step) => step.stepName || step.promptId || 'Unknown')
      : undefined;

    // Extract argument options from template conditionals
    const templatePath = path.join(promptDir, 'user-message.md');
    const templateOptions = extractTemplateOptions(templatePath);

    // Extract arguments and merge options from multiple sources
    // Priority: YAML options > template conditionals > description patterns
    const rawArgs = (data['arguments'] as Array<Record<string, unknown>>) ?? [];
    const args: ArgumentInfo[] = rawArgs
      .filter((arg) => arg['name'])
      .map((arg) => {
        const argName = arg['name'] as string;
        const argDesc = (arg['description'] as string) || '';
        // Priority chain: YAML explicit > template conditionals > description patterns
        const yamlOptions = arg['options'] as string[] | undefined;
        const options =
          yamlOptions ?? templateOptions.get(argName) ?? extractDescriptionOptions(argDesc);
        return {
          name: argName,
          type: (arg['type'] as string) || 'string',
          required: (arg['required'] as boolean) || false,
          description: argDesc.slice(0, 100),
          default: arg['defaultValue'] as string | null | undefined,
          ...(options && options.length > 0 ? { options } : {}),
        };
      });

    // Extract gates
    const gateConfig = data['gateConfiguration'] as Record<string, unknown> | undefined;
    const gates = (gateConfig?.['include'] as string[]) ?? [];

    // Extract keywords
    const keywords = extractKeywords(`${name} ${description}`);

    // Get category from parent directory or YAML
    const category = (data['category'] as string) ?? path.basename(path.dirname(promptDir));

    return {
      id: promptId,
      name,
      category,
      description: description.slice(0, 200),
      is_chain: isChain,
      chain_steps: chainSteps.length,
      chain_step_names: chainStepNames,
      arguments: args,
      gates,
      keywords,
    };
  } catch {
    return null;
  }
}

/**
 * Load and parse a gate YAML file.
 */
async function loadGateYaml(gateDir: string): Promise<GateCacheEntry | null> {
  const yamlPath = path.join(gateDir, 'gate.yaml');

  try {
    const content = await fs.readFile(yamlPath, 'utf-8');
    const data = yaml.load(content) as Record<string, unknown>;

    if (!data || typeof data !== 'object') return null;

    const gateId = data['id'] as string;
    if (!gateId) return null;

    const name = (data['name'] as string) || '';
    const description = (data['description'] as string) || '';
    const triggers = extractKeywords(`${name} ${description}`, 10);

    return {
      id: gateId,
      name,
      type: (data['type'] as string) || 'validation',
      description: description.slice(0, 150),
      triggers,
    };
  } catch {
    return null;
  }
}

/**
 * Recursively find all prompt.yaml files.
 */
async function findPromptYamls(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.name === 'prompt.yaml') {
          results.push(path.dirname(fullPath));
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  await walk(dir);
  return results;
}

/**
 * Get valid style names from styles directory.
 * Used by hooks to validate #style operator values.
 */
async function getValidStyles(resourcesDir: string): Promise<string[]> {
  const stylesDir = path.join(resourcesDir, 'styles');
  try {
    const entries = await fs.readdir(stylesDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Get valid framework names from methodologies directory.
 * Used by hooks to validate @framework operator values.
 */
async function getValidFrameworks(resourcesDir: string): Promise<string[]> {
  const methodsDir = path.join(resourcesDir, 'methodologies');
  try {
    const entries = await fs.readdir(methodsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Generate prompts cache from resources directory.
 */
async function generatePromptsCache(resourcesDir: string): Promise<PromptCache> {
  const promptsDir = path.join(resourcesDir, 'prompts');
  const prompts: Record<string, PromptCacheEntry> = {};
  const categories: Record<string, string[]> = {};

  try {
    const promptDirs = await findPromptYamls(promptsDir);

    for (const promptDir of promptDirs) {
      const entry = await loadPromptYaml(promptDir);
      if (entry) {
        prompts[entry.id] = entry;

        // Build category index
        let categoryList = categories[entry.category];
        if (!categoryList) {
          categoryList = [];
          categories[entry.category] = categoryList;
        }
        if (!categoryList.includes(entry.id)) {
          categoryList.push(entry.id);
        }
      }
    }
  } catch {
    // Prompts directory may not exist
  }

  // Get valid operator values for hook validation
  const validStyles = await getValidStyles(resourcesDir);
  const validFrameworks = await getValidFrameworks(resourcesDir);

  return {
    version: '1.0',
    generated_at: new Date().toISOString(),
    source: resourcesDir,
    prompts,
    categories,
    count: Object.keys(prompts).length,
    _meta: {
      valid_styles: validStyles,
      valid_frameworks: validFrameworks,
    },
  };
}

/**
 * Generate gates cache from resources directory.
 */
async function generateGatesCache(resourcesDir: string): Promise<GateCache> {
  const gatesDir = path.join(resourcesDir, 'gates');
  const gates: Record<string, GateCacheEntry> = {};
  const byType: Record<string, string[]> = {};

  try {
    const entries = await fs.readdir(gatesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const gateDir = path.join(gatesDir, entry.name);
      const gateEntry = await loadGateYaml(gateDir);

      if (gateEntry) {
        gates[gateEntry.id] = gateEntry;

        // Build type index
        let typeList = byType[gateEntry.type];
        if (!typeList) {
          typeList = [];
          byType[gateEntry.type] = typeList;
        }
        typeList.push(gateEntry.id);
      }
    }
  } catch {
    // Gates directory may not exist
  }

  return {
    version: '1.0',
    generated_at: new Date().toISOString(),
    gates,
    by_type: byType,
    count: Object.keys(gates).length,
  };
}

/**
 * Main cache generation function.
 * Generates both prompts and gates caches.
 */
export async function generateCache(
  serverRoot: string,
  logger?: Logger
): Promise<{ prompts: number; gates: number }> {
  const resourcesDir = path.join(serverRoot, 'resources');
  const cacheDir = path.join(serverRoot, 'cache');

  // Ensure cache directory exists
  await fs.mkdir(cacheDir, { recursive: true });

  // Generate caches
  const promptsCache = await generatePromptsCache(resourcesDir);
  const gatesCache = await generateGatesCache(resourcesDir);

  // Write cache files
  await fs.writeFile(
    path.join(cacheDir, 'prompts.cache.json'),
    JSON.stringify(promptsCache, null, 2)
  );

  await fs.writeFile(path.join(cacheDir, 'gates.cache.json'), JSON.stringify(gatesCache, null, 2));

  logger?.info(`Cache generated: ${promptsCache.count} prompts, ${gatesCache.count} gates`);

  return {
    prompts: promptsCache.count,
    gates: gatesCache.count,
  };
}

/**
 * Get the cache directory path for a given server root.
 */
export function getCacheDir(serverRoot: string): string {
  return path.join(serverRoot, 'cache');
}
