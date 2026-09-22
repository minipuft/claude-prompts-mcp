// @lifecycle canonical - One refusal, three tools: an argument key no contract declares.
/**
 * An argument key a tool does not declare is a security property, not a tidiness one.
 *
 * All three tools used to answer a call carrying an undeclared key with SUCCESS. Zod strips an
 * unknown key before the registered callback runs, so the key never reached a handler and nothing
 * said so — measured 2026-09-20 over both transports on `f711401b`:
 *
 *   prompt_engine  {command:">>listprompts", force_restrt:true}  → prompt list, isError:false
 *   prompt_engine  {command:">>listprompts", dry_run:true}       → prompt list, isError:false
 *   system_control {action:"status", previw:true}                → status, isError:false
 *
 * The cost is not a dropped convenience flag. A caller — or a model reading a prompt-injected
 * instruction — that sends a SAFETY flag under a slightly wrong name gets a success reply while
 * the server did the unguarded thing: a `dry_run`/`preview`/`confirm` typo performs the real
 * write. This repo has already paid it once, with the schema doing exactly this stripping: a
 * `skills_sync` preview wrote 33 real files because the registered schema dropped the undeclared
 * flag. Refusing by name turns that class into a loud error at the boundary.
 *
 * ONE mechanism, three tools (R50). `resource_manager` refused first (#342) because its flat
 * schema serves four resource types; that refusal's undeclared half now lives here, so the rule a
 * caller meets is the same whichever tool they called.
 *
 * The declared key set is read from the CONTRACT (`tooling/contracts/*.json`, via the generated
 * metadata) rather than from each hand-written Zod schema. The contract is what `tools/list`
 * publishes and what a client validates against, so it is the set a caller could have known;
 * `tests/unit/mcp-tools/tool-input-fields.test.ts` already pins each schema against it in both
 * directions, so reading either gives the same answer and reading the contract says why.
 *
 * NOT a guard where the defect lives: the defect is the silent ACCEPTANCE, and this stands at the
 * boundary before any dispatch, write, or version snapshot.
 *
 * SCOPE — top-level `arguments` keys only. `_meta` is a client-protocol field carried on
 * `params`, beside `arguments`, never inside it (verified against the SDK: `validateToolInput`
 * receives `request.params.arguments`), so it is not reachable here and needs no exemption.
 * Nested object keys are a separate axis this function does not touch: a contract declares
 * parameters, not the shape inside one. Which nested schemas already refuse is recorded in
 * `docs/reference/mcp-tools.md`.
 */

import { prompt_engineParameters } from '../../contracts/schemas/_generated/prompt_engine.generated.js';
import { resource_managerParameters } from '../../contracts/schemas/_generated/resource_manager.generated.js';
import { system_controlParameters } from '../../contracts/schemas/_generated/system_control.generated.js';

/** The three tools this server publishes, and the only names with a contract to read. */
export type ContractToolName = 'prompt_engine' | 'system_control' | 'resource_manager';

/** Every parameter each tool's contract declares — the union across all reachable states. */
export const DECLARED_PARAMETERS_BY_TOOL: Readonly<Record<ContractToolName, ReadonlySet<string>>> =
  {
    prompt_engine: new Set(prompt_engineParameters.map((parameter) => parameter.name)),
    system_control: new Set(system_controlParameters.map((parameter) => parameter.name)),
    resource_manager: new Set(resource_managerParameters.map((parameter) => parameter.name)),
  };

/**
 * A declared parameter the CURRENT runtime state does not advertise, and why.
 *
 * `prompt_engine` advertises a union: `gates`, `gate_verdict` and `gate_action` appear only while
 * the gate system is enabled (CLAUDE.md §Public API Contract). Such a key is declared-but-
 * unavailable, and telling its sender "not a parameter of prompt_engine" would be false — the
 * contract names it. It gets its own message, which says what to turn on.
 */
export type UnavailableParameters = ReadonlyMap<string, string>;

