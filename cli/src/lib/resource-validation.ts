import { formatValidationIssues, type ResourceValidationResult } from '@cli-shared/index.js';

import { output, icons } from './output.js';

function toIssueLines(result: ResourceValidationResult): string[] {
  const lines: string[] = [];
  for (const issue of result.errors) {
    lines.push(`- error [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  for (const issue of result.warnings) {
    lines.push(`- warn  [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  return lines;
}

export function printValidationFailure(
  validation: ResourceValidationResult,
  options: {
    json: boolean;
    action: string;
    rolledBack?: boolean;
  },
): void {
  const summary =
    `${options.action} failed validation for ${validation.resourceType}/${validation.resourceId}\n` +
    `file: ${validation.filePath}`;

  if (options.json) {
    output(
      {
        error: summary,
        validation,
        rollback: {
          performed: options.rolledBack === true,
        },
      },
      { json: true },
    );
    return;
  }

  console.error(`${icons.error()} ${summary}`);
  for (const line of toIssueLines(validation)) {
    console.error(`  ${line}`);
  }
  if (options.rolledBack) {
    console.error('  rollback: previous files restored');
  }
}

/**
 * A successful mutation's warnings, formatted the way `cpm validate` formats an entry's issues
 * (R124). A mutation run with `--no-validate` carries no verdict and so reports none.
 */
export function mutationWarnings(validation: ResourceValidationResult | undefined): string[] {
  return validation === undefined ? [] : formatValidationIssues(validation.warnings);
}

/** Print a successful mutation's warnings in the lines `cpm validate` prints an entry's warnings. */
export function printMutationWarnings(warnings: string[]): void {
  for (const warning of warnings) console.error(`    ${icons.warn()}  ${warning}`);
}
