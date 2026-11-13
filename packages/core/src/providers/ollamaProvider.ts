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

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: ToolDefinition[];
  stream: boolean;
  options?: { temperature?: number; num_predict?: number };
}

interface OllamaChatResponse {
  message: OllamaMessage;
  done: boolean;
}

export class OllamaProvider extends BaseProvider {
  public readonly name = "ollama";
  constructor(public readonly baseUrl: string = "http://127.0.0.1:11434") {
    super();
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    return this.withRetry("ollama.complete", async () => {
      const body: OllamaChatRequest = {
        model: this.resolveModel(request),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        tools: request.tools ?? [],
        stream: false,
      };
      if (request.temperature !== undefined || request.maxTokens !== undefined) {
        body.options = {};
        if (request.temperature !== undefined) body.options.temperature = request.temperature;
        if (request.maxTokens !== undefined) body.options.num_predict = request.maxTokens;
      }
      const res = await fetchJson(`${this.baseUrl}/api/chat`, request.signal, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err: any = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const data: OllamaChatResponse = await res.json();
      const message: ChatMessage = { role: "assistant", content: data.message.content ?? "" };
      if (data.message.tool_calls) {
        message.toolCalls = data.message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: (this.safeParseJson(tc.function.arguments, {}) as Record<string, unknown>) ?? {},
        }));
      }
      return { message, raw: JSON.stringify(data) };
    }, request.signal);
  }

  async *stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamChunk> {
    const iterable = await this.withRetry("ollama.stream", async () => this.streamBody(request), request.signal);
    yield* iterable;
  }

  private async *streamBody(request: LlmCompletionRequest): AsyncIterable<LlmStreamChunk> {
    const body: OllamaChatRequest = {
      model: this.resolveModel(request),
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: request.tools ?? [],
      stream: true,
    };
    if (request.temperature !== undefined || request.maxTokens !== undefined) {
      body.options = {};
      if (request.temperature !== undefined) body.options.temperature = request.temperature;
      if (request.maxTokens !== undefined) body.options.num_predict = request.maxTokens;
    }
    const res = await fetchJson(`${this.baseUrl}/api/chat`, request.signal, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
          message: "ollama.stream aborted",
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
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim() === "") continue;
        try {
          const evt: OllamaChatResponse = JSON.parse(line);
          if (evt.message.content) {
            yield { type: "text", content: evt.message.content };
          }
          if (evt.message.tool_calls) {
            for (const tc of evt.message.tool_calls) {
              yield {
                type: "tool_call_delta",
                toolCallDelta: {
                  id: tc.id,
                  name: tc.function.name,
                  arguments: (this.safeParseJson(tc.function.arguments, {}) as Record<string, unknown>) ?? {},
                },
              };
            }
          }
          if (evt.done) {
            yield { type: "done" };
            return;
          }
        } catch {
          // ignore malformed NDJSON lines
        }
      }
    }
    yield { type: "done" };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private resolveModel(request: LlmCompletionRequest): string {
    return request.messages.find((m) => m.role === "system")?.content ?? "default";
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
