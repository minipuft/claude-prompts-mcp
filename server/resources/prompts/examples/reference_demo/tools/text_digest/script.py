#!/usr/bin/env python3
"""
Text Digest Script Tool

The confirm-gated half of the reference_demo pair. Reads JSON from stdin and
writes JSON to stdout, exactly like its sibling `word_count`; the only thing that
differs is `execution.confirm`, which is the point the demo is making.

Input (JSON from stdin):
{
    "text": "string to digest"
}

Output (JSON to stdout):
{
    "digest": "<sha256 hex>",
    "length": 12
}
"""

import hashlib
import json
import sys


def digest(text: str) -> dict:
    """Return a stable SHA-256 digest of the text and its length."""
    return {
        "digest": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "length": len(text),
    }


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        json.dump({"error": f"invalid JSON input: {exc}"}, sys.stdout)
        sys.exit(1)

    text = payload.get("text")
    if not isinstance(text, str):
        json.dump({"error": "missing required input: text"}, sys.stdout)
        sys.exit(1)

    json.dump(digest(text), sys.stdout)


if __name__ == "__main__":
    main()
