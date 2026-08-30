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
// Python artifact consumed by hooks/gate-enforce.py. Lives in the repo-root hooks tree (not
// server/src) because `prepack` rsyncs ../hooks into the package, which is how downstream
// adapter repos receive hook code.
const HOOKS_GENERATED_DIR = path.resolve(ROOT, '..', 'hooks', 'lib', '_generated');

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

interface LoadedContract {
  fileName: string;
  contract: ToolContract;
}

async function loadContracts(): Promise<LoadedContract[]> {
  const entries = await readdir(CONTRACTS_DIR, { withFileTypes: true });
  const contracts: LoadedContract[] = [];
  const contractFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of contractFiles) {
    const content = await readFile(path.join(CONTRACTS_DIR, fileName), 'utf-8');
    const parsed = JSON.parse(content);
    const contract = toolContractSchema.parse(parsed);
    contracts.push({ fileName, contract });
  }
  return contracts;
}

/**
 * A contract's ARTIFACT POSTURE — what it is allowed to skip, and why.
 *
 * `!contract.toolDescription -> skip everything` used to conflate two different things that
 * happen to share a shape: "deprecated tool" (intentionally produces nothing) and "not a tool"
 * (a resource-shape contract, which still owes `_generated/` its parameter metadata). That
 * conflation is P6-F15: a resource-shape contract that forgets its marker falls through to the
 * same branch as a deprecated one and vanishes from generation with a green exit and nothing but
 * a console.log naming it.
 *
 * Three recognized postures, in priority order:
 *
 *  - `tool` — has `toolDescription`. Normal MCP tool contract; emits `.generated.ts` AND
 *    contributes to `tool-descriptions.contracts.json`.
 *  - `resource-shape` — `metadata.artifactKind === 'resource-shape'`. Describes the SHAPE OF A
 *    VALUE, not a tool's parameter list (`tooling/contracts/workflow-ir.json` is the first,
 *    OQ-P6-10, 2026-08-13). Emits `.generated.ts` for its parameter metadata; excluded from
 *    `tool-descriptions.contracts.json` because nothing registers it as a tool.
 *  - `artifact-less` — `metadata.artifactKind === 'none'`, DECLARED rather than inferred, and
 *    carrying both `metadata.artifactKindReason` and `metadata.closedBy` — the same two fields
 *    the sqlite-persistence `AcceptedException` convention requires (a reason and a named exit;
 *    an exception with no `closedBy` is a permanent bypass wearing a temporary label). Legitimate
 *    for a genuinely deprecated tool contract kept only for historical typing. Skipped and
 *    logged, never silently.
 *
 * Anything else — no `toolDescription`, no `artifactKind`, an unrecognized `artifactKind` value,
 * or an `artifactKind: 'none'` missing its reason/closedBy — resolves to `unmarked` and FAILS the
 * run. A contract missing its marker by accident must keep failing loudly; only an explicit,
 * fully-declared exemption may skip.
 */
type ContractPosture =
  | { kind: 'tool' }
  | { kind: 'resource-shape' }
  | { kind: 'artifact-less'; reason: string; closedBy: string }
  | { kind: 'unmarked' };

