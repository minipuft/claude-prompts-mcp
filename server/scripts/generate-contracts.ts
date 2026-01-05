// @lifecycle canonical - Generates contract artifacts from SSOT manifests.
/**
 * Contract Generator (TypeScript)
 *
 * - Validates tool contract manifests under tooling/contracts
 * - Emits Markdown snippets for docs
 * - Supports --check mode to fail when generated output is stale
 *
 * Imports schemas from src/tooling/contracts/types.ts (SSOT) to eliminate duplication.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Import schemas from SSOT (eliminates duplication)
import {
  toolContractSchema,
  type ToolContract,
  type ParameterDefinition,
} from '../src/tooling/contracts/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTRACTS_DIR = path.join(ROOT, 'tooling', 'contracts');
const GENERATED_META_DIR = path.join(ROOT, 'src', 'tooling', 'contracts', '_generated');
const DOCS_DIR = path.join(ROOT, '..', 'docs');
const GENERATED_DIR = path.join(DOCS_DIR, '_generated');

interface ToolDescriptionsConfig {
  version: string;
  lastUpdated?: string;
  generatedFrom: string;
  tools: Record<string, {
    description: string;
    shortDescription: string;
    category: string;
    triggerExamples?: string[];
    parameters: Record<string, string | { type: string; description: string }>;
    frameworkAware: { enabled: string; disabled: string };
  }>;
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

async function readJsonIfExists(filePath: string): Promise<ToolDescriptionsConfig | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function renderParamTable(contract: ToolContract): string {
  const rows = contract.parameters
    .filter((p) => p.status !== 'hidden')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const status = p.status === 'working' ? 'working' : `**${p.status}**`;
      const required = p.required ? 'yes' : 'no';
      const descParts = [escapePipes(p.description)];
      if (p.compatibility && p.compatibility !== 'canonical') {
        descParts.push(`(${p.compatibility})`);
      }
      if (p.notes?.length) {
        descParts.push(p.notes.map(escapePipes).join(' '));
      }
      return `| \`${p.name}\` | ${escapePipes(p.type)} | ${status} | ${required} | ${descParts.join(' ')} |`;
    });

  const header = ['| Name | Type | Status | Required | Description |', '| --- | --- | --- | --- | --- |'];
  return header.concat(rows).join('\n');
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, '\\|');
}

async function writeFileIfChanged(filePath: string, content: string, checkMode: boolean): Promise<boolean> {
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

/**
 * Map contract parameter type to Zod schema code
 */
function typeToZod(param: ParameterDefinition): string {
  const { type, name, required } = param;
  let zodCode = '';

  // Handle enum types
  if (type.startsWith('enum[') || type === 'enum') {
    const enumMatch = type.match(/^enum\[([^\]]+)\]$/);
    if (enumMatch) {
      const values = enumMatch[1].split('|').map((v) => `'${v.trim()}'`);
      zodCode = `z.enum([${values.join(', ')}])`;
    } else if (param.enum) {
      const values = param.enum.map((v) => `'${v}'`);
      zodCode = `z.enum([${values.join(', ')}])`;
    } else {
      zodCode = 'z.string()';
    }
  }
  // Handle array types
  else if (type === 'array' || type.startsWith('array<')) {
    // For complex union arrays like gates, use passthrough
    if (name === 'gates') {
      zodCode = `z.array(z.union([
        z.string(),
        z.object({ name: z.string(), description: z.string() }),
        z.object({
          id: z.string().optional(),
          name: z.string().optional(),
          description: z.string().optional(),
          criteria: z.array(z.string()).optional(),
          severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
          type: z.enum(['validation', 'guidance']).optional(),
          scope: z.enum(['execution', 'session', 'chain', 'step']).optional(),
          template: z.string().optional(),
          pass_criteria: z.array(z.string()).optional(),
          guidance: z.string().optional(),
          context: z.record(z.unknown()).optional(),
          source: z.enum(['manual', 'automatic', 'analysis']).optional(),
          target_step_number: z.number().int().positive().optional(),
          apply_to_steps: z.array(z.number().int().positive()).optional(),
        }),
      ]))`;
    } else if (name === 'arguments') {
      zodCode = `z.array(z.object({
        name: z.string(),
        type: z.string(),
        description: z.string(),
      }))`;
    } else {
      zodCode = 'z.array(z.unknown())';
    }
  }
  // Handle record/object types
  else if (type === 'record' || type === 'object') {
    zodCode = 'z.record(z.unknown())';
  }
  // Handle never type (blocked parameters)
  else if (type === 'never') {
    zodCode = 'z.never()';
  }
  // Handle boolean
  else if (type === 'boolean') {
    zodCode = 'z.boolean()';
  }
  // Handle number
  else if (type === 'number') {
    zodCode = 'z.number()';
  }
  // Default to string with optional pattern
  else {
    zodCode = 'z.string()';
    // Add trim for strings that might have whitespace
    if (name === 'command' || name === 'user_response' || name === 'reason') {
      zodCode += '.trim()';
    }
    // Add regex pattern for specific parameters
    if (name === 'chain_id') {
      zodCode += `.regex(/^chain-[a-zA-Z0-9_-]+(?:#\\d+)?$/, 'Chain ID must follow format: chain-{prompt}[#runNumber]')`;
    }
    if (name === 'gate_verdict') {
      zodCode += `.regex(/^GATE_REVIEW:\\s(PASS|FAIL)\\s-\\s.+$/, 'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"')`;
    }
  }

  // Add optional modifier if not required
  if (!required) {
    zodCode += '.optional()';
  }

  return zodCode;
}

