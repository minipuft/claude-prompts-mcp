"""
Cache manager for Claude Code hooks.
Loads and queries MCP prompt/gate metadata from SQLite resource_index.

Uses db_reader for SQLite access to runtime-state/state.db (read-only).
"""

from typing import TypedDict, cast

from db_reader import (
    get_prompt_by_id_from_db,
    get_valid_frameworks_from_db,
    get_valid_styles_from_db,
    load_gates,
    load_prompts,
)


class ArgumentInfo(TypedDict):
    name: str
    type: str
    required: bool
    description: str
    default: str | None
    options: list[str] | None


class PromptInfo(TypedDict):
    id: str
    name: str
    category: str
    description: str
    is_chain: bool
    chain_steps: int
    chain_step_ids: list[str] | None
    chain_step_names: list[str] | None
    arguments: list[ArgumentInfo]
    gates: list[str]
    keywords: list[str]


class GateInfo(TypedDict):
    id: str
    name: str
    type: str
    description: str
    triggers: list[str]


def load_prompts_cache() -> dict | None:
    """Load prompt metadata from SQLite resource_index."""
    return load_prompts()


def load_gates_cache() -> dict | None:
    """Load gate metadata from SQLite resource_index."""
    return load_gates()


def get_prompt_by_id(prompt_id: str) -> PromptInfo | None:
    """Get a specific prompt by ID (case-insensitive lookup via SQLite)."""
    data = get_prompt_by_id_from_db(prompt_id)
    return cast(PromptInfo, data) if data is not None else None


def match_prompts_to_intent(user_prompt: str, max_results: int = 5) -> list[tuple[str, PromptInfo, int]]:
    """
    Match prompts based on keywords in user's prompt.
    Returns list of (prompt_id, prompt_info, score) tuples sorted by score descending.
    """
    cache = load_prompts_cache()
    if not cache:
        return []

    prompt_lower = user_prompt.lower()
    matches: list[tuple[str, PromptInfo, int]] = []

    for prompt_id, data in cache.get("prompts", {}).items():
        score = 0

        # Keyword matching
        for keyword in data.get("keywords", []):
            if keyword in prompt_lower:
                score += 10

        # Category matching
        category = data.get("category", "")
        if category in prompt_lower:
            score += 20

        # Name word matching
        name_words = data.get("name", "").lower().split()
        for word in name_words:
            if len(word) > 3 and word in prompt_lower:
                score += 15

        # Boost chains (more comprehensive)
        if data.get("is_chain") and score > 0:
            score += 5

        if score > 0:
            matches.append((prompt_id, data, score))

    # Sort by score descending
    matches.sort(key=lambda x: x[2], reverse=True)
    return matches[:max_results]


def suggest_gates_for_work(
    work_types: list[str],
) -> list[tuple[str, GateInfo]]:
    """
    Suggest relevant gates based on detected work types.

    work_types can include: "code", "research", "security", "documentation"
    """
    cache = load_gates_cache()
    if not cache:
        return []

    # Mapping of work types to relevant gate keywords
    work_gate_mapping = {
        "code": ["code", "quality", "test", "coverage"],
        "research": ["research", "quality", "content", "accuracy"],
        "security": ["security", "awareness", "pr-security"],
        "documentation": ["content", "structure", "clarity", "educational"],
    }

    suggested: list[tuple[str, GateInfo]] = []
    seen_ids: set[str] = set()

    for work_type in work_types:
        keywords = work_gate_mapping.get(work_type, [])

        for gate_id, gate_data in cache.get("gates", {}).items():
            if gate_id in seen_ids:
                continue

            # Check if gate matches any keyword
            gate_triggers = gate_data.get("triggers", [])
            gate_name_lower = gate_data.get("name", "").lower()

            for keyword in keywords:
                if keyword in gate_triggers or keyword in gate_name_lower:
                    suggested.append((gate_id, gate_data))
                    seen_ids.add(gate_id)
                    break

    return suggested[:3]  # Limit to 3 suggestions


def get_all_prompts() -> dict[str, PromptInfo]:
    """Get all prompts."""
    cache = load_prompts_cache()
    if not cache:
        return {}
    return cache.get("prompts", {})


