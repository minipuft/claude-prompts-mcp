// @lifecycle canonical - Metric label cardinality enforcement for OTel metrics.
/**
 * Metric View Policy
 *
 * Enforces low-cardinality labels on OTel metric instruments.
 * Prevents high-cardinality identifiers (prompt IDs, chain IDs, etc.)
 * from appearing as metric dimensions — those belong in trace attributes only.
 *
 * See Phase 6.0 Sampling + Metric Label Policy in the implementation plan.
 */

// ===== Allowed Metric Labels =====

/**
 * Metric labels permitted on OTel metric instruments.
 * These have bounded cardinality (≤50 distinct values each).
 */
export const ALLOWED_METRIC_LABELS = [
  'stage_name',
  'stage_type',
  'status',
  'execution_mode',
  'is_chain',
] as const;

export type AllowedMetricLabel = (typeof ALLOWED_METRIC_LABELS)[number];

// ===== Disallowed Metric Labels =====

/**
 * Labels that must NOT appear on metric instruments.
 * High-cardinality: unbounded or user-supplied identifiers.
 * These are safe as trace attributes but would explode metric cardinality.
 */
export const DISALLOWED_METRIC_LABELS = [
  'prompt_id',
  'chain_id',
  'continuity_scope_id',
  'operator_types',
  'execution_id',
  'session_id',
  'framework_id',
] as const;

export type DisallowedMetricLabel = (typeof DISALLOWED_METRIC_LABELS)[number];

// ===== Pure Functions =====

/**
 * Check if a label key is allowed on metric instruments.
 */
export function isAllowedMetricLabel(key: string): boolean {
  return (ALLOWED_METRIC_LABELS as readonly string[]).includes(key);
}

/**
 * Check if a label key is explicitly disallowed on metric instruments.
 */
export function isDisallowedMetricLabel(key: string): boolean {
  return (DISALLOWED_METRIC_LABELS as readonly string[]).includes(key);
}

/**
 * Filter a label map to include only allowed metric labels.
 * Drops disallowed and unknown labels — safe for metric instrument use.
 */
export function filterMetricLabels(
  labels: Record<string, string | number | boolean>
): Record<AllowedMetricLabel, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(labels)) {
    if (isAllowedMetricLabel(key)) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Validate that a set of label keys contains no disallowed entries.
 * Returns list of violations for diagnostic output.
 */
export function validateMetricLabels(keys: string[]): string[] {
  return keys.filter(isDisallowedMetricLabel);
}

// ===== Metric View Configuration =====

/**
 * Metric view definition for OTel SDK MeterProvider configuration.
 * Used in Phase 1.2 runtime setup to register attribute filters.
 */
export interface MetricViewDefinition {
  /** Metric instrument name pattern (glob). */
  instrumentName: string;
  /** Allowed attribute keys for this metric. */
  attributeKeys: AllowedMetricLabel[];
}

/**
 * Default metric views for the pipeline metrics.
 * Applied during MeterProvider configuration.
 */
export const DEFAULT_METRIC_VIEWS: MetricViewDefinition[] = [
  {
    instrumentName: 'cpm.pipeline.*',
    attributeKeys: ['stage_name', 'status', 'execution_mode', 'is_chain'],
  },
  {
    instrumentName: 'cpm.stage.*',
    attributeKeys: ['stage_name', 'stage_type', 'status'],
  },
  {
    instrumentName: 'cpm.gate.*',
    attributeKeys: ['status', 'execution_mode'],
  },
];
