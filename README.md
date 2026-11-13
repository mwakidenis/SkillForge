# SkillForge

SkillForge is a local-first, offline-capable Portable Agent Skill & Harness Runner. It treats agent capabilities as portable, version-controlled `.md` files ("Skill Manifests") containing YAML frontmatter, typed input parameter schemas, explicit tool permission allowlists, and structured prompt templates.

Instead of locking developer workflows inside proprietary IDE extensions or cloud platforms, SkillForge runs agents locally against your own workspace, with defense-in-depth sandboxing, atomic Git checkpoint/rollback, and real-time desktop observability via a Windows System Tray monitor.

## Architecture

```
+-----------------------------------------------------------+
|                    Windows System Tray                    |
|              (SkillForgeTray - .NET 8 WinForms)           |
|  Idle / Running / Sandbox Blocked / Rollback Ready states |
|           One-click emergency Git rollback                |
+---------------------^-------------------------------------+
                      | JSON-over-HTTP (127.0.0.1:48921)
+---------------------v-------------------------------------+
|                    CLI / IPC Daemon                       |
|              (@skillforge/cli - `sf`)                     |
|  init  list  validate  run  rollback  daemon              |
|  GET  /health  GET  /status  POST /events                 |
|  POST /rollback/latest                                    |
+---------------------^-------------------------------------+
                      | HarnessEvents
+---------------------v-------------------------------------+
|                  Agentic Execution Harness                |
|              (@skillforge/core)                           |
|  ReAct tool-use loop  maxSteps  verification  rollback    |
+---------------------^-------------------------------------+
                      | tool calls
+---------------------v-------------------------------------+
|   Sandbox  |  Providers  |  Git  |  Parser  |  Tools      |
| pathGuard  | ollama      | exec  | YAML     | fs.* shell  |
| commandGuard| openAI-compatible| checkpoint| exec        |
| runtime    | mock-deterministic|             |           |
+-----------------------------------------------------------+
                         Local Workspace (git repo)
```

## Monorepo Structure

```
skillforge/
├── package.json              # root: private monorepo, pnpm workspace
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── .gitignore
├── README.md
├── CHANGELOG.md
├── examples/skills/          # skill manifest fixtures
│   ├── refactor-module.md
│   ├── generate-unit-tests.md
│   └── security-audit.md
├── packages/
│   ├── core/                 # @skillforge/core (zero-runtime-bloat)
│   │   ├── src/
│   │   │   ├── errors/       # SkillForgeError hierarchy
│   │   │   ├── types/        # Zod schemas + interfaces
│   │   │   ├── parser/       # yamlParser, templateEngine, skillParser
│   │   │   ├── sandbox/      # pathGuard, commandGuard, sandboxRuntime
│   │   │   ├── tools/        # toolRegistry, fsTools, shellTool
│   │   │   ├── providers/    # ollama, openAI-compatible, mock-deterministic
│   │   │   ├── git/          # gitExecutor, checkpointManager
│   │   │   ├── harness/      # contextManager, executionHarness, ipcBroadcaster
│   │   │   └── utils/        # logger
│   │   └── tests/
│   └── cli/                  # @skillforge/cli (`sf`)
│       ├── src/
│       │   ├── index.ts      # bin: sf
│       │   ├── argParser.ts
│       │   ├── formatter.ts
│       │   ├── ipcServer.ts
│       │   └── commands/
│       └── tests/
└── apps/
    └── tray-monitor/         # SkillForgeTray (.NET 8 WinForms)
        ├── SkillForgeTray.sln
        ├── SkillForgeTray.csproj
        ├── Program.cs
        ├── Models/IpcMessages.cs
        ├── Services/IpcClientService.cs
        ├── Services/LogBufferService.cs
        ├── UI/TrayApplicationContext.cs
        └── UI/LogViewerForm.cs
```

## Installation

