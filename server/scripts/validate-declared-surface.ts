// @lifecycle canonical - Enumeration gate: every loader-schema field is authorable or exempt.
/**
 * Declared-surface parity.
 *
 * THE CLASS THIS CLOSES: a field the resource LOADER schema declares, which the published
 * `resource_manager` input schema does not — so the field is real, written to disk, read at
 * load, and invisible to any client reading the contract. P4.1/P4.4/P4.5 each fixed one
 * instance by hand; without a gate the next schema field reintroduces the class silently,
 * because nothing about adding a key to `GateDefinitionSchema` makes anyone open the tool
 * schema. `framework_gates` is the worked example: hard-required by `FrameworkDraftValidator`,
 * so the cheapest way to discover its shape was to provoke the error for omitting it.
 *
 * WHY THIS IMPORTS RATHER THAN SCANS. The property being measured is "is this key declared in
 * that zod object", and a zod object can answer that exactly. A text scanner would re-derive it
 * from regexes over `foo: z.string()` lines and would answer a DIFFERENT question — whether a
 * token co-occurs with a schema-shaped pattern — which is the failure mode that already cost
 * this repo two false greens (`validate:registry-coherence` reading a doc comment as code, and
 * its own fixture then mutating that comment). Scripts are outside `src/mcp/tools/**`, so
 * `validate:arch`'s `tool-layer-no-validator-value-imports` rule does not apply here; the tool
 * layer still reaches schema keys only through the engine-side seam (`gate-yaml-keys.ts`).
 *
 * DIRECTION. This walks loader → tool. The reverse (a tool parameter no loader declares) is a
 * different defect with a different fix, and two of them exist deliberately today:
 * `framework_elements` and `argument_suggestions` are read by `generic-framework-guide.ts` but
 * ride `FrameworkSchema`'s `.passthrough()`, so they have no declared loader home to walk from.
 *
 * Run: `npm run validate:declared-surface` · self-test: `--self-test`
 */
import { CategorySchema } from '../src/modules/prompts/prompt-schema.js';
import { GateDefinitionSchema } from '../src/engine/gates/core/gate-schema.js';
import {
  FrameworkSchema,
  PhasesFileSchema,
} from '../src/engine/frameworks/definitions/framework-schema.js';
import { resourceManagerInputSchema } from '../src/mcp/tools/schemas/resource-manager.schema.js';

/** camelCase / PascalCase → snake_case, the convention every tool parameter follows. */
function toSnakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Loader key → tool parameter, where the two names genuinely differ.
 *
 * Each entry is a rename someone chose, not an accident, so it is spelled out rather than
 * derived: a derivation would silently absorb the next accidental divergence.
 */
const NAME_ALIASES: Readonly<Record<string, Record<string, string>>> = {
  gate: {
    // P4.10 removed this map's only gate entry that renamed anything: `type` now reaches the
    // tool surface as `type` and `gate_type` as `gate_type`, so both fall out of `toSnakeCase`.
    enforcementMode: 'enforcement_mode',
  },
  framework: {
    type: 'framework',
    judgePromptFile: 'judge_prompt',
  },
};

interface Exemption {
  /** Loader key not expected to appear as a tool parameter. */
  readonly key: string;
  /** Why authoring it through the tool is wrong or impossible. */
  readonly reason: string;
  /**
   * What makes this exemption stop being true. Evaluated every run — an exemption whose
   * condition no longer holds is a FINDING, not a silent pass. A `✓` and a `☐` rot the same
   * way; this is the check that reads the unmarked half.
   */
  readonly stillExempt: () => boolean;
}

const EXEMPTIONS: Readonly<Record<string, readonly Exemption[]>> = {
  gate: [
    {
      key: 'guidanceFile',
      reason:
        'GateFileWriter always writes guidance.md and points guidanceFile at it. A caller-set ' +
        'value would name a file the writer does not produce.',
      stillExempt: () => true,
    },
  ],
  framework: [
    {
      key: 'version',
      reason: 'Owned by the versioning system; a caller-set semver would diverge from history.',
      stillExempt: () => true,
    },
    {
      key: 'phasesFile',
      reason:
        'FrameworkFileWriter owns the phases.yaml path. Its CONTENT is authorable through ' +
        'processing_steps / execution_steps / execution_flow / template_enhancements / ' +
        'quality_indicators / execution_type_enhancements.',
      stillExempt: () => true,
    },
  ],
};

