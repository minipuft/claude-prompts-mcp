#!/usr/bin/env python3
"""
UserPromptSubmit hook: Directive injection for claude-prompts.

Detects >>syntax and operators, outputs:
- systemMessage: Compact user confirmation
- additionalContext: Structured directive for Claude

Architecture:
- Layer 1: MCP-native prompts (via registerPrompt) - standard protocol
- Layer 2: This hook - efficiency layer translating >>syntax to prompt_engine calls

Operators detected (from SSOT registry):
- `-->` chain, `==>` delegation, `::` gate, `@` framework, `#` style, `* N` repetition
"""

import json
import re
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from cache_manager import (
    ArgumentInfo,
    PromptInfo,
    fuzzy_match_prompt_id,
    get_chains_only,
    get_prompt_by_id,
    get_valid_frameworks,
    get_valid_styles,
    load_prompts_cache,
    match_prompts_to_intent,
)
from config_loader import is_expanded_output
from db_reader import load_active_chain_state
from session_state import ChainState, format_chain_reminder, load_session_state

# Import generated operator patterns (SSOT: server/tooling/contracts/operators.json)
try:
    from operators import OPERATORS, detect_operator, get_delimiter_symbols

    HAS_GENERATED_OPERATORS = True
except ImportError:
    HAS_GENERATED_OPERATORS = False
    OPERATORS = {}

    def get_delimiter_symbols() -> list[str]:
        return ["-->", "==>"]


def format_arguments(prompt_id: str) -> dict[str, str]:
    """
    Extract argument info from prompt metadata.

    Returns dict of arg_name -> "type (required|optional)"
    If options are available, shows: "opt1 | opt2 | opt3 (required)"
    """
    prompt = get_prompt_by_id(prompt_id)
    if not prompt:
        return {}
    args = prompt.get("arguments", [])
    result: dict[str, str] = {}
    for arg in args:
        if not isinstance(arg, dict) or not arg.get("name"):
            continue
        name = arg.get("name", "")
        options = arg.get("options")
        if options and isinstance(options, list) and len(options) > 0:
            # Show options inline: "tutorial | howto | reference"
            type_str = " | ".join(options)
        else:
            type_str = arg.get("type", "string")
        req = "required" if arg.get("required") else "optional"
        result[name] = f"{type_str} ({req})"
    return result


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def detect_prompt_invocation(message: str) -> str | None:
    """
    Detect >> prompt invocation syntax.
    Returns the prompt ID/name if found.

    Examples:
        >>deep_analysis -> "deep_analysis"
        >> code_review -> "code_review"
        >>research-comprehensive -> "research-comprehensive"
        @CAGEERF >>analyze -> "analyze"
        #analytical >>report -> "report"
    """
    # Try exact start first
    match = re.match(r"^>>\s*([a-zA-Z0-9_-]+)", message.strip())
    if match:
        # Normalize to lowercase for case-insensitive matching (aligns with MCP server)
        return match.group(1).lower()

    # Also check for >> after operators (@framework, #style)
    match = re.search(r">>\s*([a-zA-Z0-9_-]+)", message)
    if match:
        # Normalize to lowercase for case-insensitive matching (aligns with MCP server)
        return match.group(1).lower()

    return None


def detect_explicit_request(message: str) -> bool:
    """Detect explicit prompt suggestion requests."""
    triggers = [
        r"\bsuggest\s+prompts?\b",
        r"\blist\s+prompts?\b",
        r"\bavailable\s+prompts?\b",
        r"\bshow\s+prompts?\b",
        r"\bwhat\s+prompts?\b",
        r"\bprompt\s+suggestions?\b",
        r"\brecommend\s+prompts?\b",
    ]
    message_lower = message.lower()
    return any(re.search(trigger, message_lower) for trigger in triggers)


