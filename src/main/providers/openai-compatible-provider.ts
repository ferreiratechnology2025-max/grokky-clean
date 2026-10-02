import { randomUUID } from "node:crypto";
import type { ActivityItem, AgentDefinition, Conversation, UsageSummary } from "../../shared/contracts";
import {
  OPENAI_COMPATIBLE_PRESETS,
  effectiveOpenAICompatibleBaseUrl,
  normalizeOpenAICompatibleSettings,
  presetExtras,
} from "../../shared/openai-compatible";
import type { ComputerToolName } from "../computer-access";
import { PRODUCT_WRITING_STYLE_RULE } from "../writing-style";
import type { ProviderRunContext } from "./types";

/**
 * Generic Chat Completions provider (v1 subset):
 * POST {baseUrl}/chat/completions with model, messages, tools (if any), tool_choice (only with tools)
 * and stream:false. Preset specific fields come from presetExtras(). Authorization is sent only
 * when a key exists. Redirects are refused. The screen tool is not announced in v1.
 */
export interface OpenAICompatibleRunContext extends ProviderRunContext {
  apiKey?: string;
}

type Tool = Record<string, unknown>;

const readTools: Tool[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List readable files in the selected workspace. Secret files and dependency/build directories are excluded.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search readable workspace files for a literal text query.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read one UTF-8 text file using a path relative to the selected workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
];

const writeTools: Tool[] = [
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Create a new UTF-8 text file in the selected workspace. Refuses to overwrite an existing file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace one unique exact string in a UTF-8 workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string" },
          new_text: { type: "string" },
        },
        required: ["path", "old_text", "new_text"],
        additionalProperties: false,
      },
    },
  },
];

const commandTool: Tool = {
  type: "function",
  function: {
    name: "run_command",
    description: "Run an allowlisted development command in the selected workspace. Network, deletion, shell composition, and system-control commands are blocked.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false,
    },
  },
};

const browserTool: Tool = {
  type: "function",
  function: {
    name: "browse_url",
    description: "Open one public http or https page on the selected computer and return its title, final URL, and readable text. Private network addresses are blocked.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
};

const automationTools: Tool[] = [
  {
    type: "function",
    function: {
      name: "open_application",
      description: "Open a named desktop application on the selected computer.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "click_screen",
      description: "Click an absolute screen coordinate on the selected computer. Use only after inspecting current visible state.",
      parameters: {
        type: "object",
        properties: { x: { type: "integer" }, y: { type: "integer" } },
        required: ["x", "y"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type text into the active application on the selected computer.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
    },
  },
];

/** v1: capture_screen is intentionally absent (image results are not part of the verified subset). */
export function toolsFor(context: Pick<ProviderRunContext, "computerAccess">, conversation: Conversation, readOnly: boolean): Tool[] {
  if (!context.computerAccess.enabled) return [];
  const activeRemote = context.computerAccess.remoteDevices.find((device) => device.id === context.computerAccess.activeDeviceId && !device.revoked);
  const capabilities = new Set(activeRemote?.capabilities ?? ["files", "commands", "browser", "screen", "automation"]);
  return [
    ...(capabilities.has("files") && context.computerAccess.grants.files !== "blocked" ? readTools : []),
    ...(!readOnly && capabilities.has("files") && context.computerAccess.grants.files !== "blocked" && conversation.sandboxMode === "workspace-write" ? writeTools : []),
    ...(!readOnly && capabilities.has("commands") && context.computerAccess.grants.commands !== "blocked" && conversation.sandboxMode === "workspace-write" && conversation.allowCommands ? [commandTool] : []),
    ...(capabilities.has("browser") && context.computerAccess.grants.browser !== "blocked" ? [browserTool] : []),
    ...(!readOnly && capabilities.has("automation") && context.computerAccess.grants.automation !== "blocked" ? automationTools : []),
  ];
}

export function visibleContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (item && typeof item === "object" && "text" in item && typeof item.text === "string") return item.text;
    return "";
  }).join("");
}

interface CompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface CompatToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

interface CompletionMessage {
  role: string;
  content?: unknown;
  tool_calls?: CompatToolCall[];
}

export interface ChatCompletion {
  id?: string;
  choices?: Array<{ message?: CompletionMessage; finish_reason?: string }>;
  usage?: CompletionUsage;
  error?: { message?: string };
}

export function usageFrom(result: ChatCompletion): UsageSummary | undefined {
  if (!result.usage) return undefined;
  return {
    inputTokens: result.usage.prompt_tokens ?? 0,
    cachedInputTokens: result.usage.prompt_tokens_details?.cached_tokens,
    outputTokens: result.usage.completion_tokens ?? 0,
    reasoningTokens: result.usage.completion_tokens_details?.reasoning_tokens,
    // No cost field is assumed for generic endpoints; none is invented.
  };
}

