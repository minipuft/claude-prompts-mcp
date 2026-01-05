#!/usr/bin/env python3
"""
Word Count Script Tool

This is an example script tool that demonstrates the prompt-scoped
script execution feature. It reads JSON input from stdin and outputs
JSON results to stdout.

Input (JSON from stdin):
{
    "text": "string to analyze",
    "include_whitespace": false  // optional
}

Output (JSON to stdout):
{
    "word_count": 3,
    "character_count": 17,
    "line_count": 1,
    "unique_words": 3
}
"""

import json
import sys


def count_words(text: str, include_whitespace: bool = False) -> dict:
    """Count words, characters, and lines in the given text."""
    # Word count (split on whitespace)
    words = text.split()
    word_count = len(words)

    # Character count
    if include_whitespace:
        char_count = len(text)
    else:
        char_count = len(text.replace(' ', '').replace('\n', '').replace('\t', ''))

    # Line count
    line_count = text.count('\n') + 1 if text else 0

    # Unique words (case-insensitive)
    unique_words = len(set(word.lower() for word in words))

    return {
        "word_count": word_count,
        "character_count": char_count,
        "line_count": line_count,
        "unique_words": unique_words
    }


def main():
    try:
        # Read JSON input from stdin
        input_data = json.load(sys.stdin)

        # Extract parameters
        text = input_data.get("text", "")
        include_whitespace = input_data.get("include_whitespace", False)

        # Perform analysis
        result = count_words(text, include_whitespace)

        # Output JSON result to stdout
        print(json.dumps(result))
        sys.exit(0)

    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {str(e)}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Script error: {str(e)}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
