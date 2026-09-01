#!/usr/bin/env tsx
/**
 * Prompt YAML Validator — the gate prompts never had.
 *
 * WHY THIS EXISTS
 * `validate:frameworks` has validated framework YAML against the loader's own schema since the
 * frameworks shipped. Prompts had no equivalent, so a prompt that fails schema validation is
 * DROPPED at load with a single `[ERROR] [PromptLoader] Invalid YAML` line in a log file, and a
 * malformed inline gate is dropped with a `[WARN] ... The gate will not load` line. Both read as a
 * healthy start: the process exits 0, the served count is simply lower, and nothing compares it to
 * what is on disk.
 *
 * That is not hypothetical. Measured 2026-08-30 across the bundled tree and one personal library:
 * three prompts failed schema validation and eight inline gate definitions were dropped across six
 * prompts. One of those six — `knowledge-capture/practice_capture` — is a TRACKED file in this
 * repository, carrying two gates that had never loaded, past every gate in `validate:all` and
 * every CI run.
 *
 * WHY IT TAKES A ROOT
 * The defects that motivated it mostly live OUTSIDE this repo: a personal prompt library reached
 * through `MCP_RESOURCES_PATH` is where most authoring happens, and no CI can ever see it. A gate
 * that could only check the bundled tree would have caught 2 of 11. Pointing it at a root is what
 * makes it usable by the person who can actually fix the other 9:
 *
 *   npm run validate:prompts                      # the bundled tree (what CI runs)
 *   npm run validate:prompts -- --root ~/.claude/resources/prompts
 *
 * A DROPPED GATE IS A FAILURE, NOT A WARNING
 * The prompt still loads without it, so nothing downstream complains — which is exactly why it
 * survived. An author who wrote a gate and got no gate has a silently broken prompt.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

import { normalizeInlineGateDefinitions } from '../src/modules/prompts/yaml-prompt-loader.js';
import { validatePromptYaml } from '../src/modules/prompts/prompt-schema.js';
import { isCanonicalPromptId, isKebabId } from '../src/shared/utils/resource-ids.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(__dirname, '..', 'resources', 'prompts');

const args = process.argv.slice(2);
const SELF_TEST = args.includes('--self-test');
const rootFlag = args.indexOf('--root');
const ROOT =
  rootFlag >= 0 && args[rootFlag + 1] !== undefined
    ? (args[rootFlag + 1] as string)
    : (process.env['VALIDATE_PROMPTS_ROOT'] ?? DEFAULT_ROOT);

interface Problem {
  file: string;
  kind: 'schema' | 'gate' | 'convention';
  detail: string;
}

/**
 * Ids that violate the convention and are deferred, not accepted.
 *
 * Keyed by `<category>/<id>` so an exemption covers one prompt, never a shape — exempting
 * "camelCase ids" would let the next one in silently. Each entry names the plan row that retires
 * it. `findStaleExceptions` below fails when an entry stops being needed, so a rename that lands
 * without deleting its exemption is itself a finding: an exception list nobody prunes becomes a
 * list of things that used to be true.
 */
const CONVENTION_EXCEPTIONS = new Map<string, string>([
  [
    'development/strategicImplement',
    'P5.12 — rename deferred; ~252 references across 4 repositories and a global skill name',
  ],
  ['general/diagnosisCard', 'P5.12 — same arc as strategicImplement'],
]);

/**
 * The convention, enforced. `shared/utils/resource-ids.ts` owns the patterns and the rationale;
 * this reads them rather than restating them, so the gate cannot drift from the rule it checks.
 */
