/**
 * Type surface for the plain-JS ESLint plugin.
 *
 * The plugin stays JavaScript because ESLint loads `eslint.config.js` directly, with no build step
 * between the two. This declaration exists so its rules can be imported from a TypeScript test
 * without the import site resolving to `any` — a cast at each call site would suppress the same
 * error while asserting the same shape less visibly.
 */

import type { Rule } from 'eslint';

export declare const rules: Record<string, Rule.RuleModule>;

declare const plugin: { rules: Record<string, Rule.RuleModule> };
export default plugin;