```bash
# Install dependencies (root)
pnpm install

# Build all TypeScript packages
pnpm build

# Typecheck
pnpm typecheck

# Run the full test suite (159 tests)
pnpm test
```

## Skill Authoring

A Skill Manifest is a Markdown file with YAML frontmatter delimited by `---` and `##`-level body sections.

### Example: `refactor-module.md`

```yaml
---
id: refactor-module
name: Deterministic Module Refactorer
version: 1.0.0
description: Safe, behavior-preserving TypeScript refactorings.
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
    description: Path to the TypeScript module to refactor.
    pattern: "^[^.].*\\.ts$"
  - name: goal
    type: string
    required: true
    description: Refactoring goal.
  - name: strictMode
    type: boolean
    required: false
    default: true
---

## System Role

You are a deterministic TypeScript refactoring agent...

## Instructions

Apply refactorings to {{targetFile}} to achieve: {{goal}}
{{#if strictMode}}Preserve all exported signatures.{{/if}}

## Verification Criteria

`npx tsc --noEmit` exits 0; `pnpm test` passes.
```

### Frontmatter fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | kebab-case string | Yes | Unique skill id |
| `name` | string | Yes | Display name |
| `version` | semver | Yes | Skill version |
| `description` | string | Yes | Short description |
| `model.provider` | string | No | LLM provider name |
| `model.preferred` | string | No | Preferred model |
| `model.temperature` | number | No | 0-2 (default 0.7) |
| `model.maxTokens` | int | No | default 4096 |
| `permissions.tools` | ToolPermissionName[] | No | Allowed tools |
| `permissions.allowedCommands` | string[] | No | Shell command prefixes |
| `permissions.allowNetwork` | boolean | No | default false |
| `permissions.maxSteps` | int | No | default 10 |
| `permissions.timeoutMs` | int | No | default 60000 |
| `git.autoCheckpoint` | boolean | No | default false |
| `git.rollbackOnFailure` | boolean | No | default false |

### Tool permissions

`fs.read`, `fs.write`, `fs.delete`, `fs.list`, `shell.exec`, `git.status`, `git.diff`

### Template tags

Body sections support Handlebars-style interpolation validated against declared parameters:

- `{{variableName}}` — interpolate a parameter (with type coercion & pattern validation)
- `{{config.target}}` — dot-path access
- `{{#if flag}}...{{else}}...{{/if}}` — conditionals
- `{{#each items}}...{{this}}...{{/each}}` — iteration

Undeclared variables and missing required parameters throw `SkillParseError`.

## CLI Reference

The `sf` binary is the entry point (`bin: sf`).

```
sf <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `sf init` | Scaffold `.skillforge/` config and a starter skill |
| `sf list [dir]` | List available skills in a skill directory |
| `sf validate <skillPath>` | Strict YAML, Zod, and template static analysis |
| `sf run <skillPath>` | Execute a skill end-to-end with sandbox enforcement |
| `sf rollback [--list] [--run-id <id>]` | List or restore a Git checkpoint |
| `sf daemon` | Start the local IPC hub (port 48921) |

### Global options

`--workspace <dir>`, `--provider <name>`, `--model <name>`, `--param key=value` (repeatable), `--dry-run`, `--json`, `--help`.

### Examples

```bash
# Validate a skill (exit 0 on success)
sf validate examples/skills/refactor-module.md
sf validate examples/skills/refactor-module.md --json
```

Sample `sf validate` output:

```
Valid: refactor-module v1.0.0
  tools: fs.read, fs.write, fs.list, shell.exec
  parameters: 3
  contentHash: 2e3998efd980997f3e0feb9999458b4c8d27da1e1f0d24e55aa050d15fce632d