function readMetadataString(contract: ToolContract, key: string): string | undefined {
  const value = contract.metadata?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveContractPosture(contract: ToolContract): ContractPosture {
  if (contract.toolDescription) {
    return { kind: 'tool' };
  }

  const artifactKind = contract.metadata?.['artifactKind'];

  if (artifactKind === 'resource-shape') {
    return { kind: 'resource-shape' };
  }

  if (artifactKind === 'none') {
    const reason = readMetadataString(contract, 'artifactKindReason');
    const closedBy = readMetadataString(contract, 'closedBy');
    if (reason && closedBy) {
      return { kind: 'artifact-less', reason, closedBy };
    }
    // Declared artifact-less but missing the hygiene fields — an incomplete exemption is not
    // an exemption. Fall through to `unmarked` so it fails loudly instead of skipping quietly.
    return { kind: 'unmarked' };
  }

  return { kind: 'unmarked' };
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
 * Emit the pending-run resolution verbs for the Python gate hook.
 *
 * `hooks/gate-enforce.py` (PreToolUse) must accept exactly the moves the server accepts while a
 * run is waiting for one. Named for the RUN, not the gate: a failed gate review is no longer the
 * only thing a run can be pending on — a blocking-unknown interrupt holds a run on the reserved
 * `__unknown_interrupt__` review, and the verbs that clear it (`gate_action: resume |
 * accept_alternative`) travel the same channel. Its previous hardcoded model rotted twice — it denied
 * `gate_action: "abort"` and `cancel: true`, both server-supported exits, trapping sessions
 * behind their own pending gate (2026-08-20). Parameters flagged `resolvesPendingRun: true`
 * in the prompt-engine contract are the single source; this artifact is how the hook reads it.
 *
 * Throws when the contract exists but flags nothing: an empty set would make the hook deny
 * every chain_id call — silently recreating the trap this artifact exists to prevent.
 */
async function generateResolutionVerbs(
  contracts: LoadedContract[],
  checkMode: boolean
): Promise<boolean> {
  const promptEngine = contracts.find(({ contract }) => contract.tool === 'prompt_engine');
  if (!promptEngine) {
    return false;
  }

  const verbs = promptEngine.contract.parameters
    .filter((p) => p.resolvesPendingRun === true)
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b));

  if (verbs.length === 0) {
    throw new Error(
      '[generate-contracts] prompt-engine.json flags no parameter with resolvesPendingRun. ' +
        'An empty set would make hooks/gate-enforce.py deny every pending-gate call, including ' +
        'cancel and gate_action. Flag the resolution parameters or remove the hook consumer.'
    );
  }

  const initContent = '"""Generated package marker. Do not edit."""\n';
  const moduleContent = [
    '"""Pending-run resolution verbs. Generated from tooling/contracts/prompt-engine.json.',
    '',
    'Regenerate with `npm run generate:contracts` (server/). Do not edit.',
    '"""',
    '',
    'PENDING_RUN_RESOLUTION_PARAMS: frozenset[str] = frozenset(',
    '    {',
    ...verbs.map((name) => `        "${name}",`),
    '    }',
    ')',
    '',
  ].join('\n');

  // JSON twin of the verb set — consumed by the opencode-prompts plugin's pre-tool
  // handler so TS and Python stay contract-synced without hand-copying (plan row 2.1,
  // plans/opencode-parity-p1-close-client-gaps-2026-08-21.md).
  const verbsJsonContent = `${JSON.stringify([...verbs].sort(), null, 2)}\n`;

  // Extraction-pattern sources — the single source both the Python hooks loader and the
  // opencode-prompts plugin compile their matchers from (plan row 2.2). Values are
  // regex SOURCE strings; consumers compile them with their language's engine.
  const extractionPatterns = {
    step: '(?:[Ss]tep|[Pp]rogress|[Cc]omplete)\\s*\\(?(\\d+)\\s*(?:of|/)\\s*(\\d+)',
    chainId: '(chain-[a-zA-Z0-9_#-]+)',
    gateHeader: '\\*\\*(?:Structural \\+ Gate |Structural |Gate )?Review Required\\*\\*',
    gatesList: '\\*\\*Gates\\*\\*:\\s*(.+?)(?:\n|$)',
    structuredVerdict: '"overall"\\s*:\\s*"(PASS|FAIL)"',
    // A HARD-PAUSED blocking-unknown interrupt (`response-assembler.ts::buildInterruptSection`,
    // paused header). Matches only the paused variant: the SOFT interrupt issues the step, so a
    // consumer treating it as a hold would block a resume the server accepts.
    interruptHeader: '\\*\\*Chain Paused[^\\n*]*\\*\\*',
    // The exits that section printed. Read back rather than modelled client-side, because the
    // paused verb list is state-dependent (§PAUSED_INTERRUPT_VERBS) and a client-side copy of it
    // is what rotted twice in 2026-08.
    interruptVerbs: 'Resolve with `chain_id=[^\\n]*plus one of:\\n\\n((?:-\\s*.+\\n?)+)',
  };
  const patternsJsonContent = `${JSON.stringify(extractionPatterns, null, 2)}\n`;

  const initChanged = await writeFileIfChanged(
    path.join(HOOKS_GENERATED_DIR, '__init__.py'),
    initContent,
    checkMode
  );
  const moduleChanged = await writeFileIfChanged(
    path.join(HOOKS_GENERATED_DIR, 'resolution_verbs.py'),
    moduleContent,
    checkMode
  );
  const jsonChanged = await writeFileIfChanged(
    path.join(HOOKS_GENERATED_DIR, 'resolution-verbs.json'),
    verbsJsonContent,
    checkMode
  );
  const patternsChanged = await writeFileIfChanged(
    path.join(HOOKS_GENERATED_DIR, 'extraction-patterns.json'),
    patternsJsonContent,
    checkMode
  );
  return initChanged || moduleChanged || jsonChanged || patternsChanged;
}

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

