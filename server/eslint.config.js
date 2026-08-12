import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
// import-x, not eslint-plugin-import. The latter has no ESLint 10 release and does not merely
// warn under it — `import/order` throws `sourceCode.getTokenOrCommentAfter is not a function`
// at rule setup, which takes the whole lint run down. import-x is the maintained fork and
// declares eslint ^10. The rule IDs change with the plugin name (`import/*` -> `import-x/*`),
// so the ratchet baseline keys were renamed in place to carry their counts across the swap.
import importPlugin from 'eslint-plugin-import-x';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import sonarjs from 'eslint-plugin-sonarjs';
import claudePlugin from './eslint-rules/claude-plugin.js';

const lifecycleAnnotationTargets = [
  'src/engine/**/*.ts',
  'src/modules/**/*.ts',
  'src/runtime/**/*.ts',
  'src/infra/**/*.ts',
  'src/mcp/**/*.ts',
  'src/shared/utils/**/*.ts',
  'src/shared/types/**/*.ts',
  'src/shared/core/**/*.ts',
];

export default [
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript files configuration (source files)
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'import-x': importPlugin,
      prettier: prettierPlugin,
      claude: claudePlugin,
      sonarjs: sonarjs,
    },
    rules: {
      // TypeScript strict rules
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
        },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // Import rules
      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling'],
            'index',
            'object',
            'type',
          ],
          // `@/**` matched nothing — this repo never used that prefix. Subpath imports
          // (package.json "imports") are the internal-module form.
          pathGroups: [
            {
              pattern: '#**',
              group: 'internal',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'import-x/no-duplicates': 'error',
      'import-x/no-cycle': 'error',
      'import-x/newline-after-import': 'error',

      // Cross-layer relative imports are enforced by `validate:no-crosslayer-relative`,
      // NOT by no-restricted-imports. A textual `../../*` ban flags 197 legitimate deep
      // intra-layer imports and zero real violations: `mcp/tools/handlers/x.ts` importing
      // `../../schemas/y.js` never leaves `mcp`. Whether an import crosses a layer is a
      // question about the resolved path, so the guard resolves it.

      // General rules - warn on all console usage, use EnhancedLogger instead
      'no-console': 'warn',

      // Complexity enforcement (PRIMARY quality gate — ratcheted)
      //
      // Cognitive complexity is the gate. Cyclomatic (`complexity`) is off: the two
      // measure overlapping things, and where they disagree cyclomatic is the worse
      // signal. It counts every `??` and `?.` as a branch, so idiomatic optional
      // chaining inflates it without making anything harder to read — a pure 20-line
      // predicate here measured 11 against a limit of 10 purely from null-coalescing.
      // Cognitive complexity weights nesting instead, which is what actually costs a
      // reader. Keeping both meant the worse metric did the blocking.
      'sonarjs/cognitive-complexity': ['warn', 15],
      complexity: 'off',
      'max-depth': ['warn', 4],
      // 6, not 4: a stage constructor taking five injected services is dependency
      // injection, not a defect. The threshold flags genuine outliers (7+) rather
      // than pushing every wired-up class toward an options object.
      'max-params': ['warn', 6],
      // File-level line count (ADVISORY — secondary signal)
      'max-lines': ['warn', { max: 1000, skipBlankLines: true, skipComments: true }],

      // Prettier integration
      'prettier/prettier': 'error',

      // Disable rules that conflict with TypeScript
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // Lifecycle guardrails - deprecated import paths
      'claude/no-legacy-imports': [
        'error',
        {
          patterns: [
            // Generic legacy patterns
            'legacy/',
            '/legacy/',
            '@legacy/',
            'legacy-',
            // Deleted parser files (now in command-parser.ts and symbolic-operator-parser.ts)
            'symbolic-command-parser',
            'unified-command-parser',
            // Deleted TypeScript framework guides (now YAML under resources/frameworks/).
            // The directory was `frameworks/methodology/guides/` before the pass-4 rename;
            // both spellings stay banned so neither path can come back.
            { type: 'regex', value: 'frameworks/(methodology|definitions)/guides/.*-guide' },
          ],
        },
      ],
      // Prefer execution context barrel imports (non-blocking)
      'claude/no-context-deep-imports': [
        'warn',
        {
          allowInternal: true,
        },
      ],
      // Forbid pure re-export shims carrying a compat marker. Ported from
      // scripts/validate-no-crosslayer-reexport.js.
      //
      // This carried `allowlist: ['src/types.ts']` until 2026-08-06 (row 0.6). That entry's own
      // retirement condition was "when no file imports from `src/types.js`, delete both the file
      // and this entry" — and it had already been met: measured 0 dependents via dependency-cruiser,
      // 0 resolving import specifiers repo-wide, and `knip` listed the file as unused. Nothing
      // reported it, because an exception suppresses its finding whether or not it is still true.
      //
      // The `allowlist` option was removed from the rule with the last entry rather than left empty.
      // A future exemption uses `eslint-disable`, which ESLint reports as an "Unused eslint-disable
      // directive" once it stops being needed — the satisfied-exception detection a config array
      // structurally cannot offer.
      'claude/no-compat-reexport-shim': 'error',
      // Block legacy executor symbols that should no longer exist
      'no-restricted-syntax': [
        'error',
        {
          selector: "Identifier[name='ChainExecutor']",
          message: 'ChainExecutor is deprecated. Use PromptExecutionPipeline instead.',
        },
        {
          selector: "Identifier[name='ConsolidatedPromptEngine']",
          message: 'ConsolidatedPromptEngine is deprecated. Use PromptExecutionPipeline instead.',
        },
        // Replaces scripts/validate-no-prompt-gates-alias.js, deleted 2026-08-06 (row 1.5).
        //
        // These two entries live in THIS array rather than a file-scoped block on purpose. In flat
        // config a later block REPLACES a rule's options rather than merging them, so a block
        // scoped to the processor file would have silently dropped the two selectors above for
        // exactly that file. Measured 2026-08-06: across all of `src/`, `args.gates` appears as a
        // direct operand of `||`/`??` in one place, so repo-wide scope costs nothing here.
        //
        // The deleted script pinned two literal EXPRESSIONS (`||`, bracket access, property
        // position). The defect returned on 2026-03-18 — one week after that script landed on
        // 2026-03-11 — written `args.gate_configuration ?? args.gates`, and the script reported
        // "No legacy prompt gate alias usage found" for ~5 months. These selectors match the SHAPE
        // instead: `args.gates` coalesced onto anything, in either operator.
        {
          selector:
            "LogicalExpression[operator='||'] > MemberExpression[object.name='args'][property.name='gates']",
          message:
            '`gates` is a [Framework] parameter and `gate_configuration` is a [Prompt] one. Coalescing them gives one concept two accepted spellings at the tool boundary. Read the parameter that belongs to the resource type being handled.',
        },
        {
          selector:
            "LogicalExpression[operator='??'] > MemberExpression[object.name='args'][property.name='gates']",
          message:
            '`gates` is a [Framework] parameter and `gate_configuration` is a [Prompt] one. Coalescing them gives one concept two accepted spellings at the tool boundary. Read the parameter that belongs to the resource type being handled.',
        },
      ],
    },
  },

  // TypeScript test files configuration
  // The `tests/**` config block that stood here was inert. A files-less `ignores` block below
  // declares `'tests/**'`, which in ESLint flat config is a GLOBAL ignore and wins over any
  // `files` match — so its ~157 lines of test-specific rules never ran, from 0963d4ac
  // (2026-01-05) until removal. Deleted rather than left as a breadcrumb; recover with
  // `git show <this commit>^:server/eslint.config.js` if tests are ever un-ignored.
  //
  // Un-ignoring is a real option, not a lost one — measured cost 2026-08-06:
  // 1,514 errors + 1,470 warnings across 213 files, absorbable by `lint:ratchet` baseline.
  // Until then ESLint cannot see `tests/`, which is why guards scanning it (validate-no-stepstate)
  // cannot become ESLint rules without losing scope.

  // Prettier config (disables conflicting rules)
  prettierConfig,

  // Console usage exemptions - early startup files where logger is not available yet
  {
    files: [
      'src/index.ts', // Main entry point - early startup before logger initialization
      'src/runtime/startup.ts', // Rollback mechanism and critical diagnostics
      'src/infra/logging/index.ts', // Logger implementation - fallback console for error cases
    ],
    rules: {
      // Allow console usage in these files for early startup and critical diagnostics
      // All other files must use EnhancedLogger
      'no-console': 'off',
    },
  },

  // Lifecycle annotations required for guarded runtime files
  // Replaces scripts/validate-no-execution-mode.js, deleted 2026-08-06 (row 1.4).
  //
  // The script ripgrepped `-w -i 'mode'` over these paths, so it matched comments, prose and
  // string literals as well as code — which is where most of its allowlist came from. This rule
  // reads the AST, so prose cannot match and those entries have no successor. Measured 2026-08-06
  // before the port: 46 text hits in scope and 10 allowlist entries, of which 3 were not
  // load-bearing — two named `scripts/` and `package.json`, which the script's own SCOPE never
  // visited, and `non-strict mode` was already covered by the `strict mode` entry. What survives
  // the port is the deprecation fold, expressed below as `ignores` rather than as rule options.
  //
  // RETIREMENT: when script authors can no longer be carrying pre-migration YAML, delete the
  // transform in core/script-schema.ts, the migration branch in core/script-definition-loader.ts,
  // and these two `ignores` entries in the same change.
  {
    files: ['src/modules/automation/**/*.ts', 'src/shared/types/automation.ts'],
    ignores: [
      'src/modules/automation/core/script-schema.ts',
      'src/modules/automation/core/script-definition-loader.ts',
    ],
    plugins: { claude: claudePlugin },
    rules: { 'claude/no-deprecated-automation-mode': 'error' },
  },

  {
    files: lifecycleAnnotationTargets,
    ignores: ['src/**/_generated/**'],
    plugins: {
      claude: claudePlugin,
    },
    rules: {
      'claude/require-file-lifecycle': [
        'error',
        {
          allowedStatuses: ['canonical', 'migrating'],
          requireDescription: true,
        },
      ],
    },
  },

  // Scripts configuration (Node.js environment)
  {
    files: ['scripts/**/*.js', 'scripts/**/*.cjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Inflow governance for new guard scripts.
  //
  // CONVENTION: a `validate-no-*` guard must state its disposition in a header comment:
  //
  //     MECHANISM: script — reach|relation|resolution — <what it reads or resolves>
  //     MECHANISM: rehome — eslint|dependency-cruiser|jest — <plan row that owns the port>
  //
  //   reach      — reads files the linter cannot see (`tests/`, `../cli/`, `../docs/`, non-TS)
  //   relation   — compares two artifacts; ESLint is single-file and cannot
  //   resolution — needs a resolved module path, not a literal match (dependency-cruiser's job)
  //
  // A guard pending a move declares `rehome` IN ITSELF rather than sitting in a config allowlist.
  // The allowlist form was tried first and removed 2026-08-06: it is a second place to update, and
  // a rule only visits files that exist, so an entry naming a deleted guard is never reported —
  // observed when a retired guard orphaned its entry and nothing caught it. An in-file marker dies
  // with the `rm` that deletes the guard, so the stale-entry class cannot occur at all.
  //
  // A guard that cannot name one of the three is a source-pattern check and belongs in this
  // plugin, where it folds into a pass ESLint already makes. Measured 2026-08-06: a trivial guard
  // costs 138 ms through npm before doing any work, and `validate:all` spends roughly 4.5 s of its
  // 38.7 s on process startup alone. This rule exists because `validate-no-llm-client.js` (283 ln)
  // landed as a script mid-plan with no such decision recorded.
  //
  // Tier 1.2 issued all eight verdicts 2026-08-06: one retired into `.dependency-cruiser.cjs` and
  // was deleted, five state `script`, two state `rehome` pending rows 1.4 and 1.5. Every verdict
  // now lives in the guard it describes, so this block carries no per-file exemptions at all.
  {
    files: ['scripts/validate-no-*.js'],
    plugins: {
      claude: claudePlugin,
    },
    rules: {
      'claude/require-guard-mechanism-verdict': 'error',
    },
  },

  // Row 4.3 — form without truth. Scoped to gate scripts, where `closedBy` can only mean a
  // retirable suppression of that gate's own findings; elsewhere in the tree the word does not
  // appear. Deliberately NOT scoped by declaration name — see the rule's header for why
  // `ALLOWED_METRIC_LABELS` and friends make that probe useless.
  {
    files: ['scripts/validate-*.js', 'scripts/validate-*.ts', 'scripts/verify-*.mjs'],
    plugins: {
      claude: claudePlugin,
    },
    rules: {
      'claude/require-exception-audit': 'error',
    },
  },

  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'tests/**',
      'temp/**',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
    ],
  },
];
