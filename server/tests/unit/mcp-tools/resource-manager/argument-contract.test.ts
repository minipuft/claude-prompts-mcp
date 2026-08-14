import { describe, expect, it } from '@jest/globals';

import { PRESERVED_PROMPT_YAML_KEYS } from '../../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { UPDATE_FIELDS } from '../../../../src/mcp/tools/resource-manager/prompt/utils/validation.js';
import { resourceManagerInputSchema } from '../../../../src/mcp/tools/schemas/resource-manager.schema.js';

/**
 * P7-D1. The tool's Zod schema accepted only `{name, type, description}` for an argument, so Zod's
 * default strip discarded `required`, `defaultValue` and `validation` at the FIRST boundary — the
 * contract, `core/types.ts` and the loader all declared `required` and none of them ever saw it.
 *
 * These assert on what `parse` RETURNS rather than on whether it throws: the defect was silent
 * acceptance, so a test that only checked for an absent error passed against the broken schema.
 */
describe('resource_manager argument contract', () => {
  const base = { resource_type: 'prompt' as const, action: 'create' as const, id: 'sample' };

  function parseArguments(args: unknown[]): Array<Record<string, unknown>> {
    const parsed = resourceManagerInputSchema.parse({ ...base, arguments: args });
    return (parsed.arguments ?? []) as Array<Record<string, unknown>>;
  }

  it('preserves required:true through the tool schema', () => {
    const [arg] = parseArguments([{ name: 'feature', type: 'string', required: true }]);

    expect(arg?.required).toBe(true);
  });

  it('preserves required:false rather than dropping it as falsy', () => {
    const [arg] = parseArguments([{ name: 'feature', required: false }]);

    // `false` and "absent" mean the same thing to the loader today, but they are different
    // authored intents and a writer that cannot tell them apart cannot round-trip either.
    expect(arg).toHaveProperty('required', false);
  });

  it('preserves defaultValue, including falsy values', () => {
    const [text, count, flag] = parseArguments([
      { name: 'text', defaultValue: 'hello' },
      { name: 'count', type: 'number', defaultValue: 0 },
      { name: 'flag', type: 'boolean', defaultValue: false },
    ]);

    expect(text?.defaultValue).toBe('hello');
    expect(count?.defaultValue).toBe(0);
    expect(flag?.defaultValue).toBe(false);
  });

  it('preserves the validation block that arms required-argument enforcement', () => {
    const [arg] = parseArguments([
      { name: 'feature', required: true, validation: { minLength: 3, pattern: '^[a-z]+$' } },
    ]);

    expect(arg?.validation).toEqual({ minLength: 3, pattern: '^[a-z]+$' });
  });

  it('accepts an argument declaring only a name', () => {
    // `type` and `description` were mandatory tool-side and optional loader-side. The drift meant
    // the tool refused prompts the loader accepts.
    const [arg] = parseArguments([{ name: 'feature' }]);

    expect(arg?.name).toBe('feature');
  });

  it('rejects a type outside the loader vocabulary', () => {
    // Was `z.string()`, so `str` reached the YAML and failed at LOAD time instead of at the call.
    expect(() =>
      resourceManagerInputSchema.parse({ ...base, arguments: [{ name: 'feature', type: 'str' }] })
    ).toThrow();
  });

  it('accepts the five preserved prompt fields as parameters (OQ-P7-8)', () => {
    // Owner ruling 2026-08-13. Until this landed the five could SURVIVE an update but not be SET
    // by one, which made them authorable only by hand — a state MCP-tooling-only forbids (P7-F7).
    // Asserts on what `parse` RETURNS: `.passthrough()` means an unmodelled parameter also reaches
    // the router, so "no error" proves nothing about whether the schema models the field.
    const parsed = resourceManagerInputSchema.parse({
      ...base,
      injection: { 'system-prompt': { enabled: false, frequency: { mode: 'first-only' } } },
      register_with_mcp: false,
      mcp_prompt_mode: 'launch',
      subagent_model: 'heavy',
      agent_type: 'code-lifecycle-auditor',
    });

    expect(parsed.injection).toEqual({
      'system-prompt': { enabled: false, frequency: { mode: 'first-only' } },
    });
    expect(parsed.register_with_mcp).toBe(false);
    expect(parsed.mcp_prompt_mode).toBe('launch');
    expect(parsed.subagent_model).toBe('heavy');
    expect(parsed.agent_type).toBe('code-lifecycle-auditor');
  });

  it('rejects values outside the loader vocabulary for the preserved fields', () => {
    // The value is written verbatim into `prompt.yaml`, so a shape wider here than
    // `PromptYamlSchema` is accepted at the call and rejected at LOAD — the prompt is dropped with
    // nothing but a log line. Each case is its own expect so a widened enum fails by name.
    expect(() => resourceManagerInputSchema.parse({ ...base, subagent_model: 'opus' })).toThrow();
    expect(() =>
      resourceManagerInputSchema.parse({ ...base, mcp_prompt_mode: 'inline' })
    ).toThrow();
    expect(() => resourceManagerInputSchema.parse({ ...base, agent_type: '' })).toThrow();
    // `PromptInjectionConfigSchema` is `.strict()` at both levels.
    expect(() =>
      resourceManagerInputSchema.parse({
        ...base,
        injection: { 'system-promt': { enabled: true } },
      })
    ).toThrow();
    expect(() =>
      resourceManagerInputSchema.parse({
        ...base,
        injection: { 'system-prompt': { enabled: true, conditions: [] } },
      })
    ).toThrow();
  });

  it('still strips an unrecognised argument key', () => {
    // OQ-P7-2: explicit fields, not `.passthrough()`. The sibling `chain_steps` IS passthrough
    // because a step is an opaque object; an argument is a typed contract and passthrough would
    // admit arbitrary keys into persisted YAML.
    const [arg] = parseArguments([{ name: 'feature', requred: true }]);

    expect(arg).not.toHaveProperty('requred');
  });
});

