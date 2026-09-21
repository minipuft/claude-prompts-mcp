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

import {
  describeUnresolvedChainStep,
  resolveChainSteps,
} from '../src/modules/prompts/chain-step-resolution.js';
import { normalizeInlineGateDefinitions } from '../src/modules/prompts/yaml-prompt-loader.js';
import { validatePromptYaml } from '../src/modules/prompts/prompt-schema.js';
import {
  isExcludedCategoryDirectoryName,
  isIgnoredPromptEntryName,
  isReservedPromptDirectoryName,
} from '../src/shared/utils/prompt-layout.js';
import { isCanonicalPromptId, isKebabId } from '../src/shared/utils/resource-ids.js';
import type { Logger } from '../src/shared/types/index.js';

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
  kind: 'schema' | 'gate' | 'convention' | 'orphan' | 'chain';
  detail: string;
}

/**
 * One deferred convention exemption.
 *
 * `scope: 'personal-library'` DECLARES that the id lives only outside the scanned root — a real
 * fact about where the resource is, not something `findStaleExceptions` should have to infer from
 * absence. Without it, an id absent from the root reads exactly like a tracked id that was renamed
 * away, and neither is ever retired: absence is evidence for both, so an inferring check has to
 * treat them the same.
 */
interface ConventionException {
  reason: string;
  scope?: 'personal-library';
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
const CONVENTION_EXCEPTIONS = new Map<string, ConventionException>([
  [
    'general/diagnosisCard',
    {
      reason: 'P5.12 — renamed to diagnosis_card where it lives',
      scope: 'personal-library',
    },
  ],
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

/**
 * An exemption whose prompt is gone, or now satisfies the convention, is a finding.
 *
 * `root` and `exceptions` are explicit rather than read off the module-level `ROOT` and
 * `CONVENTION_EXCEPTIONS` so a self-test can drive this against a fixture root and a fixture
 * exception map instead of the live ones.
 */
function findStaleExceptions(
  files: string[],
  root: string,
  exceptions: ReadonlyMap<string, ConventionException>
): string[] {
  const live = new Set(
    files.map((f) => `${relative(root, f).split(/[/\\]/)[0] ?? ''}/${basename(dirname(f))}`)
  );
  return [...exceptions.entries()]
    .filter(([key, exception]) => {
      const isLive = live.has(key);
      if (exception.scope === 'personal-library') {
        // Declared to live only outside this root. Absence here is exactly what the declaration
        // predicts, so the exemption still applies. Presence contradicts it — the id is tracked
        // here too, so the exemption needs a real fix rather than a declaration nobody re-checks.
        return isLive;
      }
      if (!isLive) return true; // no scope declared and absent from the root: a renamed-away tracked id
      const id = key.split('/')[1] ?? '';
      return isCanonicalPromptId(id);
    })
    .map(([key]) => key);
}

/**
 * Every `prompt.yaml` beneath the root that the loader would serve, at any depth — nested chain
 * steps live deeper.
 *
 * The skips are the loader's, read from `prompt-layout.ts` rather than restated. Without them this
 * walk schema-checked files nothing serves: a `prompt.yaml` under a prompt's reserved `tools/`, or
 * anywhere below `_drafts/` or a root-level `backup/`, could fail CI as a prompt no MCP surface
 * ever answers. At the root the loader's category rule decides; `tools` is reserved only BELOW the
 * root — at the root it is an ordinary category, which the loader serves.
 */
function findPromptFiles(dir: string, found: string[] = [], depth = 0): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (isIgnoredPromptEntryName(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const skipped =
        depth === 0
          ? isExcludedCategoryDirectoryName(entry.name)
          : isReservedPromptDirectoryName(entry.name);
      if (skipped) continue;
      findPromptFiles(full, found, depth + 1);
    } else if (entry.name === 'prompt.yaml') found.push(full);
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
  // `normalizeInlineGateDefinitions` only ever calls `logger.warn`
  // (yaml-prompt-loader.ts `warnInlineGateDropped`), but `InlineGateSource.logger` is typed
  // as the full `Logger` interface — these are real no-ops, not a cast around a partial shape.
  const logger: Logger = {
    info: () => {},
    error: () => {},
    debug: () => {},
    warn: (message: string) => {
      reasons.push(message.replace('[PromptLoader] ', ''));
    },
  };
  normalizeInlineGateDefinitions(declared, { logger });
  return reasons;
}

/**
 * The id the REGISTRY will serve this file under.
 *
 * `loadYamlPrompt` derives it from the path relative to the CATEGORY root, so a top-level prompt
 * is `id` and a nested chain step is `parent/step` — which is the form `chainSteps[].promptId`
 * uses. Deriving it here rather than reading the file's own `id:` key is what makes this check
 * agree with the server: a scaffolded step's `id:` is the bare step name and the loader overrides
 * it with the path-derived one.
 */
function registeredIdOf(file: string, root: string): string {
  const segments = relative(root, dirname(file)).split(/[/\\]/);
  return segments.slice(1).join('/');
}

/**
 * Every chain step under this root that names a prompt the root does not contain.
 *
 * The LOAD posture (`resolution !== 'resolved'`): nothing is being written, so the
 * `<chainId>/<step>` shape a `resource_manager` write would scaffold is, here, simply a directory
 * that is not on disk. R4 scopes this to ONE root — an overlay chain referencing a bundled prompt
 * is checked at load, where both roots are visible, not in CI, where they are not.
 */
function findChainProblems(files: string[], root: string): Problem[] {
  const registeredIds = new Set(files.map((file) => registeredIdOf(file, root)));
  const problems: Problem[] = [];

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = yaml.load(readFileSync(file, 'utf8'));
    } catch {
      continue; // Already reported as a schema problem by `validateFile`.
    }
    const steps = (parsed as { chainSteps?: unknown })?.chainSteps;
    if (!Array.isArray(steps) || steps.length === 0) {
      continue;
    }
    for (const reference of resolveChainSteps(steps, registeredIdOf(file, root), registeredIds)) {
      if (reference.resolution !== 'resolved') {
        problems.push({
          file: relative(root, file),
          kind: 'chain',
          detail: `chain '${registeredIdOf(file, root)}' ${describeUnresolvedChainStep(reference)}`,
        });
      }
    }
  }

  return problems;
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

interface GateYamlMinimal {
  id?: string;
  activation?: unknown;
}

/** `gate.yaml` files one level under `dir` (`<gatesRoot>/<id>/gate.yaml`). */
function findGateFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const gateFile = join(dir, entry.name, 'gate.yaml');
    if (existsSync(gateFile)) found.push(gateFile);
  }
  return found;
}