function addUsage(left: UsageSummary | undefined, right: UsageSummary | undefined): UsageSummary | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: (left.cachedInputTokens ?? 0) + (right.cachedInputTokens ?? 0),
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: (left.reasoningTokens ?? 0) + (right.reasoningTokens ?? 0),
  };
}

function activityForCall(call: CompatToolCall, status: ActivityItem["status"], detail?: string, prefix = ""): ActivityItem {
  return {
    id: `${prefix}${call.id}`,
    kind: call.function.name === "run_command" ? "command" : call.function.name.includes("file") ? "files" : "tool",
    label: call.function.name.replaceAll("_", " "),
    ...(detail ? { detail: detail.slice(-12_000) } : {}),
    status,
    createdAt: Date.now(),
  };
}

/** Removes every occurrence of the key from text that may be thrown or shown. */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 8) return text;
  return text.split(secret).join("[redacted]");
}

function baseSystem(conversation: Conversation, readOnly: boolean, webSearchEnabled: boolean): string[] {
  return [
    "You are Grokky, a careful local workspace agent.",
    `The selected workspace is ${conversation.workingDirectory}.`,
    "Use tools when repository evidence is needed. Never request, read, expose, or infer credentials or private keys.",
    "Only claim to have read, browsed, seen, clicked, typed, or opened something when the matching tool completed successfully.",
    readOnly || conversation.sandboxMode === "read-only" ? "This session is read-only." : "Workspace file edits are allowed.",
    !readOnly && conversation.allowCommands ? "A small development-command allowlist is enabled." : "Command execution is disabled.",
    webSearchEnabled
      ? "Live web search is enabled. Use the browse_url tool to research current or online information and include links to the sources consulted."
      : "Live web search is disabled. Do not claim to browse or search the live web; explain that it can be enabled in Settings.",
    "You cannot capture or view the screen in this session.",
    PRODUCT_WRITING_STYLE_RULE,
    "Finish with a concise, evidence-backed answer that states what changed and what remains.",
  ];
}

type ChatMessage = { role: string; content: unknown; tool_calls?: CompatToolCall[]; tool_call_id?: string };

interface LoopOptions {
  conversation: Conversation;
  prompt: string;
  model?: string;
  reasoning?: Conversation["reasoning"];
  systemExtra?: string[];
  history?: boolean;
  readOnly?: boolean;
  activityPrefix?: string;
  emitActivity?: boolean;
}

async function runLoop(
  context: OpenAICompatibleRunContext,
  options: LoopOptions,
): Promise<{ text: string; usage?: UsageSummary }> {
  const config = normalizeOpenAICompatibleSettings(context.settings.openAICompatible);
  const preset = OPENAI_COMPATIBLE_PRESETS[config.preset];
  // Defense in depth: the endpoint is re-validated right before every request.
  const baseUrl = effectiveOpenAICompatibleBaseUrl(config);
  const model = options.model || options.conversation.model || config.model || preset.defaultModel;
  if (!model) throw new Error("Choose a model for the OpenAI-compatible provider");
  const readOnly = options.readOnly === true;
  const tools = toolsFor(context, options.conversation, readOnly);
  const prior = options.history
    ? options.conversation.messages.slice(-41, -1).map((message) => ({ role: message.role, content: message.content }))
    : [];
  const messages: ChatMessage[] = [
    { role: "system", content: [...baseSystem(options.conversation, readOnly, context.settings.webSearchEnabled), ...(options.systemExtra ?? [])].join("\n") },
    ...prior,
    { role: "user", content: options.prompt },
  ];
  const fail = (message: string): never => {
    throw new Error(redactSecret(message, context.apiKey));
  };
  let totalUsage: UsageSummary | undefined;
  for (let step = 0; step < 8; step += 1) {
    if (context.signal.aborted) throw new Error(`${preset.label} run cancelled`);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          ...(context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
          ...presetExtras(config.preset, options.reasoning || options.conversation.reasoning),
          stream: false,
        }),
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(180_000)]),
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : `${preset.label} request failed`);
    }
    const result = await response.json().catch(() => undefined) as ChatCompletion | undefined;
    if (!response.ok || result?.error) {
      return fail(result?.error?.message || `${preset.label} request failed (${response.status})`);
    }
    if (!result) return fail(`${preset.label} returned a response that is not JSON`);
    totalUsage = addUsage(totalUsage, usageFrom(result));
    const choice = result.choices?.[0];
    if (!choice?.message) return fail(`${preset.label} returned no completion choice`);
    const assistant = choice.message;
    const toolCalls = assistant.tool_calls ?? [];
    if (!toolCalls.length) {
      const text = visibleContent(assistant.content).trim();
      if (!text) return fail(`${preset.label} returned an empty answer`);
      return { text, ...(totalUsage ? { usage: totalUsage } : {}) };
    }
    messages.push({ role: "assistant", content: assistant.content ?? "", tool_calls: toolCalls });
    for (const call of toolCalls) {
      if (options.emitActivity !== false) {
        await context.onEvent({ type: "activity", activity: activityForCall(call, "running", undefined, options.activityPrefix) });
      }
      let toolOutput: string;
      try {
        const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        toolOutput = await context.executeTool(call.function.name as ComputerToolName, args, { readOnly });
        if (options.emitActivity !== false) {
          await context.onEvent({ type: "activity", activity: activityForCall(call, "completed", toolOutput, options.activityPrefix) });
        }
      } catch (error) {
        toolOutput = `Tool error: ${error instanceof Error ? error.message : "Unknown tool failure"}`;
        if (options.emitActivity !== false) {
          await context.onEvent({ type: "activity", activity: activityForCall(call, "failed", toolOutput, options.activityPrefix) });
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: toolOutput.slice(0, 40_000) });
    }
  }
  return fail(`${preset.label} reached the eight-step tool limit without a final answer`);
}

