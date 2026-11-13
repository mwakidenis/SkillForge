import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createCheckpointManager } from "@skillforge/core";
import { createGitExecutor } from "@skillforge/core";

export interface RollbackCommandArgs {
  workspace?: string;
  json?: boolean;
  runId?: string;
  list?: boolean;
  _: string[];
}

export async function rollbackCommand(args: RollbackCommandArgs): Promise<void> {
  const workspace = args.workspace ?? process.cwd();
  const git = createGitExecutor(workspace);
  const isWorktree = await git.isGitWorktree();
  if (!isWorktree) {
    throw new Error("Not inside a Git worktree");
  }

  const mgr = createCheckpointManager(workspace);

  if (args.list) {
    const checkpoints = await mgr.listCheckpoints();
    if (args.json) {
      process.stdout.write(JSON.stringify({ checkpoints }, null, 2) + "\n");
    } else {
      if (checkpoints.length === 0) {
        process.stdout.write("No checkpoints found.\n");
      } else {
        for (const cp of checkpoints) {
          process.stdout.write(`${cp.runId} | ${cp.skillId} | ${cp.baseHead.slice(0, 8)} | ${cp.timestamp}\n`);
        }
      }
    }
    return;
  }

  const runId = args.runId;
  if (!runId) {
    // rollback the latest checkpoint
    const checkpoints = await mgr.listCheckpoints();
    if (checkpoints.length === 0) {
      throw new Error("No checkpoints available to rollback");
    }
    const latest = checkpoints[checkpoints.length - 1]!;
    await mgr.rollbackToCheckpoint(latest.runId);
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: true, runId: latest.runId, restored: true }) + "\n");
    } else {
      process.stdout.write(`Rolled back to checkpoint ${latest.runId}\n`);
    }
    return;
  }

  const result = await mgr.rollbackToCheckpoint(runId);
  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: true, runId, restored: result.restored, workingTreeMatches: result.workingTreeMatches }) + "\n");
  } else {
    process.stdout.write(`Rolled back to checkpoint ${runId}: ${result.message}\n`);
  }
}