/**
 * Every gate id a prompt reaches for by reference rather than defining inline — the two surfaces
 * `resolveActiveGateRefs` (skills-sync/service.ts) registers ahead of auto-activation: a prompt's
 * `gateConfiguration.include`, and a chain step's `inlineGateIds` (flattened to prompt level, same
 * as that resolver's rank 1b). `gateConfiguration.inline` is NOT in this set — it carries free-text
 * criteria strings for `inline-N` gate refs, never gate ids (confirmed against its one reader,
 * `resolveActiveGateRefs` rank 4). `inline_gate_definitions` defines new gates rather than
 * including existing ones, so it is out of scope for an ORPHAN check.
 */
function collectIncludedGateIds(promptFiles: string[]): Set<string> {
  const included = new Set<string>();
  for (const file of promptFiles) {
    let parsed: unknown;
    try {
      parsed = yaml.load(readFileSync(file, 'utf8'));
    } catch {
      continue; // unparseable YAML is already reported as a schema problem
    }
    // `parsed` is `null` for a document containing only `null`/`~` — coalesce to `{}` before the
    // cast (findDroppedGates's `?.`-after-cast idiom, applied once for both fields below instead
    // of twice) so neither property read below dereferences a null document.
    const doc = (parsed ?? {}) as {
      gateConfiguration?: { include?: unknown };
      chainSteps?: unknown;
    };

    // YAML gives no guarantee `include` is an array — a mapping or scalar here is already
    // reported as a schema problem by `validateFile`; skip it rather than throw.
    const include = doc.gateConfiguration?.include;
    if (Array.isArray(include)) {
      for (const id of include) {
        if (typeof id === 'string') included.add(id);
      }
    }

    // Same guarantee gap for `chainSteps`, and for each step in turn — a step that is `null` or
    // a scalar is likewise the schema validator's concern, not this one.
    const steps = doc.chainSteps;
    if (Array.isArray(steps)) {
      for (const step of steps) {
        if (typeof step !== 'object' || step === null) continue;
        const inlineGateIds = (step as { inlineGateIds?: unknown }).inlineGateIds;
        if (Array.isArray(inlineGateIds)) {
          for (const id of inlineGateIds) {
            if (typeof id === 'string') included.add(id);
          }
        }
      }
    }
  }
  return included;
}

