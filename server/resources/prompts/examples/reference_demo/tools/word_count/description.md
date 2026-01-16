# Word Counter Tool

A simple text analysis tool that counts words, characters, lines, and unique words in a given text.

## Usage

This tool is automatically invoked when the prompt detects text analysis needs. It accepts text input and returns statistics about the content.

## Output

The tool returns a JSON object with the following metrics:

- `word_count`: Total number of words
- `character_count`: Total characters (excluding whitespace by default)
- `line_count`: Number of lines
- `unique_words`: Count of unique words (case-insensitive)

## Example

Input:

```json
{
  "text": "Hello world! Hello again.",
  "include_whitespace": false
}
```

Output:

```json
{
  "word_count": 4,
  "character_count": 21,
  "line_count": 1,
  "unique_words": 3
}
```
