// @lifecycle canonical - The artifact-kind vocabulary and the path classifier gate activation reads.
/**
 * Artifact Kinds
 *
 * Ruling B13: a gate declares the artifact it checks rather than the prompt categories it
 * guesses at, and a run declares the artifacts it produces. This module is the ONLY home of
 * both halves of that vocabulary — the kind list and the path table that maps a file onto a
 * kind. The gate schema's enum, the prompt schema's enum, and the execution planner all import
 * from here; a second copy of either would let the authoring surface and the runtime disagree
 * about what `test` means.
 */

/**
 * The fixed artifact vocabulary (B13). Order is load-bearing: `classifyArtifactPaths` and
 * `resolveDeclaredArtifacts` emit their results in this order, so a declared set reads the same
 * way wherever it is printed.
 */
export const ARTIFACT_KINDS = [
  'source',
  'test',
  'docs',
  'readme',
  'plan',
  'changelog',
  'config',
  'prompt',
  'gate',
  'pr-body',
] as const;

/** One entry of the fixed artifact vocabulary. */
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const KIND_ORDER = new Map<ArtifactKind, number>(
  ARTIFACT_KINDS.map((kind, index) => [kind, index])
);

/** Splits a declared argument value into candidate paths: newlines, commas, and whitespace. */
const PATH_SEPARATORS = /[\s,]+/;

/**
 * Normalize to a forward-slash path with a leading slash.
 *
 * The leading slash is what lets the table below ask `includes('/tests/')` once and have it
 * answer the same for `tests/x.ts` and `server/tests/x.ts` — without it, a top-level directory
 * would silently fall through to `source`.
 */
function normalize(path: string): string {
  const forward = path.replace(/\\/g, '/').trim();
  return forward.startsWith('/') ? forward : `/${forward}`;
}

function basenameOf(normalized: string): string {
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

/**
 * Classify one path into an `ArtifactKind`. First match wins, top to bottom.
 *
 * The order encodes the specific-beats-general rule: `README.md` is a readme before it is a
 * `.md` doc, a `.yaml` under `resources/prompts/` is a prompt before it is config, and a
 * `.test.ts` is a test before it is source. Anything the table does not recognise is `source`,
 * which is the conservative answer — a source gate attaching to an unclassified file costs a
 * reminder, while a miss costs the check the gate exists for.
 */
export function classifyArtifactPath(path: string): ArtifactKind {
  const normalized = normalize(path);
  const basename = basenameOf(normalized);

  if (/^README/i.test(basename)) return 'readme';
  if (/^CHANGELOG/i.test(basename)) return 'changelog';
  if (normalized.includes('/plans/') || /\.plan\.md$/i.test(basename)) return 'plan';
  if (normalized.includes('/resources/prompts/')) return 'prompt';
  if (normalized.includes('/resources/gates/')) return 'gate';
  if (
    /\.test\.|\.spec\.|^test_|_test\.py$/.test(basename) ||
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/')
  ) {
    return 'test';
  }
  if (/\.md$/i.test(basename) || normalized.includes('/docs/')) return 'docs';
  if (
    basename === 'config.json' ||
    basename === 'config.schema.json' ||
    /\.config\.(js|ts|mjs|cjs)$/i.test(basename) ||
    /\.ya?ml$/i.test(basename)
  ) {
    return 'config';
  }
  return 'source';
}

/** Deduped kinds for a set of paths, in `ARTIFACT_KINDS` order. */
export function classifyArtifactPaths(paths: Iterable<string>): ArtifactKind[] {
  const kinds = new Set<ArtifactKind>();
  for (const path of paths) {
    if (typeof path !== 'string' || path.trim().length === 0) continue;
    kinds.add(classifyArtifactPath(path));
  }
  return sortKinds(kinds);
}

/**
 * A prompt's artifact declaration, structurally typed.
 *
 * Deliberately NOT `PromptYaml['artifacts']`: this module is imported by the gate schema, the
 * prompt schema, and the planner, and naming any of their types here would make the vocabulary
 * depend on the surfaces that consume it.
 */
export interface ArtifactDeclaration {
  /** Kinds this prompt always produces, whatever it is invoked with. */
  produces?: readonly ArtifactKind[] | undefined;
  /** Name of a declared argument whose value carries the paths this run touches. */
  fromArgument?: string | undefined;
}

/**
 * The artifacts a run declares: `produces` unioned with the kinds classified out of the argument
 * `fromArgument` names. Pure, so the planner and the gate-enhancement stage can both derive the
 * same answer from the same inputs rather than threading one through the pipeline.
 */
export function resolveDeclaredArtifacts(
  declaration: ArtifactDeclaration | undefined,
  promptArgs: Record<string, unknown> | undefined
): ArtifactKind[] {
  if (declaration === undefined) return [];

  const kinds = new Set<ArtifactKind>(declaration.produces ?? []);

  const argumentName = declaration.fromArgument;
  if (argumentName !== undefined && argumentName.length > 0) {
    const raw = promptArgs?.[argumentName];
    if (typeof raw === 'string') {
      for (const kind of classifyArtifactPaths(raw.split(PATH_SEPARATORS))) {
        kinds.add(kind);
      }
    }
  }

  return sortKinds(kinds);
}

function sortKinds(kinds: Set<ArtifactKind>): ArtifactKind[] {
  return [...kinds].sort((a, b) => (KIND_ORDER.get(a) ?? 0) - (KIND_ORDER.get(b) ?? 0));
}
