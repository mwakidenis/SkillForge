import type {
  ChatMessage,
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
  LlmStreamChunk,
  ToolCallRequest,
  ToolCallResult,
} from "../types/provider.js";

export interface MockScenario {
  responses: Array<{
    message?: ChatMessage;
    chunks?: LlmStreamChunk[];
    error?: Error;
  }>;
}

export interface MockCall {
  request: LlmCompletionRequest;
  stepIndex: number;
}

export class MockDeterministicProvider implements LlmProvider {
  public readonly name = "mock-deterministic";
  public readonly calls: MockCall[] = [];

  constructor(public readonly scenarios: MockScenario[] = []) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    this.calls.push({ request, stepIndex: this.calls.length });
    const scenario = this.scenarios[this.calls.length - 1] ?? this.scenarios[this.scenarios.length - 1] ?? {
      responses: [{ message: { role: "assistant", content: "" } }],
    };
    const response =
      scenario.responses[this.calls.length - 1] ??
      scenario.responses[scenario.responses.length - 1] ??
      { message: { role: "assistant", content: "" } };
    if (response.error) throw response.error;
    const message = response.message ?? { role: "assistant", content: "" };
    return { message: { ...message }, raw: JSON.stringify(message) };
  }

  async *stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamChunk> {
    this.calls.push({ request, stepIndex: this.calls.length });
    const scenario = this.scenarios[this.calls.length - 1] ?? this.scenarios[this.scenarios.length - 1] ?? {
      responses: [{ chunks: [{ type: "text", content: "" }] }],
    };
    const response =
      scenario.responses[this.calls.length - 1] ??
      scenario.responses[scenario.responses.length - 1] ??
      { chunks: [{ type: "text", content: "" }] };
    if (response.error) throw response.error;
    for (const chunk of response.chunks ?? [{ type: "text", content: "" }]) {
      yield chunk;
    }
    yield { type: "done" };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  injectResponse(message: ChatMessage): void {
    this.scenarios.push({ responses: [{ message }] });
  }

  injectError(error: Error): void {
    this.scenarios.push({ responses: [{ error }] });
  }
}