/**
 * Convert tool name to camelCase (e.g., prompt_engine -> promptEngine)
 */
function toCamelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Generate mcp-schemas.ts with Zod schemas for MCP registration
 */
function generateMcpSchemas(contracts: ToolContract[]): string {
  const lines: string[] = [
    '// Auto-generated from tooling/contracts/*.json. Do not edit manually.',
    "import { z } from 'zod';",
    '',
  ];

  for (const contract of contracts) {
    if (!contract.toolDescription) continue; // Skip contracts without toolDescription

    const camelName = toCamelCase(contract.tool);
    const schemaName = `${camelName}Schema`;

    lines.push(`/**`);
    lines.push(` * Zod schema for ${contract.tool} MCP tool`);
    lines.push(` * Generated from contract version ${contract.version}`);
    lines.push(` */`);
    lines.push(`export const ${schemaName} = z.object({`);

    for (const param of contract.parameters) {
      // Skip hidden parameters in schema (they should be rejected)
      if (param.status === 'hidden') {
        lines.push(`  // ${param.name}: hidden/blocked - not included in schema`);
        continue;
      }

      const zodType = typeToZod(param);
      // Add JSDoc comment for description
      lines.push(`  /** ${escapeTsComment(param.description)} */`);
      lines.push(`  ${param.name}: ${zodType},`);
    }

    lines.push('}).passthrough();');
    lines.push('');
    lines.push(`export type ${camelName}Input = z.infer<typeof ${schemaName}>;`);
    lines.push('');
  }

  return lines.join('\n');
}

function escapeTsComment(text: string): string {
  return text.replace(/\*\//g, '*\\/').replace(/\n/g, ' ');
}

async function main(): Promise<void> {
  const checkMode = process.argv.includes('--check');
  const contracts = await loadContracts();
  let changed = false;

  for (const contract of contracts) {
    // Generate docs markdown
    const snippet = renderParamTable(contract);
    const snippetPath = path.join(GENERATED_DIR, `${contract.tool}-params.md`);
    const wrote = await writeFileIfChanged(snippetPath, `${snippet}\n`, checkMode);
    changed = changed || wrote;

    // Skip .generated.ts for contracts without toolDescription (deprecated tools)
    if (!contract.toolDescription) {
      console.log(`[generate-contracts] Skipping ${contract.tool} (no toolDescription - deprecated)`);
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
    const tsChanged = await writeFileIfChanged(tsPath, `${tsContent}\n`, checkMode);
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
  const toolDescChanged = await writeFileIfChanged(toolDescriptionsPath, `${toolDescriptionsJson}\n`, checkMode);
  changed = changed || toolDescChanged;
  if (toolDescChanged) {
    console.log('[generate-contracts] Generated tool-descriptions.contracts.json');
  }

  // Generate mcp-schemas.ts (Zod schemas for MCP registration)
  const mcpSchemasPath = path.join(GENERATED_META_DIR, 'mcp-schemas.ts');
  const mcpSchemasContent = generateMcpSchemas(contracts);
  const mcpSchemasChanged = await writeFileIfChanged(mcpSchemasPath, `${mcpSchemasContent}\n`, checkMode);
  changed = changed || mcpSchemasChanged;
  if (mcpSchemasChanged) {
    console.log('[generate-contracts] Generated mcp-schemas.ts');
  }

  if (checkMode && changed) {
    throw new Error('Contract artifacts were regenerated. Re-run without --check to update files.');
  }

  console.log('[generate-contracts] Complete');
}

main().catch((error) => {
  console.error('[generate-contracts] Failed:', error);
  process.exit(1);
});
