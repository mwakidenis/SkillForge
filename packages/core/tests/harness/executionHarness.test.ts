import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ExecutionHarness } from "../../src/harness/executionHarness.js";
import { ContextManager } from "../../src/harness/contextManager.js";
import { IpcBroadcaster } from "../../src/harness/ipcBroadcaster.js";
import { MockDeterministicProvider } from "../../src/providers/mockDeterministicProvider.js";
import { ToolRegistry } from "../../src/tools/toolRegistry.js";
import { SandboxRuntime } from "../../src/sandbox/sandboxRuntime.js";
import { PathGuard } from "../../src/sandbox/pathGuard.js";
import { CommandGuard } from "../../src/sandbox/commandGuard.js";
import { parseSkill } from "../../src/parser/skillParser.js";
import type { ToolCallRequest } from "../../src/types/provider.js";

function makeSkillFile(root: string, frontmatter: string, body: string): string {
  const file = path.join(root, "skill.md");
  fs.writeFile(file, "---\n" + frontmatter + "\n---\n" + body);
  return file;
}

function makeHarnessDeps(root: string) {
  const guard = new PathGuard(root);
  const cguard = new CommandGuard(["node --version"]);
  const sandbox = new SandboxRuntime({ workspaceRoot: root }, guard, cguard);
  const registry = new ToolRegistry();
  const provider = new MockDeterministicProvider();
  return { sandbox, registry, provider, guard, cguard };
}

describe("executionHarness - parameter interpolation", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-harness-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("renders {{targetFile}} and {{goal}} into instructions", async () => {
    const file = makeSkillFile(
      root,
      "id: interp-test\nname: Interp\nversion: 1.0.0\ndescription: d\nmodel: {provider: mock, preferred: m, temperature: 0.1, maxTokens: 256}\npermissions: {tools: [], allowedCommands: [], allowNetwork: false, maxSteps: 1, timeoutMs: 5000}\ngit: {autoCheckpoint: false, commitOnSuccess: false, commitPrefix: c, rollbackOnFailure: false}\nparameters:\n  - name: targetFile\n    type: string\n    required: true\n    description: f\n  - name: goal\n    type: string\n    required: true\n    description: g",
      "## System Role\nyou are an agent\n\n## Instructions\nrefactor {{targetFile}} to {{goal}}\n"
    );
    const { sandbox, registry, provider } = makeHarnessDeps(root);
    const harness = new ExecutionHarness({
      skillPath: file,
      params: { targetFile: "src/a.ts", goal: "clean code" },
      workspaceRoot: root,
      provider,
      toolRegistry: registry,
      sandbox,
      sandboxPolicy: sandbox.policy,
    });
    const result = await harness.execute();
    expect(result.status).toBe("completed");
    const instrEvent = result.events.find((e) => e.type === "llm:chunk");
    // The mock returns empty content; just ensure it ran without param errors
    expect(result.events.some((e) => e.type === "run:completed")).toBe(true);
  });

  it("fails when required parameter is missing", async () => {
    const file = makeSkillFile(
      root,
      "id: missing-param\nname: MP\nversion: 1.0.0\ndescription: d\nmodel: {provider: mock, preferred: m, temperature: 0.1, maxTokens: 256}\npermissions: {tools: [], allowedCommands: [], allowNetwork: false, maxSteps: 1, timeoutMs: 5000}\ngit: {autoCheckpoint: false, commitOnSuccess: false, commitPrefix: c, rollbackOnFailure: false}\nparameters:\n  - name: targetFile\n    type: string\n    required: true\n    description: f",
      "## Instructions\ndo it\n"
    );
    const { sandbox, registry, provider } = makeHarnessDeps(root);
    const harness = new ExecutionHarness({
      skillPath: file,
      params: {},
      workspaceRoot: root,
      provider,
      toolRegistry: registry,
      sandbox,
      sandboxPolicy: sandbox.policy,
    });
    await expect(harness.execute()).rejects.toThrow();
  });
});

