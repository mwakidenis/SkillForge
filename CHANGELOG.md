# CHANGELOG

# SkillForge v1.0.0

## [1.0.0] - 2026-11-13

### Initial release — complete monorepo implementation

SkillForge v1.0.0 is a local-first, offline-capable Portable Agent Skill & Harness Runner built as a production-ready, thoroughly tested, cross-platform monorepo. All phases (0–6) implemented with zero shortcuts, no stubs, and no placeholders. 159 passing tests across the TypeScript packages; C# Windows Tray Monitor compiles clean.

### Phase 0 — Workspace & Tooling Foundation

- Root `package.json`: `skillforge-monorepo`, private, type module; scripts `build`, `test`, `test:coverage`, `typecheck`; devDependencies `typescript`, `vitest`, `@types/node`.
- `pnpm-workspace.yaml`: packages `packages/*`.
- `tsconfig.base.json`: ES2022, NodeNext module/resolution, strict flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `declaration`, `sourceMap`).
- `.gitignore`: `node_modules/`, `dist/`, `coverage/`, `.skillforge/`, `bin/`, `obj/`, `*.user`.
- Three example Skill Manifests: `refactor-module.md`, `generate-unit-tests.md`, `security-audit.md` (fixtures + integration test inputs).

### Phase 1 — Core Types & Zero-Dependency Markdown/YAML Parser

**Error taxonomy** (`src/errors/SkillForgeError.ts`): `SkillForgeError`, `SkillParseError` (line/column/syntax), `SandboxViolationError` (path/command/policy), `ProviderExecutionError` (provider/httpStatus/retryable), `GitCheckpointError` (gitCommand/exitCode/stderr/recoveryInstructions), `HarnessTimeoutError` (stepCount/elapsedMs). All with `toJSON()` serialization.

**Type definitions** (`src/types/`): `skill.ts` (Zod `SkillManifestSchema`, `ToolPermissionName`, `SkillParameterSchema`, `SkillManifest`, `ParsedSkill`), `provider.ts` (`ChatMessage`, `ToolCallRequest`, `ToolCallResult`, `LlmStreamChunk`, `LlmProvider`), `sandbox.ts` (`SandboxPolicy`, `SandboxAuditEntry`), `git.ts` (`GitCheckpoint`, `RollbackResult`, `GitStatusResult`), `ipc.ts` (`IpcStatusPayload`, `HarnessEvent`, `IpcClientConfig`).

**Zero-dependency YAML frontmatter parser** (`src/parser/yamlParser.ts`): scalars (double/single-quoted with escapes, unquoted, int, float, bool, null/~), inline/nested arrays, block arrays of scalars/objects, nested mappings (2/4-space), literal (`|`) and folded (`>`) block scalars, inline comments outside quotes. Throws `SkillParseError` with 1-based line numbers on tab indentation, inconsistent dedentation, unterminated quotes, duplicate keys.

**Template engine** (`src/parser/templateEngine.ts`): `{{var}}`, dot-path, `{{#if}}/{{else}}/{{/if}}`, `{{#each}}/{{this}}/{{/each}}`, parameter coercion & pattern validation, undeclared-variable and missing-required errors.

**Skill markdown parser** (`src/parser/skillParser.ts`): splits `---` frontmatter (CRLF/LF), parses YAML, validates via Zod, extracts `##` sections (System Role/Instructions/Verification Criteria), SHA-256 contentHash.

**Phase 1 gate**: 52 tests, typecheck clean (CHECKPOINT 1 passed).

### Phase 2 — Sandbox Guardrails & Tool Execution Runtime

**pathGuard** (`src/sandbox/pathGuard.ts`): `resolveSafePath` rejects null bytes, resolves against workspaceRoot, walks ancestors via `fs.realpathSync` to prevent symlink escapes, verifies containment, matches denied patterns via custom glob matcher. Throws `SandboxViolationError` with full audit context.

**commandGuard** (`src/sandbox/commandGuard.ts`): rejects shell metacharacters outside quotes, tokenizes commands, prefix-matches `allowedCommands`, scrubs sensitive env vars (`AWS_*`, `OPENAI_*`, `ANTHROPIC_*`, `GITHUB_*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`).

**sandboxRuntime** (`src/sandbox/sandboxRuntime.ts`): immutable timestamped `SandboxAuditEntry[]` ledger, `maxFileWriteBytes` (5MB), `maxTotalWrites` (50MB), atomic write via temp file + rename, shell exec with `spawn` (`shell: false`), SIGKILL timeout, stdout/stderr truncation.

**Tools** (`src/tools/`): `fs.read` (line slicing), `fs.write` (atomic), `fs.list` (recursive, .gitignore, depth cap), `fs.delete`, `shell.exec` (stdout/stderr caps). Registered in `ToolRegistry` with JSON-Schema definitions.

**Phase 2 gate**: 100+ adversarial security tests (path traversal, symlink escape, `.env`/`.git`/private-key denial, command chaining, subshell injection, env scrubbing), typecheck clean, zero security bypasses (CHECKPOINT 2 passed).

