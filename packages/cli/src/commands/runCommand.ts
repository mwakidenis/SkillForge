import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseSkill } from "@skillforge/core";
import { ExecutionHarness } from "@skillforge/core";
import { ContextManager } from "@skillforge/core";
import { IpcBroadcaster } from "@skillforge/core";
import { SandboxRuntime } from "@skillforge/core";
import { PathGuard } from "@skillforge/core";
import { CommandGuard } from "@skillforge/core";
import { ToolRegistry } from "@skillforge/core";
import { MockDeterministicProvider } from "@skillforge/core";
import { builtinToolDefinitions } from "@skillforge/core";
import { fsRead, fsWrite, fsList, fsDelete, shellExec } from "@skillforge/core";

export interface RunCommandArgs {
  workspace?: string;
  provider?: string;
  model?: string;
  dryRun?: boolean;
  json?: boolean;
  param: Record<string, string>;
  _: string[];
}

export async function runCommand(args: RunCommandArgs): Promise<void> {
  const skillPath = args._[1];
  if (!skillPath) {
    throw new Error("run requires a skill path: sf run <skillPath>");
  }

  const workspace = args.workspace ?? process.cwd();
  const raw = await fs.readFile(skillPath, "utf8");
  const parsed = parseSkill(raw, skillPath);
  const manifest = parsed.manifest;

  if (args.dryRun) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: true, dryRun: true, skillId: manifest.id }) + "\n");
    } else {
      process.stdout.write(`Dry-run OK: ${manifest.id}\n`);
    }
    return;
  }

  const guard = new PathGuard(workspace);
  const cguard = new CommandGuard(manifest.permissions.allowedCommands);
  const sandboxConfig: Partial<import("@skillforge/core").SandboxPolicy> & { workspaceRoot: string } = {
    workspaceRoot: workspace,
    allowedCommands: manifest.permissions.allowedCommands,
    allowNetwork: manifest.permissions.allowNetwork,
    maxSteps: manifest.permissions.maxSteps,
    timeoutMs: manifest.permissions.timeoutMs,
  };
  if (!manifest.permissions.allowNetwork) {
    sandboxConfig.deniedPatterns = [
      ".git/**",
      "**/.env*",
      "**/*.pem",
      "**/*.key",
      "**/id_rsa*",
      "**/secrets.*",
    ];
  }
  const sandbox = new SandboxRuntime(sandboxConfig, guard, cguard);

  const registry = new ToolRegistry();
  for (const def of builtinToolDefinitions()) {
    if (manifest.permissions.tools.includes(def.name as any)) {
      registry.register({
        name: def.name,
        definition: def,
        handler: async (args_: Record<string, unknown>) => {
          switch (def.name) {
            case "fs.read":
              return fsRead(sandbox, String(args_.path), { startLine: args_.startLine as number, endLine: args_.endLine as number });
            case "fs.write":
              return fsWrite(sandbox, String(args_.path), String(args_.content));
            case "fs.list":
              return fsList(sandbox, String(args_.path), { depth: args_.depth as number });
            case "fs.delete":
              return fsDelete(sandbox, String(args_.path));
            case "shell.exec":
              return shellExec(sandbox, String(args_.command));
            default:
              throw new Error(`Unknown tool: ${def.name}`);
          }
        },
      });
    }
  }

  const provider = new MockDeterministicProvider();
  const broadcaster = new IpcBroadcaster();
  const context = new ContextManager();

  const harness = new ExecutionHarness({
    skillPath,
    params: args.param,
    workspaceRoot: workspace,
    provider,
    toolRegistry: registry,
    sandbox,
    sandboxPolicy: sandbox.policy,
    broadcaster,
    runId: args.param.runId ?? "",
  });

  context.addMessage({ role: "system", content: parsed.sections.systemPrompt });
  context.addMessage({ role: "user", content: parsed.sections.instructions });

  const result = await harness.execute();

  if (args.json) {
    process.stdout.write(
      JSON.stringify({ ok: true, runId: result.runId, status: result.status, durationMs: result.durationMs, events: result.events.length }) + "\n",
    );
  } else {
    process.stdout.write(`Run ${result.status}: ${result.skillId} (${result.durationMs}ms)\n`);
    process.stdout.write(`Events emitted: ${result.events.length}\n`);
    if (result.finalOutput) {
      process.stdout.write(`Output:\n${result.finalOutput}\n`);
    }
  }
}
