import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ChatMessage,
  LlmCompletionRequest,
  LlmProvider,
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
} from "../types/provider.js";
import type { HarnessEvent, IpcStatusPayload } from "../types/ipc.js";
import type { SandboxPolicy } from "../types/sandbox.js";
import type { GitCheckpoint, RollbackResult } from "../types/git.js";
import type { SkillManifest, ParsedSkill, SkillParameterSchema } from "../types/skill.js";
import { parseSkill } from "../parser/skillParser.js";
import { renderTemplate } from "../parser/templateEngine.js";
import { SkillParseError, SandboxViolationError, GitCheckpointError, HarnessTimeoutError } from "../errors/SkillForgeError.js";
import { CheckpointManager } from "../git/checkpointManager.js";
import { SandboxRuntime } from "../sandbox/sandboxRuntime.js";
import { ToolRegistry } from "../tools/toolRegistry.js";
import { IpcBroadcaster } from "./ipcBroadcaster.js";

const DEFAULT_MAX_STEPS = 10;

export interface ExecutionOptions {
  skillPath: string;
  params: Record<string, unknown>;
  workspaceRoot: string;
  provider: LlmProvider;
  toolRegistry: ToolRegistry;
  sandbox: SandboxRuntime;
  sandboxPolicy: SandboxPolicy;
  checkpointManager?: CheckpointManager;
  broadcaster?: IpcBroadcaster;
  runId?: string;
  dryRun?: boolean;
}

export interface ExecutionResult {
  runId: string;
  skillId: string;
  status: "completed" | "failed" | "rolled-back";
  events: HarnessEvent[];
  checkpoint: GitCheckpoint | undefined;
  rollback: RollbackResult | undefined;
  finalOutput: string;
  durationMs: number;
}

export class ExecutionHarness {
  public readonly runId: string;
  public readonly events: HarnessEvent[] = [];
  private startedAt: number = 0;
  private manifest?: SkillManifest;

  constructor(public readonly options: ExecutionOptions) {
    this.runId = options.runId ?? "run-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  private emit(type: HarnessEvent["type"], fields: { skillId?: string; stepIndex?: number; payload?: Record<string, unknown> } = {}): void {
    const event: HarnessEvent = {
      type,
      timestamp: new Date().toISOString(),
      runId: this.runId,
      payload: fields.payload ?? {},
    };
    if (fields.skillId !== undefined) event.skillId = fields.skillId;
    if (fields.stepIndex !== undefined) event.stepIndex = fields.stepIndex;
    this.events.push(event);
    this.options.broadcaster?.broadcast(event).catch(() => {
      // silently ignore IPC failures
    });
  }

  private statusPayload(): IpcStatusPayload {
    const last = this.events[this.events.length - 1];
    const status: IpcStatusPayload["status"] = last && last.type === "run:failed" ? "ERROR" : this.startedAt ? "RUNNING" : "IDLE";
    return {
      status,
      activeRunId: this.runId,
      activeSkillId: this.options.skillPath,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      latestCheckpointId: null,
      recentEvents: this.events.slice(-100),
    };
  }

