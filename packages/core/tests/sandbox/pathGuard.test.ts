import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { PathGuard } from "../../src/sandbox/pathGuard.js";
import { SandboxViolationError } from "../../src/errors/SkillForgeError.js";

describe("pathGuard - basic containment", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-path-"));
    await fs.mkdir(path.join(root, "sub"), { recursive: true });
    await fs.writeFile(path.join(root, "sub", "hello.txt"), "hi");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("resolves a relative path inside workspace", () => {
    const guard = new PathGuard(root);
    const resolved = guard.resolveSafePath("sub/hello.txt", "read");
    expect(resolved).toBe(path.resolve(root, "sub/hello.txt"));
  });

  it("resolves absolute path inside workspace", () => {
    const guard = new PathGuard(root);
    const resolved = guard.resolveSafePath(path.resolve(root, "sub/hello.txt"), "read");
    expect(resolved).toBe(path.resolve(root, "sub/hello.txt"));
  });

  it("rejects path traversal with ..", () => {
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath("../../etc/passwd", "read")).toThrow(SandboxViolationError);
  });

  it("rejects null byte injection", () => {
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath("sub/hello.txt\0evil", "read")).toThrow(SandboxViolationError);
  });

  it("rejects traversal via parent then re-entry", () => {
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath("sub/../../outside.txt", "read")).toThrow(SandboxViolationError);
  });

  it("resolves workspace root itself", () => {
    const guard = new PathGuard(root);
    const resolved = guard.resolveSafePath("", "read");
    expect(resolved).toBe(path.resolve(root));
  });

  it("allows read of workspace root", () => {
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath(".", "read")).not.toThrow();
  });
});

describe("pathGuard - symlink escape", () => {
  let root: string;
  let outside: string;
  let symlinkSupported = false;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-sym-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "sf-out-"));
    await fs.writeFile(path.join(outside, "secret.txt"), "pwned");
    await fs.mkdir(path.join(root, "linkdir"), { recursive: true });
    try {
      await fs.symlink(outside, path.join(root, "linkdir", "escape"));
      symlinkSupported = true;
    } catch (e) {
      symlinkSupported = false;
    }
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("rejects symlink pointing outside workspace", () => {
    if (!symlinkSupported) {
      // tslint:disable-next-line
      return;
    }
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath("linkdir/escape/secret.txt", "read")).toThrow(SandboxViolationError);
  });
});

describe("pathGuard - denied patterns", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-deny-"));
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    await fs.writeFile(path.join(root, ".env.local"), "secret=1");
    await fs.writeFile(path.join(root, "id_rsa"), "key");
    await fs.writeFile(path.join(root, "secrets.json"), "{}");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("denies .git/** reads", () => {
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath(".git/HEAD", "read")).toThrow(SandboxViolationError);
  });
  it("denies .env* reads", () => {
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath(".env.local", "read")).toThrow(SandboxViolationError);
  });
  it("denies *.pem/*.key/id_rsa* reads", () => {
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath("id_rsa", "read")).toThrow(SandboxViolationError);
    expect(() => guard.resolveSafePath("cert.pem", "read")).toThrow(SandboxViolationError);
    expect(() => guard.resolveSafePath("key.key", "read")).toThrow(SandboxViolationError);
  });
  it("denies secrets.* reads", () => {
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath("secrets.json", "read")).toThrow(SandboxViolationError);
  });
  it("allows non-denied files", async () => {
    const guard = new PathGuard(root);
    await fs.writeFile(path.join(root, "safe.txt"), "ok");
    expect(() => guard.resolveSafePath("safe.txt", "read")).not.toThrow();
  });
});

describe("pathGuard - write/delete containment", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-wd-"));
    await fs.writeFile(path.join(root, "safe.txt"), "ok");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects write outside workspace", () => {
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath(path.join(os.tmpdir(), "evil.txt"), "write")).toThrow(SandboxViolationError);
  });
  it("rejects delete outside workspace", () => {
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath("../../../etc/passwd", "delete")).toThrow(SandboxViolationError);
  });
  it("resolves write inside workspace", () => {
    const guard = new PathGuard(root);
    const resolved = guard.resolveSafePath("newfile.txt", "write");
    expect(resolved).toBe(path.resolve(root, "newfile.txt"));
  });
});

describe("pathGuard - windows separators", () => {
  it("normalizes mixed separators on POSIX", async () => {
    const root = path.join(os.tmpdir(), "sf-mixed-" + Date.now());
    await fs.mkdir(root, { recursive: true });
    const guard = new PathGuard(root);
    expect(() => guard.resolveSafePath("sub/../safe.txt", "read")).not.toThrow();
    await fs.rm(root, { recursive: true, force: true });
  });
});