def detect_chain_syntax(message: str) -> list[str]:
    """
    Detect chain syntax (-->, ==>) in message.
    Returns list of prompt IDs in chain order (normalized to lowercase).

    Splits on delimiter operators from SSOT registry (plus → unicode alias),
    then extracts >>prompt_id from each segment. Handles arguments between
    prompt ID and delimiter correctly.

    Example: >>analyze --> >>implement --> >>test
    Example with args: >>analyze scope:"backend" --> >>implement
    Example with delegation: >>step1 ==> >>step2
    """
    # Build split pattern from SSOT delimiter symbols
    delimiters = get_delimiter_symbols()
    escaped = [re.escape(d) for d in delimiters] + ["→"]
    split_pattern = r"\s*(?:" + "|".join(escaped) + r")\s*"

    parts = re.split(split_pattern, message)
    if len(parts) <= 1:
        return []

    # Extract >>prompt_id from each segment (ignores arguments safely)
    prompts = []
    for part in parts:
        match = re.search(r">>\s*([a-zA-Z0-9_-]+)", part)
        if match:
            prompts.append(match.group(1).lower())

    return prompts


def detect_inline_gates(message: str) -> list[str]:
    """
    Detect :: gate syntax in message.
    Returns list of gate criteria/IDs.

    Examples:
        :: 'must check security' -> ["must check security"]
        :: security-check -> ["security-check"]

    Note: Always uses semantic extraction (not generated patterns) because
    we need gate content, not the :: symbol itself.
    """
    # Always use semantic patterns - generated pattern returns operator symbol too
    quoted_pattern = r'::\s*[\'"]([^\'"]+)[\'"]'
    id_pattern = r"::\s*([a-zA-Z][a-zA-Z0-9_-]*)\b"

    quoted = re.findall(quoted_pattern, message)
    ids = re.findall(id_pattern, message)

    return quoted + ids


def detect_framework(message: str) -> str | None:
    """
    Detect @FRAMEWORK syntax in message.
    Returns the framework ID if found (normalized to lowercase).

    Examples:
        @CAGEERF >>analyze -> "cageerf"
        @ReACT >>debug -> "react"

    Note: Framework IDs are normalized to lowercase to align with MCP server storage.
    """
    if HAS_GENERATED_OPERATORS:
        matches = detect_operator(message, "framework")
        # Normalize to lowercase (MCP server stores framework keys as lowercase)
        return matches[0].lower() if matches else None

    # Fallback: hardcoded pattern
    match = re.search(r"(?:^|\s)@([A-Za-z0-9_-]+)(?=\s|$)", message)
    return match.group(1).lower() if match else None


def detect_repetition(message: str) -> int | None:
    """
    Detect * N repetition syntax in message.
    Returns the repetition count if found.

    Examples:
        >>prompt * 3 -> 3
        >>analyze * 5 --> >>summarize -> 5
    """
    if HAS_GENERATED_OPERATORS:
        matches = detect_operator(message, "repetition")
        return int(matches[0]) if matches else None

    # Fallback: hardcoded pattern
    match = re.search(r"\s+\*\s*(\d+)(?=\s|$|-->)", message)
    return int(match.group(1)) if match else None


def parse_inline_args(message: str) -> dict[str, str]:
    """
    Parse key:"value" or key:'value' argument patterns from message.
    Only parses quoted values for safety (avoids misparsing URLs/special chars).

    Examples:
        >>prompt content:"hello world" -> {"content": "hello world"}
        >>prompt scope:'global' limit:"10" -> {"scope": "global", "limit": "10"}
    """
    pattern = r'(\w+):["\']([^"\']+)["\']'
    matches = re.findall(pattern, message)
    return dict(matches)


