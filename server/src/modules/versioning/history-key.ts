// @lifecycle canonical - The one definition of "this resource id and everything below it".
/**
 * How a `version_history` row is matched to a resource AND its descendants.
 *
 * A chain's steps keep their history under composite ids — `chain/step` — so "delete the history
 * of `chain`" must mean `chain` and `chain/…`, and must NOT mean `chain_other`. Appending `/` to
 * both sides makes that one prefix test: `chain` and `chain/step` both start `chain/`, and
 * `chain_other` does not.
 *
 * It lives here, in the domain that owns what a version key means, because BOTH surfaces that
 * delete history have to agree on it: `VersionHistoryService.deleteHistory` over MCP and
 * `cli-shared/version-history.ts` for `cpm`. They already disagreed once about whether delete
 * purges at all, which is the defect this import closes; two copies of the predicate would be the
 * same disagreement one layer down, and invisible, because both would look correct in isolation.
 *
 * `cli-shared/` may import this: the rule it must respect (`cli-shared-no-runtime`) forbids
 * reaching `runtime/`, `infra/` and `mcp/`, and this module imports nothing at all.
 *
 * Binds the resource id TWICE — the parameter appears on both sides of the comparison.
 */
export const RESOURCE_SUBTREE_MATCH = `substr(resource_id || '/', 1, length(?) + 1) = ? || '/'`;