/**
 * A gate declaring no `activation` block only ever attaches through an explicit include (row A.2's
 * sibling ruling A1 — a gate with no `activation` is opt-in, not always-active). If no prompt or
 * chain step includes it, it never attaches and nothing notices: the process still exits 0, same
 * silent-drop shape as the dropped-gate check above.
 */
function findOrphanGates(root: string, promptFiles: string[]): Problem[] {
  const gatesRoot = join(dirname(root), 'gates');
  const gateFiles = findGateFiles(gatesRoot);
  if (gateFiles.length === 0) return [];

  const included = collectIncludedGateIds(promptFiles);
  const problems: Problem[] = [];

  for (const file of gateFiles) {
    const rel = relative(root, file);
    let parsed: unknown;
    try {
      parsed = yaml.load(readFileSync(file, 'utf8'));
    } catch {
      continue; // malformed gate YAML is a different gate's concern
    }
    // A gate.yaml that parses to `null` (content `null`/`~`) or to a non-mapping is nobody else's
    // concern: `validate:gate-index` (generate-gate-index.js) reads every gate.yaml too, but it
    // CRASHES on the same shape rather than reporting it (`classifyGate`'s `gate.id.startsWith`
    // on the `undefined` a null-spread produces, verified 2026-09-15) — so this is the only reader
    // that can report it, and it does, rather than skipping.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      problems.push({ file: rel, kind: 'schema', detail: 'gate.yaml is empty or not a mapping' });
      continue;
    }
    const gate = parsed as GateYamlMinimal;
    if (gate.activation !== undefined) continue; // opt-in on its own terms
    const id = gate.id ?? basename(dirname(file));
    if (included.has(id)) continue;
    problems.push({
      file: rel,
      kind: 'orphan',
      detail:
        `gate '${id}' declares no activation and is included by no prompt or chain step — ` +
        `add an activation block, or include it via gateConfiguration.include / a chain step's inlineGateIds`,
    });
  }
  return problems;
}

