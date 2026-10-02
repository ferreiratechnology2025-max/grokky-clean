import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runOpenAICompatible, toolsFor, type OpenAICompatibleRunContext } from "../../src/main/providers/openai-compatible-provider";
import type { ProviderEvent } from "../../src/main/providers/types";
import { defaultPersistentState } from "../../src/main/state-store";
import type { Conversation } from "../../src/shared/contracts";
import type { OpenAICompatibleSettings } from "../../src/shared/openai-compatible";
import { computerProviderContext } from "../provider-fixtures";

const KEY = `test-key-${"x".repeat(24)}`;

interface Call {
  url: string;
  init: RequestInit & { redirect?: string };
  body: Record<string, unknown>;
}

let calls: Call[] = [];
let responses: Array<() => Response> = [];

function completion(message: Record<string, unknown>, usage?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", ...message } }], ...(usage ? { usage } : {}) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init: init as Call["init"], body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const next = responses.shift();
    return next ? next() : completion({ content: "ok" }, { prompt_tokens: 1, completion_tokens: 2 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function context(
  openAICompatible: OpenAICompatibleSettings,
  patch: { apiKey?: string; reasoning?: Conversation["reasoning"]; computerEnabled?: boolean } = {},
): Promise<{ context: OpenAICompatibleRunContext; events: ProviderEvent[] }> {
  const workingDirectory = await mkdtemp(join(tmpdir(), "grokky-compat-"));
  const conversation: Conversation = {
    id: "c1",
    title: "Compat",
    provider: "openai-compatible",
    model: openAICompatible.model || "model-x",
    reasoning: patch.reasoning ?? "medium",
    sandboxMode: "workspace-write",
    allowCommands: false,
    projectMode: "project",
    workingDirectory,
    messages: [],
    activities: [],
    selectedAgentIds: [],
    agentRuns: [],
    crewCommunications: [],
    status: "idle",
    createdAt: 1,
    updatedAt: 2,
  };
  const fixture = computerProviderContext(conversation);
  if (patch.computerEnabled === false) fixture.computerAccess.enabled = false;
  const events: ProviderEvent[] = [];
  const settings = { ...defaultPersistentState(workingDirectory).settings, multiAgentEnabled: false, openAICompatible };
  return {
    events,
    context: {
      conversation,
      settings,
      agents: [],
      prompt: "hello",
      signal: new AbortController().signal,
      computerAccess: fixture.computerAccess,
      executeTool: fixture.executeTool,
      onEvent: (event) => { events.push(event); },
      ...(patch.apiKey ? { apiKey: patch.apiKey } : {}),
    },
  };
}

const agnes: OpenAICompatibleSettings = { preset: "agnes", baseUrl: "https://apihub.agnes-ai.com/v1", model: "agnes-2.5-flash", credentialPath: "" };
const local: OpenAICompatibleSettings = { preset: "custom", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model", credentialPath: "" };

function headerNames(call: Call): string[] {
  return Object.keys(call.init.headers as Record<string, string>).map((name) => name.toLowerCase());
}

describe("runOpenAICompatible request", () => {
  test("Agnes preset: official endpoint even if settings try to override it, Bearer, thinking kwargs, no redirects", async () => {
    const { context: ctx, events } = await context({ ...agnes, baseUrl: "https://evil.example/v1" }, { apiKey: KEY });
    await runOpenAICompatible(ctx);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://apihub.agnes-ai.com/v1/chat/completions");
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(call.init.redirect).toBe("error");
    expect(call.init.method).toBe("POST");
    expect(call.body).toMatchObject({ model: "agnes-2.5-flash", stream: false, chat_template_kwargs: { enable_thinking: true } });
    expect(events.find((event) => event.type === "final")).toMatchObject({ text: "ok" });
    expect(events.find((event) => event.type === "usage")).toMatchObject({ usage: { inputTokens: 1, outputTokens: 2 } });
  });

  test("Agnes preset: low reasoning disables thinking", async () => {
    const { context: ctx } = await context(agnes, { apiKey: KEY, reasoning: "low" });
    await runOpenAICompatible(ctx);
    expect(calls[0]!.body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  test("Custom preset: uses the settings endpoint, base body only, no Authorization without a key", async () => {
    const { context: ctx } = await context(local);
    await runOpenAICompatible(ctx);
    const call = calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(headerNames(call)).not.toContain("authorization");
    expect(call.body).not.toHaveProperty("chat_template_kwargs");
    expect(call.body.stream).toBe(false);
    expect(call.body.model).toBe("local-model");
    expect(Array.isArray(call.body.messages)).toBe(true);
  });

  test("Custom preset: sends Bearer when a key exists", async () => {
    const { context: ctx } = await context({ ...local, baseUrl: "https://llm.example.org/v1" }, { apiKey: KEY });
    await runOpenAICompatible(ctx);
    expect(calls[0]!.url).toBe("https://llm.example.org/v1/chat/completions");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  test("tools and tool_choice go together, and only when tools exist", async () => {
    const withTools = await context(local);
    await runOpenAICompatible(withTools.context);
    expect(calls[0]!.body.tool_choice).toBe("auto");
    expect((calls[0]!.body.tools as unknown[]).length).toBeGreaterThan(0);

    calls = [];
    const withoutTools = await context(local, { computerEnabled: false });
    await runOpenAICompatible(withoutTools.context);
    expect(calls[0]!.body).not.toHaveProperty("tools");
    expect(calls[0]!.body).not.toHaveProperty("tool_choice");
  });

  test("capture_screen is never announced", async () => {
    const { context: ctx } = await context(local);
    const names = toolsFor(ctx, ctx.conversation, false).map((tool) => (tool.function as { name: string }).name);
    expect(names).toContain("list_files");
    expect(names).not.toContain("capture_screen");
    await runOpenAICompatible(ctx);
    const sent = (calls[0]!.body.tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name);
    expect(sent).not.toContain("capture_screen");
  });

  test("runs a tool call and sends the result back as a string tool message", async () => {
    responses = [
      () => completion({ content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "list_files", arguments: "{}" } }] }),
      () => completion({ content: "done" }),
    ];
    const { context: ctx, events } = await context(local);
    await runOpenAICompatible(ctx);
    expect(calls).toHaveLength(2);
    const second = calls[1]!.body.messages as Array<{ role: string; content: unknown; tool_call_id?: string }>;
    const toolMessage = second.find((message) => message.role === "tool");
    expect(toolMessage?.tool_call_id).toBe("call_1");
    expect(typeof toolMessage?.content).toBe("string");
    expect(events.filter((event) => event.type === "activity").length).toBeGreaterThanOrEqual(2);
    expect(events.find((event) => event.type === "final")).toMatchObject({ text: "done" });
  });
});

describe("runOpenAICompatible guardrails and errors", () => {
  test("refuses an unsafe or missing custom endpoint before any request", async () => {
    const remote = await context({ ...local, baseUrl: "http://example.com/v1" });
    await expect(runOpenAICompatible(remote.context)).rejects.toThrow();
    const empty = await context({ ...local, baseUrl: "" });
    await expect(runOpenAICompatible(empty.context)).rejects.toThrow("Choose an endpoint");
    expect(calls).toHaveLength(0);
  });

  test("requires a model", async () => {
    const { context: ctx } = await context({ ...local, model: "" });
    ctx.conversation.model = "";
    await expect(runOpenAICompatible(ctx)).rejects.toThrow("Choose a model");
    expect(calls).toHaveLength(0);
  });

  test("redacts the key from server errors", async () => {
    responses = [() => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } }), { status: 401, headers: { "content-type": "application/json" } })];
    const { context: ctx } = await context(agnes, { apiKey: KEY });
    const failure = await runOpenAICompatible(ctx).then(() => "", (error: Error) => error.message);
    expect(failure).toContain("Incorrect API key provided");
    expect(failure).not.toContain(KEY);
    expect(failure).toContain("[redacted]");
  });

  test("redacts the key from transport errors and reports non-JSON bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError(`connect failed for ${KEY}`); }));
    const { context: ctx } = await context(agnes, { apiKey: KEY });
    const failure = await runOpenAICompatible(ctx).then(() => "", (error: Error) => error.message);
    expect(failure).not.toContain(KEY);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    const second = await context(agnes, { apiKey: KEY });
    await expect(runOpenAICompatible(second.context)).rejects.toThrow("request failed (502)");
  });
});
