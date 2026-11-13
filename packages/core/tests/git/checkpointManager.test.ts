import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { createCheckpointManager } from "../../src/git/checkpointManager.js";
import { createGitExecutor } from "../../src/git/gitExecutor.js";
import { GitCheckpointError } from "../../src/errors/SkillForgeError.js";

const GIT_TIMEOUT = 60000;

async function rmRf(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // best effort on Windows file locks
  }
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
  execSync("git config core.autocrlf false", { cwd: dir, stdio: "pipe" });
  await fs.writeFile(path.join(dir, "README.md"), "# hello\n", "utf8");
  await fs.writeFile(path.join(dir, "a.txt"), "alpha\n", "utf8");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m init", { cwd: dir, stdio: "pipe" });
}

describe("checkpointManager - real git repo scenario 1", () => {
  let dir: string;
  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `sf-git1-${Date.now()}`);
    await initGitRepo(dir);
  }, GIT_TIMEOUT);
  afterEach(async () => {
    await rmRf(dir);
  });

  it("clean repo: skill modifies 3 files & creates 2 new files -> rollback restores exact original state", async () => {
    const mgr = createCheckpointManager(dir);
    const cp = await mgr.createCheckpoint("run-1", "skill-1");
    expect(cp.skillId).toBe("skill-1");
    expect(cp.baseHead).toMatch(/^[0-9a-f]{5,40}$/);

    await fs.writeFile(path.join(dir, "README.md"), "# modified readme\n", "utf8");
    await fs.writeFile(path.join(dir, "a.txt"), "modified alpha\n", "utf8");
    await fs.writeFile(path.join(dir, "new1.txt"), "brand new\n", "utf8");
    await fs.writeFile(path.join(dir, "new2.txt"), "brand new 2\n", "utf8");

    const before = await fs.readFile(path.join(dir, "README.md"), "utf8");
    expect(before).toBe("# modified readme\n");

    const result = await mgr.rollbackToCheckpoint("run-1");
    expect(result.restored).toBe(true);
    expect(result.workingTreeMatches).toBe(true);

    const afterReadme = (await fs.readFile(path.join(dir, "README.md"), "utf8")).replace(/\r\n/g, "\n");
    expect(afterReadme).toBe("# hello\n");
    const afterA = (await fs.readFile(path.join(dir, "a.txt"), "utf8")).replace(/\r\n/g, "\n");
    expect(afterA).toBe("alpha\n");

    const new1Exists = await fs.access(path.join(dir, "new1.txt")).then(() => true).catch(() => false);
    const new2Exists = await fs.access(path.join(dir, "new2.txt")).then(() => true).catch(() => false);
    expect(new1Exists).toBe(false);
    expect(new2Exists).toBe(false);

    const statusAfter = await createGitExecutor(dir).status();
    expect(statusAfter.untrackedFiles).toEqual([]);
    expect(statusAfter.modifiedFiles).toEqual([]);
    expect(statusAfter.dirty).toBe(false);
  }, GIT_TIMEOUT);
});

describe("checkpointManager - real git repo scenario 2", () => {
  let dir: string;
  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `sf-git2-${Date.now()}`);
    await initGitRepo(dir);
    await fs.writeFile(path.join(dir, "a.txt"), "PRE-EXISTING EDIT\n", "utf8");
    await fs.writeFile(path.join(dir, "notes.txt"), "user notes\n", "utf8");
  }, GIT_TIMEOUT);
  afterEach(async () => {
    await rmRf(dir);
  });

  it("repo already dirty + untracked notes: skill corrupts files -> rollback preserves pre-existing edits AND untracked file", async () => {
    const mgr = createCheckpointManager(dir);
    const cp = await mgr.createCheckpoint("run-2", "skill-2");
    expect(cp.baseHead).toBeDefined();

    await fs.writeFile(path.join(dir, "README.md"), "CORRUPTED\n", "utf8");
    await fs.writeFile(path.join(dir, "a.txt"), "CORRUPTED\n", "utf8");
    await fs.writeFile(path.join(dir, "notes.txt"), "CORRUPTED NOTES\n", "utf8");
    await fs.writeFile(path.join(dir, "junk.txt"), "junk\n", "utf8");

    const result = await mgr.rollbackToCheckpoint("run-2");
    expect(result.restored).toBe(true);
    expect(result.workingTreeMatches).toBe(true);

    const aTxt = (await fs.readFile(path.join(dir, "a.txt"), "utf8")).replace(/\r\n/g, "\n");
    expect(aTxt).toBe("PRE-EXISTING EDIT\n");

    const notes = (await fs.readFile(path.join(dir, "notes.txt"), "utf8")).replace(/\r\n/g, "\n");
    expect(notes).toBe("user notes\n");

    const junkExists = await fs.access(path.join(dir, "junk.txt")).then(() => true).catch(() => false);
    expect(junkExists).toBe(false);

    const statusAfter = await createGitExecutor(dir).status();
    expect(statusAfter.modifiedFiles).toEqual([]);
    expect(statusAfter.dirty).toBe(false);
  }, GIT_TIMEOUT);
});

