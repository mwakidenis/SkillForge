export interface GitCheckpoint {
  runId: string;
  skillId: string;
  baseHead: string;
  baseHeadType: "branch" | "detached";
  checkpointTreeSha: string;
  timestamp: string;
  untrackedFiles: string[];
  refName: string;
}

export interface RollbackResult {
  runId: string;
  restored: boolean;
  workingTreeMatches: boolean;
  removedUntracked: string[];
  message: string;
}

export interface GitStatusResult {
  isGitWorktree: boolean;
  branch: string | null;
  headSha: string | null;
  isDetached: boolean;
  dirty: boolean;
  modifiedFiles: string[];
  untrackedFiles: string[];
}