function findConventionProblems(file: string, rel: string): Problem[] {
  const id = basename(dirname(file));
  const category = rel.split(/[/\\]/)[0] ?? '';
  const key = `${category}/${id}`;
  const problems: Problem[] = [];

  if (!CONVENTION_EXCEPTIONS.has(key)) {
    if (!isCanonicalPromptId(id)) {
      problems.push({
        file: rel,
        kind: 'convention',
        detail: `prompt id '${id}' is not snake_case — ids in the >> / --> command grammar are snake_case`,
      });
    }
    if (category !== '' && !isKebabId(category)) {
      problems.push({
        file: rel,
        kind: 'convention',
        detail: `category '${category}' is not kebab-case — every id outside the command grammar is kebab-case`,
      });
    }
  }

  return problems;
}

/** An exemption whose prompt is gone, or now satisfies the convention, is a finding. */
function findStaleExceptions(files: string[]): string[] {
  const live = new Set(
    files.map((f) => `${relative(ROOT, f).split(/[/\\]/)[0] ?? ''}/${basename(dirname(f))}`)
  );
  return [...CONVENTION_EXCEPTIONS.keys()].filter((key) => {
    if (!live.has(key)) return false; // not in THIS root — a personal-library id checked from the package tree
    const id = key.split('/')[1] ?? '';
    return isCanonicalPromptId(id);
  });
}

/** Every `prompt.yaml` beneath the root, at any depth — nested chain steps live deeper. */
function findPromptFiles(dir: string, found: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findPromptFiles(full, found);
    else if (entry.name === 'prompt.yaml') found.push(full);
  }
  return found;
}

/**
 * Collect the gate names the loader would drop.
 *
 * Runs the loader's OWN normalizer rather than reimplementing its rules, so this cannot drift into
 * accepting something the server rejects. The count of survivors against the count declared is the
 * signal; the normalizer reports the reasons only through a logger, so a shim captures them.
 */
function findDroppedGates(parsed: unknown): string[] {
  const config = (parsed as { gateConfiguration?: { inline_gate_definitions?: unknown } })
    ?.gateConfiguration;
  const declared = config?.inline_gate_definitions;
  if (!Array.isArray(declared) || declared.length === 0) return [];

  const reasons: string[] = [];
  normalizeInlineGateDefinitions(declared, {
    logger: {
      warn: (message: string) => reasons.push(message.replace('[PromptLoader] ', '')),
    },
  } as Parameters<typeof normalizeInlineGateDefinitions>[1]);
  return reasons;
}

function validateFile(file: string): Problem[] {
  const problems: Problem[] = [];
  const rel = relative(ROOT, file);

  let parsed: unknown;
  try {
    parsed = yaml.load(readFileSync(file, 'utf8'));
  } catch (error) {
    return [{ file: rel, kind: 'schema', detail: `unparseable YAML: ${String(error)}` }];
  }

  // `basename(dirname(file))` is the id the LOADER validates against — it derives the served id
  // from the path and rejects a file whose `id:` disagrees. Omitting it here would accept a prompt
  // the server then drops, which is the exact gap this script exists to close.
  const result = validatePromptYaml(parsed, basename(dirname(file)));
  if (!result.valid) {
    for (const issue of result.errors) {
      problems.push({ file: rel, kind: 'schema', detail: issue });
    }
  }

  for (const reason of findDroppedGates(parsed)) {
    problems.push({ file: rel, kind: 'gate', detail: reason });
  }

  problems.push(...findConventionProblems(file, rel));

  return problems;
}

function run(root: string): Problem[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`validate:prompts — no such directory: ${root}`);
    process.exit(2);
  }
  return findPromptFiles(root).flatMap(validateFile);
}

