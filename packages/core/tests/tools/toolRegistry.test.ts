import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ToolRegistry } from "../../src/tools/toolRegistry.js";
import { SandboxRuntime } from "../../src/sandbox/sandboxRuntime.js";
import { PathGuard } from "../../src/sandbox/pathGuard.js";
import { CommandGuard } from "../../src/sandbox/commandGuard.js";
import { builtinToolDefinitions } from "../../src/tools/toolRegistry.js";

describe("toolRegistry - registration and lookup", () => {
  let registry: ToolRegistry;
  beforeEach(() => {
    registry = new ToolRegistry();
    for (const def of builtinToolDefinitions()) {
      registry.register({
        name: def.name,
        definition: def,
        handler: async () => ({ ok: true }),
      });
    }
  });

  it("registers all builtin tools", () => {
    expect(registry.list().sort()).toEqual(["fs.delete", "fs.list", "fs.read", "fs.write", "shell.exec"]);
  });

  it("returns undefined for unknown tool", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("reports has() correctly", () => {
    expect(registry.has("fs.read")).toBe(true);
    expect(registry.has("git.status")).toBe(false);
  });
});

describe("toolRegistry - fs.read handler via sandbox", () => {
  let root: string;
  let runtime: SandboxRuntime;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-tool-"));
    await fs.writeFile(path.join(root, "data.txt"), "content");
    const guard = new PathGuard(root);
    const cguard = new CommandGuard([]);
    runtime = new SandboxRuntime({ workspaceRoot: root }, guard, cguard);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fs.read returns file content", async () => {
    const content = await runtime.readFile("data.txt");
    expect(content).toBe("content");
  });

  it("fs.read line slicing", async () => {
    await fs.writeFile(path.join(root, "lines.txt"), "l1\nl2\nl3\n");
    const content = await runtime.readFile("lines.txt");
    const lines = content.split(/\r?\n/);
    expect(lines.slice(1, 2).join("\n")).toBe("l2");
  });
});