def get_required_args(prompt_info: PromptInfo | None, parsed_args: dict[str, str]) -> list[str]:
    """
    Get list of required arguments that haven't been provided.

    Args:
        prompt_info: Prompt metadata from cache (may be None)
        parsed_args: Already parsed arguments from message

    Returns:
        List of required argument names not in parsed_args
    """
    if not prompt_info:
        return []

    args = prompt_info.get("arguments", [])
    required = []
    for arg in args:
        if isinstance(arg, dict) and arg.get("required", False):
            name = arg.get("name", "")
            if name and name not in parsed_args:
                required.append(name)
    return required


def get_chain_step_args(
    prompt_ids: list[str],
) -> list[tuple[str, list[ArgumentInfo]]]:
    """Fetch arguments for each prompt in a chain.

    Args:
        prompt_ids: List of prompt IDs in chain order

    Returns:
        List of (prompt_id, arguments) tuples
    """
    result: list[tuple[str, list[ArgumentInfo]]] = []
    for pid in prompt_ids:
        info = get_prompt_by_id(pid)
        args = info.get("arguments", []) if info else []
        result.append((pid, args))
    return result


def format_arg_signature(arg: ArgumentInfo, include_desc: bool = False) -> str:
    """Format a single argument for display.

    Args:
        arg: Argument dict with name, type, required, description
        include_desc: If True, append truncated description for context

    Returns:
        Compact format: name*:type or name*:type (description...)
    """
    name = arg.get("name", "unknown")
    arg_type = arg.get("type", "string")
    required = arg.get("required", False)
    req_marker = "*" if required else ""
    base = f"{name}{req_marker}:{arg_type}"

    if include_desc:
        desc = arg.get("description", "")
        if desc:
            # Truncate long descriptions for token efficiency
            short = desc[:50] + "..." if len(desc) > 50 else desc
            return f"{base} ({short})"
    return base


def format_chain_step_args(
    step_data: list[tuple[str, list[ArgumentInfo]]],
    current_step: int = 1,
    total_steps: int = 0,
) -> list[str]:
    """Format chain steps with their arguments (balanced mode).

    Args:
        step_data: List of (prompt_id, arguments) tuples
        current_step: 1-based current step (arrow marker)
        total_steps: Total steps (for header)

    Returns:
        Lines including header and step list
    """
    total = total_steps or len(step_data)
    lines = [f"[MCP Chain] Step {current_step}/{total}"]

    for i, (pid, args) in enumerate(step_data, start=1):
        # Arrow marker for current step
        marker = "→" if i == current_step else " "

        # Balanced: first 2 args get descriptions, rest signature only
        arg_parts = []
        for j, arg in enumerate(args[:5]):  # Max 5 args shown
            sig = format_arg_signature(arg, include_desc=(j < 2))
            arg_parts.append(sig)

        arg_str = ", ".join(arg_parts) if arg_parts else "(no args)"
        lines.append(f"  {marker}{i}. >>{pid}: {arg_str}")

    return lines


def format_chain_preview(
    prompt_info: PromptInfo | None = None,
    adhoc_chain: list[str] | None = None,
) -> list[str]:
    """
    Format a chain preview showing all steps before execution.
    Handles both predefined chains (from prompt_info) and ad-hoc chains (from --> syntax).

    Args:
        prompt_info: Prompt metadata from cache (for predefined chains)
        adhoc_chain: List of prompt IDs from --> syntax (for ad-hoc chains)

    Returns:
        Lines for chain preview, or empty list if not a chain
    """
    # Case 1: Predefined chain prompt (has chainSteps in YAML)
    if prompt_info and prompt_info.get("is_chain"):
        step_ids = prompt_info.get("chain_step_ids") or []
        step_names = prompt_info.get("chain_step_names") or []
        total_steps = prompt_info.get("chain_steps", 0)

        if not step_names and not step_ids:
            return [f"[Chain Workflow] {total_steps} steps"]

        lines = [f"[Chain Workflow] {total_steps} steps:"]
        max_steps = max(len(step_ids), len(step_names), total_steps)
        for i in range(max_steps):
            step_id = step_ids[i] if i < len(step_ids) else "unknown"
            step_name = step_names[i] if i < len(step_names) else step_id
            lines.append(f"  {i + 1}. {step_id}: {step_name}")
        return lines

    # Case 2: Ad-hoc chain (using --> syntax)
    if adhoc_chain and len(adhoc_chain) > 1:
        lines = [f"[Chain Workflow] {len(adhoc_chain)} steps:"]
        for i, prompt_id in enumerate(adhoc_chain):
            lines.append(f"  {i + 1}. {prompt_id}")
        return lines

    return []


