import { describe, expect, test } from "vitest";
import type { ProviderId } from "../../src/shared/contracts";
import {
  AGNES_BASE_URL,
  defaultOpenAICompatibleModel,
  defaultOpenAICompatibleSettings,
  effectiveOpenAICompatibleBaseUrl,
  mergeOpenAICompatibleSettings,
  normalizeOpenAICompatibleSettings,
  presetExtras,
  validateOpenAICompatibleBaseUrl,
} from "../../src/shared/openai-compatible";
import { validateConversationPatch, validateSettingsPatch } from "../../src/shared/validation";

describe("base URL guardrail", () => {
  const allowed: Array<[string, string]> = [
    ["https://apihub.agnes-ai.com/v1", "https://apihub.agnes-ai.com/v1"],
    ["http://localhost:1234/v1", "http://localhost:1234/v1"],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["http://[::1]:8080/v1", "http://[::1]:8080/v1"],
    ["https://llm.example.org/v1/", "https://llm.example.org/v1"],
    ["  https://llm.example.org  ", "https://llm.example.org"],
  ];
  test.each(allowed)("allows %s", (input, expected) => {
    expect(validateOpenAICompatibleBaseUrl(input)).toBe(expected);
  });

  const blocked = [
    "http://example.com",
    "http://localhost.evil.com",
    "http://127.0.0.1.evil.com",
    "http://0.0.0.0",
    "https://user:pw@host.example",
    "https://host.example/v1?x=1",
    "https://host.example/v1#frag",
    "https://host.example/v1?",
    "ftp://host.example",
    "file:///etc/hosts",
    "ws://localhost:1",
    "not a url",
    "",
    "   ",
  ];
  test.each(blocked)("blocks %s", (input) => {
    expect(() => validateOpenAICompatibleBaseUrl(input)).toThrow();
  });

  test("blocks non-strings and very long values", () => {
    expect(() => validateOpenAICompatibleBaseUrl(undefined)).toThrow();
    expect(() => validateOpenAICompatibleBaseUrl(42)).toThrow();
    expect(() => validateOpenAICompatibleBaseUrl(`https://host.example/${"a".repeat(2_001)}`)).toThrow();
  });
});

describe("presets and settings", () => {
  test("the Agnes preset has a fixed endpoint and ignores a user supplied URL", () => {
    const tampered = { preset: "agnes", baseUrl: "https://evil.example/v1", model: "agnes-2.5-flash", credentialPath: "" };
    expect(effectiveOpenAICompatibleBaseUrl(tampered)).toBe(AGNES_BASE_URL);
    expect(normalizeOpenAICompatibleSettings(tampered).baseUrl).toBe(AGNES_BASE_URL);
    expect(mergeOpenAICompatibleSettings(defaultOpenAICompatibleSettings("agnes"), { baseUrl: "https://other.example/v1" }).baseUrl).toBe(AGNES_BASE_URL);
  });

  test("the custom preset uses its validated endpoint and refuses an empty one", () => {
    const custom = mergeOpenAICompatibleSettings(defaultOpenAICompatibleSettings("agnes"), { preset: "custom", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" });
    expect(custom).toMatchObject({ preset: "custom", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" });
    expect(effectiveOpenAICompatibleBaseUrl(custom)).toBe("http://127.0.0.1:1234/v1");
    expect(() => effectiveOpenAICompatibleBaseUrl(defaultOpenAICompatibleSettings("custom"))).toThrow("Choose an endpoint");
  });

  test("switching preset resets endpoint and model but keeps the key file path", () => {
    const agnes = { ...defaultOpenAICompatibleSettings("agnes"), credentialPath: "/keys/.env" };
    const custom = mergeOpenAICompatibleSettings(agnes, { preset: "custom" });
    expect(custom).toEqual({ preset: "custom", baseUrl: "", model: "", credentialPath: "/keys/.env" });
    const back = mergeOpenAICompatibleSettings({ ...custom, baseUrl: "https://llm.example.org/v1", model: "m1" }, { preset: "agnes" });
    expect(back).toEqual({ preset: "agnes", baseUrl: AGNES_BASE_URL, model: "agnes-2.5-flash", credentialPath: "/keys/.env" });
  });

  test("the sanitizer falls back to safe defaults", () => {
    expect(normalizeOpenAICompatibleSettings(undefined)).toEqual(defaultOpenAICompatibleSettings("agnes"));
    expect(normalizeOpenAICompatibleSettings({ preset: "mystery" }).preset).toBe("agnes");
    expect(normalizeOpenAICompatibleSettings({ preset: "custom", baseUrl: "http://example.com" }).baseUrl).toBe("");
    expect(normalizeOpenAICompatibleSettings({ preset: "agnes", model: "bad model!" }).model).toBe("agnes-2.5-flash");
  });

  test("default model comes from the settings, then the preset", () => {
    expect(defaultOpenAICompatibleModel(defaultOpenAICompatibleSettings("agnes"))).toBe("agnes-2.5-flash");
    expect(defaultOpenAICompatibleModel({ preset: "custom", baseUrl: "https://a.example", model: "my-model", credentialPath: "" })).toBe("my-model");
    expect(defaultOpenAICompatibleModel(defaultOpenAICompatibleSettings("custom"))).toBe("");
  });

  test("extras exist only for the Agnes preset", () => {
    expect(presetExtras("agnes", "medium")).toEqual({ chat_template_kwargs: { enable_thinking: true } });
    expect(presetExtras("agnes", "low")).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(presetExtras("custom", "high")).toEqual({});
  });
});

describe("validation", () => {
  test("ProviderId and the conversation validator accept openai-compatible additively", () => {
    const id: ProviderId = "openai-compatible";
    expect(validateConversationPatch({ provider: id })).toEqual({ provider: "openai-compatible" });
    expect(validateConversationPatch({ provider: "codex" })).toEqual({ provider: "codex" });
    expect(validateConversationPatch({ provider: "openrouter" })).toEqual({ provider: "openrouter" });
    expect(() => validateConversationPatch({ provider: "mystery" })).toThrow("Unsupported provider");
  });

  test("the settings validator accepts a clean patch and normalizes the endpoint", () => {
    const patch = validateSettingsPatch({ openAICompatible: { preset: "custom", baseUrl: "https://llm.example.org/v1/", model: "m1", credentialPath: "/keys/.env" } });
    expect(patch.openAICompatible).toEqual({ preset: "custom", baseUrl: "https://llm.example.org/v1", model: "m1", credentialPath: "/keys/.env" });
  });

  test("the settings validator rejects forbidden endpoints, key fields and unknown keys", () => {
    expect(() => validateSettingsPatch({ openAICompatible: { baseUrl: "http://example.com" } })).toThrow();
    expect(() => validateSettingsPatch({ openAICompatible: { apiKey: "x".repeat(32) } })).toThrow("Invalid OpenAI-compatible settings");
    expect(() => validateSettingsPatch({ openAICompatible: { token: "x" } })).toThrow();
    expect(() => validateSettingsPatch({ openAICompatible: { preset: "mystery" } })).toThrow();
    expect(() => validateSettingsPatch({ openAICompatible: [] })).toThrow();
    expect(() => validateSettingsPatch({ openAICompatible: { model: "bad model!" } })).toThrow("Invalid model");
  });

  test("the OpenRouter credential setting is independent", () => {
    expect(validateSettingsPatch({ openRouterCredentialPath: "/or/.env" })).toEqual({ openRouterCredentialPath: "/or/.env" });
  });
});
