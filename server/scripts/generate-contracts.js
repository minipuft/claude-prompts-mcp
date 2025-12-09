// @lifecycle canonical - Generates contract artifacts from SSOT manifests.
/**
 * Contract Generator
 *
 * - Validates tool contract manifests under tooling/contracts
 * - Emits Markdown snippets for docs
 * - Injects snippets into docs with marker blocks
 * - Supports --check mode to fail when generated output is stale
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTRACTS_DIR = path.join(ROOT, 'tooling', 'contracts');
const GENERATED_META_DIR = path.join(ROOT, 'src', 'tooling', 'contracts', '_generated');
const DOCS_DIR = path.join(ROOT, '..', 'docs');
const GENERATED_DIR = path.join(DOCS_DIR, '_generated');
const DOC_WITH_MARKERS = path.join(DOCS_DIR, 'mcp-tools.md');
const DOC_MARKERS = {
  prompt_engine: 'prompt_engine.params',
  prompt_manager: 'prompt_manager.params',
  system_control: 'system_control.params',
};

const parameterStatusSchema = z.enum([
  'working',
  'deprecated',
  'hidden',
  'experimental',
  'needs-validation',
]);

const compatibilitySchema = z.enum(['canonical', 'legacy', 'deprecated']);

const parameterSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  status: parameterStatusSchema.default('working'),
  compatibility: compatibilitySchema.default('canonical'),
  examples: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
  enum: z.array(z.string()).optional(), // For enum types with explicit values
});

const commandDescriptorSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  parameters: z.array(z.string()).optional(),
  status: parameterStatusSchema.default('working'),
  notes: z.array(z.string()).optional(),
});

const frameworkAwareDescriptionSchema = z.object({
  enabled: z.string().min(1),
  disabled: z.string().min(1),
});

const toolDescriptionSchema = z.object({
  description: z.string().min(1),
  shortDescription: z.string().min(1),
  category: z.enum(['execution', 'management', 'system']),
  frameworkAware: frameworkAwareDescriptionSchema,
});

const toolContractSchema = z.object({
  tool: z.string().min(1),
  version: z.number().int().positive(),
  summary: z.string().min(1),
  toolDescription: toolDescriptionSchema.optional(), // Optional for backwards compatibility
  parameters: z.array(parameterSchema).min(1),
  commands: z.array(commandDescriptorSchema).optional(),
  metadata: z.record(z.any()).optional(),
});

async function loadContracts() {
  const entries = await readdir(CONTRACTS_DIR, { withFileTypes: true });
  const contracts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const content = await readFile(path.join(CONTRACTS_DIR, entry.name), 'utf-8');
    const parsed = JSON.parse(content);
    const contract = toolContractSchema.parse(parsed);
    contracts.push(contract);
  }
  return contracts;
}

function renderParamTable(contract) {
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

function escapePipes(text) {
  return text.replace(/\|/g, '\\|');
}

async function writeFileIfChanged(filePath, content, checkMode) {
  let current = null;
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

function injectDocSection(docContent, markerId, snippet) {
  const start = `<!-- ${markerId}:start -->`;
  const end = `<!-- ${markerId}:end -->`;
  const startIdx = docContent.indexOf(start);
  const endIdx = docContent.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { updated: docContent, injected: false };
  }
  const before = docContent.slice(0, startIdx + start.length);
  const after = docContent.slice(endIdx);
  return { updated: `${before}\n\n${snippet}\n\n${after}`, injected: true };
}

/**
 * Generate tool-descriptions.json from contracts (SSOT for ToolDescriptionManager)
 */
