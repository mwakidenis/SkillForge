import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GitExecutor } from "./gitExecutor.js";
import { GitCheckpointError } from "../errors/SkillForgeError.js";
import type { GitCheckpoint, RollbackResult } from "../types/git.js";

const CHECKPOINTS_DIR = "skillforge-checkpoints";

export class CheckpointManager {
  public readonly git: GitExecutor;

  constructor(git: GitExecutor) {
    this.git = git;
  }

  private refName(runId: string): string {
    return `refs/skillforge/checkpoints/${runId}`;
  }

  private checkpointsDir(cwd: string): string {
    return path.join(cwd, ".git", CHECKPOINTS_DIR);
  }

  private sidecarPath(cwd: string, runId: string): string {
    return path.join(this.checkpointsDir(cwd), `${runId}.json`);
  }

  async createCheckpoint(runId: string, skillId: string): Promise<GitCheckpoint> {
    const cwd = this.git.cwd;
    const isWorktree = await this.git.isGitWorktree();
    if (!isWorktree) {
      throw new GitCheckpointError({
        message: "Target directory is not inside a Git worktree",
        code: "GIT_CHECKPOINT_ERROR",
        gitCommand: ["rev-parse", "--is-inside-work-tree"],
        exitCode: 1,
        stderr: "not a git worktree",
        recoveryInstructions: "Initialize a Git repository (git init) before running skills with autoCheckpoint",
      });
    }

    const status = await this.git.status();
    const baseHead = status.headSha ?? "";
    const baseHeadType: "branch" | "detached" = status.isDetached ? "detached" : "branch";

    // Ensure git user identity exists for stash create / write-tree operations.
    await this.ensureGitIdentity();

    // Stage everything (tracked + untracked) into a temporary index so the user's real
    // index and stash stack (stash@{0}) are never touched.
    const tempIndex = path.join(os.tmpdir(), `skillforge-index-${runId}-${Date.now()}`);
    try {
      await this.git.exec(["add", "-A"], { cwd, env: { ...process.env, GIT_INDEX_FILE: tempIndex } });
    } catch {
      // add -A may fail if nothing to stage; that's fine, empty tree is valid
    }
    const writeTree = await this.git.exec(["write-tree"], { cwd, env: { ...process.env, GIT_INDEX_FILE: tempIndex } });
    if (writeTree.exitCode !== 0) {
      throw new GitCheckpointError({
        message: `Failed to write checkpoint tree: ${writeTree.stderr}`,
        code: "GIT_CHECKPOINT_ERROR",
        gitCommand: ["write-tree"],
        exitCode: writeTree.exitCode,
        stderr: writeTree.stderr,
      });
    }
    const checkpointTreeSha = writeTree.stdout.trim();

    const refName = this.refName(runId);
    const updateRef = await this.git.exec(["update-ref", refName, checkpointTreeSha], { cwd });
    if (updateRef.exitCode !== 0) {
      throw new GitCheckpointError({
        message: `Failed to create checkpoint ref: ${updateRef.stderr}`,
        code: "GIT_CHECKPOINT_ERROR",
        gitCommand: ["update-ref", refName],
        exitCode: updateRef.exitCode,
        stderr: updateRef.stderr,
      });
    }

    await fs.mkdir(this.checkpointsDir(cwd), { recursive: true });
    const metadata = {
      timestamp: new Date().toISOString(),
      skillId,
      baseHead,
      baseHeadType,
      checkpointTreeSha,
      untrackedFiles: status.untrackedFiles,
      runId,
    };
    await fs.writeFile(this.sidecarPath(cwd, runId), JSON.stringify(metadata, null, 2), "utf8");

    // Clean up temp index
    try {
      await fs.unlink(tempIndex);
    } catch {}

    return {
      runId,
      skillId,
      baseHead,
      baseHeadType,
      checkpointTreeSha,
      timestamp: metadata.timestamp,
      untrackedFiles: status.untrackedFiles,
      refName,
    };
  }

  async rollbackToCheckpoint(runId: string): Promise<RollbackResult> {
    const cwd = this.git.cwd;
    const sidecar = await this.readSidecar(cwd, runId);
    if (!sidecar) {
      throw new GitCheckpointError({
        message: `Checkpoint not found for run ${runId}`,
        code: "GIT_CHECKPOINT_ERROR",
        gitCommand: [],
        exitCode: 1,
        stderr: "checkpoint not found",
        recoveryInstructions: "List checkpoints with sf rollback --list",
      });
    }

    const { baseHead, baseHeadType, checkpointTreeSha, untrackedFiles: checkpointUntracked } = sidecar;

    // Restore tracked files to base HEAD.
    const resetHard = await this.git.exec(["reset", "--hard", baseHead], { cwd });
    if (resetHard.exitCode !== 0) {
      throw new GitCheckpointError({
        message: `Failed to reset --hard ${baseHead}: ${resetHard.stderr}`,
        code: "GIT_CHECKPOINT_ERROR",
        gitCommand: ["reset", "--hard", baseHead],
        exitCode: resetHard.exitCode,
        stderr: resetHard.stderr,
      });
    }

    // Restore exact tree state (tracked modifications + previously-untracked files) into
    // index and working tree via the checkpoint tree SHA.
    const readTree = await this.git.exec(["read-tree", "--reset", "-u", checkpointTreeSha], { cwd });
    if (readTree.exitCode !== 0) {
      throw new GitCheckpointError({
        message: `Failed to read-tree checkpoint ${checkpointTreeSha}: ${readTree.stderr}`,
        code: "GIT_CHECKPOINT_ERROR",
        gitCommand: ["read-tree", "--reset", "-u", checkpointTreeSha],
        exitCode: readTree.exitCode,
        stderr: readTree.stderr,
      });
    }
    const checkoutIndex = await this.git.exec(["checkout-index", "-a", "-f"], { cwd });
    if (checkoutIndex.exitCode !== 0) {
      throw new GitCheckpointError({
        message: `Failed to checkout-index: ${checkoutIndex.stderr}`,
        code: "GIT_CHECKPOINT_ERROR",
        gitCommand: ["checkout-index", "-a", "-f"],
        exitCode: checkoutIndex.exitCode,
        stderr: checkoutIndex.stderr,
      });
    }

    // Remove any untracked files on disk that were not part of the checkpoint snapshot.
    const treeFiles = await this.listTreeFiles(checkpointTreeSha);
    const currentUntracked = await this.git.exec(["ls-files", "--others", "--exclude-standard"], { cwd });
    const removedUntracked: string[] = [];
    const currentList = currentUntracked.stdout.trim() ? currentUntracked.stdout.trim().split(/\n/) : [];
    for (const file of currentList) {
      if (!treeFiles.has(file)) {
        const fullPath = path.join(cwd, file);
        try {
          await fs.rm(fullPath, { recursive: true, force: true });
          removedUntracked.push(file);
        } catch {
          // best effort
        }
      }
    }

    // Verify restoration: working tree status should match checkpoint (no modifications).
    const after = await this.git.status(cwd);
    const workingTreeMatches = !after.dirty && after.modifiedFiles.length === 0 && after.untrackedFiles.length === 0;

    return {
      runId,
      restored: true,
      workingTreeMatches,
      removedUntracked,
      message: workingTreeMatches ? "Rollback completed successfully" : "Rollback completed with warnings",
    };
  }