// A self-test that only proved the validator ACCEPTS the bundled tree would pass against a
// validator that accepts everything — the failure mode this file exists to catch. It asserts both
// directions against fixtures written to a temp dir.
if (SELF_TEST) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const dir = mkdtempSync(join(tmpdir(), 'validate-prompts-selftest-'));
  const write = (name: string, body: string): void => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'prompt.yaml'), body, 'utf8');
  };

  write(
    'good/ok_prompt',
    [
      'id: ok_prompt',
      'name: OK Prompt',
      'category: good',
      'description: A prompt that should validate cleanly.',
      'userMessageTemplateFile: user-message.md',
      '',
    ].join('\n')
  );
  write(
    'bad/no_description',
    [
      'id: no_description',
      'name: No Description',
      'category: bad',
      "description: ''",
      'userMessageTemplateFile: user-message.md',
      '',
    ].join('\n')
  );
  write(
    'bad/dropped_gate',
    [
      'id: dropped_gate',
      'name: Dropped Gate',
      'category: bad',
      'description: Declares a gate the loader silently discards.',
      'userMessageTemplateFile: user-message.md',
      'gateConfiguration:',
      '  inline_gate_definitions:',
      '    - name: Missing Guidance',
      '      type: validation',
      '      scope: step',
      '      description: Has no guidance field, so the loader drops it.',
      '',
    ].join('\n')
  );

  const found = findPromptFiles(dir).flatMap((file) => {
    const rel = relative(dir, file);
    const parsed = yaml.load(readFileSync(file, 'utf8'));
    const schema = validatePromptYaml(parsed, basename(dirname(file)));
    const gates = findDroppedGates(parsed);
    return [
      ...(schema.valid ? [] : [{ file: rel, kind: 'schema' as const, detail: 'invalid' }]),
      ...gates.map((detail) => ({ file: rel, kind: 'gate' as const, detail })),
    ];
  });
  rmSync(dir, { recursive: true, force: true });

  const clean = found.filter((p) => p.file.startsWith('good'));
  const schemaCaught = found.some((p) => p.file.includes('no_description') && p.kind === 'schema');
  const gateCaught = found.some((p) => p.file.includes('dropped_gate') && p.kind === 'gate');

  const failures: string[] = [];
  if (clean.length > 0) failures.push(`a valid prompt was reported: ${JSON.stringify(clean)}`);
  if (!schemaCaught) failures.push('an empty description was NOT reported');
  if (!gateCaught) failures.push('a gate missing `guidance` was NOT reported');

  if (failures.length > 0) {
    console.error(
      `validate:prompts --self-test FAILED\n${failures.map((f) => `  - ${f}`).join('\n')}`
    );
    process.exit(1);
  }
  console.log(
    'validate:prompts --self-test OK — accepts a valid prompt, catches both defect kinds'
  );
  process.exit(0);
}

const problems = run(ROOT);
const promptFiles = findPromptFiles(ROOT);
const files = promptFiles.length;

const stale = findStaleExceptions(promptFiles);
if (stale.length > 0) {
  console.error(
    'validate:prompts FAILED — convention exemption(s) no longer needed; delete them:\n' +
      stale.map((key) => `  - ${key}`).join('\n')
  );
  process.exit(1);
}

if (problems.length === 0) {
  console.log(
    `validate:prompts OK — ${files} prompt(s) under ${ROOT}, none dropped at load, ` +
      `${CONVENTION_EXCEPTIONS.size} deferred convention exemption(s)`
  );
  process.exit(0);
}

const schemaProblems = problems.filter((p) => p.kind === 'schema');
const gateProblems = problems.filter((p) => p.kind === 'gate');
const conventionProblems = problems.filter((p) => p.kind === 'convention');

console.error(
  `validate:prompts FAILED — ${schemaProblems.length} schema error(s), ` +
    `${gateProblems.length} silently dropped gate(s) and ${conventionProblems.length} ` +
    `convention violation(s) across ${files} prompt(s) under ${ROOT}\n`
);
for (const problem of problems) {
  const label =
    problem.kind === 'schema' ? 'INVALID' : problem.kind === 'gate' ? 'GATE   ' : 'CONVENT';
  console.error(`  ${label}  ${problem.file}`);
  console.error(`            ${problem.detail}`);
}
console.error(
  '\nA prompt with a schema error is DROPPED at load and a dropped gate never runs — both are ' +
    'silent at runtime. Fix the file, or the server will keep starting "successfully" without it.'
);
process.exit(1);
