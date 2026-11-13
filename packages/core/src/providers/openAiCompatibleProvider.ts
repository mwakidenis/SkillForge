import type {
  ChatMessage,
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmStreamChunk,
  ToolDefinition,
} from "../types/provider.js";
import { BaseProvider, accumulateText, mergeToolCallDeltas } from "./baseProvider.js";
import { ProviderExecutionError } from "../errors/SkillForgeError.js";

async function fetchJson(url: string, signal: AbortSignal | undefined, init: RequestInit): Promise<Response> {
  const finalInit: RequestInit = { ...init };
  if (signal !== undefined) finalInit.signal = signal;
  return fetch(url, finalInit);
}

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: ToolDefinition[];
  tool_choice?: "none" | "required" | "auto";
  temperature?: number;
  max_tokens?: number;
  stream: boolean;
}

interface OpenAIStreamChoice {
  index: number;
  delta: { role?: string; content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
  finish_reason: string | null;
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{ message: OpenAIMessage; finish_reason: string | null }>;
}

export class OpenAiCompatibleProvider extends BaseProvider {
  public readonly name = "openai-compatible";
  constructor(public readonly baseUrl: string = "http://127.0.0.1:1234") {
    super();
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    return this.withRetry("openai-compatible.complete", async () => {
      const body: OpenAIChatRequest = {
        model: request.messages.find((m) => m.role === "system")?.content ?? "default",
        messages: request.messages.map((m) => ({ role: m.role, content: m.content ?? null })),
        stream: false,
      };
      if (request.tools) body.tools = request.tools;
      if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
      const res = await fetchJson(`${this.baseUrl}/v1/chat/completions`, request.signal, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err: any = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const data: OpenAIChatResponse = await res.json();
      const choice = data.choices[0];
      if (!choice) {
        throw new ProviderExecutionError({
          message: "openai-compatible.complete returned no choices",
          code: "PROVIDER_EXECUTION_ERROR",
          providerName: this.name,
          retryable: true,
          cause: new Error("empty choices"),
        });
      }
      const message: ChatMessage = { role: "assistant", content: choice.message.content ?? "" };
      if (choice.message.tool_calls) {
        message.toolCalls = choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: (this.safeParseJson(tc.function.arguments, {}) as Record<string, unknown>) ?? {},
        }));
      }
      return { message, raw: JSON.stringify(data) };
    }, request.signal);
  }

  async *stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamChunk> {
    const iterable = await this.withRetry("openai-compatible.stream", async () => this.streamBody(request), request.signal);
    yield* iterable;
  }

  private async *streamBody(request: LlmCompletionRequest): AsyncIterable<LlmStreamChunk> {
    const body: OpenAIChatRequest = {
      model: request.messages.find((m) => m.role === "system")?.content ?? "default",
      messages: request.messages.map((m) => ({ role: m.role, content: m.content ?? null })),
      stream: true,
    };
    if (request.tools) body.tools = request.tools;
    if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    const res = await fetchJson(`${this.baseUrl}/v1/chat/completions`, request.signal, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      if (request.signal?.aborted) {
        throw new ProviderExecutionError({
          message: "openai-compatible.stream aborted",
          code: "PROVIDER_EXECUTION_ERROR",
          providerName: this.name,
          retryable: true,
          cause: new Error("AbortSignal aborted"),
        });
      }
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = block.split("\n");
        let dataLine = "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            dataLine = line.slice(6);
          }
        }
        if (dataLine === "[DONE]") {
          yield { type: "done" };
          return;
        }
        if (dataLine) {
          try {
            const evt: OpenAIStreamChunk = JSON.parse(dataLine);
            for (const choice of evt.choices) {
              const delta = choice.delta;
              if (delta.content) yield { type: "text", content: delta.content };
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  yield {
                    type: "tool_call_delta",
                      toolCallDelta: {
                        id: tc.id ?? "",
                        name: tc.function?.name ?? "",
                        arguments: (this.safeParseJson(tc.function?.arguments ?? "{}", {}) as Record<string, unknown>) ?? {},
                      },
                  };
                }
              }
              if (choice.finish_reason) yield { type: "done" };
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    }
    yield { type: "done" };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private safeParseJson(input: string, fallback: unknown): unknown {
    try {
      return JSON.parse(input);
    } catch {
      return fallback;
    }
  }
}

export type { ChatMessage, LlmCompletionRequest, LlmCompletionResponse, LlmStreamChunk };
