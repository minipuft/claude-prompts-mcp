// @lifecycle canonical - Composes a framework's display label without doubling the word.
/**
 * Render "<name> framework" without repeating the word when the name already ends in it.
 *
 * `resources/frameworks/cageerf/framework.yaml` ships `name: C.A.G.E.E.R.F Framework`,
 * and two independent surfaces append the word again -- the exported SKILL.md
 * description and the live `>>` system-prompt header -- both producing
 * "C.A.G.E.E.R.F Framework framework".
 *
 * Fixed here rather than in the YAML because a framework name is user-editable
 * data: any installation may have customised it, and the doubling is this
 * formatter's defect on every name that ends in "framework", not one resource's.
 */
export function frameworkLabel(name: string): string {
  const trimmed = name.trim();
  return /\bframework$/i.test(trimmed) ? trimmed : `${trimmed} framework`;
}