def format_tool_call(prompt_id: str, info: dict) -> str:
    """Generate a copy-paste ready tool call."""
    args = info.get("arguments", [])

    if not args:
        return f'prompt_engine(command:">>{prompt_id}")'

    # Build options object
    options_parts = []
    for arg in args:
        name = arg.get("name", "")
        default = arg.get("default")
        placeholder = f'"{default}"' if default else f'"<{name}>"'
        options_parts.append(f'"{name}": {placeholder}')

    options_str = ", ".join(options_parts)
    return f'prompt_engine(command:">>{prompt_id}", options:{{{options_str}}})'


def format_prompt_suggestion(prompt_id: str, info: PromptInfo, score: int = 0) -> str:
    """Format a single prompt suggestion. Compact single-line format."""
    chain_tag = f" [{info.get('chain_steps', 0)}]" if info.get("is_chain") else ""
    desc = info.get("description", "")[:60]
    return f"  >>{prompt_id}{chain_tag}: {desc}"


def format_user_message(
    command: str,
    parsed_args: dict[str, str],
    operators: dict[str, list[str]],
    arguments: dict[str, str] | None = None,
    expanded: bool = False,
    prompt_info: PromptInfo | None = None,
) -> str:
    """
    Format user-visible confirmation message.

    Args:
        command: The full command string (e.g., ">>deep_analysis" or "@CAGEERF >>analyze")
        parsed_args: Parsed arguments from message
        operators: Detected operators dict
        arguments: Prompt arguments with types (from format_arguments)
        expanded: If True, show detailed multi-line output
        prompt_info: Prompt metadata from cache (for chain preview)

    Returns:
        Compact: "[>>] deep_analysis | content:'foo'"
        Expanded: Multi-line with operators, arguments, and support info
    """
    # Extract prompt ID from command (handle @framework >>prompt syntax)
    # Normalize to lowercase for case-insensitive matching (aligns with MCP server)
    match = re.search(r">>\s*([a-zA-Z0-9_-]+)", command)
    prompt_id = match.group(1).lower() if match else command.lower()

    if expanded:
        return _format_expanded_message(prompt_id, command, parsed_args, operators, arguments, prompt_info)

    # Compact mode (default)
    # Include prompt_engine hint so user knows a tool is being invoked
    parts = [f"[>> prompt_engine] {prompt_id}"]

    # Add parsed args
    if parsed_args:
        arg_strs = [f'{k}:"{v}"' for k, v in list(parsed_args.items())[:3]]
        parts.append(" | " + ", ".join(arg_strs))

    # Add operator indicators (compact)
    op_indicators = []
    if operators.get("chain"):
        op_indicators.append(f"chain:{len(operators['chain'])}steps")
    if operators.get("repetition"):
        op_indicators.append(f"*{operators['repetition'][0]}")
    if operators.get("framework"):
        op_indicators.append(f"@{operators['framework'][0]}")
    if operators.get("style"):
        op_indicators.append(f"#{operators['style'][0]}")
    if operators.get("gate"):
        op_indicators.append(f"gates:{len(operators['gate'])}")
    if operators.get("delegation"):
        op_indicators.append("delegated")

    if op_indicators:
        parts.append(" [" + ", ".join(op_indicators) + "]")

    base_message = "".join(parts)

    # Add chain preview for chain prompts (predefined or ad-hoc)
    chain_preview = format_chain_preview(prompt_info, operators.get("chain"))
    if chain_preview:
        return base_message + "\n" + "\n".join(chain_preview)

    return base_message


