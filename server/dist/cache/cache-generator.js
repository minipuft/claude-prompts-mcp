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
/**
 * Extract meaningful keywords from text.
 */
function extractKeywords(text, maxWords = 15) {
    if (!text)
        return [];
    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const unique = [];
    const seen = new Set();
    for (const word of words) {
        if (!STOP_WORDS.has(word) && !seen.has(word)) {
            seen.add(word);
            unique.push(word);
        }
    }
    return unique.slice(0, maxWords);
}
/**
 * Load and parse a prompt YAML file.
 */
async function loadPromptYaml(promptDir) {
    const yamlPath = path.join(promptDir, 'prompt.yaml');
    try {
        const content = await fs.readFile(yamlPath, 'utf-8');
        const data = yaml.load(content);
        if (!data || typeof data !== 'object')
            return null;
        const promptId = data['id'];
        if (!promptId)
            return null;
        const name = data['name'] || '';
        const description = data['description'] || '';
        const chainSteps = data['chainSteps'] || [];
        const isChain = chainSteps.length > 0;
        // Extract arguments
        const rawArgs = data['arguments'] || [];
        const args = rawArgs
            .filter((arg) => arg['name'])
            .map((arg) => ({
            name: arg['name'],
            type: arg['type'] || 'string',
            required: arg['required'] || false,
            description: (arg['description'] || '').slice(0, 100),
            default: arg['defaultValue'],
        }));
        // Extract gates
        const gateConfig = data['gateConfiguration'];
        const gates = gateConfig?.['include'] || [];
        // Extract keywords
        const keywords = extractKeywords(`${name} ${description}`);
        // Get category from parent directory or YAML
        const category = data['category'] || path.basename(path.dirname(promptDir));
        return {
            id: promptId,
            name,
            category,
            description: description.slice(0, 200),
            is_chain: isChain,
            chain_steps: chainSteps.length,
            arguments: args,
            gates,
            keywords,
        };
    }
    catch {
        return null;
    }
}
/**
 * Load and parse a gate YAML file.
 */
async function loadGateYaml(gateDir) {
    const yamlPath = path.join(gateDir, 'gate.yaml');
    try {
        const content = await fs.readFile(yamlPath, 'utf-8');
        const data = yaml.load(content);
        if (!data || typeof data !== 'object')
            return null;
        const gateId = data['id'];
        if (!gateId)
            return null;
        const name = data['name'] || '';
        const description = data['description'] || '';
        const triggers = extractKeywords(`${name} ${description}`, 10);
        return {
            id: gateId,
            name,
            type: data['type'] || 'validation',
            description: description.slice(0, 150),
            triggers,
        };
    }
    catch {
        return null;
    }
}
/**
 * Recursively find all prompt.yaml files.
 */
async function findPromptYamls(dir) {
    const results = [];
    async function walk(currentDir) {
        try {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    await walk(fullPath);
                }
                else if (entry.name === 'prompt.yaml') {
                    results.push(path.dirname(fullPath));
                }
            }
        }
        catch {
            // Ignore unreadable directories
        }
    }
    await walk(dir);
    return results;
}
/**
 * Generate prompts cache from resources directory.
 */
async function generatePromptsCache(resourcesDir) {
    const promptsDir = path.join(resourcesDir, 'prompts');
    const prompts = {};
    const categories = {};
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
    }
    catch {
        // Prompts directory may not exist
    }
    return {
        version: '1.0',
        generated_at: new Date().toISOString(),
        source: resourcesDir,
        prompts,
        categories,
        count: Object.keys(prompts).length,
    };
}
/**
 * Generate gates cache from resources directory.
 */
async function generateGatesCache(resourcesDir) {
    const gatesDir = path.join(resourcesDir, 'gates');
    const gates = {};
    const byType = {};
    try {
        const entries = await fs.readdir(gatesDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
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
    }
    catch {
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
export async function generateCache(serverRoot, logger) {
    const resourcesDir = path.join(serverRoot, 'resources');
    const cacheDir = path.join(serverRoot, 'cache');
    // Ensure cache directory exists
    await fs.mkdir(cacheDir, { recursive: true });
    // Generate caches
    const promptsCache = await generatePromptsCache(resourcesDir);
    const gatesCache = await generateGatesCache(resourcesDir);
    // Write cache files
    await fs.writeFile(path.join(cacheDir, 'prompts.cache.json'), JSON.stringify(promptsCache, null, 2));
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
export function getCacheDir(serverRoot) {
    return path.join(serverRoot, 'cache');
}
//# sourceMappingURL=cache-generator.js.map