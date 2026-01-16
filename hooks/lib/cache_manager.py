"""
Cache manager for Claude Code hooks.
Loads and queries MCP prompt/gate caches.

Uses workspace resolution (MCP_WORKSPACE > CLAUDE_PLUGIN_ROOT > development fallback).
"""

import json
from pathlib import Path
from typing import TypedDict

from workspace import get_cache_dir


class ArgumentInfo(TypedDict):
    name: str
    type: str
    required: bool
    description: str
    default: str | None


class PromptInfo(TypedDict):
    id: str
    name: str
    category: str
    description: str
    is_chain: bool
    chain_steps: int
    arguments: list[ArgumentInfo]
    gates: list[str]
    keywords: list[str]


class GateInfo(TypedDict):
    id: str
    name: str
    type: str
    description: str
    triggers: list[str]


def _get_cache_dir() -> Path:
    """
    Get cache directory using workspace resolution.

    Priority:
      1. MCP_WORKSPACE/server/cache
      2. CLAUDE_PLUGIN_ROOT/server/cache
      3. Development fallback (relative to this script)
    """
    dev_fallback = Path(__file__).parent.parent.parent / "server" / "cache"
    return get_cache_dir(dev_fallback)


CACHE_DIR = _get_cache_dir()


def load_prompts_cache() -> dict | None:
    """Load cached prompt metadata."""
    cache_path = CACHE_DIR / "prompts.cache.json"
    if not cache_path.exists():
        return None
    try:
        with open(cache_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def load_gates_cache() -> dict | None:
    """Load cached gate metadata."""
    cache_path = CACHE_DIR / "gates.cache.json"
    if not cache_path.exists():
        return None
    try:
        with open(cache_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def get_prompt_by_id(prompt_id: str, cache: dict | None = None) -> PromptInfo | None:
    """Get a specific prompt by ID."""
    if cache is None:
        cache = load_prompts_cache()
    if not cache:
        return None
    return cache.get("prompts", {}).get(prompt_id)


def match_prompts_to_intent(
    user_prompt: str,
    cache: dict | None = None,
    max_results: int = 5
) -> list[tuple[str, PromptInfo, int]]:
    """
    Match prompts based on keywords in user's prompt.
    Returns list of (prompt_id, prompt_info, score) tuples sorted by score descending.
    """
    if cache is None:
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
    cache: dict | None = None
) -> list[tuple[str, GateInfo]]:
    """
    Suggest relevant gates based on detected work types.

    work_types can include: "code", "research", "security", "documentation"
    """
    if cache is None:
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


def get_all_prompts(cache: dict | None = None) -> dict[str, PromptInfo]:
    """Get all prompts from cache."""
    if cache is None:
        cache = load_prompts_cache()
    if not cache:
        return {}
    return cache.get("prompts", {})


def get_chains_only(cache: dict | None = None) -> dict[str, PromptInfo]:
    """Get only chain prompts from cache."""
    prompts = get_all_prompts(cache)
    return {k: v for k, v in prompts.items() if v.get("is_chain")}


def get_single_prompts_only(cache: dict | None = None) -> dict[str, PromptInfo]:
    """Get only single (non-chain) prompts from cache."""
    prompts = get_all_prompts(cache)
    return {k: v for k, v in prompts.items() if not v.get("is_chain")}
