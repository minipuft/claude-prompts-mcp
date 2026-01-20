// @lifecycle canonical - Generates operator patterns from SSOT registry.
/**
 * Operator Registry Generator
 *
 * Reads operators.json (SSOT) and generates:
 * - TypeScript: src/execution/parsers/_generated/operator-patterns.ts
 * - Python: hooks/lib/_generated/operators.py
 *
 * Usage:
 *   npm run generate:operators        # Generate artifacts
 *   npm run generate:operators --check # Verify artifacts are current
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOOKS_ROOT = path.resolve(ROOT, '..', 'hooks');

const OPERATORS_CONTRACT = path.join(ROOT, 'tooling', 'contracts', 'registries', 'operators.json');
const TS_OUTPUT_DIR = path.join(ROOT, 'src', 'execution', 'parsers', '_generated');
const TS_OUTPUT = path.join(TS_OUTPUT_DIR, 'operator-patterns.ts');
const PY_OUTPUT_DIR = path.join(HOOKS_ROOT, 'lib', '_generated');
const PY_OUTPUT = path.join(PY_OUTPUT_DIR, 'operators.py');

interface OperatorPattern {
  typescript: string;
  flags?: string;
}

interface OperatorVariant {
  syntax: string;
  description: string;
}

interface Operator {
  id: string;
  symbol: string;
  description: string;
  purpose: string;
  pattern: OperatorPattern;
  variants?: OperatorVariant[];
  examples: string[];
  status: 'implemented' | 'reserved' | 'deprecated';
  detectInHooks: boolean;
}

interface OperatorsContract {
  version: number;
  description: string;
  operators: Operator[];
}

async function loadContract(): Promise<OperatorsContract> {
  const content = await readFile(OPERATORS_CONTRACT, 'utf-8');
  return JSON.parse(content);
}

function generateTypeScript(contract: OperatorsContract): string {
  const lines: string[] = [
    '// AUTO-GENERATED - Do not edit directly',
    '// Source: tooling/contracts/registries/operators.json',
    '',
    '/**',
    ' * Operator patterns generated from SSOT registry.',
    ' * Use these patterns in symbolic-operator-parser.ts',
    ' */',
    '',
    'export const GENERATED_OPERATOR_PATTERNS = {',
  ];

  for (const op of contract.operators) {
    const flags = op.pattern.flags ?? '';
    lines.push(`  /** ${op.description} - ${op.symbol} */`);
    lines.push(`  ${op.id}: {`);
    lines.push(`    pattern: /${op.pattern.typescript}/${flags},`);
    lines.push(`    symbol: '${op.symbol}',`);
    lines.push(`    status: '${op.status}',`);
    lines.push(`  },`);
  }

  lines.push('} as const;');
  lines.push('');
  lines.push('export type OperatorId = keyof typeof GENERATED_OPERATOR_PATTERNS;');
  lines.push('');
  lines.push('export const IMPLEMENTED_OPERATORS = [');
  for (const op of contract.operators.filter((o) => o.status === 'implemented')) {
    lines.push(`  '${op.id}',`);
  }
  lines.push('] as const;');
  lines.push('');

  return lines.join('\n');
}

function generatePython(contract: OperatorsContract): string {
  const hookOperators = contract.operators.filter((o) => o.detectInHooks);

  const lines: string[] = [
    '# AUTO-GENERATED - Do not edit directly',
    '# Source: server/tooling/contracts/registries/operators.json',
    '"""',
    'Operator detection patterns for hooks.',
    '',
    'These patterns are for USER CONTEXT HINTS only.',
    'Full parsing happens server-side in symbolic-operator-parser.ts',
    '"""',
    'import re',
    'from typing import TypedDict, Pattern',
    '',
    '',
    'class OperatorInfo(TypedDict):',
    '    symbol: str',
    '    description: str',
    '    pattern: Pattern[str]',
    '    examples: list[str]',
    '',
    '',
    '# Operator detection patterns',
    'OPERATORS: dict[str, OperatorInfo] = {',
  ];

  for (const op of hookOperators) {
    // TypeScript regex patterns work directly in Python raw strings
    // The JSON already has proper escaping (e.g., \\s means literal \s)
    const pyPattern = op.pattern.typescript;

    const flags = op.pattern.flags?.includes('i') ? ', re.IGNORECASE' : '';

    lines.push(`    '${op.id}': {`);
    lines.push(`        'symbol': '${op.symbol}',`);
    lines.push(`        'description': '${op.description}',`);
    lines.push(`        'pattern': re.compile(r'''${pyPattern}'''${flags}),`);
    lines.push(`        'examples': ${JSON.stringify(op.examples)},`);
    lines.push(`    },`);
  }

  lines.push('}');
  lines.push('');
  lines.push('');
  lines.push('def detect_operator(message: str, operator_id: str) -> list[str]:');
  lines.push('    """');
  lines.push('    Detect operator matches in message.');
  lines.push('    Returns list of captured groups or empty list if no match.');
  lines.push('    """');
  lines.push('    if operator_id not in OPERATORS:');
  lines.push('        return []');
  lines.push('    pattern = OPERATORS[operator_id]["pattern"]');
  lines.push('    matches = pattern.findall(message)');
  lines.push('    # Flatten tuple results from groups');
  lines.push('    if matches and isinstance(matches[0], tuple):');
  lines.push('        return [m for group in matches for m in group if m]');
  lines.push('    return list(matches)');
  lines.push('');
  lines.push('');
  lines.push('def detect_all_operators(message: str) -> dict[str, list[str]]:');
  lines.push('    """Detect all operators in message. Returns dict of operator_id -> matches."""');
  lines.push('    return {');
  lines.push('        op_id: matches');
  lines.push('        for op_id in OPERATORS');
  lines.push('        if (matches := detect_operator(message, op_id))');
  lines.push('    }');
  lines.push('');

  return lines.join('\n');
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const checkMode = process.argv.includes('--check');

  console.log('[generate-operators] Loading operators contract...');
  const contract = await loadContract();
  console.log(`[generate-operators] Found ${contract.operators.length} operators`);

  // Generate TypeScript
  const tsContent = generateTypeScript(contract);
  await ensureDir(TS_OUTPUT_DIR);

  if (checkMode) {
    const existing = await readIfExists(TS_OUTPUT);
    if (existing !== tsContent) {
      console.error(
        '[generate-operators] TypeScript output is stale. Run npm run generate:operators'
      );
      process.exit(1);
    }
  } else {
    await writeFile(TS_OUTPUT, tsContent);
    console.log(`[generate-operators] Generated ${TS_OUTPUT}`);
  }

  // Generate Python
  const pyContent = generatePython(contract);
  await ensureDir(PY_OUTPUT_DIR);

  if (checkMode) {
    const existing = await readIfExists(PY_OUTPUT);
    if (existing !== pyContent) {
      console.error('[generate-operators] Python output is stale. Run npm run generate:operators');
      process.exit(1);
    }
  } else {
    await writeFile(PY_OUTPUT, pyContent);
    console.log(`[generate-operators] Generated ${PY_OUTPUT}`);
  }

  console.log('[generate-operators] Complete');
}

main().catch((err) => {
  console.error('[generate-operators] Error:', err);
  process.exit(1);
});
