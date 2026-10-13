// @lifecycle canonical - Why a request gate (`gates` / `workflow.gates`) cannot register, and the refusal text that says so.
/**
 * The shape rules stage 05 refuses a request gate by (R11.8), and the registration loop asserts
 * (`TemporaryGateRegistrar`): one module, so the check that refuses and the loop that registers
 * read one definition of "cannot register". Imports nothing. The inline-criteria sibling is
 * `inline-criteria-refusal.ts`. PURE throughout.
 */

/**
 * Whether a request gate carries content of its own. One that does is a gate, not a reference: under
 * a canonical id it is refused (R100), and a run's recorded one restores under a fresh id (R110).
 */
export function gateInputContainsInlineContent(gate: Record<string, unknown>): boolean {
  const hasCriteria = Array.isArray(gate['criteria']) && gate['criteria'].length > 0;
  const hasPassCriteria = Array.isArray(gate['pass_criteria']) && gate['pass_criteria'].length > 0;
  const hasGuidance = typeof gate['guidance'] === 'string' && gate['guidance'].trim().length > 0;
  const hasDescription =
    typeof gate['description'] === 'string' && gate['description'].trim().length > 0;
  return hasCriteria || hasPassCriteria || hasGuidance || hasDescription;
}

/** What a valid request gate looks like, carried by every refusal. */
const REQUEST_GATE_FORMS =
  'Send a registered gate id ("code-quality"), a criterion ("Cites a primary source"), ' +
  '{name:"…", description:"…"}, or {id:"…", criteria:["…"]}, with every criterion, guidance and ' +
  'description non-blank. Request gates are counted across `gates`, then `workflow.gates`.';

const CONTENT_FIELDS = ['criteria', 'pass_criteria', 'guidance', 'description'] as const;

/**
 * What one request gate is, as sent: a gate of its own (`id` when it declares one), a bare id that
 * must name a gate to mean anything, or an entry that cannot register. PURE.
 */
type RequestGateShape =
  | { readonly kind: 'gate'; readonly id?: string }
  | { readonly kind: 'reference'; readonly id: string }
  | { readonly kind: 'invalid'; readonly problem: string };

export function requestGateShape(gate: unknown): RequestGateShape {
  if (typeof gate === 'string') {
    return gate.trim().length > 0
      ? { kind: 'gate' }
      : { kind: 'invalid', problem: `is ${gate.length === 0 ? 'empty' : 'blank'}` };
  }
  if (!isRecord(gate)) {
    return { kind: 'invalid', problem: 'is neither text nor an object' };
  }
  const fieldProblem =
    blankLabelProblem(gate) ??
    criteriaListProblem(gate, 'criteria') ??
    criteriaListProblem(gate, 'pass_criteria');
  if (fieldProblem !== undefined) {
    return { kind: 'invalid', problem: fieldProblem };
  }
  const id = isNonBlank(gate['id']) ? gate['id'] : undefined;
  if (gateInputContainsInlineContent(gate)) {
    return id === undefined ? { kind: 'gate' } : { kind: 'gate', id };
  }
  if (id !== undefined) {
    return { kind: 'reference', id };
  }
  const sent = CONTENT_FIELDS.some((field) => gate[field] !== undefined);
  return {
    kind: 'invalid',
    problem: sent
      ? 'carries no criterion, guidance or description: every one it sends is blank'
      : 'carries no id, criterion, guidance or description',
  };
}

/**
 * A sent `id` or `name` that is blank, phrased for a refusal. PURE. A gate's id and name are how
 * its review addresses it: one sent blank names nothing, and the schema's `min(1)` admits spaces.
 */
function blankLabelProblem(gate: Record<string, unknown>): string | undefined {
  for (const field of ['id', 'name'] as const) {
    const value = gate[field];
    if (typeof value === 'string' && value.trim().length === 0) {
      return `has a ${value.length === 0 ? 'empty' : 'blank'} ${field}`;
    }
  }
  return undefined;
}

/** The first blank or non-text entry of a criteria list, phrased for a refusal. PURE. */
function criteriaListProblem(
  gate: Record<string, unknown>,
  field: 'criteria' | 'pass_criteria'
): string | undefined {
  const list = gate[field];
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) return `has ${field} that is not a list`;
  const index = list.findIndex((item) => typeof item !== 'string' || item.trim().length === 0);
  if (index === -1) return undefined;
  const item: unknown = list[index];
  return typeof item === 'string'
    ? `has the ${field} entry ${JSON.stringify(item)}, which is ${item.length === 0 ? 'empty' : 'blank'}`
    : `has ${field} entry ${index + 1}, which is not text`;
}

/** Whether a request gate is a bare id, which registers nothing of its own. PURE. */
function isRequestGateReference(gate: unknown): boolean {
  return requestGateShape(gate).kind === 'reference';
}

/**
 * Whether a request gate goes on to register. A new entry that cannot register throws: stage 05
 * refuses it before registration (R11.8), so meeting one here is a server fault, never a skip. A
 * recorded one (R11.13) was accepted when its run started; if it registered nothing then, it
 * registers nothing now, and the run resumes. A bare id is judged after canonical resolution.
 */
export function admitRequestGate(gate: unknown, recorded: boolean): boolean {
  const shape = requestGateShape(gate);
  if (shape.kind !== 'invalid') {
    return true;
  }
  if (recorded) {
    return false;
  }
  throw new Error(
    `[TemporaryGateRegistrar] request gate ${shape.problem}; stage 05 refuses such a request ` +
      'before registration (R11.8), so a caller registered request gates without ' +
      'TemporaryGateRegistrar.invalidRequestGates.'
  );
}

/**
 * A bare id that named neither a registered gate nor one this run holds is refused by
 * `invalidRequestGates`, never registered as a gate with nothing to review (R11.8). A claimed run's
 * recorded one registers as it did when its run started, so the run's reviews still resolve it
 * (R11.13).
 */
export function assertNotBareReference(
  gate: unknown,
  gateId: string | null,
  recorded: boolean
): void {
  if (!recorded && isRequestGateReference(gate)) {
    throw new Error(
      `[TemporaryGateRegistrar] request gate "${gateId}" names no gate and carries no criteria; ` +
        'stage 05 refuses it before registration (R11.8), so a caller registered request gates ' +
        'without TemporaryGateRegistrar.invalidRequestGates.'
    );
  }
}

/**
 * A request gate addressed by position and id or name — `request gate 1 (name "Tone")` — the way
 * every refusal that names one addresses it. PURE.
 */
export function requestGateAddress(index: number, gate: unknown): string {
  const label =
    typeof gate === 'string'
      ? JSON.stringify(gate)
      : isRecord(gate) && typeof gate['id'] === 'string'
        ? `id ${JSON.stringify(gate['id'])}`
        : isRecord(gate) && typeof gate['name'] === 'string'
          ? `name ${JSON.stringify(gate['name'])}`
          : 'no id or name';
  return `request gate ${index + 1} (${label})`;
}

/** One refusal line's detail: the entry by position and id or name, the problem, the fix. PURE. */
export function requestGateRefusalDetail(index: number, gate: unknown, problem: string): string {
  return (
    `${requestGateAddress(index, gate)} ${problem}. The server can neither address nor review ` +
    `it, and skipping it would start the run without a gate you asked for. ${REQUEST_GATE_FORMS}`
  );
}

export function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