  async commitCheckpointSuccess(runId: string, skillId: string, summary: string): Promise<string> {
    const cwd = this.git.cwd;
    const sidecar = await this.readSidecar(cwd, runId);
    const commitPrefix = sidecar?.commitPrefix ?? "chore(skill)";
    await this.git.exec(["add", "-A"], { cwd });
    const commitRes = await this.git.exec(["commit", "-m", `${commitPrefix}: ${skillId} - ${summary}`], { cwd });
    if (commitRes.exitCode !== 0) {
      throw new GitCheckpointError({
        message: `Failed to commit: ${commitRes.stderr}`,
        code: "GIT_CHECKPOINT_ERROR",
        gitCommand: ["commit", "-m", "..."],
        exitCode: commitRes.exitCode,
        stderr: commitRes.stderr,
      });
    }
    const head = await this.git.getHeadSha(cwd);
    return head ?? "";
  }

  async listCheckpoints(): Promise<GitCheckpoint[]> {
    const cwd = this.git.cwd;
    const list = await this.git.exec(["for-each-ref", "--format=%(refname)", "refs/skillforge/checkpoints/"], { cwd });
    const refs = list.stdout.trim() ? list.stdout.trim().split(/\n/) : [];
    const results: GitCheckpoint[] = [];
    for (const ref of refs) {
      const runId = ref.replace(/^refs\/skillforge\/checkpoints\//, "");
      const sidecar = await this.readSidecar(cwd, runId);
      if (sidecar) {
        results.push({
          runId,
          skillId: sidecar.skillId,
          baseHead: sidecar.baseHead,
          baseHeadType: sidecar.baseHeadType,
          checkpointTreeSha: sidecar.checkpointTreeSha,
          timestamp: sidecar.timestamp,
          untrackedFiles: sidecar.untrackedFiles,
          refName: ref,
        });
      }
    }
    results.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
    return results;
  }

  async pruneCheckpoints(olderThanDays: number): Promise<number> {
    const checkpoints = await this.listCheckpoints();
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let pruned = 0;
    for (const cp of checkpoints) {
      const t = Date.parse(cp.timestamp ?? "");
      if (!isNaN(t) && t < cutoff) {
        await this.git.exec(["update-ref", "-d", cp.refName], { cwd: this.git.cwd });
        try {
          await fs.unlink(this.sidecarPath(this.git.cwd, cp.runId));
        } catch {}
        pruned++;
      }
    }
    return pruned;
  }

  private async readSidecar(cwd: string, runId: string): Promise<sidecar | null> {
    try {
      const content = await fs.readFile(this.sidecarPath(cwd, runId), "utf8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async listTreeFiles(treeSha: string): Promise<Set<string>> {
    const res = await this.git.exec(["ls-tree", "-r", "--name-only", treeSha], { cwd: this.git.cwd });
    const files = new Set<string>();
    if (res.stdout.trim()) {
      for (const line of res.stdout.trim().split(/\n/)) files.add(line);
    }
    return files;
  }

  private async ensureGitIdentity(): Promise<void> {
    const name = await this.git.exec(["config", "user.name"], { cwd: this.git.cwd });
    const email = await this.git.exec(["config", "user.email"], { cwd: this.git.cwd });
    if (name.exitCode !== 0) {
      await this.git.exec(["config", "user.name", "SkillForge"], { cwd: this.git.cwd });
    }
    if (email.exitCode !== 0) {
      await this.git.exec(["config", "user.email", "skillforge@localhost"], { cwd: this.git.cwd });
    }
  }
}

interface sidecar {
  timestamp: string;
  skillId: string;
  baseHead: string;
  baseHeadType: "branch" | "detached";
  checkpointTreeSha: string;
  runId: string;
  untrackedFiles: string[];
  commitPrefix?: string;
}

export function createCheckpointManager(cwd: string): CheckpointManager {
  return new CheckpointManager(new GitExecutor(cwd));
}

export type { GitCheckpoint, RollbackResult };