/** Levenshtein distance, capped by early exit at `max` so a long pair costs nothing. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        substitution,
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1
      );
    }
    if (Math.min(...current) > max) return max + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

/** `enforcementMode` and `enforcement_mode` are the same word in two spellings. */
const squash = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The declared parameter a sender most plausibly meant, or `undefined` when nothing is close.
 *
 * Two rules, in order. A spelling difference that survives lowercasing and separator removal is
 * the same word — `enforcementMode` → `enforcement_mode` — and is offered outright. Otherwise a
 * genuine typo is within two edits; beyond that a "suggestion" is a guess, and a wrong guess sends
 * the caller to re-send under a name they never wanted.
 */
export function nearestDeclaredParameter(
  sent: string,
  declared: Iterable<string>
): string | undefined {
  const squashedSent = squash(sent);
  let best: { name: string; distance: number } | undefined;

  for (const candidate of declared) {
    if (squash(candidate) === squashedSent) return candidate;
    const distance = editDistance(sent, candidate, 2);
    if (distance <= 2 && (best === undefined || distance < best.distance)) {
      best = { name: candidate, distance };
    }
  }

  return best?.name;
}

/** `action:"guide"` is how a caller re-reads the contract, and each tool spells it differently. */
const GUIDE_HINT: Readonly<Record<ContractToolName, string>> = {
  prompt_engine: '`>>listprompts` and the tool description list what this tool accepts.',
  system_control: '`action:"guide"` lists what this tool accepts.',
  resource_manager: '`resource_type:"prompt", action:"guide"` lists what this tool accepts.',
};

/**
 * "Was it SENT", not "is the key present".
 *
 * JSON has no `undefined`, so nothing arriving over MCP reaches here this way; an in-process
 * caller building its argument object with an unset optional field does, and refusing that would
 * be refusing a key nobody sent. A JSON `null` is a value, and is still refused.
 */
function sentKeys(args: object): string[] {
  const record = args as Record<string, unknown>;
  return Object.keys(record).filter((key) => record[key] !== undefined);
}

/**
 * Why this call sends keys the named tool will not read, or `null` when every key is live.
 *
 * Returns the message rather than a boolean: the caller needs the parameter's name, not
 * "invalid". EVERY undeclared key is named in one message (R50) — a caller who sent three typos
 * should not have to make three round trips to learn about the second and third.
 *
 * Unavailable-but-declared keys are reported separately and FIRST, because "turn gates on" and
 * "you misspelled this" are different corrections and merging them would obscure both.
 */
export function describeUndeclaredParameterRefusal(
  tool: ContractToolName,
  args: object,
  unavailable: UnavailableParameters = new Map()
): string | null {
  const declared = DECLARED_PARAMETERS_BY_TOOL[tool];
  const sent = sentKeys(args);

  const unavailableSent = sent.filter((key) => unavailable.has(key));
  if (unavailableSent.length > 0) {
    const reason = unavailable.get(unavailableSent[0] as string) as string;
    return (
      `${quoteList(unavailableSent)} ${unavailableSent.length === 1 ? 'is a parameter' : 'are parameters'} of ${tool}, ` +
      `but not one this server is advertising right now: ${reason}\n\n` +
      `It was accepted and ignored before, which reported a success for something that never ran.`
    );
  }

  const undeclared = sent.filter((key) => !declared.has(key));
  if (undeclared.length === 0) return null;

  // One offender needs no arrow — "did you mean 'force_restart'?" is the whole correction. Two or
  // more do, or the reader cannot tell which suggestion belongs to which key.
  const suggestions = undeclared
    .map((key) => {
      const nearest = nearestDeclaredParameter(key, declared);
      if (nearest === undefined) return null;
      return undeclared.length === 1 ? `'${nearest}'` : `'${key}' → '${nearest}'`;
    })
    .filter((entry): entry is string => entry !== null);

  return (
    `${quoteList(undeclared)} ${undeclared.length === 1 ? 'is not a parameter' : 'are not parameters'} of ${tool}.\n\n` +
    (suggestions.length > 0 ? `Did you mean ${suggestions.join(', ')}?\n\n` : '') +
    `It was accepted and ignored before, which reported a success for something that never ran. ` +
    `Check the spelling, or drop it from this call — ${GUIDE_HINT[tool]}`
  );
}

