import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { SandboxRuntime } from "../../src/sandbox/sandboxRuntime.js";
import { PathGuard } from "../../src/sandbox/pathGuard.js";
import { CommandGuard } from "../../src/sandbox/commandGuard.js";

describe("sandboxRuntime - file operations", () => {
  let root: string;
  let runtime: SandboxRuntime;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-rt-"));
    await fs.writeFile(path.join(root, "a.txt"), "alpha");
    const guard = new PathGuard(root);
    const cguard = new CommandGuard(["pnpm test"]);
    runtime = new SandboxRuntime({ workspaceRoot: root }, guard, cguard);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reads a file and records an audit entry", async () => {
    const content = await runtime.readFile("a.txt");
    expect(content).toBe("alpha");
    expect(runtime.auditLedger.length).toBeGreaterThan(0);
    const entry = runtime.auditLedger[runtime.auditLedger.length - 1];
    expect(entry.verdict).toBe("allow");
    expect(entry.tool).toBe("fs.read");
  });

  it("reads denied path and records deny entry", async () => {
    await expect(runtime.readFile("../../../etc/passwd")).rejects.toThrow();
    const denials = runtime.auditLedger.filter((e) => e.verdict === "deny");
    expect(denials.length).toBeGreaterThan(0);
    expect(denials[0].tool).toBe("fs.read");
  });

  it("writes a file atomically and records bytes", async () => {
    await runtime.writeFile("new.txt", "hello world");
    const written = await fs.readFile(path.join(root, "new.txt"), "utf8");
    expect(written).toBe("hello world");
    const writes = runtime.auditLedger.filter((e) => e.tool === "fs.write" && e.verdict === "allow");
    expect(writes.length).toBe(1);
    expect(writes[0].bytesWritten).toBe(11);
  });

  it("rejects write exceeding maxFileWriteBytes", async () => {
    const small = new SandboxRuntime({ workspaceRoot: root, maxFileWriteBytes: 5 }, new PathGuard(root), new CommandGuard([]));
    await expect(small.writeFile("big.txt", "this is way too long")).rejects.toThrow();
    const denials = small.auditLedger.filter((e) => e.verdict === "deny");
    expect(denials.length).toBeGreaterThan(0);
  });

  it("lists directory contents", async () => {
    await fs.mkdir(path.join(root, "dir1"), { recursive: true });
    await fs.writeFile(path.join(root, "dir1", "b.txt"), "b");
    const list = await runtime.listDir(root);
    expect(list).toContain("a.txt");
    expect(list).toContain("dir1");
  });

  it("deletes a file", async () => {
    await runtime.writeFile("tmp.txt", "x");
    await runtime.deleteFile("tmp.txt");
    await expect(fs.access(path.join(root, "tmp.txt"))).rejects.toThrow();
    const dels = runtime.auditLedger.filter((e) => e.tool === "fs.delete" && e.verdict === "allow");
    expect(dels.length).toBe(1);
  });
});

describe("sandboxRuntime - shell exec", () => {
  let root: string;
  let runtime: SandboxRuntime;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-shell-"));
    await fs.writeFile(path.join(root, "package.json"), "{}");
    const guard = new PathGuard(root);
    const cguard = new CommandGuard(["node --version"]);
    runtime = new SandboxRuntime({ workspaceRoot: root, timeoutMs: 5000 }, guard, cguard);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("executes an allowed command", async () => {
    const r = await runtime.execCommand("node --version");
    expect(typeof r.stdout).toBe("string");
    expect(typeof r.exitCode).toBe("number");
  });

  it("rejects disallowed command", async () => {
    await expect(runtime.execCommand("whoami")).rejects.toThrow();
    const denials = runtime.auditLedger.filter((e) => e.verdict === "deny" && e.tool === "shell.exec");
    expect(denials.length).toBeGreaterThan(0);
  });

  it("rejects command chaining", async () => {
    await expect(runtime.execCommand("npx tsc --noEmit; whoami")).rejects.toThrow();
  });
});

describe("sandboxRuntime - maxTotalWrites", () => {
  let root: string;
  let runtime: SandboxRuntime;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-total-"));
    const guard = new PathGuard(root);
    const cguard = new CommandGuard([]);
    runtime = new SandboxRuntime({ workspaceRoot: root, maxTotalWrites: 8 }, guard, cguard);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("blocks writes exceeding total cap", async () => {
    await runtime.writeFile("a.txt", "12345");
    await expect(runtime.writeFile("b.txt", "6789012345")).rejects.toThrow();
  });
});
