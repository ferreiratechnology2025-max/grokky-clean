import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderStatus } from "../shared/contracts";
import {
  OPENAI_COMPATIBLE_PRESETS,
  normalizeOpenAICompatibleSettings,
  tryValidateOpenAICompatibleBaseUrl,
  type OpenAICompatibleSettings,
} from "../shared/openai-compatible";
import { parseEnvValue } from "./credentials";

export interface OpenAICompatibleCredential {
  apiKey: string;
  source: string;
}

/** Any non-placeholder token of 16+ visible characters. No vendor prefix is required. */
export function isUsableOpenAICompatibleKey(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  return /^\S{16,}$/.test(trimmed) && !/replace|example|your[_-]?key|changeme/i.test(trimmed);
}

export function openAICompatibleCredentialCandidates(settings: OpenAICompatibleSettings, homeDirectory: string): string[] {
  return [settings.credentialPath, join(homeDirectory, ".config", "grokky", ".env")]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

/**
 * Looks up only the variable named by the preset (AGNES_API_KEY or OPENAI_COMPATIBLE_API_KEY),
 * first in the process environment, then in the chosen env files. The key never leaves main.
 */
export async function resolveOpenAICompatibleCredential(
  settings: unknown,
  homeDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OpenAICompatibleCredential | null> {
  const normalized = normalizeOpenAICompatibleSettings(settings);
  const variable = OPENAI_COMPATIBLE_PRESETS[normalized.preset].credentialEnvVar;
  const inherited = env[variable]?.trim();
  if (isUsableOpenAICompatibleKey(inherited)) return { apiKey: inherited, source: `Process environment (${variable})` };
  for (const pathname of openAICompatibleCredentialCandidates(normalized, homeDirectory)) {
    try {
      const apiKey = parseEnvValue(await readFile(pathname, "utf8"), variable);
      if (isUsableOpenAICompatibleKey(apiKey)) return { apiKey: apiKey.trim(), source: pathname };
    } catch {
      // A missing or unreadable candidate is simply skipped.
    }
  }
  return null;
}

export async function openAICompatibleStatus(settings: unknown, homeDirectory: string): Promise<ProviderStatus> {
  const normalized = normalizeOpenAICompatibleSettings(settings);
  const preset = OPENAI_COMPATIBLE_PRESETS[normalized.preset];
  const credential = await resolveOpenAICompatibleCredential(normalized, homeDirectory);
  if (preset.requiresKey) {
    return credential
      ? {
          id: "openai-compatible",
          ready: true,
          label: `${preset.label} configured`,
          source: credential.source,
          detail: "The key stays in the Electron main process.",
        }
      : {
          id: "openai-compatible",
          ready: false,
          label: `${preset.label} key missing`,
          source: "No credential source found",
          detail: `Set ${preset.credentialEnvVar} or choose an env file containing it.`,
        };
  }
  if (!tryValidateOpenAICompatibleBaseUrl(normalized.baseUrl)) {
    return {
      id: "openai-compatible",
      ready: false,
      label: "Custom endpoint missing",
      source: "No endpoint set",
      detail: "Enter an https endpoint, or http for localhost.",
    };
  }
  return {
    id: "openai-compatible",
    ready: true,
    label: "Custom endpoint configured",
    source: credential?.source ?? "No key (Authorization omitted)",
    detail: credential
      ? "The key stays in the Electron main process."
      : "No key set: requests are sent without Authorization.",
  };
}
