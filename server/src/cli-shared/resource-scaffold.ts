/**
 * Resource directory scaffolding for CLI create/delete operations.
 *
 * Pure functions using only node:fs and node:path.
 * Follows workspace-init.ts pattern.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type ResourceValidationResult, validateResourceFile } from './resource-validation.js';
import { deleteHistoryFile } from './version-history.js';

type ResourceType = 'prompts' | 'gates' | 'methodologies' | 'styles';

export interface CreateResourceOptions {
  name?: string;
  description?: string;
  category?: string;
  validate?: boolean;
}

export interface CreateResourceResult {
  success: boolean;
  path?: string;
  error?: string;
  validation?: ResourceValidationResult;
  rolledBack?: boolean;
}

// ── Template generators ─────────────────────────────────────────────────────

function promptYaml(id: string, opts: CreateResourceOptions): string {
  const desc = opts.description ?? `${opts.name ?? id} prompt`;
  return [
    `id: ${id}`,
    `name: ${opts.name ?? id}`,
    `category: ${opts.category ?? 'general'}`,
    `description: >-`,
    `  ${desc}`,
    `userMessageTemplateFile: user-message.md`,
    `# systemMessageFile: system-message.md`,
    '',
    '# --- Arguments (uncomment and customize) ---',
    '# arguments:',
    '#   - name: topic',
    '#     type: string',
    '#     description: The main subject to address',
    '#     required: true',
    '#   - name: context',
    '#     type: string',
    '#     description: Additional context or background',
    '#     required: false',
    '',
    '# --- Gate Configuration (uncomment to add quality gates) ---',
    '# gateConfiguration:',
    '#   include:',
    '#     - content-structure',
    '#   framework_gates: false',
    '#   inline_gate_definitions:',
    '#     - name: Custom Check',
    '#       type: validation',
    '#       description: Verify response meets criteria',
    '#       pass_criteria:',
    '#         - Criterion one',
    '#         - Criterion two',
    '',
    '# --- Chain Steps (uncomment for multi-step workflows) ---',
    '# chainSteps:',
    '#   - promptId: step_one',
    '#     stepName: Step 1 of N',
    '#   - promptId: step_two',
    '#     stepName: Step 2 of N',
    '',
    '# --- Script Tools (uncomment to attach tools) ---',
    '# tools:',
    '#   - my-tool-id',
    '',
  ].join('\n');
}

function gateYaml(id: string, opts: CreateResourceOptions): string {
  const desc = opts.description ?? `${opts.name ?? id} validation gate`;
  return [
    `id: ${id}`,
    `name: ${opts.name ?? id}`,
    `type: validation`,
    `description: >-`,
    `  ${desc}`,
    `guidanceFile: guidance.md`,
    '',
    'pass_criteria:',
    '  - type: inline_guidance',
    '    min_length: 50',
    '',
    '# --- Activation Rules (uncomment to scope when this gate triggers) ---',
    '# activation:',
    '#   prompt_categories:',
    '#     - development',
    '#     - analysis',
    '#   explicit_request: false',
    '',
    '# --- Retry Config (uncomment to control retry behavior) ---',
    '# retry_config:',
    '#   max_attempts: 2',
    '#   improvement_hints: true',
    '#   preserve_context: true',
    '',
    '# --- Advanced Pass Criteria Examples ---',
    '# pass_criteria:',
    '#   - type: inline_guidance',
    '#     required_patterns:',
    "#       - '## Summary'",
    '#     keyword_count:',
    '#       example: 1',
    '#     regex_patterns:',
    "#       - '^\\d+\\.\\s+'",
    '',
  ].join('\n');
}

function methodologyYaml(id: string, opts: CreateResourceOptions): string {
  const name = opts.name ?? id;
  const desc = opts.description ?? `${name} methodology`;
  return [
    `id: ${id}`,
    `name: ${name}`,
    `methodology: ${id.toUpperCase().replace(/-/g, '_')}`,
    `version: 1.0.0`,
    `description: >-`,
    `  ${desc}`,
    `enabled: false`,
    '',
    'systemPromptGuidance: |',
    `  Apply the ${name} methodology systematically.`,
    '  Define your methodology phases and guidance here.',
    '',
    '# phasesFile: phases.yaml',
    '# judgePromptFile: judge-prompt.md',
    '',
    '# --- Gate Configuration (uncomment to link quality gates) ---',
    '# gates:',
    '#   include:',
    '#     - framework-compliance',
    '',
    '# --- Methodology-Specific Gates (uncomment to define) ---',
    '# methodologyGates:',
    '#   - id: phase_completeness',
    '#     name: Phase Completeness',
    '#     description: Verify all methodology phases are addressed',
    '#     methodologyArea: Core',
    '#     priority: high',
    '#     validationCriteria:',
    '#       - All required phases present',
    '',
  ].join('\n');
}

function styleYaml(id: string, opts: CreateResourceOptions): string {
  const desc = opts.description ?? `${opts.name ?? id} response style`;
  return [
    `id: ${id}`,
    `name: ${opts.name ?? id}`,
    `description: >-`,
    `  ${desc}`,
    `guidanceFile: guidance.md`,
    `enabled: true`,
    '',
    '# --- Priority and Enhancement (uncomment to customize) ---',
    '# priority: 0',
    '# enhancementMode: prepend',
    '',
    '# --- Activation Rules (uncomment to scope when this style triggers) ---',
    '# activation:',
    '#   prompt_categories:',
    '#     - analysis',
    '#     - development',
    '',
    '# --- Framework Compatibility (uncomment to declare) ---',
    '# compatibleFrameworks:',
    '#   - CAGEERF',
    '#   - ReACT',
    '',
  ].join('\n');
}

const YAML_GENERATORS: Record<ResourceType, (id: string, opts: CreateResourceOptions) => string> = {
  prompts: promptYaml,
  gates: gateYaml,
  methodologies: methodologyYaml,
  styles: styleYaml,
};

const ENTRY_FILES: Record<ResourceType, string> = {
  prompts: 'prompt.yaml',
  gates: 'gate.yaml',
  methodologies: 'methodology.yaml',
  styles: 'style.yaml',
};

const COMPANION_FILES: Record<ResourceType, { name: string; content: string }> = {
  prompts: {
    name: 'user-message.md',
    content: '<!-- Template. Use {{arg_name}} for argument substitution. -->\n\n',
  },
  gates: {
    name: 'guidance.md',
    content:
      '## Validation Criteria\n\n- Criterion one\n- Criterion two\n\n## Common Failures\n\n- Failure pattern\n',
  },
  methodologies: {
    name: 'system-prompt.md',
    content: 'Apply the methodology systematically, ensuring thorough coverage of each phase.\n',
  },
  styles: {
    name: 'guidance.md',
    content:
      '## Style Guidance\n\nStructure responses with clear organization appropriate to the context.\n',
  },
};

function cleanupEmptyPromptCategory(resourceDir: string): void {
  const categoryDir = dirname(resourceDir);
  if (!existsSync(categoryDir)) {
    return;
  }

  const entries = readdirSync(categoryDir).filter((entry) => !entry.startsWith('.'));
  if (entries.length === 0) {
    rmSync(categoryDir, { recursive: true, force: true });
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if a resource already exists at the expected path.
 */
