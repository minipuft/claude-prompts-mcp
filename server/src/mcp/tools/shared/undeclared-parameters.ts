// @lifecycle canonical - One refusal, three tools: an argument key no contract declares.
/**
 * An argument key a tool does not declare is a security property, not a tidiness one.
 *
 * All three tools used to answer a call carrying an undeclared key with SUCCESS. Zod strips an
 * unknown key before the registered callback runs, so the key never reached a handler and nothing
 * said so — measured 2026-09-20 over both transports on `f711401b`:
 *
 *   prompt_engine  {command:">>listprompts", force_restrt:true}  → prompt list, isError:false
 *   prompt_engine  {command:">>listprompts", dry_run:true}       → prompt list, isError:false
 *   system_control {action:"status", previw:true}                → status, isError:false
 *
 * The cost is not a dropped convenience flag. A caller — or a model reading a prompt-injected
 * instruction — that sends a SAFETY flag under a slightly wrong name gets a success reply while
 * the server did the unguarded thing: a `dry_run`/`preview`/`confirm` typo performs the real
 * write. This repo has already paid it once, with the schema doing exactly this stripping: a
 * `skills_sync` preview wrote 33 real files because the registered schema dropped the undeclared
 * flag. Refusing by name turns that class into a loud error at the boundary.
 *
 * ONE mechanism, three tools (R50). `resource_manager` refused first (#342) because its flat
 * schema serves four resource types; that refusal's undeclared half now lives here, so the rule a
 * caller meets is the same whichever tool they called.
 *
 * The declared key set is read from the CONTRACT (`tooling/contracts/*.json`, via the generated
 * metadata) rather than from each hand-written Zod schema. The contract is what `tools/list`
 * publishes and what a client validates against, so it is the set a caller could have known;
 * `tests/unit/mcp-tools/tool-input-fields.test.ts` already pins each schema against it in both
 * directions, so reading either gives the same answer and reading the contract says why.
 *
 * NOT a guard where the defect lives: the defect is the silent ACCEPTANCE, and this stands at the
 * boundary before any dispatch, write, or version snapshot.
 *
 * SCOPE — top-level `arguments` keys only. `_meta` is a client-protocol field carried on
 * `params`, beside `arguments`, never inside it (verified against the SDK: `validateToolInput`
 * receives `request.params.arguments`), so it is not reachable here and needs no exemption.
 * Nested object keys are a separate axis this function does not touch: a contract declares
 * parameters, not the shape inside one. Which nested schemas already refuse is recorded in
 * `docs/reference/mcp-tools.md`.
 */

import { prompt_engineParameters } from '../../contracts/schemas/_generated/prompt_engine.generated.js';
import { resource_managerParameters } from '../../contracts/schemas/_generated/resource_manager.generated.js';
import { system_controlParameters } from '../../contracts/schemas/_generated/system_control.generated.js';

import { nearestDeclaredParameter } from '#shared/utils/nested-key-refusal.js';

/** The three tools this server publishes, and the only names with a contract to read. */
export type ContractToolName = 'prompt_engine' | 'system_control' | 'resource_manager';

/** Every parameter each tool's contract declares — the union across all reachable states. */
export const DECLARED_PARAMETERS_BY_TOOL: Readonly<Record<ContractToolName, ReadonlySet<string>>> =
  {
    prompt_engine: new Set(prompt_engineParameters.map((parameter) => parameter.name)),
    system_control: new Set(system_controlParameters.map((parameter) => parameter.name)),
    resource_manager: new Set(resource_managerParameters.map((parameter) => parameter.name)),
  };

/**
 * A declared parameter the CURRENT runtime state does not advertise, and why.
 *
 * `prompt_engine` advertises a union: `gates`, `gate_verdict` and `gate_action` appear only while
 * the gate system is enabled (CLAUDE.md §Public API Contract). Such a key is declared-but-
 * unavailable, and telling its sender "not a parameter of prompt_engine" would be false — the
 * contract names it. It gets its own message, which says what to turn on.
 */
export type UnavailableParameters = ReadonlyMap<string, string>;

