import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MockDeterministicProvider } from "../../src/providers/mockDeterministicProvider.js";
import { OpenAiCompatibleProvider } from "../../src/providers/openAiCompatibleProvider.js";
import { OllamaProvider } from "../../src/providers/ollamaProvider.js";
import { BaseProvider, accumulateText, mergeToolCallDeltas } from "../../src/providers/baseProvider.js";
import type { LlmStreamChunk, ChatMessage } from "../../src/types/provider.js";

describe("providers - mockDeterministicProvider", () => {
  it("returns scripted responses in order", async () => {
    const provider = new MockDeterministicProvider([
      { responses: [{ message: { role: "assistant", content: "first" } }] },
      { responses: [{ message: { role: "assistant", content: "second" } }] },
    ]);
    const r1 = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
    const r2 = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(r1.message.content).toBe("first");
    expect(r2.message.content).toBe("second");
    expect(provider.calls.length).toBe(2);
  });

  it("stream yields chunks and done", async () => {
    const provider = new MockDeterministicProvider([
      { responses: [{ chunks: [{ type: "text", content: "ab" }, { type: "text", content: "cd" }] }] },
    ]);
    const chunks: LlmStreamChunk[] = [];
    for await (const c of provider.stream({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(c);
    }
    expect(chunks.map((c) => c.type)).toEqual(["text", "text", "done"]);
    expect(accumulateText(chunks)).toBe("abcd");
  });

  it("injects error and propagates", async () => {
    const provider = new MockDeterministicProvider([
      { responses: [{ error: new Error("boom") }] },
    ]);
    await expect(provider.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("boom");
  });

  it("healthCheck returns true", async () => {
    const provider = new MockDeterministicProvider();
    expect(await provider.healthCheck()).toBe(true);
  });

  it("injectResponse appends a scenario", async () => {
    const provider = new MockDeterministicProvider();
    provider.injectResponse({ role: "assistant", content: "injected" });
    const r = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(r.message.content).toBe("injected");
  });
});

describe("providers - baseProvider utilities", () => {
  it("accumulateText concatenates text chunks", () => {
    const chunks: LlmStreamChunk[] = [
      { type: "text", content: "he" },
      { type: "tool_call_delta", toolCallDelta: { id: "1" } },
      { type: "text", content: "llo" },
      { type: "done" },
    ];
    expect(accumulateText(chunks)).toBe("hello");
  });

  it("mergeToolCallDeltas stitches delta fields", () => {
    const chunks: LlmStreamChunk[] = [
      { type: "tool_call_delta", toolCallDelta: { id: "t1", name: "fs.read" } },
      { type: "tool_call_delta", toolCallDelta: { id: "t1", arguments: { path: "a.txt" } } },
      { type: "tool_call_delta", toolCallDelta: { id: "t2", name: "fs.list" } },
    ];
    const calls = mergeToolCallDeltas(chunks);
    expect(calls.length).toBe(2);
    const t1 = calls.find((c) => c.id === "t1");
    expect(t1?.name).toBe("fs.read");
    expect(t1?.arguments).toEqual({ path: "a.txt" });
  });
});

describe("providers - OpenAiCompatibleProvider SSE assembly", () => {
  it("assembles SSE text chunks into content", async () => {
    let capturedBody: string | undefined;
    const origFetch = globalThis.fetch;
    // @ts-expect-error mock fetch
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string | undefined;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "1",
          object: "chat.completion",
          created: 0,
          model: "m",
          choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        }),
        text: async () => "",
        body: null,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response;
    };
    try {
      const provider = new OpenAiCompatibleProvider("http://127.0.0.1:1234");
      const res = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
      expect(res.message.content).toBe("hi");
      expect(capturedBody).toBeDefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("healthCheck returns false on connection error", async () => {
    const origFetch = globalThis.fetch;
    // @ts-expect-error mock fetch
    globalThis.fetch = async () => {
      throw new TypeError("connect ECONNREFUSED");
    };
    try {
      const provider = new OpenAiCompatibleProvider("http://127.0.0.1:1");
      expect(await provider.healthCheck()).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("providers - OllamaProvider NDJSON parsing", () => {
  it("healthCheck returns false on connection error", async () => {
    const origFetch = globalThis.fetch;
    // @ts-expect-error mock fetch
    globalThis.fetch = async () => {
      throw new TypeError("connect ECONNREFUSED");
    };
    try {
      const provider = new OllamaProvider("http://127.0.0.1:1");
      expect(await provider.healthCheck()).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
