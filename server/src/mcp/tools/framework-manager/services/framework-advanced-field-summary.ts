// @lifecycle canonical - Pure summarizer for the 11 framework advanced fields (P4.11 read-back).
/**
 * Renders the framework advanced fields already loaded by
 * `FrameworkFileWriter.loadExistingFramework` + `toFrameworkCreationData` — `inspect` reports from
 * that same result rather than reading disk a second time (P4.11 ruling R1). Bounded and legible
 * by design (P4.11 ruling R2 / CLAUDE.md § Instruction surface): a resource-authored string field
 * like `judge_prompt` is a second delivery channel into the client's context if pasted whole, so
 * every summary is a count or a truncated first line — never the field's content verbatim.
 */
import type { FrameworkCreationData } from '../core/types.js';

/** Advanced field keys `inspect` renders when present, in fixed display order. */
export const ADVANCED_FRAMEWORK_FIELD_KEYS = [
  'framework_gates',
  'template_suggestions',
  'framework_elements',
  'argument_suggestions',
  'judge_prompt',
  'processing_steps',
  'execution_steps',
  'execution_type_enhancements',
  'template_enhancements',
  'execution_flow',
  'quality_indicators',
] as const satisfies readonly (keyof FrameworkCreationData)[];

const STRING_PREVIEW_LIMIT = 80;

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Bounded, one-line summary of a single advanced field's value. Arrays report a length, strings
 * report a truncated first line, and plain objects (including `Record<string, ...>` fields like
 * `quality_indicators`) report their own key count — never the nested content.
 */
export function summarizeAdvancedFieldValue(value: unknown): string {
  if (Array.isArray(value)) {
    return pluralize(value.length, 'item');
  }
  if (typeof value === 'string') {
    const firstLine = value.split('\n', 1)[0] ?? '';
    return firstLine.length > STRING_PREVIEW_LIMIT
      ? `${firstLine.slice(0, STRING_PREVIEW_LIMIT)}…`
      : firstLine;
  }
  if (value !== null && typeof value === 'object') {
    return pluralize(Object.keys(value).length, 'key');
  }
  return String(value);
}

/**
 * Renders the advanced fields present on `creationData` as a bounded text block, or `''` when
 * none are set. Field order is fixed (`ADVANCED_FRAMEWORK_FIELD_KEYS`) so output is stable.
 */
export function renderAdvancedFrameworkFields(creationData: FrameworkCreationData): string {
  const lines: string[] = [];
  for (const key of ADVANCED_FRAMEWORK_FIELD_KEYS) {
    const value = creationData[key];
    if (value === undefined) continue;
    lines.push(`  - ${key}: ${summarizeAdvancedFieldValue(value)}`);
  }
  return lines.length === 0 ? '' : `\n\nAdvanced Fields:\n${lines.join('\n')}`;
}
