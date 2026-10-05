#!/usr/bin/env tsx
/**
 * Creation adapters are projections of resource_manager, never a second authoring contract.
 * Command metadata owns the field vocabulary; the hand-written transport schema owns types.
 * This checks both omitted and obsolete declarations, then runs every declared input through
 * the real builder, including falsy values accepted by the transport. Nested records remain
 * opaque: resource_manager owns semantic validation, not this checker or the adapters.
 *
 * Scope: bundled examples and their creation builders. It cannot verify authored prose,
 * domain-valid resources, or operator-installed prompts. No MCP write is executed here.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';
import { z } from 'zod';

import { describeParameterRefusal } from '../src/mcp/tools/resource-manager/core/parameter-ownership.js';
import { resourceManagerInputSchema } from '../src/mcp/tools/schemas/resource-manager.schema.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXAMPLES_DIR = path.join(SERVER_ROOT, 'resources', 'prompts', 'examples');
const FIXTURES_PATH = path.join(
  SERVER_ROOT,
  'tests/unit/resources/bundled-script-tool-fixtures.json'
);
const RESOURCE_TYPES = ['prompt', 'gate', 'framework'] as const;
type CreationType = (typeof RESOURCE_TYPES)[number];
type JsonObject = Record<string, unknown>;

export interface ToolOnDisk {
  id: string;
  dir: string;
  promptDir: string;
  runtime: string;
  script: string;
}
export interface ScriptOutput {
  valid?: boolean;
  errors?: string[];
  auto_execute?: { tool?: string; params?: JsonObject };
  draft?: { tool?: string; params?: JsonObject };
}
interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  enum?: unknown[];
}
export interface AuthoringResource {
  type: CreationType;
  tool: ToolOnDisk;
  schema: JsonSchema;
  arguments: Array<{ name: string; type?: string }>;
  input: JsonObject;
}
export type CreationFields = Record<CreationType, Record<string, JsonSchema>>;

// These are control/routing inputs, not authored resource contents. Framework identity is id;
// its `framework` parameter is a selector. full_restart controls process lifecycle after writes.
// skip_version suppresses version recording for the write; it says nothing about the resource.
const CONTROL_FIELDS = new Set([
  'resource_type',
  'action',
  'full_restart',
  'framework',
  'skip_version',
]);
const ALIASES: Record<CreationType, Record<string, string>> = {
  prompt: {
    systemMessage: 'system_message',
    userMessageTemplate: 'user_message_template',
    gateConfiguration: 'gate_configuration',
    chainSteps: 'chain_steps',
    registerWithMcp: 'register_with_mcp',
  },
  gate: { enforcementMode: 'enforcement_mode' },
  framework: {},
};

/** The same enumeration used by the existing bundled-tool parameter-ownership suite. */
export function bundledScriptTools(examplesDir = EXAMPLES_DIR): ToolOnDisk[] {
  const found: ToolOnDisk[] = [];
  for (const promptEntry of readdirSync(examplesDir, { withFileTypes: true })) {
    if (!promptEntry.isDirectory()) continue;
    const promptDir = path.join(examplesDir, promptEntry.name);
    const toolsDir = path.join(promptDir, 'tools');
    if (!existsSync(toolsDir)) continue;
    for (const toolEntry of readdirSync(toolsDir, { withFileTypes: true })) {
      if (!toolEntry.isDirectory()) continue;
      const dir = path.join(toolsDir, toolEntry.name);
      if (!existsSync(path.join(dir, 'tool.yaml'))) continue;
      const manifest = yaml.load(readFileSync(path.join(dir, 'tool.yaml'), 'utf8')) as {
        id?: string;
        runtime?: string;
        script?: string;
      };
      found.push({
        id: manifest.id ?? toolEntry.name,
        dir,
        promptDir,
        runtime: manifest.runtime ?? 'python',
        script: manifest.script ?? 'script.py',
      });
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

export function runTool(tool: ToolOnDisk, input: unknown): ScriptOutput {
  if (!['python', 'node'].includes(tool.runtime)) {
    throw new Error(`${tool.id}: unsupported checker runtime ${tool.runtime}`);
  }
  const stdout = execFileSync(
    tool.runtime === 'python' ? 'python3' : 'node',
    [path.join(tool.dir, tool.script)],
    {
      input: JSON.stringify(input),
      encoding: 'utf8',
      timeout: 10_000,
      cwd: tool.dir,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }
  );
  return JSON.parse(stdout) as ScriptOutput;
}

/** No hand-maintained list of creation fields: adding a contract parameter immediately fails. */
export function creationFields(): CreationFields {
  const contract = JSON.parse(
    readFileSync(path.join(SERVER_ROOT, 'tooling/contracts/resource-manager.json'), 'utf8')
  ) as {
    commands: Array<{ id: string; parameters: string[] }>;
  };
  const transport = z.toJSONSchema(resourceManagerInputSchema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema;
  const fields = {} as CreationFields;
  for (const type of RESOURCE_TYPES) {
    const command = contract.commands.find((entry) => entry.id === `${type}:create`);
    if (!command?.parameters.length) throw new Error(`${type}:create: missing command parameters`);
    fields[type] = {};
    for (const name of command.parameters.filter((key) => !CONTROL_FIELDS.has(key))) {
      const shape = transport.properties?.[name];
      if (!shape?.type) throw new Error(`${type}:create/${name}: no transport field type`);
      fields[type][name] = shape;
    }
  }
  return fields;
}

function fieldTypes(schema: JsonSchema): string[] {
  return (Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []).sort();
}

function declarationProblems(resource: AuthoringResource, expected: Record<string, JsonSchema>) {
  const problems: string[] = [];
  const properties = resource.schema.properties ?? {};
  const aliases = ALIASES[resource.type];
  for (const name of Object.keys(expected)) {
    if (!(name in properties)) problems.push(`${name}: missing builder schema field`);
    if (!(name in resource.input)) problems.push(`${name}: missing round-trip fixture input`);
  }
  for (const [name, shape] of Object.entries(properties)) {
    const canonical = aliases[name] ?? name;
    const canonicalShape = expected[canonical];
    if (!canonicalShape) {
      problems.push(`${name}: undeclared creation field`);
      continue;
    }
    if (!isDeepStrictEqual(fieldTypes(shape), fieldTypes(canonicalShape))) {
      problems.push(
        `${name}: builder type ${fieldTypes(shape)} differs from transport ${fieldTypes(canonicalShape)}`
      );
    }
    const argument = resource.arguments.find((entry) => entry.name === name);
    if (!argument) problems.push(`${name}: missing registered prompt argument`);
    else if (!fieldTypes(canonicalShape).includes(argument.type ?? 'string')) {
      problems.push(
        `${name}: registered argument type ${argument.type} differs from transport ${fieldTypes(canonicalShape)}`
      );
    }
  }
  return problems;
}

function outputProblems(
  resource: AuthoringResource,
  output: ScriptOutput,
  expected: Record<string, JsonSchema>
) {
  const problems: string[] = [];
  if (output.valid !== true || (output.errors?.length ?? 0) > 0) {
    problems.push(`builder did not return a ready draft: ${JSON.stringify(output.errors)}`);
  }
  const envelope = resource.type === 'prompt' ? output.auto_execute : output.draft;
  if (resource.type !== 'prompt' && output.auto_execute !== undefined) {
    problems.push('auto_execute: gate/framework creation must require client action');
  }
  if (envelope?.tool !== 'resource_manager' || !envelope.params) {
    return [...problems, 'missing resource_manager draft parameters'];
  }
  const params = envelope.params;
  const action = resource.type === 'prompt' ? 'validate' : 'create';
  if (params['resource_type'] !== resource.type)
    problems.push('resource_type: incorrect draft resource');
  if (params['action'] !== action)
    problems.push(`action: expected ${action}, received ${params['action']}`);
  for (const key of Object.keys(params)) {
    if (!['resource_type', 'action'].includes(key) && !(key in expected)) {
      problems.push(`${key}: emitted undeclared creation parameter`);
    }
  }
  const refusal = describeParameterRefusal(resource.type, params);
  if (refusal) problems.push(refusal);
  return problems;
}

/** Compare actual adapter output to inputs; checking only allowed output keys misses omissions. */
export function validateAuthoringContracts(
  resources: AuthoringResource[],
  expected: CreationFields,
  execute: (_tool: ToolOnDisk, _input: JsonObject) => ScriptOutput = runTool
): string[] {
  const problems: string[] = [];
  for (const type of RESOURCE_TYPES) {
    if (!resources.some((resource) => resource.type === type))
      problems.push(`create_${type}: no builder found`);
  }
  for (const resource of resources) {
    const prefix = `create_${resource.type}/${resource.tool.id}`;
    const fields = expected[resource.type];
    if (Object.keys(fields).length === 0)
      problems.push(`${prefix}: empty canonical creation field set`);
    const report = (errors: string[]) =>
      problems.push(...errors.map((error) => `${prefix}/${error}`));
    report(declarationProblems(resource, fields));
    const check = (input: JsonObject, key?: string, canonical = key) => {
      try {
        const output = execute(resource.tool, input);
        report(outputProblems(resource, output, fields));
        const params = (resource.type === 'prompt' ? output.auto_execute : output.draft)?.params;
        if (key === undefined && params) {
          const parsed = resourceManagerInputSchema.safeParse(params);
          if (!parsed.success) {
            report(
              parsed.error.issues.map(
                (issue) =>
                  `${issue.path.join('.')}: base draft fails canonical transport schema: ${issue.message}`
              )
            );
          }
        }
        if (
          key &&
          canonical &&
          (!params ||
            !Object.hasOwn(params, canonical) ||
            !isDeepStrictEqual(params[canonical], input[key]))
        ) {
          report([`${key}: adapter lost or changed mapped value for ${canonical}`]);
        }
      } catch (error) {
        report([
          `${key ?? 'execution'}: builder failed: ${error instanceof Error ? error.message : String(error)}`,
        ]);
      }
    };
    check(resource.input);
    for (const [key, shape] of Object.entries(fields)) {
      if (!(key in resource.input)) continue;
      check(resource.input, key);
      const transportField =
        resourceManagerInputSchema.shape[key as keyof typeof resourceManagerInputSchema.shape];
      for (const value of [false, 0, '', [], {}, ...(shape.enum ?? [])]) {
        // Probe only values accepted by the owner. No independent nested domain constraints.
        if (
          fieldTypes(shape).includes(Array.isArray(value) ? 'array' : typeof value) &&
          transportField?.safeParse(value).success
        )
          check({ ...resource.input, [key]: value }, key);
      }
    }
    for (const [alias, canonical] of Object.entries(ALIASES[resource.type])) {
      if (!(alias in (resource.schema.properties ?? {}))) continue;
      const input = { ...resource.input, [alias]: resource.input[canonical] };
      delete input[canonical];
      check(input, alias, canonical);
      // A legacy alias must not overwrite an explicitly supplied canonical input.
      const value = resource.input[canonical];
      const conflicting =
        typeof value === 'boolean'
          ? !value
          : typeof value === 'string'
            ? `${value} legacy alias`
            : Array.isArray(value)
              ? [{ legacyAliasMarker: true }]
              : { legacyAliasMarker: true };
      check({ ...resource.input, [alias]: conflicting }, canonical);
    }
  }
  return [...new Set(problems)];
}

export function loadAuthoringResources(): AuthoringResource[] {
  const tools = bundledScriptTools();
  if (tools.length === 0) throw new Error('No bundled script tools found');
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as Record<
    string,
    { input: JsonObject }
  >;
  assert.deepEqual(
    Object.keys(fixtures).sort(),
    tools.map((tool) => tool.id).sort(),
    'Bundled tool fixtures must enumerate exactly the tools on disk'
  );
  return tools.flatMap((tool) => {
    const type = RESOURCE_TYPES.find(
      (entry) => path.basename(tool.promptDir) === `create_${entry}`
    );
    if (!type) return [];
    const prompt = yaml.load(readFileSync(path.join(tool.promptDir, 'prompt.yaml'), 'utf8')) as {
      arguments?: AuthoringResource['arguments'];
      tools?: string[];
    };
    if (!prompt.tools?.includes(tool.id))
      throw new Error(`create_${type}/${tool.id}: builder is not registered`);
    return [
      {
        type,
        tool,
        schema: JSON.parse(readFileSync(path.join(tool.dir, 'schema.json'), 'utf8')) as JsonSchema,
        arguments: prompt.arguments ?? [],
        input: fixtures[tool.id]!.input,
      },
    ];
  });
}

/** Tiny isolated comparator controls; full artifact/adapter mutations live in the Jest suite. */
function selfTest() {
  const expected = {
    prompt: { name: { type: 'string' } },
    gate: { name: { type: 'string' } },
    framework: { name: { type: 'string' } },
  } satisfies CreationFields;
  const resources: AuthoringResource[] = RESOURCE_TYPES.map((type) => ({
    type,
    tool: { id: `${type}_builder`, dir: '', promptDir: '', runtime: 'python', script: 'script.py' },
    schema: { properties: { name: { type: 'string' } } },
    arguments: [{ name: 'name', type: 'string' }],
    input: { name: 'probe' },
  }));
  const execute = (tool: ToolOnDisk, input: JsonObject): ScriptOutput => {
    const type = RESOURCE_TYPES.find((entry) => tool.id === `${entry}_builder`)!;
    const call = {
      tool: 'resource_manager',
      params: { ...input, resource_type: type, action: type === 'prompt' ? 'validate' : 'create' },
    };
    return { valid: true, ...(type === 'prompt' ? { auto_execute: call } : { draft: call }) };
  };
  assert.deepEqual(validateAuthoringContracts(resources, expected, execute), []);
  const missing = structuredClone(resources);
  delete missing[0]!.schema.properties!['name'];
  assert(
    validateAuthoringContracts(missing, expected, execute).some((error) =>
      error.includes('missing builder schema field')
    )
  );
  assert(validateAuthoringContracts([], expected, execute).length === 3);
  const dropping = (tool: ToolOnDisk, input: JsonObject) =>
    execute(tool, { ...input, name: undefined });
  assert(
    validateAuthoringContracts(resources, expected, dropping).some((error) =>
      error.includes('adapter lost')
    )
  );
  console.log(
    'Authoring contract self-test: clean, missing field, lost mapping, empty enumeration passed'
  );
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const resources = loadAuthoringResources();
  const problems = validateAuthoringContracts(resources, creationFields());
  if (problems.length) {
    console.error(
      `Authoring contract drift (${problems.length}):\n${problems.map((entry) => `  ${entry}`).join('\n')}`
    );
    process.exitCode = 1;
  } else
    console.log(
      `Authoring contracts aligned: ${resources.length} creation builders; actual adapter round trips passed`
    );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
