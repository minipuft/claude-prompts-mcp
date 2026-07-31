// @lifecycle canonical - Pure placeholder substitution for framework system-prompt templates.

/**
 * Values substituted into a framework's `systemPromptTemplate`.
 *
 * `frameworkName` and `frameworkType` are different fields and both are needed: a framework's
 * `name` is its human label ("CAGEERF Framework") while its `type` is the discriminator
 * ("CAGEERF") that templates branch on.
 */
export interface TemplateVariableValues {
  promptName: string;
  promptCategory: string;
  frameworkName: string;
  frameworkType: string;
  promptType: 'chain' | 'single';
}

/**
 * Placeholder names this module substitutes, in the order they are reported to callers.
 *
 * `{FRAMEWORK_GUIDANCE}` is deliberately absent — it is resolved by the caller before
 * substitution because producing it requires an initialised framework guide.
 */
export const TEMPLATE_VARIABLE_NAMES = [
  'PROMPT_NAME',
  'PROMPT_CATEGORY',
  'FRAMEWORK_NAME',
  'FRAMEWORK_TYPE',
  'PROMPT_TYPE',
] as const;

/**
 * Pre-rename spelling of `{FRAMEWORK_TYPE}`.
 *
 * Kept so a workspace template authored before the rename still substitutes. It resolved to
 * `framework.type`, which is what the new name says; the old name read as a sibling of
 * `{FRAMEWORK_NAME}` and did not. Retire once no workspace template uses it.
 */
const DEPRECATED_FRAMEWORK_TYPE_PLACEHOLDER = /\{METHODOLOGY\}/g;

/**
 * Substitute framework placeholders in a system-prompt template.
 *
 * Pure: same input always yields the same output, no I/O and no mutation of `values`.
 */
export function substituteTemplateVariables(
  template: string,
  values: TemplateVariableValues
): string {
  return template
    .replace(/\{PROMPT_NAME\}/g, values.promptName)
    .replace(/\{PROMPT_CATEGORY\}/g, values.promptCategory)
    .replace(/\{FRAMEWORK_NAME\}/g, values.frameworkName)
    .replace(/\{FRAMEWORK_TYPE\}/g, values.frameworkType)
    .replace(DEPRECATED_FRAMEWORK_TYPE_PLACEHOLDER, values.frameworkType)
    .replace(/\{PROMPT_TYPE\}/g, values.promptType);
}
