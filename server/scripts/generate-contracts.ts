// @lifecycle canonical - Generates contract artifacts from SSOT manifests.
/**
 * Contract Generator (TypeScript)
 *
 * - Validates tool contract manifests under tooling/contracts
 * - Generates TypeScript constants and tool description JSON
 * - Supports --check mode to fail when generated output is stale
 *
 * Imports schemas from src/mcp/contracts/schemas/types.ts (SSOT) to eliminate duplication.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Import schemas from SSOT (eliminates duplication)
import { toolContractSchema, type ToolContract } from '../src/mcp/contracts/schemas/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTRACTS_DIR = path.join(ROOT, 'tooling', 'contracts');
const GENERATED_META_DIR = path.join(ROOT, 'src', 'mcp', 'contracts', 'schemas', '_generated');

interface ToolDescriptionsConfig {
  version: string;
  lastUpdated?: string;
  generatedFrom: string;
  tools: Record<
    string,
    {
      description: string;
      shortDescription: string;
      category: string;
      triggerExamples?: string[];
      parameters: Record<string, string | { type: string; description: string }>;
      frameworkAware: { enabled: string; disabled: string };
    }
  >;
}

async function loadContracts(): Promise<ToolContract[]> {
  const entries = await readdir(CONTRACTS_DIR, { withFileTypes: true });
  const contracts: ToolContract[] = [];
  const contractFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of contractFiles) {
    const content = await readFile(path.join(CONTRACTS_DIR, fileName), 'utf-8');
    const parsed = JSON.parse(content);
    const contract = toolContractSchema.parse(parsed);
    contracts.push(contract);
  }
  return contracts;
}

/**
 * A contract that describes the SHAPE OF A VALUE rather than an MCP tool's parameter list.
 *
 * `tooling/contracts/workflow-ir.json` is the first (OQ-P6-10, 2026-08-13). It declares no
 * `toolDescription`, because it is not a tool — nothing registers a `workflow_ir` tool and
 * nothing should advertise one. Two consequences, and both are the point:
 *
 *  - it is EXCLUDED from `tool-descriptions.contracts.json`, so no phantom tool reaches
 *    `ToolDescriptionLoader`. That exclusion is automatic: `generateToolDescriptions` already
 *    skips every contract without a `toolDescription`.
 *  - it still EMITS its parameter metadata to `_generated/`, which the pre-existing
 *    `!toolDescription -> continue` guard would otherwise suppress. That guard exists to skip
 *    DEPRECATED tools, and "deprecated tool" and "not a tool" are different things that happened
 *    to share a shape.
 *
 * Opt-in rather than inferred: a contract missing `toolDescription` by accident should keep
 * being skipped and logged, exactly as before.
 */
function isResourceShapeContract(contract: ToolContract): boolean {
  return contract.metadata?.['artifactKind'] === 'resource-shape';
}