```

```bash
# List available skills
sf list examples/skills
sf list examples/skills --json
```

Sample `sf list` output:

```
id                   name                              version  path                                                                 
-------------------  --------------------------------  -------  ---------------------------------------------------------------------
generate-unit-tests  Exhaustive Unit Test Generator    1.0.0    C:\Users\Denis\Downloads\skill\examples\skills\generate-unit-tests.md
refactor-module      Deterministic Module Refactorer   1.0.0    C:\Users\Denis\Downloads\skill\examples\skills\refactor-module.md    
security-audit       Read-Only Security Audit Scanner  1.0.0    C:\Users\Denis\Downloads\skill\examples\skills\security-audit.md     
```

```bash
# Initialize .skillforge/ in the current repo
sf init

# List checkpoints
sf rollback --list

# Roll back the latest checkpoint
sf rollback

# Start the IPC daemon for tray integration
sf daemon
```

## Sandbox Security Model

SkillForge enforces defense-in-depth sandboxing:

1. **Path guard** — every filesystem path is canonicalized via `fs.realpath`, checked against path traversal (`..`), symlink escapes, and denied patterns (`.git/**`, `**/.env*`, `**/*.pem`, `**/*.key`, `**/id_rsa*`, `**/secrets.*`).
2. **Command guard** — shell metacharacters (`;`, `&&`, `||`, `` ` ``, `$(`, `>`, `<`, newline) are rejected outside quotes; commands must prefix-match `permissions.allowedCommands`; sensitive env vars (`AWS_*`, `OPENAI_*`, `ANTHROPIC_*`, `GITHUB_*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`) are scrubbed from the child process environment.
3. **Sandbox runtime** — immutable audit ledger, per-file write cap (5MB), per-run total write cap (50MB), command timeout with SIGKILL, stdout/stderr byte caps.
4. **Git isolation** — checkpoints use a temporary `GIT_INDEX_FILE` so the user's `git stash@{0}` stack is never polluted.

## Atomic Git Checkpoint & Rollback

Before a skill touches disk, SkillForge records `HEAD`, snapshots the working tree (tracked + untracked) into a temporary index via `git write-tree`, and stores the tree SHA under `refs/skillforge/checkpoints/<run-id>`. A JSON metadata sidecar is written to `.git/skillforge-checkpoints/<run-id>.json`.

On failure or sandbox violation, `rollbackToCheckpoint` performs `git reset --hard <baseHead>`, restores the tree via `git read-tree --reset -u <treeSha>`, and removes any untracked files not in the snapshot — restoring bit-for-bit the pre-skill state, including the user's pre-existing uncommitted edits and untracked files.

## Windows System Tray Monitor

`apps/tray-monitor/` is a .NET 8 Windows Forms application with zero third-party NuGet dependencies.

- Crisp 16x16 status icons generated via `System.Drawing.Graphics` (Gray=Offline, Green=Idle, Amber=Running, Red=Blocked/Error).
- Context menu: Status header, "Open Live Execution Monitor...", "Trigger Emergency Git Rollback" (with confirmation), Exit.
- Balloon notifications on skill completion, sandbox violation, or automatic rollback.
- Log viewer window with live streaming execution logs, sandbox audit verdicts, checkpoint history, and a "Rollback Last Run" button.
- Polls `http://127.0.0.1:48921/status` every 1000ms with graceful offline handling.

Build (Windows, .NET 8 SDK):

```bash
dotnet build apps/tray-monitor/SkillForgeTray.sln
```

## Verification Gates

- `pnpm build` — TypeScript build across `@skillforge/core` and `@skillforge/cli`, zero errors/warnings.
- `pnpm test` — 159 passing tests across parser, sandbox, tools, providers, git checkpoints, execution harness, and CLI integration.
- `pnpm typecheck` — strict `tsc --noEmit` clean.
- CLI e2e dry run: `sf validate examples/skills/refactor-module.md` exits 0; `sf list examples/skills` prints formatted output.
- `dotnet build apps/tray-monitor/SkillForgeTray.sln` — C# compilation clean.

## License

MIT

---

<sub>proudly made by 🛠️ mwakidenis 🚀</sub>