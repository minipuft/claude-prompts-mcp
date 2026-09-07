// @lifecycle canonical - Sole owner of "does this chain step's promptId resolve".
/**
 * Chain step reference resolution.
 *
 * ONE DERIVATION, THREE BOUNDARIES. A chain step names a prompt by id; three places have to
 * answer whether that id resolves, and before this module they answered differently:
 *
 *  - the resource WRITE (`resource_manager create` / `update`) warned and saved anyway, and
 *    skipped any id containing `/` — which `PROMPT_ID_PATTERN` makes the canonical form for a
 *    nested step, so the check exempted exactly the ids it was written to check;
 *  - the LOAD path checked a chain's internal edge endpoints and nothing else;
 *  - CI checked id canonicality and nothing else.
 *
 * This function classifies; it does not decide. Each boundary maps the classification to its own
 * posture, because the same id means different things at different times:
 *
 *  - at WRITE, `<chainId>/<step>` is satisfied by the same call — `scaffoldChainStepDirectories`
 *    creates exactly those directories after the reference check runs — so it is
 *    `scaffolded-by-this-write` and accepted. Everything else must already be registered.
 *  - at LOAD and in CI nothing is being written, so `scaffolded-by-this-write` is a broken
 *    reference: the scaffold either never ran or the directory was removed afterwards.
 *
 * Pure: no I/O, no logger, no registry handle. The caller supplies the registered id set.
 */

/**
 * What a chain step's `promptId` resolves to.
 *
 * - `resolved` — the exact id is in the registry.
 * - `scaffolded-by-this-write` — the id is `<chainId>/<one segment>`, the shape
 *   `scaffoldChainStepDirectories` creates. Not registered yet; a write creates it.
 * - `unresolved` — nothing registered under this id, and no write will create it.
 */
export type ChainStepResolution = 'resolved' | 'scaffolded-by-this-write' | 'unresolved';

/** One chain step's id and how it resolved. */
export interface ChainStepReference {
  /** Zero-based position in the chain's `chainSteps` array. */
  readonly stepIndex: number;
  readonly promptId: string;
  readonly resolution: ChainStepResolution;
}

/**
 * Is this id the one-level-nested form a write scaffolds?
 *
 * Mirrors `FileOperations.scaffoldChainStepDirectories` exactly: the prefix is `<chainId>/`, the
 * remainder must be non-empty and must not itself contain `/`. Deeper nesting is what the
 * scaffold skips, so exempting it here would accept an id nothing creates.
 */
function isScaffoldedByChain(promptId: string, chainId: string): boolean {
  const prefix = `${chainId}/`;
  if (!promptId.startsWith(prefix)) {
    return false;
  }
  const remainder = promptId.slice(prefix.length);
  return remainder.length > 0 && !remainder.includes('/');
}

/** Classify one chain step reference. */
export function resolveChainStepPromptId(
  promptId: string,
  chainId: string,
  registeredIds: ReadonlySet<string>
): ChainStepResolution {
  if (registeredIds.has(promptId)) {
    return 'resolved';
  }
  return isScaffoldedByChain(promptId, chainId) ? 'scaffolded-by-this-write' : 'unresolved';
}

/**
 * Classify every step of a chain.
 *
 * A step with no `promptId`, or a non-string one, is not classified: the shape of a step is the
 * schema's concern (`ChainStepSchema`), and reporting it here would give one defect two voices.
 */
export function resolveChainSteps(
  steps: readonly unknown[],
  chainId: string,
  registeredIds: Iterable<string>
): ChainStepReference[] {
  const idSet = registeredIds instanceof Set ? registeredIds : new Set(registeredIds);
  const references: ChainStepReference[] = [];

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index] as Record<string, unknown> | null | undefined;
    const promptId = step?.['promptId'];
    if (typeof promptId !== 'string' || promptId.length === 0) {
      continue;
    }
    references.push({
      stepIndex: index,
      promptId,
      resolution: resolveChainStepPromptId(promptId, chainId, idSet),
    });
  }

  return references;
}

/** The addressed line every boundary reports a broken reference with. */
export function describeUnresolvedChainStep(reference: ChainStepReference): string {
  return `step ${reference.stepIndex + 1} references unknown promptId '${reference.promptId}'`;
}
