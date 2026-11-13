export interface IpcStatusPayload {
  status: "IDLE" | "RUNNING" | "ERROR" | "OFFLINE";
  activeRunId: string | null;
  activeSkillId: string | null;
  uptimeMs: number;
  latestCheckpointId: string | null;
  recentEvents: HarnessEvent[];
}

export interface HarnessEvent {
  type:
    | "run:started"
    | "run:completed"
    | "run:failed"
    | "step:started"
    | "step:completed"
    | "llm:chunk"
    | "tool:invoked"
    | "tool:completed"
    | "sandbox:blocked"
    | "git:checkpoint"
    | "git:rollback"
    | "verification:passed"
    | "verification:failed";
  timestamp: string;
  runId: string;
  skillId?: string;
  stepIndex?: number;
  payload: Record<string, unknown>;
}

export interface IpcClientConfig {
  host: string;
  port: number;
  basePath: string;
}
