import type {
  ChatMessage,
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
  LlmStreamChunk,
  ToolCallRequest,
  ToolDefinition,
} from "../types/provider.js";
import { ProviderExecutionError } from "../errors/SkillForgeError.js";
import type { SkillForgeErrorOptions } from "../errors/SkillForgeError.js";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

function isRetryableHttp(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export abstract class BaseProvider implements LlmProvider {
  public abstract readonly name: string;

  public abstract complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
  public abstract stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamChunk>;
  public abstract healthCheck(): Promise<boolean>;

  protected async withRetry<T>(
    label: string,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        const abortOpts: SkillForgeErrorOptions & {
          providerName: string;
          httpStatus?: number;
          retryable?: boolean;
          cause: Error;
        } = {
          message: `${label} aborted`,
          code: "PROVIDER_EXECUTION_ERROR",
          providerName: this.name,
          retryable: true,
          cause: new Error("AbortSignal aborted"),
        };
        throw new ProviderExecutionError(abortOpts);
      }
      try {
        return await fn();
      } catch (cause) {
        const err = cause as Error;
        lastError = err;
        const status = this.extractHttpStatus(err);
        if (status !== undefined && isRetryableHttp(status) && attempt < MAX_RETRIES - 1) {
          await sleep(BASE_BACKOFF_MS * (attempt + 1));
          continue;
        }
        const failOpts: SkillForgeErrorOptions & {
          providerName: string;
          httpStatus?: number;
          retryable?: boolean;
          cause: Error;
        } = {
          message: `${label} failed: ${err.message}`,
          code: "PROVIDER_EXECUTION_ERROR",
          providerName: this.name,
          retryable: status !== undefined && isRetryableHttp(status),
          cause: err,
        };
        if (status !== undefined) failOpts.httpStatus = status;
        throw new ProviderExecutionError(failOpts);
      }
    }
    const status = lastError ? this.extractHttpStatus(lastError) : undefined;
    const finalOpts: SkillForgeErrorOptions & {
      providerName: string;
      httpStatus?: number;
      retryable?: boolean;
      cause?: Error;
    } = {
      message: `${label} failed after ${MAX_RETRIES} attempts: ${lastError?.message ?? ""}`,
      code: "PROVIDER_EXECUTION_ERROR",
      providerName: this.name,
      retryable: true,
    };
    if (status !== undefined) finalOpts.httpStatus = status;
    if (lastError) finalOpts.cause = lastError;
    throw new ProviderExecutionError(finalOpts);
  }

  protected extractHttpStatus(error: unknown): number | undefined {
    if (error && typeof error === "object" && "status" in error) {
      const s = (error as Record<string, unknown>).status;
      if (typeof s === "number") return s;
    }
    return undefined;
  }
}

export function accumulateText(chunks: Iterable<LlmStreamChunk>): string {
  let out = "";
  for (const chunk of chunks) {
    if (chunk.type === "text" && chunk.content) out += chunk.content;
  }
  return out;
}

export function mergeToolCallDeltas(chunks: Iterable<LlmStreamChunk>): ToolCallRequest[] {
  const calls = new Map<string, ToolCallRequest>();
  for (const chunk of chunks) {
    if (chunk.type === "tool_call") {
      calls.set(chunk.toolCall!.id, { ...chunk.toolCall! });
    } else if (chunk.type === "tool_call_delta" && chunk.toolCallDelta) {
      const id = chunk.toolCallDelta.id;
      if (!id) continue;
      let call = calls.get(id);
      if (!call) {
        call = { id, name: "", arguments: {} };
        calls.set(id, call);
      }
      if (chunk.toolCallDelta.name) call.name = chunk.toolCallDelta.name;
      if (chunk.toolCallDelta.arguments) {
        call.arguments = { ...call.arguments, ...chunk.toolCallDelta.arguments };
      }
    }
  }
  return Array.from(calls.values());
}
