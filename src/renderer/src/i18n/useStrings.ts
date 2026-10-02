import { useSyncExternalStore } from "react";
import { en, type StringKey } from "./strings.en";
import { ptBR } from "./strings.pt-BR";

export type UiLanguage = "en" | "pt-BR";
export type StringVars = Record<string, string | number>;

export const UI_LANGUAGES: readonly UiLanguage[] = ["pt-BR", "en"];
export const DEFAULT_UI_LANGUAGE: UiLanguage = "pt-BR";
export const UI_LANGUAGE_STORAGE_KEY = "grokky.uiLanguage";

const dictionaries: Record<UiLanguage, Record<string, string>> = { en, "pt-BR": ptBR };

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "en" || value === "pt-BR";
}

/** A saved valid choice wins; a missing or invalid value resolves to the default (pt-BR). */
export function resolveStoredLanguage(stored: unknown): UiLanguage {
  return isUiLanguage(stored) ? stored : DEFAULT_UI_LANGUAGE;
}

function readStoredLanguage(): UiLanguage {
  try {
    return resolveStoredLanguage(globalThis.localStorage?.getItem(UI_LANGUAGE_STORAGE_KEY));
  } catch {
    // Storage can be unavailable; fall back to the default.
    return DEFAULT_UI_LANGUAGE;
  }
}

function applyDocumentLanguage(language: UiLanguage): void {
  if (typeof document !== "undefined") document.documentElement.lang = language;
}

let current: UiLanguage = readStoredLanguage();
applyDocumentLanguage(current);
const listeners = new Set<() => void>();

export function getLanguage(): UiLanguage {
  return current;
}

export function setLanguage(language: UiLanguage): void {
  if (!isUiLanguage(language) || language === current) return;
  current = language;
  applyDocumentLanguage(language);
  try {
    globalThis.localStorage?.setItem(UI_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Persistence is best effort.
  }
  listeners.forEach((listener) => listener());
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function interpolate(template: string, vars?: StringVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/** Resolve a key in a given language (English if the language has no entry). */
export function translate(language: UiLanguage, key: StringKey, vars?: StringVars): string {
  return interpolate(dictionaries[language][key] ?? en[key], vars);
}

export function t(key: StringKey, vars?: StringVars): string {
  return translate(current, key, vars);
}

/** Count-aware lookup: uses `<base>.one` when n is 1 and `<base>.other` otherwise. */
export function tn(base: string, n: number, vars?: StringVars): string {
  const key = `${base}.${n === 1 ? "one" : "other"}` as StringKey;
  return translate(current, key, { n, ...vars });
}

const reverse = new Map<string, StringKey>();
for (const key of Object.keys(en) as StringKey[]) {
  const value = en[key] as string;
  if (!reverse.has(value)) reverse.set(value, key);
}

/**
 * Translate a fixed English label that lives in a module-level table or comes from an
 * English-only helper or from the main process. Unknown text (model output, provider
 * labels, user data) is returned unchanged.
 */
export function tr(text: string): string {
  const key = reverse.get(text);
  return key ? translate(current, key) : text;
}

export function useStrings() {
  const language = useSyncExternalStore(onLanguageChange, getLanguage, () => DEFAULT_UI_LANGUAGE);
  return { language, setLanguage, t, tn, tr };
}