/** `action:"guide"` is how a caller re-reads the contract, and each tool spells it differently. */
const GUIDE_HINT: Readonly<Record<ContractToolName, string>> = {
  prompt_engine: '`>>listprompts` and the tool description list what this tool accepts.',
  system_control: '`action:"guide"` lists what this tool accepts.',
  resource_manager: '`resource_type:"prompt", action:"guide"` lists what this tool accepts.',
};

/**
 * "Was it SENT", not "is the key present".
 *
 * JSON has no `undefined`, so nothing arriving over MCP reaches here this way; an in-process
 * caller building its argument object with an unset optional field does, and refusing that would
 * be refusing a key nobody sent. A JSON `null` is a value, and is still refused.
 */
function sentKeys(args: object): string[] {
  const record = args as Record<string, unknown>;
  return Object.keys(record).filter((key) => record[key] !== undefined);
}

/**
 * Why this call sends keys the named tool will not read, or `null` when every key is live.
 *
 * Returns the message rather than a boolean: the caller needs the parameter's name, not
 * "invalid". EVERY undeclared key is named in one message (R50) — a caller who sent three typos
 * should not have to make three round trips to learn about the second and third.
 *
 * Unavailable-but-declared keys are reported separately and FIRST, because "turn gates on" and
 * "you misspelled this" are different corrections and merging them would obscure both.
 */
export function describeUndeclaredParameterRefusal(
  tool: ContractToolName,
  args: object,
  unavailable: UnavailableParameters = new Map()
): string | null {
  const declared = DECLARED_PARAMETERS_BY_TOOL[tool];
  const sent = sentKeys(args);

  const unavailableSent = sent.filter((key) => unavailable.has(key));
  if (unavailableSent.length > 0) {
    const reason = unavailable.get(unavailableSent[0] as string) as string;
    return (
      `${quoteList(unavailableSent)} ${unavailableSent.length === 1 ? 'is a parameter' : 'are parameters'} of ${tool}, ` +
      `but not one this server is advertising right now: ${reason}\n\n` +
      `It was accepted and ignored before, which reported a success for something that never ran.`
    );
  }

  const undeclared = sent.filter((key) => !declared.has(key));
  if (undeclared.length === 0) return null;

  // One offender needs no arrow — "did you mean 'force_restart'?" is the whole correction. Two or
  // more do, or the reader cannot tell which suggestion belongs to which key.
  const suggestions = undeclared
    .map((key) => {
      const nearest = nearestDeclaredParameter(key, declared);
      if (nearest === undefined) return null;
      return undeclared.length === 1 ? `'${nearest}'` : `'${key}' → '${nearest}'`;
    })
    .filter((entry): entry is string => entry !== null);

  return (
    `${quoteList(undeclared)} ${undeclared.length === 1 ? 'is not a parameter' : 'are not parameters'} of ${tool}.\n\n` +
    (suggestions.length > 0 ? `Did you mean ${suggestions.join(', ')}?\n\n` : '') +
    `It was accepted and ignored before, which reported a success for something that never ran. ` +
    `Check the spelling, or drop it from this call — ${GUIDE_HINT[tool]}`
  );
}

/** `'a'`, `'a' and 'b'`, `'a', 'b' and 'c'` — names in the order they were sent. */
function quoteList(names: readonly string[]): string {
  const quoted = names.map((name) => `'${name}'`);
  if (quoted.length === 1) return quoted[0] as string;
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1] as string}`;
}

/**
 * The gate parameters `prompt_engine` withdraws from its advertised surface while gates are off.
 *
 * Built from the contract rather than a second literal list so the union members and the
 * unavailability rule cannot drift apart.
 */
export const GATE_PARAMETERS_UNAVAILABLE: UnavailableParameters = new Map(
  (['gates', 'gate_verdict', 'gate_action'] as const).map((name) => [
    name,
    'the gate system is disabled, so nothing reads a gate parameter. Enable it with ' +
      '`system_control action:"gates", operation:"enable"`, or drop it from this call.',
  ])
);
