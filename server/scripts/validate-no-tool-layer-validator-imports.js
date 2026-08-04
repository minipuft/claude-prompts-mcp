#!/usr/bin/env node

/**
 * Forbids the MCP tool layer importing validator and schema modules directly, which would put
 * validation decisions in a layer that is supposed to route to processors.
 *
 * RETIREMENT CONDITION: delete this guard when `validate:arch` expresses the same edge as a
 * dependency-cruiser layer rule. That is strictly the better home — this file carries a literal
 * list of six module paths, so renaming any one of them silently empties the guard while leaving
 * it green, whereas a path-based rule follows the move. Until that rule exists, the literal list
 * is what stands between the tool layer and its own validation logic.
 */

import { execSync } from 'node:child_process';

const IMPORT_PATTERN = [
  'cli-shared/resource-validation',
  'modules/prompts/prompt-schema',
  'engine/gates/core/gate-schema',
  'engine/frameworks/definitions/framework-schema',
  'modules/formatting/core/style-schema',
  'modules/automation/core/script-schema',
].join('|');

const TARGET = 'src/mcp/tools';

// `import type` is excluded deliberately. The boundary this guard defends is the tool layer not
// running validation logic; a type-only import is erased at compile time and pulls no logic in.
// Every dependency-cruiser rule in `.dependency-cruiser.cjs` already draws this same distinction
// via `dependencyTypes`/`dependencyTypesNot: ['type-only']` — before 2026-07-29 this guard did
// not, so it reported a type-only `StyleToolDescriptionYaml` import as a boundary breach and
// could never go green. `import type {…}` and `import { type X }` are both excluded; a value
// import of the same module is still a violation.
/** rg emits `path:line:content`; strip that prefix before testing the import form. */
const isTypeOnly = (row) => /^[^:]+:\d+:\s*import\s+type\s/.test(row);

// `src/mcp/tools/schemas/` is exempt. This guard defends one boundary: the tool layer must not
// run RESOURCE-CONTENT validation itself instead of delegating to ResourceVerificationService.
// MCP PARAMETER validation is a different job, and `.claude/rules/mcp-contracts.md` assigns it to
// exactly this directory ("Hand-written Zod schemas in src/mcp/tools/schemas/ are the SSOT for MCP
// parameter validation"). Composing a shared Zod fragment there — e.g. `ChainStepSchema` for the
// `chain_steps` parameter — is shape reuse; forbidding it would force a duplicate copy of the
// shape and break SSOT, which is the defect this codebase is actively removing.
const isParameterSchemaOwner = (row) => row.startsWith('src/mcp/tools/schemas/');

function validateBoundary() {
  try {
    const raw = execSync(
      `rg -n "^import\\\\s+.*from\\\\s+['\\\"][^'\\\"]*(${IMPORT_PATTERN})\\\\.js['\\\"];?" ${TARGET}`,
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    const output = raw
      .split('\n')
      .filter((row) => row.trim() !== '' && !isTypeOnly(row) && !isParameterSchemaOwner(row))
      .join('\n');

    if (output.trim() !== '') {
      console.error('Validator boundary violation: direct validator imports found in tool layer.');
      console.error(output.trim());
      console.error(
        '\nUse ResourceVerificationService from modules/resources/services instead of direct schema imports.'
      );
      process.exit(1);
    }
  } catch (error) {
    if (error.status === 1) {
      console.log('Tool-layer validator boundary check passed.');
      process.exit(0);
    }

    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    console.error(stderr !== '' ? stderr : String(error));
    process.exit(1);
  }

  console.log('Tool-layer validator boundary check passed.');
}

validateBoundary();
