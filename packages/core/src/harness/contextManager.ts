import { HarnessTimeoutError } from "../errors/SkillForgeError.js";
import type { ChatMessage } from "../types/provider.js";

const ESTIMATED_CHARS_PER_TOKEN = 4;

export class ContextManager {
  public readonly messages: ChatMessage[] = [];
  public readonly maxTokens: number;

  constructor(maxTokens: number = 4096) {
    this.maxTokens = maxTokens;
  }

  addMessage(message: ChatMessage): void {
    this.messages.push(message);
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
  }

  totalEstimatedTokens(): number {
    return this.messages.reduce((sum, m) => sum + this.estimateTokens(m.content ?? ""), 0);
  }

  truncateToFit(preserveHeadCount: number = 2): ChatMessage[] {
    if (this.totalEstimatedTokens() <= this.maxTokens) return this.getMessages();
    const head = this.messages.slice(0, preserveHeadCount);
    let tail = this.messages.slice(preserveHeadCount);
    let total = head.reduce((sum, m) => sum + this.estimateTokens(m.content ?? ""), 0);
    const kept: ChatMessage[] = [];
    for (let i = tail.length - 1; i >= 0; i--) {
      const m = tail[i];
      if (!m) continue;
      const tokens = this.estimateTokens(m.content ?? "");
      if (total + tokens > this.maxTokens) break;
      kept.unshift(m);
      total += tokens;
    }
    const result = [...head, ...kept];
    const summary: ChatMessage = {
      role: "system",
      content: `[SkillForge context truncated: ${tail.length - kept.length} older messages omitted to fit ${this.maxTokens} token window]`,
    };
    return [summary, ...result];
  }
}

export function createContextManager(maxTokens?: number): ContextManager {
  return new ContextManager(maxTokens);
}