def _format_expanded_message(
    prompt_id: str,
    command: str,
    parsed_args: dict[str, str],
    operators: dict[str, list[str]],
    arguments: dict[str, str] | None = None,
    prompt_info: PromptInfo | None = None,
) -> str:
    """
    Format expanded multi-line user message with full details.
    """
    # Include prompt_engine hint so user knows a tool is being invoked
    lines = [f"[>> prompt_engine] {prompt_id}"]

    # Add chain workflow preview for chain prompts (predefined or ad-hoc)
    chain_preview = format_chain_preview(prompt_info, operators.get("chain"))
    if chain_preview:
        lines.extend(chain_preview)

    # Show operators with descriptions
    if operators:
        op_parts = []
        if operators.get("chain"):
            op_parts.append(f"chain ({len(operators['chain'])} steps)")
        if operators.get("framework"):
            op_parts.append(f"@{operators['framework'][0]}")
        if operators.get("style"):
            op_parts.append(f"#{operators['style'][0]}")
        if operators.get("repetition"):
            op_parts.append(f"repeat x{operators['repetition'][0]}")
        if operators.get("gate"):
            gate_list = ", ".join(operators["gate"][:2])
            op_parts.append(f"gates: {gate_list}")
        if operators.get("delegation"):
            op_parts.append("delegation (==> sub-agent)")
        if op_parts:
            lines.append(f"  Operators: {' | '.join(op_parts)}")

    # Show arguments with types (always show, even if empty)
    arg_strs = [f"{k}: {v}" for k, v in list((arguments or {}).items())[:4]]
    args_line = ", ".join(arg_strs) if arg_strs else "(none)"
    lines.append(f"  Arguments: {args_line}")

    # Show provided options
    if parsed_args:
        opt_strs = [f'{k}="{v}"' for k, v in list(parsed_args.items())[:3]]
        lines.append(f"  Provided: {', '.join(opt_strs)}")

    return "\n".join(lines)


def format_directive(
    command: str,
    parsed_args: dict[str, str],
    required_args: list[str],
    operators: dict[str, list[str]],
    arguments: dict[str, str] | None = None,
    prompt_info: PromptInfo | None = None,
) -> str:
    """
    Format token-efficient tool directive for Claude.

    Uses structured tags and minimal imperative language to ensure Claude
    recognizes this as a required action, not optional context.

    Design: ~40 tokens base, scales with params. One blocking instruction.

    Args:
        command: The full command string
        parsed_args: Parsed arguments from message
        required_args: Required args not yet provided
        operators: Detected operators dict
        arguments: Prompt arguments with types (from format_arguments)
        prompt_info: Prompt metadata from cache (for chain workflow context)

    Returns:
        Structured directive that Claude will execute immediately
    """
    lines = ["<CALL-TOOL>"]

    # Build compact param line: prompt_engine | command:"..." | gates:[...] | options:{...}
    parts = ["prompt_engine"]
    parts.append(f'command:"{command}"')

    if operators.get("gate"):
        parts.append(f"gates:{json.dumps(operators['gate'])}")

    if parsed_args:
        parts.append(f"options:{json.dumps(parsed_args)}")

    lines.append(" | ".join(parts))

    # Chain context (compact, only if chain)
    if prompt_info and prompt_info.get("is_chain"):
        step_names = prompt_info.get("chain_step_names") or []
        if step_names:
            lines.append(f"chain:{json.dumps(step_names)}")

    # Missing args hint (compact)
    if required_args:
        lines.append(f"missing:{json.dumps(required_args)}")

    # Single blocking instruction (essential for compliance)
    lines.append("REQUIRED: Execute now. Do not respond to >> prompts directly.")
    lines.append("</CALL-TOOL>")

    return "\n".join(lines)