function run(root: string): Problem[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`validate:prompts — no such directory: ${root}`);
    process.exit(2);
  }
  const promptFiles = findPromptFiles(root);
  return [
    ...promptFiles.flatMap(validateFile),
    ...findOrphanGates(root, promptFiles),
    ...findChainProblems(promptFiles, root),
  ];
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
  // The chain arm. `good/ok_chain` names a step that EXISTS under this root, `bad/broken_chain`
  // names one that does not — both are chains, so a validator that simply ignored `chainSteps`
  // would fail the second assertion, and one that reported every chain would fail the first.
  write(
    'good/ok_chain',
    [
      'id: ok_chain',
      'name: OK Chain',
      'category: good',
      'description: A chain whose only step is a prompt this root contains.',
      'userMessageTemplateFile: user-message.md',
      'chainSteps:',
      '  - promptId: ok_prompt',
      '    stepName: Step One',
      '',
    ].join('\n')
  );
  write(
    'bad/broken_chain',
    [
      'id: broken_chain',
      'name: Broken Chain',
      'category: bad',
      'description: A chain naming a prompt that does not exist under this root.',
      'userMessageTemplateFile: user-message.md',
      'chainSteps:',
      '  - promptId: ok_prompt',
      '    stepName: Step One',
      '  - promptId: no_such_prompt',
      '    stepName: Step Two',
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

  const files = findPromptFiles(dir);
  const found = [
    ...files.flatMap((file) => {
      const rel = relative(dir, file);
      const parsed = yaml.load(readFileSync(file, 'utf8'));
      const schema = validatePromptYaml(parsed, basename(dirname(file)));
      const gates = findDroppedGates(parsed);
      return [
        ...(schema.valid ? [] : [{ file: rel, kind: 'schema' as const, detail: 'invalid' }]),
        ...gates.map((detail) => ({ file: rel, kind: 'gate' as const, detail })),
      ];
    }),
    ...findChainProblems(files, dir),
  ];
  rmSync(dir, { recursive: true, force: true });

  const clean = found.filter((p) => p.file.startsWith('good'));
  const schemaCaught = found.some((p) => p.file.includes('no_description') && p.kind === 'schema');
  const gateCaught = found.some((p) => p.file.includes('dropped_gate') && p.kind === 'gate');
  const chainCaught = found.some(
    (p) =>
      p.file.includes('broken_chain') &&
      p.kind === 'chain' &&
      p.detail.includes("step 2 references unknown promptId 'no_such_prompt'")
  );

  const failures: string[] = [];
  if (clean.length > 0) failures.push(`a valid prompt was reported: ${JSON.stringify(clean)}`);
  if (!schemaCaught) failures.push('an empty description was NOT reported');
  if (!gateCaught) failures.push('a gate missing `guidance` was NOT reported');
  if (!chainCaught) failures.push('a chain step naming no prompt was NOT reported by position');

  // Orphan-gate fixtures — a real `resources/{prompts,gates}` layout (`findOrphanGates` derives
  // `gatesRoot` as `dirname(root)/gates`), one gate per activation/inclusion combination: a gate
  // WITH `activation` (never flagged, opt-in on its own terms), one opt-in gate included via
  // `gateConfiguration.include`, one opt-in gate included only via a chain step's `inlineGateIds`,
  // and one opt-in gate included nowhere (must be the one flagged).
  const gateDir = mkdtempSync(join(tmpdir(), 'validate-prompts-gate-selftest-'));
  const promptsRoot = join(gateDir, 'resources', 'prompts');
  const gatesRoot = join(gateDir, 'resources', 'gates');
  const writeGate = (id: string, body: string): void => {
    mkdirSync(join(gatesRoot, id), { recursive: true });
    writeFileSync(join(gatesRoot, id, 'gate.yaml'), body, 'utf8');
  };
  const writePrompt = (name: string, body: string): void => {
    mkdirSync(join(promptsRoot, name), { recursive: true });
    writeFileSync(join(promptsRoot, name, 'prompt.yaml'), body, 'utf8');
  };

  writeGate(
    'has-activation',
    [
      'id: has-activation',
      'name: Has Activation',
      'description: always active',
      'activation:',
      '  prompt_categories:',
      '    - general',
      '',
    ].join('\n')
  );
  writeGate(
    'included-via-config',
    [
      'id: included-via-config',
      'name: Included Via Config',
      'description: opt-in, included by a prompt',
      '',
    ].join('\n')
  );
  writeGate(
    'included-via-chain-step',
    [
      'id: included-via-chain-step',
      'name: Included Via Chain Step',
      'description: opt-in, included by a chain step',
      '',
    ].join('\n')
  );
  writeGate(
    'orphan-gate',
    ['id: orphan-gate', 'name: Orphan Gate', 'description: opt-in and included nowhere', ''].join(
      '\n'
    )
  );
  writePrompt(
    'general/includer',
    [
      'id: includer',
      'name: Includer',
      'category: general',
      'description: Includes one gate explicitly and one via a chain step.',
      'userMessageTemplateFile: user-message.md',
      'gateConfiguration:',
      '  include:',
      '    - included-via-config',
      'chainSteps:',
      '  - stepName: Step One',
      '    promptId: includer',
      '    inlineGateIds:',
      '      - included-via-chain-step',
      '',
    ].join('\n')
  );
  // `gateConfiguration.include` as a mapping rather than a list — YAML gives no guarantee of
  // shape, and this is already reported elsewhere as a schema error; the orphan check must skip
  // it, not throw.
  writePrompt(
    'general/malformed_include',
    [
      'id: malformed_include',
      'name: Malformed Include',
      'category: general',
      'description: gateConfiguration.include is a mapping, not an array.',
      'userMessageTemplateFile: user-message.md',
      'gateConfiguration:',
      '  include:',
      '    not: an-array',
      '',
    ].join('\n')
  );
  // A whole prompt document that is `null` (content `null`/`~`) — `collectIncludedGateIds` must
  // not dereference `gateConfiguration`/`chainSteps` off it.
  writePrompt('general/null_document', 'null\n');
  // A whole gate document that is `null` — nothing else in `validate:all` reports this shape
  // (`validate:gate-index` crashes on it instead, see `findOrphanGates`), so it must be reported
  // here as a schema problem rather than skipped.
  writeGate('null-document', 'null\n');

  let orphanFound: Problem[] = [];
  try {
    orphanFound = findOrphanGates(promptsRoot, findPromptFiles(promptsRoot));
  } catch (error) {
    failures.push(`findOrphanGates threw: ${String(error)}`);
  }
  rmSync(gateDir, { recursive: true, force: true });

  const flaggedNullGate = orphanFound.some(
    (p) =>
      p.file.includes('null-document') &&
      p.kind === 'schema' &&
      p.detail === 'gate.yaml is empty or not a mapping'
  );
  if (!flaggedNullGate)
    failures.push('a gate.yaml that parses to null was NOT reported as a schema problem');

  const flaggedOrphan = orphanFound.some((p) => p.file.includes('orphan-gate'));
  const flaggedIncludedViaConfig = orphanFound.some((p) => p.file.includes('included-via-config'));
  const flaggedIncludedViaChainStep = orphanFound.some((p) =>
    p.file.includes('included-via-chain-step')
  );
  const flaggedHasActivation = orphanFound.some((p) => p.file.includes('has-activation'));

  if (!flaggedOrphan)
    failures.push('a gate with no activation and no includer was NOT reported as orphan');
  if (flaggedIncludedViaConfig)
    failures.push('a gate included via gateConfiguration.include was wrongly reported as orphan');
  if (flaggedIncludedViaChainStep)
    failures.push(
      "a gate included via a chain step's inlineGateIds was wrongly reported as orphan"
    );
  if (flaggedHasActivation)
    failures.push('a gate declaring its own activation block was wrongly reported as orphan');

  // Walk fixtures — every skipped path has a TWIN the walk must still find, differing only in the
  // identifier the skip keys on, so "nothing under tools/" cannot pass on a walk that found nothing:
  //   tools/leaf                  vs general/tools/leaf       — `tools` at depth 0 vs depth 1
  //   general/host/helpers/leaf   vs general/host/tools/leaf  — reserved name at depth 2
  //   general/drafts/leaf         vs general/_drafts/leaf     — `_` prefix on a directory
  //   backups/leaf                vs backup/leaf              — an excluded category name
  //   node_module/leaf            vs node_modules/leaf        — the other excluded category name
  //   general/backup/leaf         vs backup/leaf              — excluded at the root only
  const walkDir = mkdtempSync(join(tmpdir(), 'validate-prompts-walk-selftest-'));
  const walkWalked = [
    'tools/leaf',
    'general/host',
    'general/host/helpers/leaf',
    'general/drafts/leaf',
    'backups/leaf',
    'node_module/leaf',
    'general/backup/leaf',
  ];
  const walkSkipped = [
    'general/tools/leaf',
    'general/host/tools/leaf',
    'general/_drafts/leaf',
    'backup/leaf',
    'node_modules/leaf',
  ];
  for (const rel of [...walkWalked, ...walkSkipped]) {
    mkdirSync(join(walkDir, rel), { recursive: true });
    writeFileSync(join(walkDir, rel, 'prompt.yaml'), 'id: leaf\n', 'utf8');
  }
  const walked = findPromptFiles(walkDir)
    .map((file) => relative(walkDir, dirname(file)).split(/[/\\]/).join('/'))
    .sort();
  rmSync(walkDir, { recursive: true, force: true });
  const expectedWalk = [...walkWalked].sort();
  if (JSON.stringify(walked) !== JSON.stringify(expectedWalk))
    failures.push(
      `the prompt walk disagreed with the loader: expected ${JSON.stringify(expectedWalk)}, ` +
        `walked ${JSON.stringify(walked)}`
    );

  // Stale-exception fixtures — a declared `scope: 'personal-library'` id must read as NOT stale
  // while absent (the declaration's normal state) and AS stale once it turns up in this root (the
  // declaration is now false); an undeclared id absent from the root is a renamed-away tracked id
  // and must read as stale regardless.
  const exceptionsDir = mkdtempSync(join(tmpdir(), 'validate-prompts-exceptions-selftest-'));
  mkdirSync(join(exceptionsDir, 'general', 'personal-present'), { recursive: true });
  writeFileSync(
    join(exceptionsDir, 'general', 'personal-present', 'prompt.yaml'),
    'id: personal-present\n',
    'utf8'
  );
  const exceptionFixtures = new Map<string, ConventionException>([
    ['legacy/removedPrompt', { reason: 'fixture: renamed-away tracked id, no scope declared' }],
    [
      'general/personalOnly',
      { reason: 'fixture: declared personal-library id, absent here', scope: 'personal-library' },
    ],
    [
      'general/personal-present',
      { reason: 'fixture: declared personal-library id, present here', scope: 'personal-library' },
    ],
  ]);
  const exceptionFiles = findPromptFiles(exceptionsDir);
  const staleFound = findStaleExceptions(exceptionFiles, exceptionsDir, exceptionFixtures);
  rmSync(exceptionsDir, { recursive: true, force: true });

  if (!staleFound.includes('legacy/removedPrompt'))
    failures.push(
      'a renamed-away tracked id (no scope, absent from root) was NOT reported as stale'
    );
  if (staleFound.includes('general/personalOnly'))
    failures.push(
      'a declared personal-library id absent from the root was wrongly reported as stale'
    );
  if (!staleFound.includes('general/personal-present'))
    failures.push('a declared personal-library id present in the root was NOT reported as stale');

  if (failures.length > 0) {
    console.error(
      `validate:prompts --self-test FAILED\n${failures.map((f) => `  - ${f}`).join('\n')}`
    );
    process.exit(1);
  }
  console.log(
    'validate:prompts --self-test OK — accepts a valid prompt and a resolvable chain, catches ' +
      'an invalid schema, a dropped gate and an unresolvable chain step, ' +
      'flags an orphan gate without false-positiving on activation/include/inlineGateIds, ' +
      'walks only the prompt directories the loader serves, and tells a declared ' +
      'personal-library exemption apart from a renamed-away tracked one'
  );
  process.exit(0);
}

const problems = run(ROOT);
const promptFiles = findPromptFiles(ROOT);
const files = promptFiles.length;

const stale = findStaleExceptions(promptFiles, ROOT, CONVENTION_EXCEPTIONS);
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

const LABELS: Record<Problem['kind'], string> = {
  schema: 'INVALID',
  gate: 'GATE   ',
  convention: 'CONVENT',
  orphan: 'ORPHAN ',
  chain: 'CHAIN  ',
};

const schemaProblems = problems.filter((p) => p.kind === 'schema');
const gateProblems = problems.filter((p) => p.kind === 'gate');
const conventionProblems = problems.filter((p) => p.kind === 'convention');
const orphanProblems = problems.filter((p) => p.kind === 'orphan');
const chainProblems = problems.filter((p) => p.kind === 'chain');

console.error(
  `validate:prompts FAILED — ${schemaProblems.length} schema error(s), ` +
    `${gateProblems.length} silently dropped gate(s), ${conventionProblems.length} ` +
    `convention violation(s), ${orphanProblems.length} orphan gate(s) and ` +
    `${chainProblems.length} unresolvable chain step(s) across ` +
    `${files} prompt(s) under ${ROOT}\n`
);
for (const problem of problems) {
  console.error(`  ${LABELS[problem.kind]}  ${problem.file}`);
  console.error(`            ${problem.detail}`);
}
console.error(
  '\nA prompt with a schema error is DROPPED at load, a dropped gate never runs, an orphan gate ' +
    'never attaches, and a chain step naming no prompt fails only when the run reaches it — all ' +
    'four are silent at startup. Fix the file, or the server will keep starting "successfully" ' +
    'without it.'
);
process.exit(1);