/**
 * Pure self-test for `resolveContractPosture` — no filesystem I/O, fabricated fixtures.
 * Mirrors the `--self-test` convention used by `validate-table-contracts.ts` and
 * `validate-no-phantom-columns.ts`: prove every posture is reachable AND that a
 * well-formed-but-wrong input (missing marker, incomplete exemption) is rejected.
 */
function runSelfTest(): void {
  const failures: string[] = [];

  const baseContract: Omit<ToolContract, 'toolDescription' | 'metadata'> = {
    tool: 'fixture_tool',
    version: 1,
    summary: 'Fixture contract for resolveContractPosture self-test.',
    parameters: [
      {
        name: 'example',
        type: 'string',
        description: 'Fixture parameter.',
        status: 'working',
        compatibility: 'canonical',
      },
    ],
  };

  const withToolDescription: ToolContract = {
    ...baseContract,
    toolDescription: {
      description: 'Fixture description.',
      shortDescription: 'Fixture.',
      category: 'system',
      frameworkAware: { enabled: 'enabled', disabled: 'disabled' },
    },
  };
  if (resolveContractPosture(withToolDescription).kind !== 'tool') {
    failures.push('a contract with toolDescription was not classified as "tool"');
  }

  const resourceShape: ToolContract = {
    ...baseContract,
    metadata: { artifactKind: 'resource-shape' },
  };
  if (resolveContractPosture(resourceShape).kind !== 'resource-shape') {
    failures.push('a contract marked artifactKind: "resource-shape" was not classified as such');
  }

  const artifactLess: ToolContract = {
    ...baseContract,
    metadata: {
      artifactKind: 'none',
      artifactKindReason: 'Fixture: intentionally deprecated tool kept for historical typing.',
      closedBy: 'fixture-closure-condition',
    },
  };
  const artifactLessPosture = resolveContractPosture(artifactLess);
  if (artifactLessPosture.kind !== 'artifact-less') {
    failures.push(
      'a contract marked artifactKind: "none" with reason + closedBy was not classified as ' +
        '"artifact-less"'
    );
  }

  // The three ways a contract can fail the posture check — every one must resolve to "unmarked"
  // so `main()` fails loudly rather than silently skipping.
  const noMarkerAtAll: ToolContract = { ...baseContract };
  if (resolveContractPosture(noMarkerAtAll).kind !== 'unmarked') {
    failures.push('a contract with no toolDescription and no metadata was not rejected');
  }

  const unrecognizedArtifactKind: ToolContract = {
    ...baseContract,
    metadata: { artifactKind: 'something-else' },
  };
  if (resolveContractPosture(unrecognizedArtifactKind).kind !== 'unmarked') {
    failures.push('an unrecognized artifactKind value was not rejected');
  }

  const incompleteExemption: ToolContract = {
    ...baseContract,
    metadata: { artifactKind: 'none', artifactKindReason: 'Missing closedBy.' },
  };
  if (resolveContractPosture(incompleteExemption).kind !== 'unmarked') {
    failures.push(
      'artifactKind: "none" with no closedBy was accepted — an exemption with no exit must be ' +
        'rejected, same as the sqlite AcceptedException convention'
    );
  }

  if (failures.length > 0) {
    console.error('[generate-contracts] SELF-TEST FAILED:');
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    'generate-contracts self-test OK — classifies tool/resource-shape/artifact-less postures ' +
      'and rejects a missing marker, an unrecognized artifactKind, and an artifact-less ' +
      'exemption with no closedBy.'
  );
}

