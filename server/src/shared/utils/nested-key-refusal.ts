// @lifecycle canonical - A misspelled key inside a nested schema, refused by path with the nearest declared key.
/**
 * Nested key refusal: the half of the undeclared-key rule that lives INSIDE a parameter.
 *
 * `mcp/tools/shared/undeclared-parameters.ts` refuses a top-level key no contract declares. One
 * level down the rule is zod's: a strict object refuses an unknown key, but its default message is
 * `Unrecognized key: "modle"` — no path a caller can paste back, no suggestion — and a union
 * reports a failure inside a member as `<param>: Invalid input`. The functions here turn zod's own
 * issues into `'evaluation.modle' is not a declared key — did you mean 'mode'?` from the ONE parse
 * zod already made, so the published JSON Schema is untouched.
 *
 * WHY `shared/`, not beside the top-level refusal (P4.135). The strict objects a tool publishes are
 * not all the tool layer's: `injection`, `composer`, `artifacts`, argument `validation` and a
 * step's `visibility` are defined in `modules/` and shared with the YAML loader, and `modules/`
 * may not import `mcp/`. An adapter only the tool layer could reach would leave those objects on
 * zod's bare message, which is the class this row closes. `tests/unit/mcp-tools/
 * nested-object-strictness.test.ts` walks every tool schema and fails on a strict object or a
 * union that carries no `error` adapter.
 */

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
  branchSchema: unknown,
  { droppedBefore = true }: { readonly droppedBefore?: boolean } = {}
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
  if (!droppedKey || !droppedBefore) {
    return lines.join('\n');
  }

  return (
    `${lines.join('\n')}\n\n` +
    `It was dropped and ignored before, which let a misspelled key read as an absent one.`
  );
}

/** The issue fields both adapters read. `inst` is the schema that raised it (zod 4.4.3). */
interface AdapterIssue {
  readonly code?: string;
  readonly input?: unknown;
  readonly inst?: unknown;
  readonly path?: readonly PropertyKey[];
  readonly keys?: readonly string[];
  readonly errors?: readonly (readonly NestedSchemaIssue[])[];
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
 * The declared keys come from `issue.inst`, the object that raised the issue, so one callback
 * serves every object — including an inline one with no name to point a thunk at (P4.135).
 */
export function refuseUndeclaredKey(issue: AdapterIssue): string | undefined {
  if (issue.code !== 'unrecognized_keys') return undefined;
  return describeNestedSchemaRefusal(
    addressableSegments(issue.path ?? []),
    [{ code: issue.code, path: [], keys: issue.keys ?? [], message: '' }],
    issue.inst,
    // An object carrying this adapter was already strict: its key was refused, never dropped, so
    // the history sentence `gate_verdict` earned would be false here — and this message also
    // reaches YAML load errors, through the loader schemas that share these objects.
    { droppedBefore: false }
  );
}

/** A zod schema type name, for the value kinds JSON can carry. */
const KIND_TYPES: Readonly<Record<string, readonly string[]>> = {
  string: ['string', 'enum', 'literal'],
  number: ['number', 'int', 'literal'],
  boolean: ['boolean', 'literal'],
  object: ['object', 'record'],
  array: ['array', 'tuple'],
};

/** The JSON kind of a value, which is how a sender says which union member they meant. */
function jsonKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * The `error` option that makes a union report WHICH member the sender meant, and what is wrong
 * inside it (P4.120).
 *
 * Zod reports a union failure as ONE `invalid_union` issue with each member's sub-issues nested
 * under `errors`, and the MCP SDK renders top-level issues only — so a misspelled key inside a
 * union member reached a client as `gates.0: Invalid input`. `gate_verdict` needed exactly this
 * and got a bespoke override; this is the same repair for every other union.
 *
 * The member is chosen by the value's own JSON kind, then by the fewest sub-issues among members
 * of that kind: an object sent to a string-or-object union is an object submission, and reporting
 * `expected string` beside the real defect buries it. A value of no member's kind says so, naming
 * the kinds, because there the kind IS the defect. Every other issue code keeps zod's message.
 */
export function refuseUnionMismatch(issue: AdapterIssue): string | undefined {
  if (issue.code !== 'invalid_union') return undefined;
  const path = addressableSegments(issue.path ?? []);
  const kind = jsonKind(issue.input);
  const options = (zodDef(issue.inst)?.['options'] as readonly unknown[] | undefined) ?? [];
  const members = options.map((schema, index) => ({
    schema,
    index,
    type: zodDef(unwrap(schema))?.['type'] as string | undefined,
  }));
  const candidates = members.filter(
    (member) => member.type !== undefined && (KIND_TYPES[kind] ?? []).includes(member.type)
  );

  if (candidates.length === 0) {
    const kinds = [...new Set(members.map((member) => member.type ?? 'value'))];
    return `'${formatKeyPath(path)}' takes ${kinds.join(' or ')}, not ${kind}.`;
  }

  const issuesOf = (index: number): readonly NestedSchemaIssue[] => issue.errors?.[index] ?? [];
  const best = candidates.reduce((chosen, member) =>
    issuesOf(member.index).length < issuesOf(chosen.index).length ? member : chosen
  );
  return describeNestedSchemaRefusal(path, issuesOf(best.index), best.schema, {
    droppedBefore: false,
  });
}
