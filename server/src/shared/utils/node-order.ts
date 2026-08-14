// @lifecycle canonical - Pure node-identity + ordinal-math helpers for chain step addressing.
//
// Lives in shared/utils/ (Layer 0), not modules/chains/, so that both engine/ mint sites
// (04-parsing-stage.ts, symbolic-operator-parser.ts) and modules/ consumers (manager.ts, Tier 2)
// can import it as a VALUE — engine/ is architecturally forbidden from value-importing modules/
// ('engine-no-modules-or-mcp-value', severity: error, .dependency-cruiser.cjs). Mirrors the
// existing chain-id-codec.ts / chainUtils.ts placement pattern for chain-domain pure utilities.
/**
 * Anything with a node id reads as a node here — the ordinal math needs identity and nothing
 * else, and several read-side consumers hold structurally-narrower session shapes.
 */
export type NodeOrderInput = ReadonlyArray<{ id: string }> | ReadonlyArray<string>;

/**
 * Slugify a step name into a kebab-case candidate node id: lowercase, runs of non-alphanumeric
 * characters collapsed to a single hyphen, leading/trailing hyphens trimmed.
 */
function slugify(stepName: string): string {
  return stepName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Mint stable node ids for a YAML-defined chain's steps.
 *
 * Each step's explicit `id` wins when present; otherwise a node id is derived by slugifying
 * `stepName`. Collisions (explicit or derived) are deduplicated deterministically in step order
 * by appending `-2`, `-3`, … to the later occurrence — the first occurrence of a given id/slug
 * keeps the bare form.
 *
 * Pure and deterministic: the same input array always produces the same output array.
 */
export function mintNodeIds(steps: Array<{ id?: string; stepName: string }>): string[] {
  const seen = new Map<string, number>();
  const result: string[] = [];

  for (const step of steps) {
    const base = step.id ?? slugify(step.stepName);
    const priorCount = seen.get(base) ?? 0;
    seen.set(base, priorCount + 1);
    result.push(priorCount === 0 ? base : `${base}-${priorCount + 1}`);
  }

  return result;
}

/**
 * Mint frozen sequential node ids for a symbolic (non-YAML) chain: `n1`, `n2`, …, `nK`.
 *
 * These are minted exactly once at parse time and are NEVER re-minted for the lifetime of the
 * run — a symbolic chain has no stable step names to slug from, so position at mint time is the
 * only available identity source. Later insertions (P4) receive fresh suffixed ids; existing
 * `nK` ids are never renumbered.
 */
export function mintSequentialIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `n${index + 1}`);
}

/**
 * Mint a fresh, collision-free node id for a P4 mutation-time insertion.
 *
 * `base` is slugified the same way {@link mintNodeIds} slugifies a step name (lowercase,
 * non-alphanumeric runs collapsed to a single hyphen, leading/trailing hyphens trimmed) so an
 * arbitrary statement or unknown id produces a valid kebab-case node id. If the slugified base
 * is not already present in `existingIds`, it is returned bare; otherwise `-2`, `-3`, … is
 * appended until a free id is found.
 *
 * Honors the never-renumber contract this file reserves for insertions (see
 * {@link mintSequentialIds} docblock): existing ids are read-only input here and are never
 * altered, renamed, or reassigned — only the new candidate id is computed.
 */
export function mintInsertionId(base: string, existingIds: readonly string[]): string {
  const slug = slugify(base);
  const taken = new Set(existingIds);

  if (!taken.has(slug)) {
    return slug;
  }

  let suffix = 2;
  let candidate = `${slug}-${suffix}`;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${slug}-${suffix}`;
  }
  return candidate;
}

/** Normalize a `ChainNode[] | string[]` input to a plain node-id array. */
function toIds(nodes: NodeOrderInput): string[] {
  return (nodes as ReadonlyArray<{ id: string } | string>).map((node) =>
    typeof node === 'string' ? node : node.id
  );
}

/**
 * 1-based ordinal position of `nodeId` within `nodes`. Returns -1 when `nodeId` is absent.
 */
export function ordinalOf(nodes: NodeOrderInput, nodeId: string): number {
  const index = toIds(nodes).indexOf(nodeId);
  return index === -1 ? -1 : index + 1;
}

/** Total node count. */
export function totalOf(nodes: NodeOrderInput): number {
  return nodes.length;
}

/**
 * The node id immediately after `nodeId` in run order, or null when `nodeId` is terminal
 * (the last node) or absent from `nodes`.
 */
export function nextAfter(nodes: NodeOrderInput, nodeId: string): string | null {
  const ids = toIds(nodes);
  const index = ids.indexOf(nodeId);
  if (index === -1 || index === ids.length - 1) {
    return null;
  }
  return ids[index + 1] ?? null;
}

/**
 * True when `nodeId` is the last node in `nodes`. False when `nodeId` is absent — absence and
 * terminal-ness are distinct conditions; callers that need to distinguish them should use
 * `ordinalOf` alongside this.
 */
export function isTerminal(nodes: NodeOrderInput, nodeId: string): boolean {
  const ids = toIds(nodes);
  const index = ids.indexOf(nodeId);
  return index !== -1 && index === ids.length - 1;
}

/**
 * Inverse of {@link ordinalOf}: the node id at 1-based `ordinal`, or null when out of range.
 *
 * Exists for the ordinal->identity direction that callers still standing on positions need
 * (pipeline stages hand the store a position; the store speaks node ids). Tier 2 addition.
 */
export function nodeIdAt(nodes: NodeOrderInput, ordinal: number): string | null {
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    return null;
  }
  return toIds(nodes)[ordinal - 1] ?? null;
}

/**
 * The derived 1-based position a run is standing at, reproducing the integer `currentStep`
 * that `ChainState` used to carry directly.
 *
 * Three cases, and the boundaries are the contract:
 *  - no nodes at all -> 0 (a zero-step session never entered step 1)
 *  - `currentNodeId === null` (run advanced past its terminal node) -> `totalOf(nodes) + 1`,
 *    the same sentinel the old `currentStep = stepNumber + 1` arithmetic produced
 *  - otherwise the node's ordinal, or 0 when the id is absent from the run's node list
 */
export function currentOrdinal(nodes: NodeOrderInput, currentNodeId: string | null): number {
  if (nodes.length === 0) {
    return 0;
  }
  if (currentNodeId === null) {
    return nodes.length + 1;
  }
  const ordinal = ordinalOf(nodes, currentNodeId);
  return ordinal === -1 ? 0 : ordinal;
}
