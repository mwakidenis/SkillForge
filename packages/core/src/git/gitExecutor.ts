import * as child_process from "node:child_process";
import type { GitStatusResult } from "../types/git.js";
import { GitCheckpointError } from "../errors/SkillForgeError.js";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export class GitExecutor {
  public readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  exec(args: string[], options: GitExecOptions = {}): Promise<GitResult> {
    const cwd = options.cwd ?? this.cwd;
    return new Promise<GitResult>((resolve) => {
      child_process.execFile("git", args, { cwd, env: options.env }, (error, stdout, stderr) => {
        let exitCode = 0;
        if (error) {
          exitCode = (error as NodeJS.ErrnoException & { code?: string }).code ? 1 : 0;
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            exitCode = 127;
          }
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
      });
    });
  }

  async isGitWorktree(cwd?: string): Promise<boolean> {
    const target = cwd ?? this.cwd;
    const res = await this.exec(["rev-parse", "--is-inside-work-tree"], { cwd: target });
    return res.exitCode === 0 && res.stdout.trim() === "true";
  }

  async status(cwd?: string): Promise<GitStatusResult> {
    const target = cwd ?? this.cwd;
    const isWorktree = await this.isGitWorktree(target);
    if (!isWorktree) {
      return { isGitWorktree: false, branch: null, headSha: null, isDetached: false, dirty: false, modifiedFiles: [], untrackedFiles: [] };
    }

    const [branchRes, headRes, detachedRes, statusRes, untrackedRes] = await Promise.all([
      this.exec(["symbolic-ref", "--short", "HEAD"], { cwd: target }),
      this.exec(["rev-parse", "HEAD"], { cwd: target }),
      this.exec(["symbolic-ref", "HEAD"], { cwd: target }),
      this.exec(["diff", "--name-only"], { cwd: target }),
      this.exec(["ls-files", "--others", "--exclude-standard"], { cwd: target }),
    ]);

    const branch = branchRes.exitCode === 0 ? branchRes.stdout.trim() : null;
    const headSha = headRes.exitCode === 0 ? headRes.stdout.trim() : null;
    const isDetached = detachedRes.exitCode !== 0;
    const dirty = statusRes.stdout.trim().length > 0 || untrackedRes.stdout.trim().length > 0;
    const modifiedFiles = statusRes.stdout.trim() ? statusRes.stdout.trim().split(/\n/) : [];
    const untrackedFiles = untrackedRes.stdout.trim() ? untrackedRes.stdout.trim().split(/\n/) : [];

    return { isGitWorktree: true, branch, headSha, isDetached, dirty, modifiedFiles, untrackedFiles };
  }

  async getHeadSha(cwd?: string): Promise<string | null> {
    const res = await this.exec(["rev-parse", "HEAD"], { cwd: cwd ?? this.cwd });
    return res.exitCode === 0 ? res.stdout.trim() : null;
  }
}

export function createGitExecutor(cwd: string): GitExecutor {
  return new GitExecutor(cwd);
}

export type { GitStatusResult };