/**
 * A key path as a caller would write it: `gate_verdict.per_gate[0].pased`.
 *
 * Dotted for object keys, bracketed for array indices. The SDK renders an issue path by joining
 * every segment with `.` (`formatIssue`, `@modelcontextprotocol/server` 2.0.0), which turns an
 * index into `per_gate.0` — readable, but not a path anyone can paste back into their own JSON.
 */
export function formatKeyPath(segments: readonly (string | number)[]): string {
  return segments.reduce<string>((rendered, segment) => {
    if (typeof segment === 'number') return `${rendered}[${segment}]`;
    return rendered === '' ? segment : `${rendered}.${segment}`;
  }, '');
}

/**
 * The keys the schema at `path` declares, or `undefined` when that position is not an object.
 *
 * Reads zod's own internals (`_zod.def`), the same seam
 * `tests/unit/mcp-tools/nested-object-strictness.test.ts` walks to classify every reachable
 * object's unknown-key posture. Needed because an `unrecognized_keys` issue carries the offending
 * keys and the path, and NOT the declared key space it measured them against — so a suggestion
 * has to re-derive it by walking to the same position.
 *
 * Wrappers (`optional`, `default`, `nullable`, …) are transparent; an array step consumes one
 * numeric segment. Anything else answers `undefined`, which yields a refusal with no suggestion
 * rather than a wrong one.
 */
/** Zod wrapper types a caller never sees: transparent when resolving a path. */
const TRANSPARENT_WRAPPERS: ReadonlySet<string> = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'readonly',
  'nonoptional',
  'catch',
]);

/** A zod schema's internal definition, or `undefined` when the value is not one. */
function zodDef(schema: unknown): Record<string, unknown> | undefined {
  return (schema as { _zod?: { def?: Record<string, unknown> } } | null)?._zod?.def;
}

/** The same schema with every transparent wrapper peeled off. */
function unwrap(schema: unknown): unknown {
  let current = schema;
  for (;;) {
    const def = zodDef(current);
    if (def === undefined || !TRANSPARENT_WRAPPERS.has(def['type'] as string)) return current;
    current = def['innerType'];
  }
}

export function declaredKeysAt(
  schema: unknown,
  path: readonly (string | number)[]
): readonly string[] | undefined {
  let current: unknown = unwrap(schema);

  for (const segment of path) {
    const def = zodDef(current);
    const type = def?.['type'] as string | undefined;

    if (type === 'array' && typeof segment === 'number') {
      current = unwrap(def?.['element']);
      continue;
    }
    if (type === 'object' && typeof segment === 'string') {
      current = unwrap((def?.['shape'] as Record<string, unknown>)[segment]);
      continue;
    }
    return undefined;
  }

  const def = zodDef(current);
  if (def?.['type'] !== 'object') return undefined;
  return Object.keys(def['shape'] as Record<string, unknown>);
}

/** One zod issue, reduced to what a nested refusal message reads. */
export interface NestedSchemaIssue {
  readonly code: string;
  /** `PropertyKey[]`, because that is what zod hands back; symbol segments are skipped. */
  readonly path: readonly PropertyKey[];
  readonly keys?: readonly string[];
  readonly message: string;
}

/** Zod's path minus anything a caller could not have written — symbols are never JSON keys. */
function addressableSegments(path: readonly PropertyKey[]): (string | number)[] {
  return path.filter(
    (segment): segment is string | number =>
      typeof segment === 'string' || typeof segment === 'number'
  );
}

/**
 * Why a value nested inside a parameter was refused, naming the FULL path of each offending key.
 *
 * Written for `prompt_engine`'s `gate_verdict`, which is a union: zod reports a union failure as
 * ONE `invalid_union` issue with its sub-issues nested under `errors`, and the SDK renders
 * top-level issues only — so a client sent `{per_gate: [{pased: true}]}` saw exactly
 * `gate_verdict: Invalid input`, with neither the key nor its position. The sub-issues carry both;
 * this turns them into the message the union reports, so the path reaches the client through the
 * ONE validation pass zod already made rather than a second one.
 *
 * `unrecognized_keys` gets the nearest declared name at its own position, which is the correction
 * the sender needs and the reason this lives beside the top-level suggestion rather than in the
 * schema: a definition-site `error` override is ignored for that issue code (measured, P4.97).
 */