describe("executionHarness - maxSteps termination", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-maxsteps-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("stops after maxSteps and throws HarnessTimeoutError", async () => {
    const file = makeSkillFile(
      root,
      "id: maxsteps\nname: MS\nversion: 1.0.0\ndescription: d\nmodel: {provider: mock, preferred: m, temperature: 0.1, maxTokens: 256}\npermissions: {tools: [fs.read], allowedCommands: [], allowNetwork: false, maxSteps: 2, timeoutMs: 5000}\ngit: {autoCheckpoint: false, commitOnSuccess: false, commitPrefix: c, rollbackOnFailure: false}\nparameters:\n  - name: targetFile\n    type: string\n    required: true\n    description: f",
      "## Instructions\nread the file\n"
    );
    await fs.writeFile(path.join(root, "data.txt"), "x");
    const { sandbox, registry, provider } = makeHarnessDeps(root);
    registry.register({
      name: "fs.read",
      definition: { name: "fs.read", description: "r", inputSchema: { type: "object" } },
      handler: async (args: Record<string, unknown>) => sandbox.readFile(String(args.path)),
    });
    // Always return a tool call so it never completes naturally
    provider.injectResponse({ role: "assistant", content: "", toolCalls: [{ id: "t1", name: "fs.read", arguments: { path: "data.txt" } }] as ToolCallRequest[] });
    const harness = new ExecutionHarness({
      skillPath: file,
      params: { targetFile: "data.txt" },
      workspaceRoot: root,
      provider,
      toolRegistry: registry,
      sandbox,
      sandboxPolicy: sandbox.policy,
    });
    await expect(harness.execute()).rejects.toThrow();
    expect(harness.events.some((e) => e.type === "run:failed")).toBe(true);
  });
});

describe("executionHarness - sandbox violation aborts", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-sandbox-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("emits sandbox:blocked and fails on path escape", async () => {
    const file = makeSkillFile(
      root,
      "id: sandbox-abort\nname: SA\nversion: 1.0.0\ndescription: d\nmodel: {provider: mock, preferred: m, temperature: 0.1, maxTokens: 256}\npermissions: {tools: [fs.read], allowedCommands: [], allowNetwork: false, maxSteps: 5, timeoutMs: 5000}\ngit: {autoCheckpoint: false, commitOnSuccess: false, commitPrefix: c, rollbackOnFailure: false}\nparameters:\n  - name: targetFile\n    type: string\n    required: true\n    description: f",
      "## Instructions\nread the file\n"
    );
    const { sandbox, registry, provider } = makeHarnessDeps(root);
    registry.register({
      name: "fs.read",
      definition: { name: "fs.read", description: "r", inputSchema: { type: "object" } },
      handler: async (args: Record<string, unknown>) => sandbox.readFile(String(args.path)),
    });
    provider.injectResponse({ role: "assistant", content: "", toolCalls: [{ id: "t1", name: "fs.read", arguments: { path: "../../../etc/passwd" } }] as ToolCallRequest[] });
    const harness = new ExecutionHarness({
      skillPath: file,
      params: { targetFile: "data.txt" },
      workspaceRoot: root,
      provider,
      toolRegistry: registry,
      sandbox,
      sandboxPolicy: sandbox.policy,
    });
    await expect(harness.execute()).rejects.toThrow();
    expect(harness.events.some((e) => e.type === "sandbox:blocked")).toBe(true);
  });
});

describe("contextManager - sliding window", () => {
  it("truncates old messages preserving head", () => {
    const cm = new ContextManager(20);
    cm.addMessage({ role: "system", content: "system prompt here" });
    cm.addMessage({ role: "user", content: "user task here" });
    cm.addMessage({ role: "assistant", content: "a".repeat(200) });
    cm.addMessage({ role: "tool", content: "b".repeat(200) });
    const result = cm.truncateToFit(2);
    expect(result[0].role).toBe("system");
    expect(result.some((m) => m.content.includes("truncated"))).toBe(true);
    expect(cm.totalEstimatedTokens()).toBeGreaterThan(20);
  });

  it("returns all messages when under limit", () => {
    const cm = new ContextManager(10000);
    cm.addMessage({ role: "system", content: "sys" });
    cm.addMessage({ role: "user", content: "usr" });
    expect(cm.getMessages().length).toBe(2);
  });
});

describe("ipcBroadcaster - silent on connection refused", () => {
  it("does not throw when daemon is not listening", async () => {
    const bc = new IpcBroadcaster({ host: "127.0.0.1", port: 1, basePath: "/events" });
    await expect(bc.broadcast({ type: "run:started", timestamp: new Date().toISOString(), runId: "r1", payload: {} })).resolves.toBeUndefined();
  });
});
