// @lifecycle canonical - The `preview` action vocabulary shared by all three resource managers.
/**
 * Preview as an ACTION, not a flag.
 *
 * `dry_run: true` was a boolean modifier on three different actions, and a boolean modifier can be
 * read backwards. It was: the pre-dispatch confirmation guard keys on `action`, so previewing a
 * deletion still demanded `confirm: true` — the caller had to confirm the thing they were asking
 * not to happen. Making preview its own action fixes that structurally rather than by adding
 * another condition to the guard, because a non-destructive action simply is not a member of
 * `DESTRUCTIVE_ACTIONS`.
 *
 * The cost is that `action` alone no longer says WHICH operation is being previewed, so
 * `preview_action` carries it. Inferring it from the payload was rejected: the server would be
 * guessing at something the caller can state, and the guess is wrong exactly when the payload is
 * ambiguous — which is when it matters.
 */

/**
 * Operations a preview may target, per resource type.
 *
 * Deliberately per-type rather than one flat list. `dry_run` was routed to every manager for every
 * action, but only seven of the nine (type × action) pairs ever READ it: gate and framework
 * `update` accepted the parameter and wrote anyway, so a preview of those two performed the
 * mutation and reported success. A flat list would have carried that defect into the new
 * vocabulary under a better name. An unsupported pair is refused here, by name.
 */
export const PREVIEWABLE_ACTIONS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  prompt: ['update', 'delete', 'rollback'],
  gate: ['delete', 'rollback'],
  framework: ['delete', 'rollback'],
};

/** Every operation previewable for at least one resource type. The schema's `preview_action` enum. */
export const PREVIEWABLE_ACTIONS = ['update', 'delete', 'rollback'] as const;

export type PreviewableAction = (typeof PREVIEWABLE_ACTIONS)[number];

/** The minimum shape both resolvers read. Every manager's input satisfies it. */
export interface PreviewAddressable {
  action: string;
  preview_action?: string;
}

/**
 * The action this request dispatches to.
 *
 * A preview runs the target operation's own code path up to the point of effect, which is what
 * makes it a preview rather than a second implementation of the same logic — the two cannot
 * disagree about validation, because there is only one validation.
 */
export function resolveDispatchAction(args: PreviewAddressable): string {
  return args.action === 'preview' ? (args.preview_action ?? 'preview') : args.action;
}

/**
 * Whether this request must return before it writes.
 *
 * Reads the caller's own `action`, so there is no second field to keep in lockstep with it and no
 * polarity to invert. Every early return that used to test `dry_run === true` tests this.
 */
export function isPreviewRequest(args: PreviewAddressable): boolean {
  return args.action === 'preview';
}

/**
 * Why a `preview` request is malformed, or `null` when it is well-formed.
 *
 * Returns the message rather than a boolean because each refusal names the specific thing that is
 * wrong; a caller told only "invalid" has to guess which of three rules they broke.
 */
export function describePreviewRefusal(
  resourceType: string,
  args: PreviewAddressable
): string | null {
  const supported = PREVIEWABLE_ACTIONS_BY_TYPE[resourceType] ?? [];

  if (args.action !== 'preview') {
    if (args.preview_action === undefined) return null;
    return (
      `'preview_action' names what a preview would do, so it is only meaningful with ` +
      `action:"preview" — it was sent with action:"${args.action}".\n\n` +
      `Sending it here would have no effect, and a parameter that silently does nothing reads as ` +
      `a preview that ran. Re-send as action:"preview" with preview_action:"${args.preview_action}", ` +
      `or drop the parameter.`
    );
  }

  if (args.preview_action === undefined) {
    return (
      `action:"preview" requires 'preview_action' — a preview of WHAT.\n\n` +
      `For ${resourceType}, valid values are: ${supported.map((a) => `"${a}"`).join(', ')}.`
    );
  }

  if (!supported.includes(args.preview_action)) {
    const elsewhere = Object.entries(PREVIEWABLE_ACTIONS_BY_TYPE)
      .filter(([type, actions]) => type !== resourceType && actions.includes(args.preview_action!))
      .map(([type]) => type);
    const note =
      elsewhere.length > 0
        ? `\n\nIt is previewable for ${elsewhere.join(' and ')}, but a ${resourceType} ` +
          `${args.preview_action} has no preview path — it would perform the operation.`
        : '';
    return (
      `preview_action:"${args.preview_action}" is not supported for resource_type:"${resourceType}".\n\n` +
      `Valid values for ${resourceType}: ${supported.map((a) => `"${a}"`).join(', ')}.${note}`
    );
  }

  return null;
}