export function resourceExists(
  baseDir: string,
  type: ResourceType,
  id: string,
  category?: string
): boolean {
  if (type === 'prompts' && category !== undefined && category !== '') {
    return existsSync(join(baseDir, category, id, ENTRY_FILES[type]));
  }
  return existsSync(join(baseDir, id, ENTRY_FILES[type]));
}

/**
 * Create a resource directory with template YAML and companion file.
 */
function resolveResourceDir(
  baseDir: string,
  type: ResourceType,
  id: string,
  category?: string
): string {
  if (type === 'prompts') {
    return join(baseDir, category ?? 'general', id);
  }
  return join(baseDir, id);
}

export function createResourceDir(
  baseDir: string,
  type: ResourceType,
  id: string,
  opts: CreateResourceOptions = {}
): CreateResourceResult {
  const resourceDir = resolveResourceDir(baseDir, type, id, opts.category);
  const dirExistedBefore = existsSync(resourceDir);

  if (existsSync(join(resourceDir, ENTRY_FILES[type]))) {
    return { success: false, error: `Resource '${id}' already exists at ${resourceDir}` };
  }

  try {
    writeResourceFiles(resourceDir, type, id, opts);
    return validateAndFinalize(resourceDir, type, id, dirExistedBefore, opts.validate !== false);
  } catch (error) {
    cleanupCreatedDir(resourceDir, dirExistedBefore, type);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message, rolledBack: true };
  }
}

function writeResourceFiles(
  resourceDir: string,
  type: ResourceType,
  id: string,
  opts: CreateResourceOptions
): void {
  mkdirSync(resourceDir, { recursive: true });
  const yamlContent = YAML_GENERATORS[type](id, opts);
  writeFileSync(join(resourceDir, ENTRY_FILES[type]), yamlContent, 'utf8');
  const companion = COMPANION_FILES[type];
  writeFileSync(join(resourceDir, companion.name), companion.content, 'utf8');
}

// eslint-disable-next-line max-params
function validateAndFinalize(
  resourceDir: string,
  type: ResourceType,
  id: string,
  dirExistedBefore: boolean,
  shouldValidate: boolean
): CreateResourceResult {
  if (!shouldValidate) {
    return { success: true, path: resourceDir };
  }

  const entryPath = join(resourceDir, ENTRY_FILES[type]);
  const validation = validateResourceFile(type, id, entryPath);
  if (validation.valid) {
    return { success: true, path: resourceDir };
  }

  const rollback = cleanupCreatedDir(resourceDir, dirExistedBefore, type);
  return {
    success: false,
    validation,
    rolledBack: rollback.success,
    error: rollback.success
      ? 'Created resource failed validation; rolled back.'
      : `Created resource failed validation; rollback failed: ${rollback.error ?? 'unknown'}`,
  };
}

/**
 * Clean up a newly-created resource directory on failure.
 * Only removes if the directory didn't exist before creation.
 */
function cleanupCreatedDir(
  resourceDir: string,
  dirExistedBefore: boolean,
  type: ResourceType
): { success: boolean; error?: string } {
  if (dirExistedBefore || !existsSync(resourceDir)) {
    return { success: true };
  }

  const result = deleteResourceDir(resourceDir);
  if (type === 'prompts') {
    cleanupEmptyPromptCategory(resourceDir);
  }
  return result;
}

/**
 * Delete a resource directory and its version history.
 */
export function deleteResourceDir(resourceDir: string): { success: boolean; error?: string } {
  try {
    if (!existsSync(resourceDir)) {
      return { success: false, error: `Directory does not exist: ${resourceDir}` };
    }

    deleteHistoryFile(resourceDir);
    rmSync(resourceDir, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