async function runCrewMember(
  context: OpenAICompatibleRunContext,
  agent: AgentDefinition,
  prompt: string,
): Promise<{ agent: AgentDefinition; text: string; usage?: UsageSummary }> {
  const threadId = `compatible:${randomUUID()}`;
  const operationId = `spawn:${threadId}`;
  await context.onEvent({
    type: "orchestration",
    event: {
      operationId,
      tool: "spawn_agent",
      senderThreadId: context.conversation.id,
      senderName: "Grokky lead",
      receiverThreads: [{ threadId, name: agent.name, status: "running" }],
      prompt,
      status: "completed",
    },
  });
  try {
    const result = await runLoop(context, {
      conversation: { ...context.conversation, sandboxMode: "read-only", allowCommands: false },
      prompt,
      model: agent.model,
      reasoning: agent.reasoning,
      systemExtra: [
        `You are the ${agent.name} crew member.`,
        agent.description,
        agent.developerInstructions,
        "Work independently in read-only mode. Return findings and evidence to the lead agent. Do not attempt file changes.",
      ],
      readOnly: true,
      activityPrefix: `${threadId}:`,
    });
    await context.onEvent({
      type: "orchestration",
      event: {
        operationId: `wait:${threadId}`,
        tool: "wait",
        senderThreadId: context.conversation.id,
        senderName: "Grokky lead",
        receiverThreads: [{ threadId, name: agent.name, status: "completed", message: result.text }],
        status: "completed",
      },
    });
    return { agent, ...result };
  } catch (error) {
    const message = redactSecret(error instanceof Error ? error.message : "Crew member failed", context.apiKey);
    await context.onEvent({
      type: "orchestration",
      event: {
        operationId: `wait:${threadId}`,
        tool: "wait",
        senderThreadId: context.conversation.id,
        senderName: "Grokky lead",
        receiverThreads: [{ threadId, name: agent.name, status: "failed", message }],
        status: "failed",
      },
    });
    return { agent, text: `Crew member failed: ${message}` };
  }
}

export async function runOpenAICompatible(context: OpenAICompatibleRunContext): Promise<void> {
  const crew = context.settings.multiAgentEnabled
    ? context.agents.slice(0, context.settings.maxAgentThreads)
    : [];
  const results = crew.length
    ? await Promise.all(crew.map((agent) => runCrewMember(context, agent, context.prompt)))
    : [];
  let totalUsage = results.reduce<UsageSummary | undefined>((usage, result) => addUsage(usage, result.usage), undefined);
  const findings = results.length
    ? [
        "Read-only Grokky crew findings follow. Verify them, resolve disagreements, and own all final decisions and file changes.",
        ...results.map((result) => `\n[${result.agent.name}]\n${result.text}`),
      ].join("\n")
    : "";
  const final = await runLoop(context, {
    conversation: context.conversation,
    prompt: findings ? `${context.prompt}\n\n${findings}` : context.prompt,
    history: true,
    systemExtra: [
      ...(results.length ? ["You are the lead agent. Consolidate the crew's findings before acting or answering."] : []),
    ],
  });
  totalUsage = addUsage(totalUsage, final.usage);
  await context.onEvent({ type: "final", text: final.text });
  if (totalUsage) await context.onEvent({ type: "usage", usage: totalUsage });
}
