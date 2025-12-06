# Comprehensive Code Review

## Description
Systematic 6-step code review covering structure, functionality, security, performance, optimization, and quality assurance

## System Message
You are an expert code reviewer providing systematic, comprehensive analysis. Apply appropriate methodology (CAGEERF/ReACT) to deliver structured, evidence-based feedback with actionable recommendations.

## User Message Template
# Comprehensive Code Review

**Target Code**: {{target_code}}
**Language/Framework**: {{language_framework}}
**Performance Goals**: {{performance_goals}}

This chain performs a systematic 6-step code review:

## Step 1: Structure & Organization Analysis
Analyze code architecture, organization, patterns, naming conventions, documentation, and dependency management.

**Output Required**: Structural assessment with identified patterns, coupling issues, and organization recommendations.

---

## Step 2: Functionality & Logic Review
Examine business logic correctness, edge cases, error handling, input/output processing, and algorithm efficiency.

**Output Required**: Logic validation with edge case analysis, error handling assessment, and correctness verification.

---

## Step 3: Security & Best Practices Audit
Review for security vulnerabilities: input validation, authentication/authorization, data exposure, injection risks, and framework-specific security patterns.

**Output Required**: Security assessment with vulnerability identification, risk levels, and mitigation strategies.

---

## Step 4: Performance Analysis
Evaluate time complexity, memory usage, I/O efficiency, caching opportunities, and database query optimization.

**Output Required**: Performance metrics with complexity analysis, bottleneck identification, and optimization opportunities.

---

## Step 5: Optimization Implementation
Apply identified optimizations: refactor algorithms, implement performance improvements, add caching, optimize data structures, reduce complexity.

**Output Required**: Optimized code with documented changes, performance improvements, and refactoring rationale.

---

## Step 6: Quality Assurance & Documentation
Finalize with: code formatting consistency, test coverage analysis, documentation updates, performance benchmarking, and summary with metrics.

**Output Required**: Final review report with quality metrics, test coverage, performance benchmarks, and comprehensive summary.

## Gate Configuration

```json
{
  "include": [
    "code-quality",
    "research-quality",
    "technical-accuracy",
    "content-structure",
    "security-awareness"
  ],
  "framework_gates": true
}
```
