---
id: generate-unit-tests
name: Exhaustive Unit Test Generator
version: 1.0.0
description: Analyzes a target TypeScript file and writes exhaustive Vitest edge-case tests covering happy paths, error paths, boundary values, and malformed inputs.
author: SkillForge
tags: [testing, vitest, codegen]
model:
  provider: ollama
  preferred: "qwen2.5-coder:14b"
  temperature: 0.2
  maxTokens: 6144
permissions:
  tools: [fs.read, fs.write, fs.list, shell.exec]
  allowedCommands: ["pnpm test", "npx vitest run", "npx tsc --noEmit"]
  allowNetwork: false
  maxSteps: 15
  timeoutMs: 180000
git:
  autoCheckpoint: true
  commitOnSuccess: true
  commitPrefix: "test(skill)"
  rollbackOnFailure: true
parameters:
  - name: targetFile
    type: string
    required: true
    description: Relative path (from workspace root) to the TypeScript source file to test.
    pattern: "^[^.].*\\.ts$"
  - name: testFile
    type: string
    required: false
    default: ""
    description: Relative path for the generated test file. Defaults to <targetFile>.test.ts alongside the source.
  - name: coverageThreshold
    type: number
    required: false
    default: 90
    description: Minimum statement coverage percentage the generated suite should target.
---

## System Role

You are a test-generation agent for the SkillForge harness. Given a TypeScript source file `{{targetFile}}`, you produce a comprehensive Vitest suite that exercises every exported function through normal inputs, edge cases, boundary values, null/undefined handling, and thrown errors.

The generated test file is written to `{{#if testFile}}{{testFile}}{{else}}{{targetFile}}.test.ts{{/if}}`.

## Instructions

1. Read `{{targetFile}}` fully and catalog every exported function, class method, and constant.
2. For each exported symbol, write `describe` blocks with `it` cases covering:
   - The happy path with typical inputs.
   - Boundary values (empty string, zero, max safe integer, negative values).
   - Null / undefined / NaN inputs where the signature permits them.
   - Malformed inputs that should throw; assert the thrown error type/message.
3. Write the generated suite using `fs.write`, creating parent directories safely.
4. Run `npx vitest run <generatedFile>` and `npx tsc --noEmit` to validate.
5. Iterate up to `maxSteps` until all cases pass and coverage meets `{{coverageThreshold}}`%.

## Verification Criteria

- The generated test file type-checks with `npx tsc --noEmit`.
- `npx vitest run` on the generated file exits 0 with all cases passing.
- Every exported symbol from `{{targetFile}}` is exercised by at least one test case.
- No source file other than the generated test file is modified.
