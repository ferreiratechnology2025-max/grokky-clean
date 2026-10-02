import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MainController } from "../../src/main/controller";
import { openAICompatibleStatus, resolveOpenAICompatibleCredential, isUsableOpenAICompatibleKey } from "../../src/main/openai-compatible-credentials";
import { runCodex } from "../../src/main/providers/codex-provider";
import { runOpenAICompatible } from "../../src/main/providers/openai-compatible-provider";
import { runOpenRouter } from "../../src/main/providers/openrouter-provider";
import { StateStore } from "../../src/main/state-store";
import { CODEX_MODELS, DEFAULT_OPENROUTER_MODEL } from "../../src/shared/contracts";

vi.mock("../../src/main/providers/codex-provider", () => ({ runCodex: vi.fn(async () => {}) }));
vi.mock("../../src/main/providers/openrouter-provider", () => ({ runOpenRouter: vi.fn(async () => {}) }));
vi.mock("../../src/main/providers/openai-compatible-provider", () => ({ runOpenAICompatible: vi.fn(async () => {}) }));
vi.mock("../../src/main/credentials", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/main/credentials")>();
  return {
    ...original,
    providerStatuses: vi.fn(async () => [
      { id: "codex", ready: true, label: "Codex signed in", source: "test", detail: "test" },
      { id: "openrouter", ready: true, label: "OpenRouter configured", source: "test", detail: "test" },
    ]),
    resolveOpenRouterCredential: vi.fn(async () => ({ apiKey: "or-test-key-value-0001", source: "test" })),
  };
});

const SECRET = `agnes-test-${"s".repeat(24)}`;
const savedEnv = { agnes: process.env.AGNES_API_KEY, custom: process.env.OPENAI_COMPATIBLE_API_KEY };

afterEach(() => {
  if (savedEnv.agnes === undefined) delete process.env.AGNES_API_KEY; else process.env.AGNES_API_KEY = savedEnv.agnes;
  if (savedEnv.custom === undefined) delete process.env.OPENAI_COMPATIBLE_API_KEY; else process.env.OPENAI_COMPATIBLE_API_KEY = savedEnv.custom;
  vi.mocked(runCodex).mockClear();
  vi.mocked(runOpenRouter).mockClear();
  vi.mocked(runOpenAICompatible).mockClear();
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), "grokky-compat-int-"));
  const statePath = join(home, "state.json");
  const controller = new MainController(new StateStore(statePath, home), home, "test");
  await controller.initialize();
  return { home, statePath, controller, id: controller.snapshot().conversations[0]!.id };
}

async function waitIdle(controller: MainController) {
  await vi.waitFor(() => expect(controller.snapshot().conversations[0]!.status).toBe("idle"));
}

