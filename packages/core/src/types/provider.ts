export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result?: unknown;
  error?: string;
}

export interface LlmStreamChunk {
  type: "text" | "tool_call" | "tool_call_delta" | "done";
  content?: string;
  toolCall?: ToolCallRequest;
  toolCallDelta?: Partial<ToolCallRequest>;
}

export interface LlmCompletionRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "none" | "required" | "auto";
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmCompletionResponse {
  message: ChatMessage;
  raw: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
  stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamChunk>;
  healthCheck(): Promise<boolean>;
}
