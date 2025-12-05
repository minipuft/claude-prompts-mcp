/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ============================================
    // LEGACY SYSTEM DETECTION
    // ============================================
    {
      name: 'no-legacy-execution-systems',
      comment: 'Legacy execution systems should not exist. Use PromptExecutionPipeline.',
      severity: 'error',
      from: {},
      to: {
        path: [
          'src/execution/engine\\.ts$',
          'src/execution/execution-coordinator\\.ts$',
          'src/execution/unified-prompt-processor\\.ts$',
        ],
      },
    },
    {
      name: 'no-legacy-parser-files',
      comment: 'Legacy parser files deleted. Use command-parser.ts and symbolic-operator-parser.ts.',
      severity: 'error',
      from: {},
      to: {
        path: [
          'src/execution/parsers/symbolic-command-parser\\.ts$',
          'src/execution/parsers/unified-command-parser\\.ts$',
        ],
      },
    },
    {
      name: 'no-legacy-typescript-methodology-guides',
      comment: 'TypeScript methodology guides deleted. Use YAML methodologies in /methodologies.',
      severity: 'error',
      from: {},
      to: {
        path: 'src/frameworks/methodology/guides/.*-guide\\.ts$',
      },
    },

    // ============================================
    // ARCHITECTURE BOUNDARIES
    // ============================================
    {
      name: 'methodology-via-loader-only',
      comment: 'Methodology YAML files should only be accessed via RuntimeMethodologyLoader.',
      severity: 'warn',
      from: {
        pathNot: [
          'src/frameworks/methodology/runtime-methodology-loader\\.ts$',
          'src/frameworks/methodology/methodology-hot-reload\\.ts$',
        ],
      },
      to: {
        path: 'methodologies/',
      },
    },
    {
      name: 'no-runtime-state-direct-access',
      comment: 'Runtime state should be accessed via managers, not directly.',
      severity: 'warn',
      from: {
        pathNot: [
          'src/chain-session/manager\\.ts$',
          'src/frameworks/framework-state-manager\\.ts$',
          'src/gates/gate-state-manager\\.ts$',
        ],
      },
      to: {
        path: 'runtime-state/',
      },
    },

    // ============================================
    // CIRCULAR DEPENDENCY PREVENTION
    // ============================================
    {
      name: 'no-circular',
      comment: 'Circular dependencies create maintenance issues.',
      severity: 'warn',
      from: {},
      to: {
        circular: true,
      },
    },

    // ============================================
    // LAYER VIOLATIONS
    // ============================================
    {
      name: 'no-mcp-tools-to-execution-internals',
      comment: 'MCP tools should use the execution pipeline, not internal execution modules.',
      severity: 'warn',
      from: {
        path: 'src/mcp-tools/',
      },
      to: {
        path: 'src/execution/pipeline/stages/',
        pathNot: 'index\\.ts$',
      },
    },

    // ============================================
    // STANDARD RULES
    // ============================================
    {
      name: 'no-orphans',
      comment: 'Orphan modules should be removed or integrated.',
      severity: 'info',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.test\\.ts$',
          'index\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'no-deprecated-core',
      comment: 'Do not depend on deprecated Node.js core modules.',
      severity: 'warn',
      from: {},
      to: {
        dependencyTypes: ['core'],
        path: [
          '^(punycode|domain|constants|sys|_linklist|_stream_wrap)$',
        ],
      },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Do not import modules that cannot be resolved.',
      severity: 'error',
      from: {},
      to: {
        couldNotResolve: true,
      },
    },
    {
      name: 'no-non-package-json',
      comment: 'Do not depend on modules outside package.json.',
      severity: 'error',
      from: {},
      to: {
        dependencyTypes: ['unknown', 'undetermined', 'npm-no-pkg', 'npm-unknown'],
      },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Production code should not import devDependencies.',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: '\\.test\\.ts$',
      },
      to: {
        dependencyTypes: ['npm-dev'],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules', 'dist', 'coverage'],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      dot: {
        theme: {
          graph: {
            splines: 'ortho',
          },
        },
      },
      archi: {
        theme: {
          graph: {
            splines: 'ortho',
          },
        },
      },
    },
  },
};