async function readJsonIfExists(filePath: string): Promise<ToolDescriptionsConfig | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeFileIfChanged(
  filePath: string,
  content: string,
  checkMode: boolean
): Promise<boolean> {
  let current: string | null = null;
  try {
    current = await readFile(filePath, 'utf-8');
  } catch {
    // file may not exist
  }

  if (current === content) {
    return false;
  }

  if (checkMode) {
    throw new Error(`Contract artifacts out of date: ${path.relative(ROOT, filePath)}`);
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
  return true;
}

/**
 * Generate tool-descriptions.contracts.json from contracts (SSOT for ToolDescriptionManager)
 */
function generateToolDescriptions(
  contracts: ToolContract[],
  meta: { version?: string; generatedFrom?: string; lastUpdated?: string } = {}
): ToolDescriptionsConfig {
  const tools: ToolDescriptionsConfig['tools'] = {};
  for (const contract of contracts) {
    if (!contract.toolDescription) continue; // Skip contracts without toolDescription

    const toolName = contract.tool.replace(/-/g, '_');
    const params: Record<string, string | { type: string; description: string }> = {};
    for (const param of contract.parameters) {
      // Skip hidden params entirely
      if (param.status === 'hidden') continue;
      // Skip params explicitly excluded from description (still in Zod schema)
      if (param.includeInDescription === false) continue;
      // Build parameter description with optional type info for complex types
      if (param.type === 'array' || param.type.startsWith('array<')) {
        params[param.name] = {
          type: 'array',
          description: param.description,
        };
      } else {
        params[param.name] = param.description;
      }
    }
    const toolEntry: ToolDescriptionsConfig['tools'][string] = {
      description: contract.toolDescription.description,
      shortDescription: contract.toolDescription.shortDescription,
      category: contract.toolDescription.category,
      parameters: params,
      frameworkAware: contract.toolDescription.frameworkAware,
    };

    // Include triggerExamples if present in contract
    if (contract.toolDescription.triggerExamples?.length) {
      toolEntry.triggerExamples = contract.toolDescription.triggerExamples;
    }

    tools[toolName] = toolEntry;
  }
  return {
    version: meta.version ?? '3.0.0',
    lastUpdated: meta.lastUpdated,
    generatedFrom: meta.generatedFrom ?? 'contracts',
    tools,
  };
}

// typeToZod() and generateMcpSchemas() removed — Zod schemas are now hand-written
// in src/mcp/tools/schemas/ (SSOT for validation). This generator only produces
// metadata (.generated.ts), tool descriptions (.json), and docs (.md).

/**
 * Format TypeScript content with prettier for consistent output
 */
function formatWithPrettier(content: string, cwd: string): string {
  const prettierBin = path.join(cwd, 'node_modules', '.bin', 'prettier');
  const result = spawnSync(prettierBin, ['--parser', 'typescript'], {
    input: content,
    encoding: 'utf-8',
    cwd,
  });
  return result.status === 0 ? result.stdout : content;
}

async function main(): Promise<void> {
  const checkMode = process.argv.includes('--check');
  const contracts = await loadContracts();
  let changed = false;

  for (const contract of contracts) {
    // Skip .generated.ts for contracts without toolDescription (deprecated tools).
    // Resource-shape contracts are not tools and legitimately have none — see
    // isResourceShapeContract.
    if (!contract.toolDescription && !isResourceShapeContract(contract)) {
      console.log(
        `[generate-contracts] Skipping ${contract.tool} (no toolDescription - deprecated)`
      );
      continue;
    }

    // Generate TypeScript constants
    // Keep original tool name format for backward compatibility with consumers
    const toolNameForConst = contract.tool.replace(/-/g, '_');
    const tsParamConst = `${toolNameForConst}Parameters`;
    const tsCommandConst = `${toolNameForConst}Commands`;
    const tsParamType = `${toolNameForConst}ParamName`;
    const paramNames = contract.parameters
      .filter((p) => p.status !== 'hidden')
      .map((p) => `'${p.name}'`)
      .join(' | ');
    const tsContent = [
      '// Auto-generated from tooling/contracts/*.json. Do not edit manually.',
      'export interface ToolParameter {',
      '  name: string;',
      '  type: string;',
      '  description: string;',
      `  status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental';`,
      '  required?: boolean;',
      '  default?: unknown;',
      `  compatibility: 'canonical' | 'deprecated' | 'legacy'; // Required with default value`,
      '  examples?: string[];',
      '  notes?: string[];',
      '  enum?: string[]; // For enum types with explicit values',
      '  includeInDescription?: boolean; // If false, param is in schema but not tool description',
      '}',
      '',
      'export interface ToolCommand {',
      '  id: string;',
      '  summary: string;',
      '  parameters?: string[];',
      `  status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental'; // Required with default value`,
      '  notes?: string[];',
      '}',
      '',
      `export type ${tsParamType} = ${paramNames || "''"};`,
      `export const ${tsParamConst}: ToolParameter[] = ${JSON.stringify(
        contract.parameters.filter((p) => p.status !== 'hidden'),
        null,
        2
      )};`,
      '',
      `export const ${tsCommandConst}: ToolCommand[] = ${JSON.stringify(contract.commands ?? [], null, 2)};`,
      '',
      `export const ${toolNameForConst}Metadata = { tool: '${contract.tool}', version: ${contract.version} };`,
      '',
    ].join('\n');

    const tsPath = path.join(GENERATED_META_DIR, `${contract.tool}.generated.ts`);
    const formattedTsContent = formatWithPrettier(tsContent, ROOT);
    // Prettier already adds trailing newline, don't add another
    const tsChanged = await writeFileIfChanged(tsPath, formattedTsContent, checkMode);
    changed = changed || tsChanged;
  }

  // Generate unified tool-descriptions.contracts.json (SSOT for ToolDescriptionManager)
  const toolDescriptionsPath = path.join(GENERATED_META_DIR, 'tool-descriptions.contracts.json');
  const existingToolDescriptions = await readJsonIfExists(toolDescriptionsPath);
  const toolDescriptionsDraft = generateToolDescriptions(contracts, {
    version: existingToolDescriptions?.version,
    generatedFrom: existingToolDescriptions?.generatedFrom,
  });
  const existingComparable = existingToolDescriptions
    ? JSON.stringify(
        {
          version: existingToolDescriptions.version,
          generatedFrom: existingToolDescriptions.generatedFrom,
          tools: existingToolDescriptions.tools,
        },
        null,
        2
      )
    : null;
  const nextComparable = JSON.stringify(
    {
      version: toolDescriptionsDraft.version,
      generatedFrom: toolDescriptionsDraft.generatedFrom,
      tools: toolDescriptionsDraft.tools,
    },
    null,
    2
  );
  const lastUpdated =
    existingComparable && existingComparable === nextComparable
      ? existingToolDescriptions?.lastUpdated
      : new Date().toISOString();
  const toolDescriptions: ToolDescriptionsConfig = {
    ...toolDescriptionsDraft,
    lastUpdated,
  };
  const toolDescriptionsJson = JSON.stringify(toolDescriptions, null, 2);
  const toolDescChanged = await writeFileIfChanged(
    toolDescriptionsPath,
    `${toolDescriptionsJson}\n`,
    checkMode
  );
  changed = changed || toolDescChanged;
  if (toolDescChanged) {
    console.log('[generate-contracts] Generated tool-descriptions.contracts.json');
  }

  // mcp-schemas.ts generation removed — Zod schemas now hand-written in src/mcp/tools/schemas/

  if (checkMode && changed) {
    throw new Error('Contract artifacts were regenerated. Re-run without --check to update files.');
  }

  console.log('[generate-contracts] Complete');
}

main().catch((error) => {
  console.error('[generate-contracts] Failed:', error);
  process.exit(1);
});