export function describeNestedSchemaRefusal(
  parameterPath: readonly (string | number)[],
  issues: readonly NestedSchemaIssue[],
  branchSchema: unknown
): string {
  const lines: string[] = [];
  let droppedKey = false;

  for (const issue of issues) {
    const relative = addressableSegments(issue.path);
    const absolute = [...parameterPath, ...relative];
    if (issue.code === 'unrecognized_keys') {
      const declared = declaredKeysAt(branchSchema, relative) ?? [];
      droppedKey = droppedKey || (issue.keys ?? []).length > 0;
      for (const key of issue.keys ?? []) {
        const nearest = nearestDeclaredParameter(key, declared);
        lines.push(
          `'${formatKeyPath([...absolute, key])}' is not a declared key` +
            (nearest !== undefined ? ` — did you mean '${nearest}'?` : '.')
        );
      }
      continue;
    }
    lines.push(`'${formatKeyPath(absolute)}': ${issue.message}`);
  }

  if (lines.length === 0) {
    return `${formatKeyPath(parameterPath)} does not match its declared shape.`;
  }

  // The closing sentence is true of a DROPPED KEY and of nothing else: a wrong enum member or a
  // missing required field was always reported. Appending it to every failure would say
  // "this used to be ignored" about a case that never was.
  if (!droppedKey) {
    return lines.join('\n');
  }

  return (
    `${lines.join('\n')}\n\n` +
    `It was dropped and ignored before, which let a misspelled key read as an absent one.`
  );
}

/**
 * The `error` option that makes a strict nested object refuse an undeclared key the way
 * {@link describeNestedSchemaRefusal} does — by full path, with the nearest declared key.
 *
 * For a plain `z.strictObject` (no union in the way), zod hands the object's own `error` callback
 * the `unrecognized_keys` issue with `path` already absolute, so the message comes from the one
 * parse zod made and the published JSON Schema is untouched. Measured on zod 4.4.3 (P4.121):
 * `z.strictObject(shape, { error })` receives `{code: 'unrecognized_keys', path: ['evaluation'],
 * keys: ['modle']}` and its returned string replaces the default `Unrecognized key: "modle"`.
 * Every other issue code returns `undefined`, which keeps zod's own message — a wrong type or a
 * wrong enum member is already reported by path.
 *
 * `schema` is a thunk because the object passes this callback while it is still being defined.
 */
export function refuseUndeclaredNestedKeys(
  schema: () => unknown
): (issue: {
  readonly code?: string;
  readonly path?: readonly PropertyKey[];
  readonly keys?: readonly string[];
}) => string | undefined {
  return (issue) => {
    if (issue.code !== 'unrecognized_keys') return undefined;
    return describeNestedSchemaRefusal(
      addressableSegments(issue.path ?? []),
      [{ code: issue.code, path: [], keys: issue.keys ?? [], message: '' }],
      schema()
    );
  };
}

/** `'a'`, `'a' and 'b'`, `'a', 'b' and 'c'` — names in the order they were sent. */
function quoteList(names: readonly string[]): string {
  const quoted = names.map((name) => `'${name}'`);
  if (quoted.length === 1) return quoted[0] as string;
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1] as string}`;
}

/**
 * The gate parameters `prompt_engine` withdraws from its advertised surface while gates are off.
 *
 * Built from the contract rather than a second literal list so the union members and the
 * unavailability rule cannot drift apart.
 */
export const GATE_PARAMETERS_UNAVAILABLE: UnavailableParameters = new Map(
  (['gates', 'gate_verdict', 'gate_action'] as const).map((name) => [
    name,
    'the gate system is disabled, so nothing reads a gate parameter. Enable it with ' +
      '`system_control action:"gates", operation:"enable"`, or drop it from this call.',
  ])
);
