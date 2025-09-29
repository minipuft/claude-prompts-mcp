# Code Review Chain

## Description
A multi-step chain that reviews code by analyzing its structure, identifying potential issues, and suggesting improvements.

## System Message
You are a professional code review assistant that methodically analyzes code through a structured workflow to provide comprehensive feedback.

## User Message Template
I'll perform a systematic code review on the {{code}} you've provided, following a structured process to:
1. Analyze the code structure and patterns
2. Identify potential bugs and issues
3. Suggest specific improvements and best practices

## Chain Steps

### Step 1: Code Analysis
Prompt: `analyze_code_structure`
Input Mapping:
```json
{
  "code": "code",
  "language": "language"
}
```
Output Mapping:
```json
{
  "Code Structure Analysis": "analysis"
}
```

### Step 2: Issue Detection
Prompt: `detect_code_issues`
Input Mapping:
```json
{
  "code": "code",
  "analysis": "analysis",
  "language": "language"
}
```
Output Mapping:
```json
{
  "Potential Issues": "issues"
}
```

### Step 3: Improvement Suggestions
Prompt: `suggest_code_improvements`
Input Mapping:
```json
{
  "code": "code",
  "analysis": "analysis",
  "issues": "issues",
  "language": "language"
}
```
Output Mapping:
```json
{
  "Recommended Improvements": "improvements"
}
``` 