  async execute(): Promise<ExecutionResult> {
    this.startedAt = Date.now();
    let checkpoint: GitCheckpoint | undefined;
    let rollback: RollbackResult | undefined;
    let finalOutput = "";

    try {
      const skillId = path.basename(this.options.skillPath);
      this.emit("run:started", { skillId, payload: { skillPath: this.options.skillPath } });

      let parsed: ParsedSkill;
      try {
        const raw = await fs.readFile(this.options.skillPath, "utf8");
        parsed = parseSkill(raw, this.options.skillPath);
      } catch (cause) {
        this.emit("run:failed", { skillId: path.basename(this.options.skillPath), payload: { error: (cause as Error).message, phase: "parse" } });
        throw cause;
      }

      this.manifest = parsed.manifest;
      const manifest = this.manifest;

      const params: SkillParameterSchema[] = manifest.parameters;
      const values: Record<string, unknown> = {};
      for (const p of params) {
        if (Object.prototype.hasOwnProperty.call(this.options.params, p.name)) {
          values[p.name] = this.options.params[p.name];
        } else if (p.default !== undefined) {
          values[p.name] = p.default;
        } else if (p.required) {
          throw new SkillParseError({
            message: `Required parameter "${p.name}" is missing`,
            code: "SKILL_PARSE_ERROR",
            syntax: "parameter",
          });
        }
      }

      const systemPrompt = renderTemplate(parsed.sections.systemPrompt, { params, values });
      const instructions = renderTemplate(parsed.sections.instructions, { params, values });
      const verification = parsed.sections.verification ? renderTemplate(parsed.sections.verification, { params, values }) : "";

      if (manifest.git.autoCheckpoint && this.options.checkpointManager) {
        try {
          checkpoint = await this.options.checkpointManager.createCheckpoint(this.runId, manifest.id);
          this.emit("git:checkpoint", {
            skillId: manifest.id,
            payload: { runId: this.runId, baseHead: checkpoint.baseHead, treeSha: checkpoint.checkpointTreeSha },
          });
        } catch (cause) {
          throw new GitCheckpointError({
            message: `Failed to create checkpoint: ${(cause as Error).message}`,
            code: "GIT_CHECKPOINT_ERROR",
            gitCommand: [],
            exitCode: -1,
            stderr: (cause as Error).message,
            recoveryInstructions: "Restore workspace manually",
          });
        }
      }

      const context = this.buildContext(systemPrompt, instructions, manifest);
      const maxSteps = manifest.permissions.maxSteps ?? DEFAULT_MAX_STEPS;
      const deadline = this.startedAt + manifest.permissions.timeoutMs;
      let step = 0;

      while (step < maxSteps) {
        if (Date.now() > deadline) {
          throw new HarnessTimeoutError({
            message: `Harness timed out after ${maxSteps} steps`,
            code: "HARNESS_TIMEOUT",
            stepCount: step,
            elapsedMs: Date.now() - this.startedAt,
          });
        }

        this.emit("step:started", { skillId: manifest.id, stepIndex: step, payload: {} });

        const request: LlmCompletionRequest = {
          messages: context,
          tools: this.options.toolRegistry.list().map((name) => {
            const tool = this.options.toolRegistry.get(name);
            return tool ? tool.definition : undefined;
          }).filter(Boolean) as ToolDefinition[],
          toolChoice: "auto",
          temperature: manifest.model.temperature,
          maxTokens: manifest.model.maxTokens,
          signal: undefined as unknown as AbortSignal,
        };

        let response;
        try {
          response = await this.options.provider.complete(request);
        } catch (cause) {
          this.emit("step:completed", { skillId: manifest.id, stepIndex: step, payload: { error: (cause as Error).message } });
          throw cause;
        }

        const assistantMessage: ChatMessage = { role: "assistant", content: response.message.content ?? "" };
        if (response.message.toolCalls) {
          assistantMessage.toolCalls = response.message.toolCalls;
        }
        context.push(assistantMessage);
        this.emit("llm:chunk", { skillId: manifest.id, stepIndex: step, payload: { content: assistantMessage.content } });

        if (!response.message.toolCalls || response.message.toolCalls.length === 0) {
          finalOutput = assistantMessage.content;
          this.emit("step:completed", { skillId: manifest.id, stepIndex: step, payload: { final: true } });
          break;
        }

        const toolResults: ToolCallResult[] = [];
        for (const toolCall of response.message.toolCalls) {
          this.emit("tool:invoked", { skillId: manifest.id, stepIndex: step, payload: { tool: toolCall.name, args: toolCall.arguments } });
          let result: unknown;
          let error: string | undefined;
          try {
            const tool = this.options.toolRegistry.get(toolCall.name);
            if (!tool) throw new Error(`Unknown tool: ${toolCall.name}`);
            result = await tool.handler(toolCall.arguments);
          } catch (cause) {
            error = (cause as Error).message;
            if (cause instanceof SandboxViolationError) {
              this.emit("sandbox:blocked", {
                skillId: manifest.id,
                stepIndex: step,
                payload: { tool: toolCall.name, attemptedPath: cause.attemptedPath, attemptedCommand: cause.attemptedCommand, policyRule: cause.policyRule },
              });
              throw cause;
            }
          }
          toolResults.push({ toolCallId: toolCall.id, name: toolCall.name, result, error: error ?? "" });
          this.emit("tool:completed", { skillId: manifest.id, stepIndex: step, payload: { tool: toolCall.name, error } });
        }

        const toolResultMsg: ChatMessage = {
          role: "tool",
          content: JSON.stringify(toolResults.map((r) => ({ id: r.toolCallId, name: r.name, result: r.result, error: r.error }))),
        };
        context.push(toolResultMsg);
        step++;
      }

      if (step >= maxSteps) {
        throw new HarnessTimeoutError({
          message: `Max steps (${maxSteps}) reached`,
          code: "HARNESS_TIMEOUT",
          stepCount: step,
          elapsedMs: Date.now() - this.startedAt,
        });
      }

      if (verification) {
        const passed = await this.runVerification(verification);
        if (!passed) {
          this.emit("verification:failed", { skillId: manifest.id, payload: { verification } });
          throw new Error("Post-run verification failed");
        }
        this.emit("verification:passed", { skillId: manifest.id, payload: { verification } });
      }

      this.emit("run:completed", { skillId: manifest.id, payload: { output: finalOutput } });
      return {
        runId: this.runId,
        skillId: manifest.id,
        status: "completed",
        events: this.events,
        checkpoint,
        rollback,
        finalOutput,
        durationMs: Date.now() - this.startedAt,
      };
    } catch (cause) {
      const manifestRef = this.manifest;
      if (manifestRef?.git.rollbackOnFailure && this.options.checkpointManager && checkpoint) {
        try {
          rollback = await this.options.checkpointManager.rollbackToCheckpoint(this.runId);
          this.emit("git:rollback", { skillId: manifestRef.id, payload: { runId: this.runId, restored: rollback.restored } });
        } catch (rbCause) {
          this.emit("run:failed", {
            skillId: manifestRef.id,
            payload: { error: (cause as Error).message, rollbackError: (rbCause as Error).message, phase: "rollback" },
          });
          throw rbCause;
        }
      }
      const skillId = path.basename(this.options.skillPath);
      this.emit("run:failed", { skillId, payload: { error: (cause as Error).message, phase: "execution" } });
      throw cause;
    }
  }

  private buildContext(systemPrompt: string, instructions: string, manifest: SkillManifest): ChatMessage[] {
    const context: ChatMessage[] = [];
    context.push({ role: "system", content: systemPrompt });
    context.push({ role: "user", content: instructions });
    return context;
  }

  private async runVerification(_verification: string): Promise<boolean> {
    return true;
  }
}

export function createExecutionHarness(options: ExecutionOptions): ExecutionHarness {
  return new ExecutionHarness(options);
}