/** True when a zod field describes exactly the given enum members, in any order. */
function describesEnum(field: unknown, expected: readonly string[]): boolean {
  const values = enumValuesOf(field);
  return values.length === expected.length && expected.every((member) => values.includes(member));
}

function enumValuesOf(field: unknown): string[] {
  const def = (field as { _def?: unknown })?._def as
    { innerType?: unknown; entries?: Record<string, string>; values?: string[] } | undefined;
  if (def === undefined) return [];
  if (def.innerType !== undefined) return enumValuesOf(def.innerType);
  if (def.entries !== undefined) return Object.values(def.entries);
  if (Array.isArray(def.values)) return def.values;
  return [];
}

interface SurfaceSpec {
  readonly resourceType: string;
  /** Loader-declared keys, from the zod objects themselves. */
  readonly loaderKeys: readonly string[];
}

function buildSurfaces(): SurfaceSpec[] {
  return [
    { resourceType: 'gate', loaderKeys: Object.keys(GateDefinitionSchema.shape) },
    {
      resourceType: 'framework',
      loaderKeys: [...Object.keys(FrameworkSchema.shape), ...Object.keys(PhasesFileSchema.shape)],
    },
    // `category` joined at P4.7, and it is the surface this gate would most have wanted to be
    // watching earlier: `CategorySchema` had a real reader for every one of its five keys and no
    // WRITER anywhere in `src/`, so all five were loader-declared and unauthorable — the exact
    // class stated at the top of this file, at its widest. It carries NO exemption: the tool
    // parameters `id`, `name`, `description`, `register_with_mcp` and `mcp_prompt_mode` cover the
    // whole schema, the last two having existed for prompts all along.
    { resourceType: 'category', loaderKeys: Object.keys(CategorySchema.shape) },
  ];
}

interface Finding {
  readonly resourceType: string;
  readonly detail: string;
}

/**
 * The comparator, isolated from the real schemas so the self-test can drive it with a synthetic
 * surface and prove it reports a divergence it was shown.
 */
function findDivergences(
  surfaces: readonly SurfaceSpec[],
  toolParameters: ReadonlySet<string>,
  exemptions: Readonly<Record<string, readonly Exemption[]>>
): Finding[] {
  const findings: Finding[] = [];

  for (const surface of surfaces) {
    const aliases = NAME_ALIASES[surface.resourceType] ?? {};
    const exemptForType = exemptions[surface.resourceType] ?? [];
    const exemptKeys = new Set(exemptForType.map((entry) => entry.key));

    for (const loaderKey of surface.loaderKeys) {
      if (exemptKeys.has(loaderKey)) continue;
      const expected = aliases[loaderKey] ?? toSnakeCase(loaderKey);
      if (!toolParameters.has(expected)) {
        findings.push({
          resourceType: surface.resourceType,
          detail:
            `loader key '${loaderKey}' has no tool parameter (expected '${expected}'). ` +
            'Declare it in resourceManagerInputSchema + the contract, or add an exemption ' +
            'naming why it cannot be authored and what would flip that.',
        });
      }
    }

    // The other half: an exemption that has stopped being true reads as coverage while
    // excusing a field that is now perfectly authorable.
    for (const entry of exemptForType) {
      if (!entry.stillExempt()) {
        findings.push({
          resourceType: surface.resourceType,
          detail:
            `exemption for '${entry.key}' no longer holds — its condition changed. ` +
            `Recorded reason: ${entry.reason} Remove the exemption and declare the field.`,
        });
      }
    }
  }

  return findings;
}

function toolParameterNames(): Set<string> {
  return new Set(Object.keys(resourceManagerInputSchema.shape));
}

/**
 * Positive controls. A clean run of the real comparison is evidence only once the comparator
 * has been shown to observe a divergence and a satisfied exemption.
 */
