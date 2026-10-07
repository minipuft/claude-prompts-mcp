// @lifecycle canonical - Shared gate verdict parsing and validation contract.
import { isGateVerdictSubmission, renderGateVerdict } from './gate-verdict-renderer.js';
import { isSemanticEvaluationReport } from './semantic-evaluation.js';
import {
  loadVerdictPatterns,
  isPatternRestrictedToSource,
  getVerdictValidationSettings,
} from '../config/index.js';

import type {
  GateVerdictEntry,
  GateVerdictReminderExemption,
  GateVerdictReminders,
  GateVerdictSubmission,
} from '#shared/types/gate-evaluation.js';

export type GateVerdictSource = 'gate_verdict' | 'user_response';

export interface ParsedGateVerdict {
  readonly verdict: 'PASS' | 'FAIL';
  readonly rationale: string;
  readonly raw: string;
  readonly source: GateVerdictSource;
  readonly detectedPattern?: string;
  /** Original typed review; raw is display text and cannot preserve semantic reports. */
  readonly submission?: GateVerdictSubmission;
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
  if (
    !isGateVerdictSubmission(value) ||
    !hasOnlyKeys(value, ['overall', 'rationale', 'per_gate', 'reminders'])
  )
    return false;
  const entries = value['per_gate'];
  return (
    (value['overall'] === 'PASS' || value['overall'] === 'FAIL') &&
    isRationale(value['rationale']) &&
    (entries === undefined ||
      (Array.isArray(entries) && Array.from(entries).every(isVerdictEntry))) &&
    (value['reminders'] === undefined || isReminderAttestation(value['reminders']))
  );
}

export const GATE_VERDICT_VALIDATION_MESSAGE =
  'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"';

export const GATE_VERDICT_THROW_MESSAGE =
  'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"';

export const GATE_VERDICT_REQUIRED_FORMAT = 'GATE_REVIEW: PASS|FAIL - <rationale>';

export function buildGateVerdictExample(
  verdict: 'PASS' | 'FAIL',
  rationale: string = '<rationale>'
): string {
  return `GATE_REVIEW: ${verdict} - ${rationale}`;
}

export function parseGateVerdict(
  raw: string | GateVerdictSubmission | undefined,
  source: GateVerdictSource
): ParsedGateVerdict | null {
  if (typeof raw !== 'string') return parseStructuredVerdict(raw, source);
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  // Validate only the first non-empty line (per-gate verdicts may follow)
  const firstLine =
    normalized
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? normalized;

  const patterns = loadVerdictPatterns();
  const validation = getVerdictValidationSettings();

  for (const pattern of patterns) {
    if (isPatternRestrictedToSource(pattern, source)) {
      continue;
    }

    const match = firstLine.match(pattern.regex);
    if (!match?.[1]) {
      continue;
    }

    const rationale = match[2]?.trim() ?? '';
    if (validation.requireRationale && rationale.length < validation.minRationaleLength) {
      continue;
    }

    return {
      verdict: match[1].toUpperCase() as 'PASS' | 'FAIL',
      rationale,
      raw: normalized,
      source,
      detectedPattern: pattern.priority,
    };
  }

  return null;
}

/** Parse overall fields directly; rendering is a display projection, never the custody path. */
function parseStructuredVerdict(raw: unknown, source: GateVerdictSource): ParsedGateVerdict | null {
  if (source !== 'gate_verdict' || !isStructuredVerdict(raw)) return null;
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

export function isValidGateVerdict(
  gateVerdict: unknown
): gateVerdict is string | GateVerdictSubmission {
  return typeof gateVerdict === 'string'
    ? parseGateVerdict(gateVerdict, 'gate_verdict') !== null
    : parseStructuredVerdict(gateVerdict, 'gate_verdict') !== null;
}
