// @lifecycle canonical - Per-field body override for gate definitions (ADR 0001 (b)).

/** A gate body as a bag of fields. Merging is field-kind driven, not schema driven. */
export type GateBody = Record<string, unknown>;

/**
 * Resolve one gate body over another, field by field, per ADR 0001 (b).
 *
 * `base` is the lower-ranked body (a `registry-auto` or `framework` definition); `override` is
 * the higher-ranked one (a prompt's inline definition at rank 60, or a caller's spec at rank 80).
 *
 * ## Why this is a shallow replace, and why that is the whole rule
 *
 * ADR 0001 (b) states a strategy per field KIND. All three kinds land on "declared replaces":
 *
 * | Kind | Fields | Strategy |
 * |---|---|---|
 * | Scalars | `description`, `guidance`, `severity`, `enforcementMode`, `type`, `scope` | declared replaces, omitted inherits |
 * | Arrays | `criteria`, `pass_criteria`, `apply_to_steps` | declared replaces the WHOLE array — never appends |
 * | Objects | `retry_config`, `context` | declared replaces the WHOLE object — never key by key |
 *
 * Because every kind replaces, a shallow field-wise assignment implements all three. That is the
 * intended outcome, not a shortcut, and the reasons are worth keeping next to the code:
 *
 * - **Arrays must not append.** An author who wants two of a registry gate's five criteria could
 *   not express it under append semantics — they would silently get seven.
 * - **Objects must not merge key by key.** Key-by-key merge on `retry_config` can pair one
 *   source's limit with the other's backoff, a combination neither source authored.
 *
 * Deep merge is rejected for exactly that reason; it is the mechanism that yields configurations
 * no author wrote. `webpack-merge` and ESLint flat config reached the same conclusion
 * independently (ADR 0001 § Prior art). **If a future change adds deep-merge behavior for any
 * field, it contradicts an accepted ADR — amend the ADR first.**
 *
 * `undefined` in `override` counts as omitted and inherits. An explicit `null` counts as declared
 * and replaces, so a body can deliberately clear an inherited field.
 */
export function mergeGateBody(base: GateBody, override: GateBody): GateBody {
  const merged: GateBody = { ...base };

  for (const [field, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }
    merged[field] = value;
  }

  return merged;
}
