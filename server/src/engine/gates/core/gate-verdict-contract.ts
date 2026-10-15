// @lifecycle canonical - Shared gate verdict parsing and validation contract.
import { isGateVerdictSubmission, renderGateVerdict } from './gate-verdict-renderer.js';
import { isSemanticEvaluationReport } from './semantic-evaluation.js';
import { getVerdictValidationSettings } from '../config/index.js';

import type {
  GateVerdictEntry,
  GateVerdictReminderExemption,
  GateVerdictReminders,
  GateVerdictSubmission,
} from '#shared/types/gate-evaluation.js';

export type GateVerdictSource = 'gate_verdict';

export interface ParsedGateVerdict {
  readonly verdict: 'PASS' | 'FAIL';
  readonly rationale: string;
  readonly raw: string;
  readonly source: GateVerdictSource;
  readonly detectedPattern?: string;
  /** Original typed review; raw is display text and cannot preserve semantic reports. */
  readonly submission: GateVerdictSubmission;
}

/** Unknown engine callers receive bounded syntax checks; the MCP schema owns boundary parsing. */
function hasOnlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function isRationale(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value);
}

function isVerdictEntry(value: unknown): value is GateVerdictEntry {
  if (!hasOnlyKeys(value, ['index', 'passed', 'rationale', 'evaluation'])) return false;
  const index = value['index'];
  return (
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index > 0 &&
    typeof value['passed'] === 'boolean' &&
    isRationale(value['rationale']) &&
    (value['evaluation'] === undefined || isSemanticEvaluationReport(value['evaluation']))
  );
}

function isReminderId(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s,;()]+$/.test(value);
}

function isReminderExemption(value: unknown): value is GateVerdictReminderExemption {
  return (
    hasOnlyKeys(value, ['id', 'reason']) &&
    isReminderId(value['id']) &&
    isRationale(value['reason']) &&
    !/[;)]/.test(value['reason'])
  );
}

function isReminderAttestation(value: unknown): value is GateVerdictReminders {
  if (!hasOnlyKeys(value, ['satisfied', 'not_applicable'])) return false;
  const satisfied = value['satisfied'];
  const notApplicable = value['not_applicable'];
  return (
    Array.isArray(satisfied) &&
    Array.from(satisfied).every(isReminderId) &&
    Array.isArray(notApplicable) &&
    Array.from(notApplicable).every(isReminderExemption)
  );
}

function isStructuredVerdict(value: unknown): value is GateVerdictSubmission {
  if (!hasOnlyKeys(value, ['overall', 'rationale', 'per_gate', 'reminders'])) return false;
  const overall = value['overall'];
  if (!isGateVerdictSubmission(value)) return false;
  const entries = value['per_gate'];
  return (
    (overall === 'PASS' || overall === 'FAIL') &&
    isRationale(value['rationale']) &&
    (entries === undefined ||
      (Array.isArray(entries) && Array.from(entries).every(isVerdictEntry))) &&
    (value['reminders'] === undefined || isReminderAttestation(value['reminders']))
  );
}

/** The shape a refused `gate_verdict` is told to resend. */
const GATE_VERDICT_RESEND_SHAPE =
  'Resend it as {"overall": "PASS"|"FAIL", "rationale": "<one line>", ' +
  '"per_gate": [{"index": 1, "passed": true, "rationale": "<one line>"}]}: per_gate grades ' +
  'each check-tier gate by its 1-based index (a semantic gate adds its "evaluation" report), ' +
  'and "reminders": {"satisfied": [...], "not_applicable": [...]} attests reminder gates. ' +
  'The review reply carries a template with its indexes filled in.';

/** "a string", "an array", "null" — the JSON kind a sender used instead of an object. */
function describeKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/**
 * The refusal a `gate_verdict` that is not a valid structured review reads, at the MCP schema
 * and at the engine's own field validator: it names the input, says what is accepted and gives
 * the shape to resend, so a client still sending the retired string form corrects in one call.
 */
export function describeGateVerdictRefusal(value: unknown): string {
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  const lead = isObject
    ? 'gate_verdict does not match the structured object.'
    : `gate_verdict takes the structured object, not ${describeKind(value)}.`;
  return `${lead} ${GATE_VERDICT_RESEND_SHAPE}`;
}

/** Parse a structured submission, or `null` when it is absent or not a valid review. */
export function parseGateVerdict(
  raw: GateVerdictSubmission | undefined,
  source: GateVerdictSource
): ParsedGateVerdict | null {
  return parseStructuredVerdict(raw, source);
}

/** Parse overall fields directly; rendering is a display projection, never the custody path. */
function parseStructuredVerdict(raw: unknown, source: GateVerdictSource): ParsedGateVerdict | null {
  if (!isStructuredVerdict(raw)) return null;
  const rationale = raw.rationale.trim();
  const validation = getVerdictValidationSettings();
  if (validation.requireRationale && rationale.length < validation.minRationaleLength) {
    return null;
  }
  return {
    verdict: raw.overall,
    rationale,
    raw: renderGateVerdict(raw),
    source,
    detectedPattern: 'structured',
    submission: raw,
  };
}

export function isValidGateVerdict(gateVerdict: unknown): gateVerdict is GateVerdictSubmission {
  return parseStructuredVerdict(gateVerdict, 'gate_verdict') !== null;
}
