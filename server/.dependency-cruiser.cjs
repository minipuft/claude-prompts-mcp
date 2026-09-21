/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ============================================
    // 5-LAYER ARCHITECTURE BOUNDARIES
    // ============================================
    // Layer hierarchy: shared(L0) → infra(L1) → engine(L2) → modules(L3) → mcp(L4)
    // Each layer can only import from layers below it.
    // runtime/ is the application composition boundary and may wire all five layers. The reverse
    // edge is `no-imports-into-runtime` below — the header described that direction for a year
    // while nothing enforced it (measured 2026-09-15: a planted `modules/` → `#runtime/paths.js`
    // import cruised with 0 errors, while the `modules/` → `#infra/config` control failed, so the
    // harness was working and the rule was simply absent).
    // cli-shared/ is a host adapter outside the server request path. Its observed imports remain
    // visible in the generated module catalog; no second permission policy is encoded in
    // module.yaml descriptors. What IS encoded is `cli-shared-no-runtime` below.

    // --- Layer 0: shared/ (foundation, imports nothing) ---
    {
      name: 'shared-no-cross-layer-value',
      comment:
        'shared/ (Layer 0) must not have value imports from other layers. Type-only re-exports are tracked separately.',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: {
        path: '^src/(infra|engine|modules|mcp)/',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'shared-cross-layer-type-only',
      comment:
        'shared/types/ re-exports types from engine/modules. Track for future consolidation.',
      severity: 'warn',
      from: { path: '^src/shared/' },
      to: {
        path: '^src/(infra|engine|modules|mcp)/',
        dependencyTypes: ['type-only'],
      },
    },

    // --- Layer 1: infra/ (adapters, imports only shared/) ---
    {
      name: 'infra-no-cross-layer-value',
      comment: 'infra/ (Layer 1) must not have value imports from engine/modules/mcp.',
      severity: 'error',
      from: { path: '^src/infra/' },
      to: {
        path: '^src/(engine|modules|mcp)/',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'infra-cross-layer-type-only',
      comment: 'infra/ type-only imports from upper layers. Track for consolidation.',
      severity: 'warn',
      from: { path: '^src/infra/' },
      to: {
        path: '^src/(engine|modules|mcp)/',
        dependencyTypes: ['type-only'],
      },
    },

    // --- Layer 2: engine/ (mechanics, imports shared/ + infra/) ---
    {
      name: 'engine-no-modules-or-mcp-value',
      comment: 'engine/ (Layer 2) must not have value imports from modules/ or mcp/.',
      severity: 'error',
      from: { path: '^src/engine/' },
      to: {
        path: '^src/(modules|mcp)/',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'engine-cross-layer-type-only',
      comment:
        'engine/ type-only imports from modules/mcp. Types should move to shared/ or engine/interfaces/.',
      severity: 'warn',
      from: { path: '^src/engine/' },
      to: {
        path: '^src/(modules|mcp)/',
        dependencyTypes: ['type-only'],
      },
    },

    // --- Layer 3: modules/ (domain, imports shared/ + engine/) ---
    {
      name: 'modules-no-infra-static',
      comment:
        'modules/ (Layer 3) must not have static imports from infra/. Use shared/types interfaces + constructor injection.',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: {
        path: '^src/infra/',
        dependencyTypesNot: ['dynamic-import', 'type-only'],
      },
    },
    {
      name: 'modules-infra-dynamic',
      comment:
        'modules/ must not dynamically import infra/. Use constructor injection via DatabasePort.',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: {
        path: '^src/infra/',
        dependencyTypes: ['dynamic-import'],
      },
    },
    {
      name: 'modules-infra-type-only',
      comment: 'modules/ must not have type-only imports from infra/. Use shared/types interfaces.',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: {
        path: '^src/infra/',
        dependencyTypes: ['type-only'],
      },
    },
    {
      name: 'modules-no-mcp',
      comment: 'modules/ (Layer 3) cannot import from mcp/.',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: { path: '^src/mcp/' },
    },

    // --- Layer 4: mcp/ (protocol interface, imports shared/ + engine/ + modules/) ---
    {
      name: 'mcp-no-infra-static',
      comment:
        'mcp/ (Layer 4) must not have static value imports from infra/. Use shared/types interfaces.',
      severity: 'error',
      from: { path: '^src/mcp/' },
      to: {
        path: '^src/infra/',
        dependencyTypesNot: ['dynamic-import', 'type-only'],
      },
    },
    {
      name: 'mcp-infra-dynamic',
      comment:
        'mcp/ must not dynamically import infra/. Use constructor injection via DatabasePort.',
      severity: 'error',
      from: { path: '^src/mcp/' },
      to: {
        path: '^src/infra/',
        dependencyTypes: ['dynamic-import'],
      },
    },

    // --- Composition boundary: runtime/ (wires every layer, imported by none) ---
    {
      name: 'no-imports-into-runtime',
      comment:
        'runtime/ is the composition root: it wires shared/infra/engine/modules/mcp together and ' +
        'owns process lifecycle. Nothing below it may import it. An upward edge into runtime/ ' +
        'means a layer has taken a dependency on HOW the application happens to be assembled — ' +
        'the singletons it holds, the order it initializes them in — which is the one thing a ' +
        'composition root exists to keep out of the layers.\n\n' +
        'The remedy is the one already used for ApiRouterPort and DatabasePort: declare the ' +
        'contract in shared/types, implement it where the implementation belongs, and let ' +
        'runtime/ hand the two together. src/index.ts is deliberately outside the `from` set — it ' +
        'is the process entry point, not a layer.\n\n' +
        'Type-only edges are errors here too, unlike the layer rules above, which grandfather a ' +
        'backlog of type-only imports at `warn`. There is no backlog to grandfather: this ' +
        'direction measured zero type-only edges when the rule was written, and a type reached ' +
        'from the composition root is a contract that belongs in shared/ regardless.',
      severity: 'error',
      from: { path: '^src/(shared|infra|engine|modules|mcp|cli-shared)/' },
      to: { path: '^src/runtime/' },
    },
    {
      name: 'cli-shared-no-runtime',
      comment:
        'cli-shared/ must not REACH server runtime wiring — runtime/, infra/, or mcp/ — through ' +
        'any chain of imports. The CLI bundles this barrel on its own (esbuild, its own ' +
        'package.json, Node >=18.18 rather than the server floor), so a transitive edge into ' +
        'transport, config loading, or logging pulls the whole server into the CLI bundle.\n\n' +
        '`reachable` rather than a direct-edge path, because the claim being defended is about ' +
        'the closure, not the first hop: cli-shared legitimately imports schema modules from ' +
        'modules/ and engine/, and the way infra/ arrives is through one of those, never directly.\n\n' +
        'Added 2026-09-15. `src/cli-shared/index.ts` and docs/guides/cli.md had both cited this ' +
        'rule BY NAME since the CLI split, and it did not exist — tests/unit/cli-shared/' +
        'import-isolation.test.ts ran depcruise over the barrel and asserted "no dependency ' +
        'violations found" against a rule set that expressed nothing about cli-shared. Measured ' +
        'before adding: 32 modules in the barrel closure, 0 in infra/, runtime/, or mcp/.',
      severity: 'error',
      from: { path: '^src/cli-shared/' },
      to: { path: '^src/(infra|runtime|mcp)/', reachable: true },
    },

    // ============================================
    // LAYER SPECIFIER FORM
    // ============================================
    {
      name: 'no-crosslayer-relative',
      comment:
        'A cross-layer import must use its package.json "imports" subpath specifier (#shared/x.js), ' +
        'not a relative chain (../../shared/x.js). The subpath form names the layer it comes from and ' +
        "survives the importing file moving; a ../../ chain encodes the importer's depth into the " +
        'specifier, so moving the file silently changes what it means. Intra-layer relatives are left ' +
        'alone on purpose — "./foo.js" says "next to me", which is information.\n\n' +
        'Ported from scripts/validate-no-crosslayer-relative.js (plan row 2.2, 2026-08-11), which was ' +
        'a script because whether an import crosses a layer is a question about the RESOLVED path and ' +
        'a textual ../../* ban flags 197 legitimate deep intra-layer imports. That reasoning is right ' +
        'about ESLint no-restricted-imports and does not apply here: dependency-cruiser resolves, and ' +
        'dependencyTypesNot separates the subpath form from a relative one. Two properties make it ' +
        'equivalent rather than approximate — the $1 back-reference compares the TO layer against the ' +
        'FROM layer, and tsPreCompilationDeps (already enabled below) is what makes type-only imports ' +
        'visible; without it a type-only cross-layer relative is elided and silently passes.',
      severity: 'error',
      from: { path: '^src/([^/]+)/' },
      to: {
        path: '^src/',
        pathNot: '^src/$1/',
        // Anything reached through an "imports"/paths alias is already in the canonical form.
        dependencyTypesNot: ['aliased-subpath-import', 'aliased-tsconfig', 'aliased-workspace'],
      },
    },

    // ============================================
    // ENGINE INTERNAL ISOLATION
    // ============================================
    {
      name: 'no-frameworks-in-gates',
      comment: 'Gates domain should not depend on Frameworks domain.',
      severity: 'error',
      from: { path: '^src/engine/gates/' },
      to: { path: '^src/engine/frameworks/' },
    },
    {
      name: 'no-gates-in-frameworks',
      comment: 'Frameworks domain should not depend on Gates domain.',
      severity: 'error',
      from: { path: '^src/engine/frameworks/' },
      to: { path: '^src/engine/gates/' },
    },

    // ============================================
    // DOMAIN ACCESS PATTERNS
    // ============================================
    {
      // Replaces scripts/validate-no-tool-layer-validator-imports.js, deleted 2026-08-06 on its
      // own retirement condition ("delete this guard when validate:arch expresses the same edge as
      // a dependency-cruiser layer rule. That is strictly the better home").
      //
      // Stronger than the script on SPECIFIER FORM, which is why the move is not lateral. The
      // script matched `^import … from '…<module>.js'` textually. Measured 2026-08-06 against
      // planted files, two forms reached the same module and the script reported "check passed":
      // an `export … from` re-export placed in the tool layer, and `await import(…)`.
      // dependency-cruiser resolves the edge and reported both.
      //
      // Equal to the script on RENAME fragility, not better — the guard's header claimed a
      // path-based rule "follows the move", but this `to.path` is also a literal list and a
      // renamed schema module empties it just as silently. Recorded rather than inherited.
      //
      // `src/mcp/tools/schemas/` is exempt: .claude/rules/mcp-contracts.md assigns MCP PARAMETER
      // validation to exactly that directory, and this rule defends a different boundary — the
      // tool layer must not run RESOURCE-CONTENT validation instead of delegating to
      // ResourceVerificationService. Type-only imports are excluded because they pull no logic in.
      name: 'tool-layer-no-validator-value-imports',
      comment:
        'mcp/tools/ must not value-import resource validators or schemas. Use ResourceVerificationService from modules/resources/services instead.',
      severity: 'error',
      from: { path: '^src/mcp/tools/', pathNot: '^src/mcp/tools/schemas/' },
      to: {
        path: '^src/(cli-shared/resource-validation|modules/prompts/prompt-schema|engine/gates/core/gate-schema|engine/frameworks/definitions/framework-schema|modules/formatting/core/style-schema|modules/automation/core/script-schema)',
        dependencyTypesNot: ['type-only'],
      },
    },
    // `no-runtime-state-direct-access` was deleted here on 2026-09-15. It read
    // `to: { path: 'runtime-state/' }` with three exempted source files, and it could not fire in
    // either half. `runtime-state/` is a directory the server WRITES at run time; no module
    // resolves inside it, so the `to` set was empty of modules by construction, and
    // dependency-cruiser sees import edges, not the string literals that would be the real risk.
    // Two of its three exemptions had also stopped existing — `framework-state-manager.ts` and
    // `gate-state-manager.ts` are `*-state-store.ts` now. A rule that cannot fire reads as
    // coverage while providing none. The boundary it gestured at (state reached through a store,
    // not opened directly) is held by `modules-no-infra-static` and the DatabasePort contract.
    {
      name: 'no-mcp-tools-to-execution-internals',
      comment: 'MCP tools should use the execution pipeline, not internal execution modules.',
      severity: 'warn',
      from: { path: '^src/mcp/' },
      to: {
        path: 'src/engine/execution/pipeline/stages/',
        pathNot: 'index\\.ts$',
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
    // STANDARD RULES
    // ============================================
    {
      name: 'no-orphans',
      comment: 'Orphan modules should be removed or integrated.',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.test\\.ts$',
          'index\\.ts$',
          '_generated/',
        ],
      },
      to: {},
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
  },
};