### Phase 3 — Multi-Provider LLM Adapters & Agentic Harness Loop

**Providers** (`src/providers/`): `baseProvider.ts` (exponential backoff retry for 429/503, AbortSignal cancellation, `accumulateText`, `mergeToolCallDeltas`), `ollamaProvider.ts` (native fetch, NDJSON stream parsing, native tool-calling), `openAiCompatibleProvider.ts` (SSE stream parsing, tool-call delta accumulation), `mockDeterministicProvider.ts` (scriptable multi-turn loops, malformed JSON, error injection).

**Harness** (`src/harness/`): `contextManager.ts` (sliding-window truncation preserving system prompt), `executionHarness.ts` (ReAct tool-use loop up to `maxSteps`, ReAct self-healing on invalid tool args, `HarnessEvent` emission, post-run verification, automatic Git rollback on failure), `ipcBroadcaster.ts` (non-blocking HTTP POST, silently ignores `ECONNREFUSED`).

**Phase 3 gate**: 25+ tests (SSE chunk assembly, tool-call delta stitching, abort cancellation, Ollama NDJSON, multi-step tool loop, maxSteps termination, sandbox violation abort).

### Phase 4 — Atomic Git Checkpoint & Rollback Engine

**gitExecutor** (`src/git/gitExecutor.ts`): `execFile` (`shell: false`), strict array args, `isGitWorktree`, `status`, `getHeadSha`.

**checkpointManager** (`src/git/checkpointManager.ts`): `createCheckpoint` (captures branch/detached HEAD, `git write-tree` via temporary `GIT_INDEX_FILE` so `stash@{0}` is never polluted, `git update-ref refs/skillforge/checkpoints/<runId>`, JSON sidecar in `.git/skillforge-checkpoints/`), `rollbackToCheckpoint` (`git reset --hard`, `git read-tree --reset -u`, removes new untracked files, verifies restoration), `commitCheckpointSuccess` (conventional commits), `listCheckpoints`/`pruneCheckpoints`.

**Phase 4 gate**: 20+ tests on real temp Git repos — clean repo rollback, pre-existing dirty+untracked preservation, `git stash@{0}` untouched, list/prune, error cases, conventional-commit format. All pass.

### Phase 5 — CLI Application & Local IPC Daemon

**@skillforge/cli** (`packages/cli/`): executable `sf` (`#!/usr/bin/env node`).
- `argParser.ts`: subcommands, positionals, `--param key=value` (repeatable), `--workspace`, `--provider`, `--model`, `--dry-run`, `--json`, `--help`, `--list`, `--run-id`.
- `formatter.ts`: ANSI formatting with `NO_COLOR`/non-TTY fallback, tables, spinners.
- `ipcServer.ts`: `node:http` on `127.0.0.1:48921` — `GET /health`, `GET /status`, `POST /events`, `POST /rollback/latest`.
- Commands: `init`, `list`, `validate`, `run`, `rollback`, `daemon`.

**Phase 5 gate**: 34 tests (argParser, formatter, CLI integration spawning real processes against temp Git repos with MockDeterministicProvider + IPC HTTP endpoints).

### Phase 6 — C# Windows Native System Tray Monitor

`apps/tray-monitor/` — .NET 8 Windows Forms, zero third-party NuGet dependencies:
- `SkillForgeTray.csproj` / `SkillForgeTray.sln`
- `Models/IpcMessages.cs`: `DaemonStatusDto`, `HarnessEventDto`, `RollbackResponseDto`
- `Services/IpcClientService.hs`: 1000ms polling, `TriggerEmergencyRollbackAsync`, graceful offline handling
- `Services/LogBufferService.cs`: thread-safe circular buffer (500 events)
- `UI/TrayApplicationContext.cs`: `ApplicationContext` tray app, generated 16x16 icons (Gray/Green/Amber/Red), context menu, balloon notifications
- `UI/LogViewerForm.cs`: dark-mode log viewer with "Rollback Last Run" button
- `Program.cs`: STA entry point

**Phase 6 gate**: `dotnet build` succeeds with 0 errors.

### Phase 7 — Documentation & Changelog

- `README.md`: architecture diagram (ASCII), skill authoring guide, CLI reference, sandbox security model, Git checkpoint/rollback, Windows Tray setup, verification gates.
- `CHANGELOG.md`: this document.

## Test Summary (v1.0.0)

| Suite | Tests |
|-------|-------|
| yamlParser | 25 |
| templateEngine | 19 |
| skillParser | 8 |
| pathGuard | 17 |
| commandGuard | 16 |
| sandboxRuntime | 10 |
| toolRegistry | 5 |
| providers | 10 |
| executionHarness | 7 |
| checkpointManager | 8 |
| argParser | 17 |
| commands | 9 |
| cliIntegration | 8 |
| **Total** | **159** |

All test suites pass 100%. TypeScript `tsc --noEmit` is clean on both packages with strict flags. C# Solution builds with 0 errors.