function generateToolDescriptions(contracts) {
  const tools = {};
  for (const contract of contracts) {
    const toolName = contract.tool.replace(/-/g, '_');
    const params = {};
    for (const param of contract.parameters) {
      if (param.status === 'hidden') continue;
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
    tools[toolName] = {
      description: contract.toolDescription.description,
      shortDescription: contract.toolDescription.shortDescription,
      category: contract.toolDescription.category,
      parameters: params,
      frameworkAware: contract.toolDescription.frameworkAware,
    };
  }
  return {
    version: '3.0.0',
    lastUpdated: new Date().toISOString(),
    generatedFrom: 'contracts',
    tools,
  };
}

/**
 * Map contract parameter type to Zod schema code
 */
function typeToZod(param) {
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
function toCamelCase(str) {
  return str.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Generate mcp-schemas.ts with Zod schemas for MCP registration
 */
function generateMcpSchemas(contracts) {
  const lines = [
    '// Auto-generated from tooling/contracts/*.json. Do not edit manually.',
    "import { z } from 'zod';",
    '',
  ];

  for (const contract of contracts) {
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

    lines.push('});');
    lines.push('');
    lines.push(`export type ${camelName}Input = z.infer<typeof ${schemaName}>;`);
    lines.push('');
  }

  return lines.join('\n');
}

function escapeTsComment(text) {
  return text.replace(/\*\//g, '*\\/').replace(/\n/g, ' ');
}

async function main() {
  const checkMode = process.argv.includes('--check');
  const contracts = await loadContracts();
  let changed = false;

  for (const contract of contracts) {
    const snippet = renderParamTable(contract);
    const snippetPath = path.join(GENERATED_DIR, `${contract.tool}-params.md`);
    const wrote = await writeFileIfChanged(snippetPath, `${snippet}\n`, checkMode);
    changed = changed || wrote;

    const metadataJsonPath = path.join(GENERATED_META_DIR, `${contract.tool}.metadata.json`);
    const metadataJson = JSON.stringify(
      {
        tool: contract.tool,
        version: contract.version,
        summary: contract.summary,
        parameters: contract.parameters,
        commands: contract.commands ?? [],
      },
      null,
      2
    );
    const metaChanged = await writeFileIfChanged(metadataJsonPath, `${metadataJson}\n`, checkMode);
    changed = changed || metaChanged;

    const tsParamConst = `${contract.tool.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Parameters`;
    const tsCommandConst = `${contract.tool.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Commands`;
    const tsParamType = `${contract.tool.replace(/(^|[-_])(\\w)/g, (_, __, c) => c.toUpperCase())}ParamName`;
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
      `export const ${contract.tool.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Metadata = { tool: '${
        contract.tool
      }', version: ${contract.version} };`,
      '',
    ].join('\n');

    const tsPath = path.join(GENERATED_META_DIR, `${contract.tool}.generated.ts`);
    const tsChanged = await writeFileIfChanged(tsPath, `${tsContent}\n`, checkMode);
    changed = changed || tsChanged;

    const marker = DOC_MARKERS[contract.tool];
    if (marker) {
      const doc = await readFile(DOC_WITH_MARKERS, 'utf-8');
      const { updated, injected } = injectDocSection(doc, marker, snippet);
      if (!injected) {
        console.warn(`[generate-contracts] Marker not found for ${contract.tool} (${marker}); skipping doc injection.`);
      } else {
        const docChanged = await writeFileIfChanged(DOC_WITH_MARKERS, updated, checkMode);
        changed = changed || docChanged;
      }
    }
  }

  // Generate unified tool-descriptions.json (SSOT for ToolDescriptionManager)
  const toolDescriptionsPath = path.join(GENERATED_META_DIR, 'tool-descriptions.json');
  const toolDescriptions = generateToolDescriptions(contracts);
  const toolDescriptionsJson = JSON.stringify(toolDescriptions, null, 2);
  const toolDescChanged = await writeFileIfChanged(toolDescriptionsPath, `${toolDescriptionsJson}\n`, checkMode);
  changed = changed || toolDescChanged;
  if (toolDescChanged) {
    console.log('[generate-contracts] Generated tool-descriptions.json');
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
}

main().catch((error) => {
  console.error('[generate-contracts] Failed:', error);
  process.exit(1);
});