async function main(): Promise<void> {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const checkMode = process.argv.includes('--check');
  const loaded = await loadContracts();
  let changed = false;

  const postureFailures: string[] = [];
  const artifactCounts = new Map<string, number>();

  for (const { fileName, contract } of loaded) {
    const posture = resolveContractPosture(contract);

    if (posture.kind === 'unmarked') {
      postureFailures.push(
        `${fileName} (tool: "${contract.tool}") has no toolDescription and no valid ` +
          `metadata.artifactKind marker. Declare metadata.artifactKind: "resource-shape" for a ` +
          `value-shape contract, or metadata.artifactKind: "none" with both ` +
          `metadata.artifactKindReason and metadata.closedBy for a deliberately artifact-less ` +
          `contract.`
      );
      continue;
    }

    if (posture.kind === 'artifact-less') {
      console.log(
        `[generate-contracts] Skipping ${contract.tool} (artifactKind: none — ${posture.reason}; ` +
          `closedBy: ${posture.closedBy})`
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
      '  resolvesPendingRun?: boolean; // True when supplying this param resolves a run pending a review (failed gate or unknown interrupt)',
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
    artifactCounts.set(contract.tool, (artifactCounts.get(contract.tool) ?? 0) + 1);
  }

  // Every contract with a recognized, non-exempt posture must yield >=1 generated artifact
  // (this is the validate:contracts gate for P6-F15). The write above already guarantees this
  // structurally today; asserted explicitly so a future refactor that makes the write
  // conditional can't silently reopen the same shape of bug under a different code path.
  for (const { fileName, contract } of loaded) {
    const posture = resolveContractPosture(contract);
    if (posture.kind !== 'tool' && posture.kind !== 'resource-shape') continue;
    if ((artifactCounts.get(contract.tool) ?? 0) < 1) {
      postureFailures.push(
        `${fileName} (tool: "${contract.tool}") has posture "${posture.kind}" but produced zero ` +
          `generated artifacts.`
      );
    }
  }

  if (postureFailures.length > 0) {
    throw new Error(
      `[generate-contracts] ${postureFailures.length} contract(s) failed the artifact-posture ` +
        `check:\n${postureFailures.map((message) => `  - ${message}`).join('\n')}`
    );
  }

  // Generate unified tool-descriptions.contracts.json (SSOT for ToolDescriptionManager)
  const toolDescriptionsPath = path.join(GENERATED_META_DIR, 'tool-descriptions.contracts.json');
  const existingToolDescriptions = await readJsonIfExists(toolDescriptionsPath);
  const toolDescriptionsDraft = generateToolDescriptions(
    loaded.map(({ contract }) => contract),
    {
      version: existingToolDescriptions?.version,
      generatedFrom: existingToolDescriptions?.generatedFrom,
    }
  );
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

  const resolutionVerbsChanged = await generateResolutionVerbs(loaded, checkMode);
  changed = changed || resolutionVerbsChanged;
  if (resolutionVerbsChanged) {
    console.log(
      '[generate-contracts] Generated hooks/lib/_generated/resolution_verbs.py + resolution-verbs.json'
    );
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
