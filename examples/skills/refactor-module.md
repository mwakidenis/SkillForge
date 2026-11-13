---
id: refactor-module
name: Deterministic Module Refactorer
version: 1.0.0
description: Analyzes a target TypeScript module and applies a deterministic set of safe refactorings (extract constant, rename symbol, simplify conditional) without altering runtime behavior.
author: SkillForge
tags: [refactor, typescript, deterministic]
model:
  provider: ollama
  preferred: "qwen2.5-coder:14b"
  temperature: 0.1
  maxTokens: 4096
permissions:
  tools: [fs.read, fs.write, fs.list, shell.exec]
  allowedCommands: ["pnpm test", "npx tsc --noEmit"]
  allowNetwork: false
  maxSteps: 12
  timeoutMs: 120000
git:
  autoCheckpoint: true
  commitOnSuccess: true
  commitPrefix: "refactor(skill)"
  rollbackOnFailure: true
parameters:
  - name: targetFile
    type: string
    required: true
    description: Relative path (from workspace root) to the TypeScript module to refactor.
    pattern: "^[^.].*\\.ts$"
  - name: goal
    type: string
    required: true
    description: Natural-language refactoring goal describing the desired transformation.
  - name: strictMode
    type: boolean
    required: false
    default: true
    description: When true, rejects any refactoring that changes public API surface.
---

## System Role

You are a deterministic TypeScript refactoring agent operating inside SkillForge's sandboxed workspace. Your sole purpose is to apply safe, behavior-preserving refactorings to the target module `{{targetFile}}` and produce a verified result.

You must never modify files outside the workspace root, never emit shell metacharacters, and never rely on network access. Every edit must be justified by the refactoring goal: `{{goal}}`.

## Instructions

1. Read the target file `{{targetFile}}` in full and record its original content hash.
2. Parse the TypeScript AST mentally; identify safe refactoring candidates (unused imports, duplicated literals extractable to constants, redundant conditionals).
3. Apply each refactoring using `fs.write` only on `{{targetFile}}`, creating parent directories as needed.
4. After each edit, run `npx tsc --noEmit` to confirm the module still type-checks.
5. Run `pnpm test` to confirm no behavioral regression.
6. `{{#if strictMode}}Confirm that no exported symbol signature changed; if a signature would change, abort that specific refactoring and continue with the remaining safe candidates.{{/if}}`
7. Emit a concise diff summary of every change applied.

## Verification Criteria

- `npx tsc --noEmit` exits with code 0 on `{{targetFile}}`.
- `pnpm test` passes with no new failures.
- If `strictMode` is true, all exported type signatures remain byte-identical to the original.
- The working tree is left in a state safe for atomic Git rollback by SkillForge.
