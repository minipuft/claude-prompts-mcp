// @lifecycle canonical - Rejects a stage array where a consumer precedes its producer.
/**
 * Stage order validation.
 *
 * The stage array in `PipelineBuilder.build()` documents its ordering constraints in a
 * comment, which means an inversion is caught by review or not at all. `provides` and
 * `requires` restate those constraints as data so the same inversion fails construction.
 *
 * Both fields are optional and most stages declare neither. A stage with no declarations
 * is unconstrained, not violation-free-by-assertion — this catches the invariants that
 * were written down, and says nothing about the ones that were not.
 */
import type { PipelineStage } from './stage.js';

/**
 * One unmet requirement.
 *
 * `producedBy`/`producedAtIndex` are null when nothing in the array provides the key at
 * all — a different defect from a producer that merely runs too late, and one the caller
 * cannot fix by reordering.
 */
export interface StageOrderViolation {
  readonly stage: string;
  readonly missing: string;
  readonly producedBy: string | null;
  readonly producedAtIndex: number | null;
}

interface Producer {
  readonly name: string;
  readonly index: number;
}

/**
 * Map each provided key to its earliest producer.
 *
 * Earliest rather than nearest: it is the lowest index a consumer could be moved after,
 * so it is the one that makes the error message actionable.
 */
function indexFirstProducers(stages: readonly PipelineStage[]): ReadonlyMap<string, Producer> {
  const firstProducer = new Map<string, Producer>();

  stages.forEach((stage, index) => {
    for (const key of stage.provides ?? []) {
      if (!firstProducer.has(key)) {
        firstProducer.set(key, { name: stage.name, index });
      }
    }
  });

  return firstProducer;
}

function toViolation(
  stageName: string,
  missing: string,
  producer: Producer | undefined
): StageOrderViolation {
  return {
    stage: stageName,
    missing,
    producedBy: producer?.name ?? null,
    producedAtIndex: producer?.index ?? null,
  };
}

/**
 * Report every requirement not satisfied by an earlier stage.
 *
 * A stage's own `provides` are registered only after its `requires` are checked, so a
 * stage cannot satisfy its own requirement — depending on a key it writes itself is a
 * declaration error, not an ordering one, and reporting it is the point.
 */
export function validateStageOrder(
  stages: readonly PipelineStage[]
): readonly StageOrderViolation[] {
  const firstProducer = indexFirstProducers(stages);
  const violations: StageOrderViolation[] = [];
  const satisfied = new Set<string>();

  for (const stage of stages) {
    for (const key of stage.requires ?? []) {
      if (!satisfied.has(key)) {
        violations.push(toViolation(stage.name, key, firstProducer.get(key)));
      }
    }
    for (const key of stage.provides ?? []) {
      satisfied.add(key);
    }
  }

  return violations;
}

/**
 * Render violations for a construction-time error message.
 *
 * Lives here rather than at the call site so the coordinator's constructor stays a call
 * and a throw, with no formatting logic of its own.
 */
export function formatStageOrderViolations(violations: readonly StageOrderViolation[]): string {
  return violations
    .map((violation) => {
      const producer =
        violation.producedBy === null
          ? 'no stage in this array provides it'
          : `provided by ${violation.producedBy} at index ${violation.producedAtIndex}, which runs later`;
      return `  - ${violation.stage} requires "${violation.missing}": ${producer}`;
    })
    .join('\n');
}
