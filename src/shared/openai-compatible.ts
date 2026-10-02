/**
 * OpenAI-compatible provider: shared types, presets and the base URL guardrail.
 * Pure module (no Node, no Electron), so it can be tested without network.
 */

export type OpenAICompatiblePresetId = "agnes" | "custom";

export interface OpenAICompatibleSettings {
  preset: OpenAICompatiblePresetId;
  /** Only meaningful for the custom preset. The Agnes preset always uses its official endpoint. */
  baseUrl: string;
  /** Default model that seeds conversations when they switch to this provider. */
  model: string;
  /** Optional env file that holds the key named by the preset. */
  credentialPath: string;
}

export interface OpenAICompatiblePreset {
  label: string;
  baseUrl: string;
  defaultModel: string;
  credentialEnvVar: string;
  endpointEditable: boolean;
  requiresKey: boolean;
  modelSuggestions: readonly string[];
}

export const AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1";

export const OPENAI_COMPATIBLE_PRESETS: Record<OpenAICompatiblePresetId, OpenAICompatiblePreset> = {
  agnes: {
    label: "Agnes",
    baseUrl: AGNES_BASE_URL,
    defaultModel: "agnes-2.5-flash",
    credentialEnvVar: "AGNES_API_KEY",
    endpointEditable: false,
    requiresKey: true,
    modelSuggestions: ["agnes-2.5-flash"],
  },
  custom: {
    label: "Custom",
    baseUrl: "",
    defaultModel: "",
    credentialEnvVar: "OPENAI_COMPATIBLE_API_KEY",
    endpointEditable: true,
    requiresKey: false,
    modelSuggestions: [],
  },
};

export const OPENAI_COMPATIBLE_PRESET_IDS = Object.keys(OPENAI_COMPATIBLE_PRESETS) as OpenAICompatiblePresetId[];

const MODEL_PATTERN = /^[a-zA-Z0-9_~./:-]{2,160}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ENDPOINT_RULE = "Invalid endpoint: use https, or http only for localhost, 127.0.0.1 or [::1]";

export function isOpenAICompatiblePreset(value: unknown): value is OpenAICompatiblePresetId {
  return typeof value === "string" && (OPENAI_COMPATIBLE_PRESET_IDS as string[]).includes(value);
}

/**
 * Guardrail for the endpoint that receives the Bearer key.
 * https is allowed; http only for loopback hosts; no credentials, query or fragment in the URL.
 * Returns the normalized base URL (no trailing slash) or throws.
 */
export function validateOpenAICompatibleBaseUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error(ENDPOINT_RULE);
  const text = raw.trim();
  if (!text || text.length > 2_000) throw new Error(ENDPOINT_RULE);
  if (text.includes("?") || text.includes("#")) throw new Error(ENDPOINT_RULE);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(ENDPOINT_RULE);
  }
  if (url.username || url.password || !url.hostname) throw new Error(ENDPOINT_RULE);
  if (url.protocol === "http:") {
    if (!LOOPBACK_HOSTS.has(url.hostname)) throw new Error(ENDPOINT_RULE);
  } else if (url.protocol !== "https:") {
    throw new Error(ENDPOINT_RULE);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function tryValidateOpenAICompatibleBaseUrl(raw: unknown): string | null {
  try {
    return validateOpenAICompatibleBaseUrl(raw);
  } catch {
    return null;
  }
}

export function defaultOpenAICompatibleSettings(preset: OpenAICompatiblePresetId = "agnes"): OpenAICompatibleSettings {
  return {
    preset,
    baseUrl: OPENAI_COMPATIBLE_PRESETS[preset].baseUrl,
    model: OPENAI_COMPATIBLE_PRESETS[preset].defaultModel,
    credentialPath: "",
  };
}

/** Sanitizer used on load and after every merge. Never throws. */
export function normalizeOpenAICompatibleSettings(value: unknown): OpenAICompatibleSettings {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const preset: OpenAICompatiblePresetId = isOpenAICompatiblePreset(input.preset) ? input.preset : "agnes";
  const defaults = defaultOpenAICompatibleSettings(preset);
  const baseUrl = OPENAI_COMPATIBLE_PRESETS[preset].endpointEditable
    ? tryValidateOpenAICompatibleBaseUrl(input.baseUrl) ?? defaults.baseUrl
    : defaults.baseUrl;
  const model = typeof input.model === "string" && MODEL_PATTERN.test(input.model) ? input.model : defaults.model;
  const credentialPath = typeof input.credentialPath === "string" && input.credentialPath.length <= 2_000 ? input.credentialPath : "";
  return { preset, baseUrl, model, credentialPath };
}

/**
 * Applies a partial update. Switching preset resets endpoint and model to the new preset's
 * defaults (so the Agnes key can never travel with a custom endpoint) and keeps the key file path.
 */
export function mergeOpenAICompatibleSettings(
  current: unknown,
  patch: Partial<OpenAICompatibleSettings>,
): OpenAICompatibleSettings {
  const base = normalizeOpenAICompatibleSettings(current);
  const preset = isOpenAICompatiblePreset(patch.preset) ? patch.preset : base.preset;
  const seed: OpenAICompatibleSettings = preset === base.preset
    ? base
    : { ...defaultOpenAICompatibleSettings(preset), credentialPath: base.credentialPath };
  return normalizeOpenAICompatibleSettings({
    preset,
    baseUrl: patch.baseUrl ?? seed.baseUrl,
    model: patch.model ?? seed.model,
    credentialPath: patch.credentialPath ?? seed.credentialPath,
  });
}

/** The endpoint that is actually used. The Agnes preset never reads the user-supplied URL. */
export function effectiveOpenAICompatibleBaseUrl(settings: unknown): string {
  const normalized = normalizeOpenAICompatibleSettings(settings);
  if (!OPENAI_COMPATIBLE_PRESETS[normalized.preset].endpointEditable) return OPENAI_COMPATIBLE_PRESETS[normalized.preset].baseUrl;
  if (!normalized.baseUrl) throw new Error("Choose an endpoint for the custom OpenAI-compatible provider");
  return validateOpenAICompatibleBaseUrl(normalized.baseUrl);
}

export function defaultOpenAICompatibleModel(settings: unknown): string {
  const normalized = normalizeOpenAICompatibleSettings(settings);
  return normalized.model || OPENAI_COMPATIBLE_PRESETS[normalized.preset].defaultModel;
}

/** Request fields that only some presets understand. The base request never includes them. */
export function presetExtras(preset: OpenAICompatiblePresetId, reasoning: string | undefined): Record<string, unknown> {
  if (preset === "agnes") return { chat_template_kwargs: { enable_thinking: reasoning !== "low" } };
  return {};
}

const PATCH_KEYS = new Set(["preset", "baseUrl", "model", "credentialPath"]);

/** IPC validation. Unknown keys (including any key/secret field) are rejected. */
export function validateOpenAICompatiblePatch(value: unknown): Partial<OpenAICompatibleSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid OpenAI-compatible settings");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !PATCH_KEYS.has(key))) throw new Error("Invalid OpenAI-compatible settings");
  const patch: Partial<OpenAICompatibleSettings> = {};
  if (input.preset !== undefined) {
    if (!isOpenAICompatiblePreset(input.preset)) throw new Error("Unsupported preset");
    patch.preset = input.preset;
  }
  if (input.baseUrl !== undefined) {
    if (typeof input.baseUrl !== "string") throw new Error(ENDPOINT_RULE);
    patch.baseUrl = input.baseUrl.trim() === "" ? "" : validateOpenAICompatibleBaseUrl(input.baseUrl);
  }
  if (input.model !== undefined) {
    if (typeof input.model !== "string" || (input.model !== "" && !MODEL_PATTERN.test(input.model))) throw new Error("Invalid model");
    patch.model = input.model;
  }
  if (input.credentialPath !== undefined) {
    if (typeof input.credentialPath !== "string" || input.credentialPath.length > 2_000) throw new Error("Invalid credential path");
    patch.credentialPath = input.credentialPath;
  }
  return patch;
}
