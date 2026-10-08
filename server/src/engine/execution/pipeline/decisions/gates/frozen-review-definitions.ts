// @lifecycle canonical - Pure physical-to-issued review definition lookup and transient indexing.
import type {
  GateReview,
  GateReviewDefinitionSnapshot,
  GateReviewSemanticContext,
} from '#shared/types/chain-execution.js';

import { hashCanonical } from '#shared/utils/hash.js';

/** Resolve a current physical ID once; the original public DTO and digest stay authoritative. */
export function resolveFrozenReviewDefinition(
  context: GateReviewSemanticContext,
  physicalGateId: string
): GateReviewDefinitionSnapshot | undefined {
  const aliases = context.definitionAliases;
  const logicalId =
    aliases !== undefined && Object.hasOwn(aliases, physicalGateId)
      ? aliases[physicalGateId]
      : physicalGateId;
  if (typeof logicalId !== 'string' || logicalId.trim().length === 0)
    throw new Error('Issued definition alias is inconsistent');
  if (!Object.hasOwn(context.definitions, logicalId)) return undefined;
  const snapshot = context.definitions[logicalId];
  if (
    snapshot?.definition['id'] !== logicalId ||
    hashCanonical(snapshot.definition) !== snapshot.definitionDigest
  )
    throw new Error(`Issued definition '${logicalId}' is inconsistent`);
  return snapshot;
}

/** Nonpersisted current physical keys only; values are the unchanged original snapshot refs. */
export function physicalReviewDefinitionIndex(
  review: Pick<GateReview, 'gateIds' | 'semanticContext'>
): Readonly<Record<string, GateReviewDefinitionSnapshot>> | undefined {
  const issued = review.semanticContext;
  if (issued === undefined) return undefined;
  const entries: Array<[string, GateReviewDefinitionSnapshot]> = [];
  for (const gateId of review.gateIds) {
    const snapshot = resolveFrozenReviewDefinition(issued, gateId);
    if (snapshot !== undefined) entries.push([gateId, snapshot]);
  }
  return Object.fromEntries(entries);
}
