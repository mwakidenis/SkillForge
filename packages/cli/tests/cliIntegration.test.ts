import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { parseSkill } from "@skillforge/core";

const CLI = path.join(__dirname, "..", "dist", "index.js");
const ROOT = path.join(__dirname, "../../..");

async function runCLI(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({ code: error ? (error as any).code ?? 1 : 0, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

async function initGitRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const gitBin = "C:\\Program Files\\Git\\bin";
  if (!process.env.PATH?.includes(gitBin)) {
    process.env.PATH = gitBin + ";" + process.env.PATH;
  }
  const { execSync } = await import("node:child_process");
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  await fs.writeFile(path.join(dir, "README.md"), "# hello\n", "utf8");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m init", { cwd: dir, stdio: "pipe" });
}

describe("cliIntegration - validate command", () => {
  let dir: string;
  let skillPath: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-cli-"));
    skillPath = path.join(dir, "skill.md");
    await fs.writeFile(skillPath, `---\nid: cli-skill\nname: CLI Skill\nversion: 1.0.0\ndescription: d\nmodel: {provider: mock, preferred: m, temperature: 0.1, maxTokens: 256}\npermissions: {tools: [], allowedCommands: [], allowNetwork: false, maxSteps: 1, timeoutMs: 5000}\ngit: {autoCheckpoint: false, commitOnSuccess: false, commitPrefix: c, rollbackOnFailure: false}\nparameters: []\n---\n## Instructions\ndo it\n`);
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("validates a skill and exits 0", async () => {
    const res = await runCLI(["validate", skillPath], dir);
    expect(res.code).toBe(0);
  });

  it("validate JSON output includes contentHash and skill id", async () => {
    const res = await runCLI(["validate", skillPath, "--json"], dir);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.skill.id).toBe("cli-skill");
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("cliIntegration - list command", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-cli-list-"));
    await fs.mkdir(path.join(dir, "examples", "skills"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "examples", "skills", "demo.md"),
      `---\nid: demo\nname: Demo\nversion: 1.0.0\ndescription: d\nmodel: {provider: mock, preferred: m, temperature: 0.1, maxTokens: 256}\npermissions: {tools: [fs.read], allowedCommands: [], allowNetwork: false, maxSteps: 1, timeoutMs: 5000}\ngit: {autoCheckpoint: false, commitOnSuccess: false, commitPrefix: c, rollbackOnFailure: false}\nparameters: []\n---\n## Instructions\ndo\n`,
    );
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("lists skills from examples/skills", async () => {
    const res = await runCLI(["list", "examples/skills"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("demo");
  });

  it("list JSON output", async () => {
    const res = await runCLI(["list", "examples/skills", "--json"], dir);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.skills.length).toBe(1);
    expect(parsed.skills[0].id).toBe("demo");
  });
});

describe("cliIntegration - init command", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-cli-init-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("scaffolds .skillforge and starter skill", async () => {
    const res = await runCLI(["init"], dir);
    expect(res.code).toBe(0);
    const config = await fs.readFile(path.join(dir, ".skillforge", "config.json"), "utf8");
    expect(JSON.parse(config).version).toBe("1.0.0");
    const starter = await fs.readFile(path.join(dir, ".skillforge", "skills", "example-skill.md"), "utf8");
    expect(starter).toContain("example-skill");
  });
});

describe("cliIntegration - rollback list on git repo", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-cli-rollback-"));
    await initGitRepo(dir);
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rollback --list returns no checkpoints initially", async () => {
    const res = await runCLI(["rollback", "--list"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("No checkpoints found");
  });
});

describe("cliIntegration - bundled example skills", () => {
  it("validates the bundled refactor-module skill", async () => {
    const skillPath = path.join(ROOT, "examples", "skills", "refactor-module.md");
    const res = await runCLI(["validate", skillPath, "--json"], ROOT);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.skill.id).toBe("refactor-module");
  });

  it("parseSkill computes contentHash for bundled security-audit skill", async () => {
    const skillPath = path.join(ROOT, "examples", "skills", "security-audit.md");
    const raw = await fs.readFile(skillPath, "utf8");
    const parsed = parseSkill(raw, skillPath);
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.manifest.permissions.tools).toEqual(["fs.read", "fs.list"]);
  });
});
