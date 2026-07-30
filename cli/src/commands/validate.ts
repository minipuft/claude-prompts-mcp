import { join } from 'node:path';
import {
  validateResourceFile,
  formatValidationIssues,
  validateConfig,
} from '@cli-shared/index.js';
import { resolveWorkspace, resolveResourceDir, discoverResourcePaths } from '../lib/workspace.js';
import { output, icons } from '../lib/output.js';
import { type ResourceType, TYPE_CONFIG } from '../lib/types.js';

interface ValidateOptions {
  workspace?: string;
  json: boolean;
  flags: {
    prompts?: boolean;
    gates?: boolean;
    frameworks?: boolean;
    styles?: boolean;
    config?: boolean;
    all?: boolean;
  };
}

interface ValidationEntry {
  type: string;
  id: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validate(options: ValidateOptions): Promise<number> {
  const workspace = resolveWorkspace(options.workspace);
  const { flags } = options;
  const types = resolveTypes(flags);
  const results: ValidationEntry[] = [];

  for (const type of types) {
    let baseDir: string;
    try {
      baseDir = resolveResourceDir(workspace, type);
    } catch {
      continue; // Directory not found — skip
    }

    const typeConfig = TYPE_CONFIG[type];
    const resources = discoverResourcePaths(baseDir, typeConfig.entryFile, typeConfig.nested);

    for (const { id, dir } of resources) {
      const filePath = join(dir, typeConfig.entryFile);
      const validation = validateResourceFile(type, id, filePath);
      results.push({
        type,
        id,
        valid: validation.valid,
        errors: formatValidationIssues(validation.errors),
        warnings: formatValidationIssues(validation.warnings),
      });
    }
  }

  // Validate config.json when --config is explicitly passed (not part of --all)
  if (flags.config) {
    const configResult = validateConfig(workspace);
    results.push({
      type: 'config',
      id: 'config.json',
      valid: configResult.valid,
      errors: configResult.errors,
      warnings: configResult.warnings,
    });
  }

  // Detect duplicate IDs within each resource type
  detectDuplicateIds(results);

  const total = results.length;
  const validCount = results.filter((r) => r.valid).length;
  const invalidCount = total - validCount;

  if (options.json) {
    const warnCountJson = results.filter((r) => r.warnings.length > 0).length;
    output(
      {
        valid: invalidCount === 0,
        summary: { total, valid: validCount, invalid: invalidCount, warnings: warnCountJson },
        results,
      },
      { json: true },
    );
  } else {
    if (results.length === 0) {
      console.log('No resources found to validate.');
      return 0;
    }

    for (const r of results) {
      const icon = r.valid ? icons.success() : icons.error();
      console.log(`${icon} [${r.type}] ${r.id}`);
      for (const e of r.errors) console.error(`    ${icons.error()}  ${e}`);
      for (const w of r.warnings) console.error(`    ${icons.warn()}  ${w}`);
    }

    const warnCount = results.filter((r) => r.warnings.length > 0).length;
    const warnSuffix = warnCount > 0 ? `, ${warnCount} warning${warnCount === 1 ? '' : 's'}` : '';
    console.log(`\n${total} checked: ${validCount} valid, ${invalidCount} invalid${warnSuffix}`);
  }

  return invalidCount > 0 ? 1 : 0;
}

/**
 * Detect duplicate resource IDs within each type.
 * At runtime, the server registers by flat ID — duplicates cause silent drops.
 */
function detectDuplicateIds(results: ValidationEntry[]): void {
  const countByTypeAndId = new Map<string, number>();

  for (const r of results) {
    const key = `${r.type}::${r.id}`;
    countByTypeAndId.set(key, (countByTypeAndId.get(key) ?? 0) + 1);
  }

  for (const r of results) {
    const key = `${r.type}::${r.id}`;
    const count = countByTypeAndId.get(key) ?? 0;
    if (count > 1) {
      r.warnings.push(`Duplicate ID '${r.id}' found ${count} times — only one will register at runtime`);
    }
  }
}

function resolveTypes(flags: ValidateOptions['flags']): ResourceType[] {
  if (flags.all || (!flags.prompts && !flags.gates && !flags.frameworks && !flags.styles)) {
    return ['prompts', 'gates', 'frameworks', 'styles'];
  }
  const types: ResourceType[] = [];
  if (flags.prompts) types.push('prompts');
  if (flags.gates) types.push('gates');
  if (flags.frameworks) types.push('frameworks');
  if (flags.styles) types.push('styles');
  return types;
}