describe("model reset on provider switch", () => {
  test("Codex and OpenRouter to OpenAI-compatible use the preset default; back restores each default", async () => {
    const { controller, id } = await setup();
    const model = () => controller.snapshot().conversations[0]!.model;
    await controller.updateConversation(id, { provider: "openai-compatible" });
    expect(controller.snapshot().conversations[0]!.provider).toBe("openai-compatible");
    expect(model()).toBe("agnes-2.5-flash");
    await controller.updateConversation(id, { provider: "codex" });
    expect(model()).toBe(CODEX_MODELS[0]);
    await controller.updateConversation(id, { provider: "openrouter" });
    expect(model()).toBe(DEFAULT_OPENROUTER_MODEL);
    await controller.updateConversation(id, { provider: "openai-compatible" });
    expect(model()).toBe("agnes-2.5-flash");
    await controller.updateConversation(id, { provider: "openrouter" });
    expect(model()).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  test("a custom default model seeds the conversation", async () => {
    const { controller, id } = await setup();
    await controller.updateSettings({ openAICompatible: { preset: "custom", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" } });
    expect(controller.snapshot().settings.openAICompatible).toMatchObject({ preset: "custom", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" });
    await controller.updateConversation(id, { provider: "openai-compatible" });
    expect(controller.snapshot().conversations[0]!.model).toBe("local-model");
  });

  test("changing the preset in settings leaves the OpenRouter credential setting alone", async () => {
    const { controller } = await setup();
    await controller.updateSettings({ openRouterCredentialPath: "/or/.env" });
    await controller.updateSettings({ openAICompatible: { preset: "custom" } });
    expect(controller.snapshot().settings.openRouterCredentialPath).toBe("/or/.env");
    await controller.updateSettings({ openAICompatible: { credentialPath: "/compat/.env" } });
    expect(controller.snapshot().settings.openRouterCredentialPath).toBe("/or/.env");
    expect(controller.snapshot().settings.openAICompatible?.credentialPath).toBe("/compat/.env");
  });
});

describe("persistence", () => {
  test("round-trips the provider and the preset, and never stores a key", async () => {
    process.env.AGNES_API_KEY = SECRET;
    const { statePath, controller, id, home } = await setup();
    await controller.updateConversation(id, { provider: "openai-compatible" });
    const reloaded = await new StateStore(statePath, home).load();
    expect(reloaded.conversations[0]).toMatchObject({ provider: "openai-compatible", model: "agnes-2.5-flash" });
    expect(reloaded.settings.openAICompatible).toMatchObject({ preset: "agnes", baseUrl: "https://apihub.agnes-ai.com/v1", model: "agnes-2.5-flash" });
    const raw = await readFile(statePath, "utf8");
    expect(raw).not.toContain(SECRET);
    expect(JSON.stringify(controller.snapshot())).not.toContain(SECRET);
  });

  test("the sanitizer keeps what is valid and repairs what is not", async () => {
    const { statePath, controller, id, home } = await setup();
    await controller.updateConversation(id, { provider: "openai-compatible" });
    const original = JSON.parse(await readFile(statePath, "utf8")) as { conversations: Array<Record<string, unknown>>; settings: Record<string, unknown> };

    const edit = async (change: (state: typeof original) => void) => {
      const copy = structuredClone(original);
      change(copy);
      await writeFile(statePath, JSON.stringify(copy), "utf8");
      return new StateStore(statePath, home).load();
    };

    expect((await edit((state) => { state.conversations[0]!.provider = "mystery"; })).conversations[0]!.provider).toBe("codex");
    expect((await edit((state) => { state.settings.openAICompatible = { preset: "mystery" }; })).settings.openAICompatible?.preset).toBe("agnes");
    const badUrl = await edit((state) => { state.settings.openAICompatible = { preset: "custom", baseUrl: "http://example.com/v1", model: "m1" }; });
    expect(badUrl.settings.openAICompatible).toMatchObject({ preset: "custom", baseUrl: "" });
    const tampered = await edit((state) => { state.settings.openAICompatible = { preset: "agnes", baseUrl: "https://evil.example/v1" }; });
    expect(tampered.settings.openAICompatible?.baseUrl).toBe("https://apihub.agnes-ai.com/v1");
    const legacy = await edit((state) => { delete state.settings.openAICompatible; });
    expect(legacy.settings.openAICompatible).toEqual({ preset: "agnes", baseUrl: "https://apihub.agnes-ai.com/v1", model: "agnes-2.5-flash", credentialPath: "" });
    expect((await edit((state) => { state.conversations[0]!.provider = "openrouter"; })).conversations[0]!.provider).toBe("openrouter");
  });
});

describe("credentials", () => {
  test("Agnes reads AGNES_API_KEY from the environment", async () => {
    const home = await mkdtemp(join(tmpdir(), "grokky-compat-cred-"));
    const found = await resolveOpenAICompatibleCredential({ preset: "agnes" }, home, { AGNES_API_KEY: SECRET });
    expect(found).toEqual({ apiKey: SECRET, source: "Process environment (AGNES_API_KEY)" });
  });

  test("Agnes reads only its own variable from a chosen env file", async () => {
    const home = await mkdtemp(join(tmpdir(), "grokky-compat-cred-"));
    const file = join(home, "agnes.env");
    await writeFile(file, ["OPENROUTER_API_KEY=other-provider-key-must-not-be-used-0000", "OPENAI_COMPATIBLE_API_KEY=custom-key-should-not-cross-0000", `AGNES_API_KEY=${SECRET}`].join("\n"), "utf8");
    const found = await resolveOpenAICompatibleCredential({ preset: "agnes", credentialPath: file }, home, {});
    expect(found).toEqual({ apiKey: SECRET, source: file });
    const custom = await resolveOpenAICompatibleCredential({ preset: "custom", baseUrl: "https://llm.example.org/v1", credentialPath: file }, home, {});
    expect(custom?.apiKey).toBe("custom-key-should-not-cross-0000");
  });

  test("placeholders are rejected and no vendor prefix is required", () => {
    expect(isUsableOpenAICompatibleKey("REPLACE_ME_WITH_YOUR_KEY_123")).toBe(false);
    expect(isUsableOpenAICompatibleKey("your_key_goes_here_0000")).toBe(false);
    expect(isUsableOpenAICompatibleKey("short")).toBe(false);
    expect(isUsableOpenAICompatibleKey("has space inside 0000000000")).toBe(false);
    expect(isUsableOpenAICompatibleKey(`plain-token-${"a".repeat(20)}`)).toBe(true);
    expect(isUsableOpenAICompatibleKey(undefined)).toBe(false);
  });

  test("status: Agnes needs a key, Custom needs only a valid endpoint", async () => {
    const home = await mkdtemp(join(tmpdir(), "grokky-compat-cred-"));
    delete process.env.AGNES_API_KEY;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
    expect(await openAICompatibleStatus({ preset: "agnes" }, home)).toMatchObject({ id: "openai-compatible", ready: false, detail: "Set AGNES_API_KEY or choose an env file containing it." });
    process.env.AGNES_API_KEY = SECRET;
    const ready = await openAICompatibleStatus({ preset: "agnes" }, home);
    expect(ready).toMatchObject({ ready: true, source: "Process environment (AGNES_API_KEY)" });
    expect(JSON.stringify(ready)).not.toContain(SECRET);
    expect(await openAICompatibleStatus({ preset: "custom", baseUrl: "" }, home)).toMatchObject({ ready: false });
    expect(await openAICompatibleStatus({ preset: "custom", baseUrl: "http://127.0.0.1:1234/v1" }, home)).toMatchObject({ ready: true, source: "No key (Authorization omitted)", detail: "No key set: requests are sent without Authorization." });
  });
});

describe("dispatch by provider", () => {
  test("Codex still runs runCodex only", async () => {
    const { controller, id } = await setup();
    await controller.sendMessage(id, "hello");
    await vi.waitFor(() => expect(runCodex).toHaveBeenCalledTimes(1));
    await waitIdle(controller);
    expect(runOpenRouter).not.toHaveBeenCalled();
    expect(runOpenAICompatible).not.toHaveBeenCalled();
  });

  test("OpenRouter still runs runOpenRouter with the OpenRouter credential only", async () => {
    process.env.AGNES_API_KEY = SECRET;
    const { controller, id } = await setup();
    await controller.updateConversation(id, { provider: "openrouter" });
    await controller.sendMessage(id, "hello");
    await vi.waitFor(() => expect(runOpenRouter).toHaveBeenCalledTimes(1));
    expect(vi.mocked(runOpenRouter).mock.calls[0]![0].apiKey).toBe("or-test-key-value-0001");
    await waitIdle(controller);
    expect(runCodex).not.toHaveBeenCalled();
    expect(runOpenAICompatible).not.toHaveBeenCalled();
  });

  test("OpenAI-compatible runs runOpenAICompatible with the Agnes key from the environment", async () => {
    process.env.AGNES_API_KEY = SECRET;
    const { controller, id } = await setup();
    await controller.updateConversation(id, { provider: "openai-compatible" });
    await controller.sendMessage(id, "hello");
    await vi.waitFor(() => expect(runOpenAICompatible).toHaveBeenCalledTimes(1));
    expect(vi.mocked(runOpenAICompatible).mock.calls[0]![0].apiKey).toBe(SECRET);
    await waitIdle(controller);
    expect(runCodex).not.toHaveBeenCalled();
    expect(runOpenRouter).not.toHaveBeenCalled();
  });

  test("OpenAI-compatible with the Agnes preset is not ready without a key", async () => {
    delete process.env.AGNES_API_KEY;
    const { controller, id } = await setup();
    await controller.updateConversation(id, { provider: "openai-compatible" });
    await expect(controller.sendMessage(id, "hello")).rejects.toThrow("AGNES_API_KEY");
    expect(runOpenAICompatible).not.toHaveBeenCalled();
  });

  test("the custom preset runs without a key", async () => {
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
    const { controller, id } = await setup();
    await controller.updateSettings({ openAICompatible: { preset: "custom", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" } });
    await controller.updateConversation(id, { provider: "openai-compatible" });
    await controller.sendMessage(id, "hello");
    await vi.waitFor(() => expect(runOpenAICompatible).toHaveBeenCalledTimes(1));
    expect(vi.mocked(runOpenAICompatible).mock.calls[0]![0].apiKey).toBeUndefined();
  });
});

describe("secrets and wiring", () => {
  async function source(...parts: string[]): Promise<string> {
    return (await readFile(join(process.cwd(), ...parts), "utf8")).replace(/\r\n/g, "\n");
  }

  test("no renderer or preload source handles an API key", async () => {
    const rendererFiles = (await readdir(join(process.cwd(), "src", "renderer", "src"), { recursive: true })).filter((name) => /\.(ts|tsx)$/.test(String(name)));
    expect(rendererFiles.length).toBeGreaterThan(0);
    for (const name of rendererFiles) {
      expect(await source("src", "renderer", "src", String(name))).not.toMatch(/apiKey/i);
    }
    expect(await source("src", "preload", "index.ts")).not.toMatch(/apiKey/i);
  });

  test("the controller dispatches explicitly and refuses unknown providers", async () => {
    const controller = await source("src", "main", "controller.ts");
    expect(controller).toContain('conversation.provider === "codex"');
    expect(controller).toContain('conversation.provider === "openrouter"');
    expect(controller).toContain('conversation.provider === "openai-compatible"');
    expect(controller).toContain("Unsupported provider");
  });

  test("the UI exposes three provider buttons and a credential chooser without a key field", async () => {
    const app = await source("src", "renderer", "src", "App.tsx");
    expect(app).toContain('updateProvider("codex")');
    expect(app).toContain('updateProvider("openrouter")');
    expect(app).toContain('updateProvider("openai-compatible")');
    expect(app).toContain("chooseOpenAICompatibleCredential");
    expect(app).not.toMatch(/type="password"/);
  });

  test("OpenRouter and Codex provider sources are not coupled to the new provider", async () => {
    for (const name of ["openrouter-provider.ts", "codex-provider.ts", "types.ts"]) {
      expect(await source("src", "main", "providers", name)).not.toMatch(/openai-compatible|OpenAICompatible/);
    }
  });
});