def main():
    hook_input = parse_hook_input()

    # Get user's message from hook input
    # UserPromptSubmit provides the user's prompt in 'user_prompt' field
    user_message = hook_input.get("user_prompt", "") or hook_input.get("prompt", "") or hook_input.get("message", "")
    session_id = hook_input.get("session_id", "")

    if not user_message:
        # No message to process
        sys.exit(0)

    if not load_prompts_cache():
        # No prompt data available - silent exit
        sys.exit(0)

    # Check for direct prompt invocation (>>prompt_id) or chain syntax
    invoked_prompt = detect_prompt_invocation(user_message)
    chain_prompts = detect_chain_syntax(user_message)
    is_prompt_invocation = invoked_prompt or (chain_prompts and len(chain_prompts) > 0)

    if is_prompt_invocation:
        # === DIRECTIVE MODE: >>syntax detected ===
        # Generate split output: compact systemMessage + structured directive

        # Detect operators — semantic extraction for chain/gate (need content),
        # SSOT patterns for framework/style/repetition/delegation (symbol detection)
        operators: dict[str, list[str]] = {}

        # Chain: semantic extraction via SSOT delimiters (need prompt IDs, not just symbols)
        if chain_prompts and len(chain_prompts) > 1:
            operators["chain"] = chain_prompts

        # Gate: semantic extraction (need criteria content, not just :: symbol)
        inline_gates = detect_inline_gates(user_message)
        if inline_gates:
            operators["gate"] = inline_gates

        if HAS_GENERATED_OPERATORS:
            # Delegation: detect ==> presence via SSOT pattern
            delegation_matches = detect_operator(user_message, "delegation")
            if delegation_matches:
                operators["delegation"] = delegation_matches

            # Framework: validate against DB, pass through if DB unavailable
            fw_matches = detect_operator(user_message, "framework")
            if fw_matches:
                valid_fws = get_valid_frameworks()
                if valid_fws:
                    filtered = [fw for fw in fw_matches if fw.lower() in valid_fws]
                    if filtered:
                        operators["framework"] = filtered
                else:
                    # DB unavailable — pass through (server validates)
                    operators["framework"] = fw_matches

            # Style: validate against DB, pass through if DB unavailable
            style_matches = detect_operator(user_message, "style")
            if style_matches:
                valid_styles = get_valid_styles()
                if valid_styles:
                    filtered = [s for s in style_matches if s.lower() in valid_styles]
                    if filtered:
                        operators["style"] = filtered
                else:
                    operators["style"] = style_matches

            # Repetition: no validation needed (it's a number)
            rep_matches = detect_operator(user_message, "repetition")
            if rep_matches:
                operators["repetition"] = rep_matches
        else:
            # Fallback: manual detection with DB-aware validation
            framework = detect_framework(user_message)
            if framework:
                valid_fws = get_valid_frameworks()
                if not valid_fws or framework.lower() in valid_fws:
                    operators["framework"] = [framework]

            style_match = re.search(r"(?:^|\s)#([A-Za-z][A-Za-z0-9_-]*)(?=\s|$)", user_message)
            if style_match:
                style = style_match.group(1)
                valid_styles = get_valid_styles()
                if not valid_styles or style.lower() in valid_styles:
                    operators["style"] = [style]

            repetition = detect_repetition(user_message)
            if repetition:
                operators["repetition"] = [str(repetition)]

            if "==>" in user_message:
                operators["delegation"] = ["==>"]

        # Parse inline arguments (quoted only)
        parsed_args = parse_inline_args(user_message)

        # Get prompt info from cache
        prompt_info = get_prompt_by_id(invoked_prompt) if invoked_prompt else None

        # Early return for unknown prompts: provide fuzzy suggestions without tool call
        # This saves tokens by avoiding a failing server round-trip
        if invoked_prompt and prompt_info is None:
            suggestions = fuzzy_match_prompt_id(invoked_prompt)

            if suggestions:
                message = f"Unknown prompt '{invoked_prompt}'. Did you mean: {', '.join(suggestions)}?"
            else:
                message = f"Unknown prompt '{invoked_prompt}'. No similar prompts found."

            # Return message WITHOUT directive (no tool call needed)
            hook_response = {
                "systemMessage": message,
                "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": message},
            }
            print(json.dumps(hook_response))
            sys.exit(0)

        # Get required args that are missing
        required_args = get_required_args(prompt_info, parsed_args)

        # Get argument type info for LLM guidance
        arguments = format_arguments(invoked_prompt) if invoked_prompt else None

        # Use full message as command (server parses it)
        # Preserve @framework, #style prefixes and all operators
        command = user_message.strip()

        # Format outputs (check config for expanded mode)
        # Pass prompt_info for chain workflow visibility
        expanded = is_expanded_output()
        system_message = format_user_message(command, parsed_args, operators, arguments, expanded, prompt_info)
        directive = format_directive(command, parsed_args, required_args, operators, arguments, prompt_info)

        hook_response = {
            "systemMessage": system_message,  # Compact user confirmation
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": directive,  # Structured directive for Claude
            },
        }
        print(json.dumps(hook_response))
        sys.exit(0)

    # === CHAIN ENFORCEMENT: Active chain needs continuation ===
    # SSOT: read from server's state.db (works without PostToolUse hook)
    session_state: ChainState | None = load_active_chain_state()  # type: ignore[assignment]
    # Fallback: hooks-state.db (if PostToolUse populated it)
    if not session_state and session_id:
        session_state = load_session_state(session_id)
    if session_state:
        chain_id = session_state.get("chain_id", "")
        step = session_state.get("current_step", 0)
        total = session_state.get("total_steps", 0)
        pending_gate = session_state.get("pending_gate")

        # Block if: steps remain OR pending gate/verify at final step
        needs_continuation = chain_id and step > 0 and step < total
        needs_review = chain_id and step > 0 and pending_gate
        if needs_continuation or needs_review:
            # Build imperative directive matching >>syntax pattern
            if pending_gate:
                directive = (
                    f'<GATE-REVIEW>chain_id="{chain_id}" gates="{pending_gate}" → Submit gate_verdict</GATE-REVIEW>'
                )
            else:
                directive = (
                    f"<CALL-TOOL>\n"
                    f'prompt_engine | chain_id:"{chain_id}"\n'
                    f"REQUIRED: Continue active chain (step {step}/{total}). "
                    f"Do not respond without advancing.\n"
                    f"</CALL-TOOL>"
                )

            system_msg = format_chain_reminder(session_state, mode="inline")
            hook_response = {
                "systemMessage": system_msg,
                "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": directive},
            }
            print(json.dumps(hook_response))
            sys.exit(0)

    # === INFORMATIONAL MODE: No >>syntax, no active chain ===
    # Fall back to suggestions (no tool directive)
    output_lines = []

    # Check for explicit suggestion request
    if detect_explicit_request(user_message):
        matches = match_prompts_to_intent(user_message, max_results=3)

        if matches:
            output_lines.append("[MCP Suggestions]")
            for prompt_id, info, _score in matches:
                output_lines.append(format_prompt_suggestion(prompt_id, info))
        else:
            chains = get_chains_only()
            if chains:
                output_lines.append("[MCP Chains]")
                for prompt_id, info in list(chains.items())[:3]:
                    output_lines.append(format_prompt_suggestion(prompt_id, info))

    # Output informational context (same to both user and Claude)
    if output_lines:
        output = "\n".join(output_lines)
        hook_response = {
            "systemMessage": output,
            "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": output},
        }
        print(json.dumps(hook_response))
        sys.exit(0)
    else:
        sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[MCP Hook Error] {e}", file=sys.stderr)
        sys.exit(1)  # Exit 1 for actual errors