describe("checkpointManager - git stash stack untouched", () => {
  let dir: string;
  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `sf-git3-${Date.now()}`);
    await initGitRepo(dir);
  }, GIT_TIMEOUT);
  afterEach(async () => {
    await rmRf(dir);
  });

  it("user's git stash list remains completely untouched throughout checkpoint & rollback", async () => {
    const stashBefore = execSync("git stash list", { cwd: dir, stdio: "pipe" }).toString().trim();

    const mgr = createCheckpointManager(dir);
    const cp = await mgr.createCheckpoint("run-3", "skill-3");
    await fs.writeFile(path.join(dir, "README.md"), "changed\n", "utf8");
    await mgr.rollbackToCheckpoint("run-3");

    const stashAfter = execSync("git stash list", { cwd: dir, stdio: "pipe" }).toString().trim();
    expect(stashAfter).toBe(stashBefore);
  }, GIT_TIMEOUT);
});

describe("checkpointManager - list and prune", () => {
  let dir: string;
  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `sf-git4-${Date.now()}`);
    await initGitRepo(dir);
  }, GIT_TIMEOUT);
  afterEach(async () => {
    await rmRf(dir);
  });

  it("lists checkpoints created via createCheckpoint", async () => {
    const mgr = createCheckpointManager(dir);
    await mgr.createCheckpoint("run-list-1", "skill-a");
    await mgr.createCheckpoint("run-list-2", "skill-b");
    const list = await mgr.listCheckpoints();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const ids = list.map((c) => c.runId);
    expect(ids).toContain("run-list-1");
    expect(ids).toContain("run-list-2");
  }, GIT_TIMEOUT);

  it("pruneCheckpoints removes stale refs older than days", async () => {
    const mgr = createCheckpointManager(dir);
    await mgr.createCheckpoint("run-prune", "skill-c");
    const count = await mgr.pruneCheckpoints(0);
    const list = await mgr.listCheckpoints();
    expect(list.length).toBe(0);
    expect(count).toBeGreaterThanOrEqual(1);
  }, GIT_TIMEOUT);
});

describe("checkpointManager - errors", () => {
  let dir: string;
  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `sf-git5-${Date.now()}`);
    await initGitRepo(dir);
  }, GIT_TIMEOUT);
  afterEach(async () => {
    await rmRf(dir);
  });

  it("rollback of unknown run throws GitCheckpointError", async () => {
    const mgr = createCheckpointManager(dir);
    await expect(mgr.rollbackToCheckpoint("nonexistent-run")).rejects.toBeInstanceOf(GitCheckpointError);
  }, GIT_TIMEOUT);

  it("createCheckpoint in non-git dir throws", async () => {
    const nonGit = path.join(os.tmpdir(), `sf-nongit-${Date.now()}`);
    await fs.mkdir(nonGit, { recursive: true });
    try {
      const mgr = createCheckpointManager(nonGit);
      await expect(mgr.createCheckpoint("run-ng", "skill-ng")).rejects.toBeInstanceOf(GitCheckpointError);
    } finally {
      await rmRf(nonGit);
    }
  }, GIT_TIMEOUT);
});

describe("checkpointManager - commitCheckpointSuccess", () => {
  let dir: string;
  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `sf-git6-${Date.now()}`);
    await initGitRepo(dir);
  }, GIT_TIMEOUT);
  afterEach(async () => {
    await rmRf(dir);
  });

  it("commits with conventional format and returns head sha", async () => {
    const mgr = createCheckpointManager(dir);
    await fs.writeFile(path.join(dir, "a.txt"), "committed change\n", "utf8");
    const sha = await mgr.commitCheckpointSuccess("run-commit", "skill-commit", "refactor module");
    expect(sha).toMatch(/^[0-9a-f]{5,40}$/);
    const log = execSync("git log --oneline -1", { cwd: dir, stdio: "pipe" }).toString();
    expect(log).toContain("chore(skill): skill-commit - refactor module");
  }, GIT_TIMEOUT);
});
