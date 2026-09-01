// @lifecycle canonical - Sole owner of resource id normalization and the id-shape conventions.
//
// Lives in shared/utils/ (Layer 0) because both engine/ (`command-parser.ts`) and mcp/
// (`resource-manager/prompt/utils/validation.ts`) need it as a VALUE, and engine/ is
// architecturally forbidden from value-importing mcp/ or modules/
// ('engine-no-modules-or-mcp-value', .dependency-cruiser.cjs). Same placement rationale as
// node-order.ts and chain-id-codec.ts.

/**
 * THE ID CONVENTION, in one sentence:
 *
 *   Ids that appear in the `>>` / `-->` command grammar are snake_case.
 *   Every other id is kebab-case.
 *
 * Measured 2026-08-31 across the bundled tree and one personal library, which is where the rule
 * comes from — it was already the de facto standard, it had just never been written down:
 *
 *   prompt ids          92 snake  ·  1 kebab  ·  2 camelCase
 *   categories           5 kebab  ·  1 snake
 *   gate ids            25 kebab  ·  0 snake
 *   chain step ids      kebab, schema-enforced (ChainStepSchema)
 *   workflow node ids   kebab, schema-enforced (WORKFLOW_NODE_ID_PATTERN)
 *   unknown ids         kebab, schema-enforced (prompt-engine.schema.ts)
 *   framework/style     single word — compatible with either, decides nothing
 *
 * WHY PROMPTS ARE THE EXCEPTION, and why it should stay that way:
 * `command-tokenizer.ts` splits chains on `/-->|==>|\+|\?/`. A hyphen inside a prompt id is
 * genuinely ambiguous in that grammar — `>>a-->b` could be the prompt `a-->b` or the prompt `a`
 * chained to `b`. Prompt ids therefore avoid hyphens, and a kebab spelling is accepted as an
 * ALIAS and folded to the canonical underscore form. No other id type enters the symbolic
 * grammar, so kebab is free everywhere else and matches the wider convention for node/gate ids.
 *
 * The two camelCase prompt ids (`strategicImplement`, `diagnosisCard`) match neither and are a
 * known, deferred exception — see the resource-surface-consolidation plan. They are not
 * grandfathered here: `isCanonicalPromptId` reports them, because a convention with a silent
 * exception is a convention nobody can check.
 */

/**
 * A canonical prompt id: lowercase, digits and underscores, `/`-qualified for nested steps.
 *
 * Module-private on purpose. The predicates below are the surface; handing out the raw regex
 * invites a consumer to test against it directly, which is how this module's own subject matter —
 * two copies of one rule drifting apart — happened in the first place.
 */
const PROMPT_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)*$/;

/** A canonical kebab id, used by every id that is not part of the command grammar. */
const KEBAB_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Normalize a prompt id to canonical form: lowercase, hyphens and whitespace folded to
 * underscores, runs collapsed, edges trimmed.
 *
 * Users may type `my-prompt`; the canonical id is `my_prompt`, and the two name the same prompt,
 * so they cannot both exist.
 *
 * `/` SURVIVES DELIBERATELY. Nested chain steps are addressed as `parent/step`
 * (`deep_analysis/initial_scan`), and the draft service compares this function's output against
 * every loaded prompt id — including nested ones. A version that stripped `/` collapsed
 * `deep_analysis/initial_scan` to `deep_analysisinitial_scan` and could match the wrong prompt.
 *
 * Unified here 2026-08-31 from two implementations that had drifted apart: this one, and an
 * inline chain in `command-parser.ts` carrying an extra `.replace(/[^a-z0-9_]/g, '')`. That extra
 * step was **unreachable** — the capture group feeding it is `([a-zA-Z][a-zA-Z0-9_-]*)`, which
 * already excludes every character the strip removes, so it could never delete anything. It was a
 * second guard standing where the first one already held, and its only effect was to make the two
 * implementations differ on inputs neither could receive. Dropped rather than adopted: the
 * constraint belongs at the boundary that already enforces it.
 */
export function normalizePromptId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * The directory name a category resolves to — and, because the loader derives `category` back
 * from that directory, the value the prompt actually carries once reloaded.
 *
 * Folds whitespace only. It deliberately does NOT fold `_` to `-`, even though categories are
 * kebab by convention: doing so would relocate a write for an existing snake-cased category
 * (`content_processing` → `content-processing`) and silently split one category into two on
 * disk. Convention violations are REPORTED by `validate:prompts` and repaired by an explicit
 * directory rename, never by a slug that quietly moves where a write lands.
 *
 * Idempotent — the output has no uppercase and no whitespace — which is what lets post-write
 * verification apply it to both sides of a comparison without knowing which is already slugged.
 */
export function slugifyCategoryDirectory(category: string): string {
  return category.toLowerCase().replace(/\s+/g, '-');
}

/** Does this prompt id match the canonical snake_case convention? */
export function isCanonicalPromptId(id: string): boolean {
  return PROMPT_ID_PATTERN.test(id);
}

/** Does this id match the kebab-case convention used by every non-command-grammar id? */
export function isKebabId(id: string): boolean {
  return KEBAB_ID_PATTERN.test(id);
}