/**
 * Row 1.5. `UPDATE_FIELDS` is the SSOT for what `update` can SET; `PRESERVED_PROMPT_YAML_KEYS` is
 * the SSOT for what it carries forward untouched. Every field the writer can emit has to be in one
 * of them or it is silently deleted by the next update — which is exactly the defect P7-F2 names.
 */
describe('prompt.yaml write coverage', () => {
  it('accounts for every field the writer emits as settable, preserved, or identity', () => {
    // Read off `createOrUpdateYamlPrompt` — the single writer of a prompt's own prompt.yaml.
    const emittedByWriter = [
      'id',
      'name',
      'category',
      'description',
      'systemMessage',
      'userMessageTemplate',
      'arguments',
      'gateConfiguration',
      'chainSteps',
      'tools',
      ...PRESERVED_PROMPT_YAML_KEYS,
    ];

    const settable = new Set(Object.values(UPDATE_FIELDS));
    const preserved = new Set<string>(PRESERVED_PROMPT_YAML_KEYS);
    // `id` names the prompt being updated, so it is an address rather than a value. `tools` is
    // read straight off `args.tools` by both create and update instead of going through the merge
    // map, because the tool parameter carries full definitions and the YAML carries only ids.
    const notThroughTheMergeMap = new Set(['id', 'tools']);

    const unaccounted = emittedByWriter.filter(
      (field) => !settable.has(field) && !preserved.has(field) && !notThroughTheMergeMap.has(field)
    );

    expect(unaccounted).toEqual([]);
  });

  /**
   * Replaces "keeps the settable and preserved sets disjoint" (retired at OQ-P7-8).
   *
   * Disjointness was never the property worth holding — TWO WRITE MODELS was, and disjointness was
   * a proxy for it that held only while the preserved fields had no tool parameter. The owner
   * ruling gives all five a parameter, so every one is now both settable and preserved, and the
   * proxy would fail on a change that introduced no second write model at all.
   *
   * The real invariant is the one below plus its precedence half:
   * `resolvePreservedPromptYamlFields` is a SINGLE resolver — supplied value first, on-disk value
   * second — so a field being in both sets means one model with a fallback. What would still be a
   * defect is a field settable through some path OTHER than that resolver, which is what the
   * exact-overlap assertion pins: the overlap may be the preserved set, and nothing else.
   */
  it('makes every preserved field settable, and nothing else settable-and-preserved', () => {
    const settable = new Set(Object.values(UPDATE_FIELDS));
    const preserved = [...PRESERVED_PROMPT_YAML_KEYS];

    const notSettable = preserved.filter((field) => !settable.has(field));
    expect(notSettable).toEqual([]);

    const overlap = Object.values(UPDATE_FIELDS).filter((field) =>
      (PRESERVED_PROMPT_YAML_KEYS as readonly string[]).includes(field)
    );
    expect(overlap.sort()).toEqual([...preserved].sort());
  });

  it('routes every preserved field through a parameter the input schema models', () => {
    // The mapping is only half the path: a `UPDATE_FIELDS` key with no matching schema member is
    // the inverse of DEV-T1-4's inert entry — the merge would fire only for a parameter Zod does
    // not model, which `.passthrough()` makes silently possible.
    const schemaKeys = new Set(Object.keys(resourceManagerInputSchema.shape));
    const preservedParameters = Object.entries(UPDATE_FIELDS)
      .filter(([, field]) => (PRESERVED_PROMPT_YAML_KEYS as readonly string[]).includes(field))
      .map(([parameter]) => parameter);

    expect(preservedParameters).toHaveLength(PRESERVED_PROMPT_YAML_KEYS.length);
    expect(preservedParameters.filter((parameter) => !schemaKeys.has(parameter))).toEqual([]);
  });
});