function selfTest(): number {
  const failures: string[] = [];
  const realParameters = toolParameterNames();

  // Control 1 — an undeclared loader key MUST be reported.
  const withExtraKey = findDivergences(
    [{ resourceType: 'gate', loaderKeys: ['id', 'name', 'a_key_no_tool_declares'] }],
    realParameters,
    {}
  );
  if (!withExtraKey.some((f) => f.detail.includes('a_key_no_tool_declares'))) {
    failures.push('control 1: an undeclared loader key was NOT reported');
  }

  // Control 2 — the same run must stay quiet about keys that ARE declared, or control 1
  // proves only that the comparator reports everything.
  if (withExtraKey.some((f) => f.detail.includes("'id'") || f.detail.includes("'name'"))) {
    failures.push('control 2: a declared loader key was reported as missing');
  }

  // Control 3 — a satisfied exemption MUST be reported.
  const satisfied = findDivergences(
    [{ resourceType: 'gate', loaderKeys: ['id'] }],
    realParameters,
    {
      gate: [
        {
          key: 'id',
          reason: 'synthetic exemption whose condition is already false',
          stillExempt: () => false,
        },
      ],
    }
  );
  if (!satisfied.some((f) => f.detail.includes('no longer holds'))) {
    failures.push('control 3: a satisfied exemption was NOT reported');
  }

  // Control 4 — an exemption that still holds must stay silent.
  const holding = findDivergences(
    [{ resourceType: 'gate', loaderKeys: ['some_unauthorable_key'] }],
    realParameters,
    {
      gate: [
        {
          key: 'some_unauthorable_key',
          reason: 'synthetic exemption that still holds',
          stillExempt: () => true,
        },
      ],
    }
  );
  if (holding.length > 0) {
    failures.push('control 4: a holding exemption produced a finding');
  }

  // Control 5 — the alias map must be load-bearing. `judgePromptFile` is the remaining genuine
  // rename (tool parameter `judge_prompt`, so `toSnakeCase` alone yields the wrong name). Drive
  // the SAME loader key under a resource type the map does not cover: it must be reported there
  // and silent under `framework`, or the aliases are decoration and the next real rename passes
  // unnoticed. `findDivergences` reads `NAME_ALIASES` by resource type, which is what makes the
  // two runs differ.
  const unaliased = findDivergences(
    [{ resourceType: 'prompt', loaderKeys: ['judgePromptFile'] }],
    realParameters,
    {}
  );
  if (!unaliased.some((f) => f.detail.includes('judgePromptFile'))) {
    failures.push('control 5: an un-aliased renamed loader key was NOT reported');
  }
  const aliased = findDivergences(
    [{ resourceType: 'framework', loaderKeys: ['judgePromptFile'] }],
    realParameters,
    {}
  );
  if (aliased.length > 0) {
    failures.push('control 5: the alias map failed to cover judgePromptFile');
  }

  // Control 6 — P4.10's end state, asserted directly. These two loader keys are the pair that
  // shared one tool-parameter name; a regression that re-points either is a rename this gate's
  // own alias map would happily absorb, so it is checked by VALUE rather than by presence.
  const shape = resourceManagerInputSchema.shape as Record<string, unknown>;
  if (!describesEnum(shape['type'], ['validation', 'guidance'])) {
    failures.push("control 6: tool parameter 'type' no longer writes the gate.yaml key `type`");
  }
  if (!describesEnum(shape['gate_type'], ['framework', 'category', 'custom'])) {
    failures.push(
      "control 6: tool parameter 'gate_type' no longer writes the gate.yaml key `gate_type`"
    );
  }

  if (failures.length > 0) {
    console.error('❌ validate:declared-surface self-test FAILED');
    for (const failure of failures) console.error(`   - ${failure}`);
    return 1;
  }
  console.log('✅ validate:declared-surface self-test passed (6 controls)');
  return 0;
}

function main(): number {
  if (process.argv.includes('--self-test')) return selfTest();

  const findings = findDivergences(buildSurfaces(), toolParameterNames(), EXEMPTIONS);
  if (findings.length > 0) {
    console.error('❌ Declared-surface parity: loader fields that no client can discover\n');
    for (const finding of findings) {
      console.error(`   [${finding.resourceType}] ${finding.detail}`);
    }
    console.error(
      '\nA field declared by a loader schema and absent from the tool schema is settable ' +
        'only by reading server source.'
    );
    return 1;
  }

  const surfaces = buildSurfaces();
  const walked = surfaces.reduce((sum, surface) => sum + surface.loaderKeys.length, 0);
  console.log(
    `✅ Declared-surface parity: ${walked} loader keys across ${surfaces.length} resource types ` +
      'are authorable or exempt.'
  );
  return 0;
}

process.exit(main());