def get_chains_only() -> dict[str, PromptInfo]:
    """Get only chain prompts."""
    prompts = get_all_prompts()
    return {k: v for k, v in prompts.items() if v.get("is_chain")}


def get_single_prompts_only() -> dict[str, PromptInfo]:
    """Get only single (non-chain) prompts."""
    prompts = get_all_prompts()
    return {k: v for k, v in prompts.items() if not v.get("is_chain")}


def get_chain_step_names(prompt_id: str) -> list[str]:
    """
    Get step names for a chain prompt.

    Returns:
        List of step names if prompt is a chain, empty list otherwise.
    """
    info = get_prompt_by_id(prompt_id)
    if not info or not info.get("is_chain"):
        return []
    return info.get("chain_step_names") or []


def levenshtein_distance(a: str, b: str) -> int:
    """
    Calculate Levenshtein edit distance between two strings.

    Uses dynamic programming for O(m*n) time and O(n) space.
    Same algorithm as TypeScript generatePromptSuggestions().
    """
    if len(a) < len(b):
        return levenshtein_distance(b, a)
    if len(b) == 0:
        return len(a)

    previous_row = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        current_row = [i + 1]
        for j, cb in enumerate(b):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (ca != cb)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    return previous_row[-1]


def fuzzy_match_prompt_id(query: str, max_results: int = 3) -> list[str]:
    """
    Find fuzzy matches for a prompt ID using multi-factor scoring.
    Same algorithm as TypeScript generatePromptSuggestions().

    Scoring:
    - Prefix match: 100 points
    - Word overlap: 30 points per word
    - Levenshtein: 50 - (distance * 10) points

    Args:
        query: The prompt ID to match against
        max_results: Maximum number of suggestions to return

    Returns:
        List of prompt IDs sorted by score descending.
    """
    cache = load_prompts_cache()
    if not cache:
        return []

    query_lower = query.lower()
    query_words = set(query_lower.replace("-", "_").split("_"))

    scored: list[tuple[str, int]] = []

    for prompt_id in cache.get("prompts", {}):
        id_lower = prompt_id.lower()
        score = 0

        # Prefix match (highest value - user typing partial name)
        if id_lower.startswith(query_lower) or query_lower.startswith(id_lower):
            score += 100

        # Word overlap (medium value - related prompts)
        id_words = set(id_lower.replace("-", "_").split("_"))
        for qw in query_words:
            for iw in id_words:
                if qw in iw or iw in qw:
                    score += 30
                    break

        # Levenshtein distance (lower = better)
        distance = levenshtein_distance(query_lower, id_lower)
        threshold = max(3, len(query_lower) // 2)
        if distance <= threshold:
            score += max(0, 50 - distance * 10)

        if score > 0:
            # Store lowercase ID to align with MCP server case-insensitive matching
            scored.append((id_lower, score))

    # Sort by score descending, return top N (already lowercase)
    scored.sort(key=lambda x: x[1], reverse=True)
    return [pid for pid, _ in scored[:max_results]]


# =============================================================================
# Operator Value Validation
# =============================================================================


def get_valid_styles() -> list[str]:
    """
    Get list of valid style names.

    Returns lowercase style names that can be used with the # operator.
    """
    return get_valid_styles_from_db()


def get_valid_frameworks() -> list[str]:
    """
    Get list of valid framework names.

    Returns lowercase framework names that can be used with the @ operator.
    """
    return get_valid_frameworks_from_db()


def is_valid_style(style: str) -> bool:
    """
    Check if style name is valid (case-insensitive).

    Args:
        style: Style name to validate (e.g., "analytical", "creative")

    Returns:
        True if style exists in server's registered styles
    """
    valid = get_valid_styles()
    return style.lower() in valid


def is_valid_framework(framework: str) -> bool:
    """
    Check if framework name is valid (case-insensitive).

    Args:
        framework: Framework name to validate (e.g., "CAGEERF", "ReACT")

    Returns:
        True if framework exists in server's registered frameworks
    """
    valid = get_valid_frameworks()
    return framework.lower() in valid
