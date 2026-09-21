// @lifecycle canonical - The declared set of frameworks the package ships.

/**
 * The frameworks that ship inside the package, as one list.
 *
 * WHY THIS EXISTS. The same four ids were written out by hand in two places — the registry's
 * built-in load list and the MCP deletion guard — and both had gone stale against a tree that
 * ships eight. Measured 2026-09-07: `resources/frameworks/` holds `5w1h`, `cageerf`, `focus`,
 * `liquescent`, `radiant`, `react`, `scamper`, `verify`, while both literals named only the first
 * four in load order. Two consequences, and the second is destructive:
 *
 *   · `focus`, `liquescent`, `radiant` and `verify` loaded through the discovery pass rather than
 *     the built-in pass, so every surface reading `isBuiltIn` reported them as operator-created.
 *   · The deletion guard refused only the four it named. A comment claimed the bundled-tree check
 *     below it covered the rest; that check sits inside `if (!existsSync(frameworkDir))` and those
 *     directories DO exist at the configured root, so it was unreachable for exactly the ids it
 *     named. Nothing else refused before `fs.rm`, so in a default install `delete` removed them
 *     from the bundled tree.
 *
 * WHY A DECLARED LIST RATHER THAN A DIRECTORY SCAN. "Ships with the package" is not the same
 * question as "is on disk under the resources root", and in a default install the two directories
 * are the SAME path — `getBundledResourceDirectory('frameworks')` resolves to
 * `getFrameworksDirectory()`. A scan would therefore refuse to delete a framework the operator
 * created themselves, trading a data-loss bug for a capability bug. The set has to be declared,
 * and `validate:shipped-frameworks` is what keeps the declaration honest: it fails when this list
 * and `resources/frameworks/*` disagree in either direction.
 *
 * Adding a framework to the package means adding it here in the same commit. The gate says so.
 */
export const SHIPPED_FRAMEWORK_IDS = [
  '5w1h',
  'cageerf',
  'focus',
  'liquescent',
  'radiant',
  'react',
  'scamper',
  'verify',
] as const;

/** Case-insensitive membership, because ids arrive from callers in whatever case they typed. */
export function isShippedFrameworkId(id: string): boolean {
  const normalized = id.toLowerCase();
  return SHIPPED_FRAMEWORK_IDS.some((shipped) => shipped === normalized);
}
