import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/renderer/src/i18n/strings.en";
import { ptBR } from "../src/renderer/src/i18n/strings.pt-BR";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const STORAGE_KEY = "grokky.uiLanguage";
const MODULE = "../src/renderer/src/i18n/useStrings";

function stubStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(STORAGE_KEY, initial);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
  return store;
}

/** Loads a fresh copy of the module, which is what a page reload does. */
async function reload() {
  vi.resetModules();
  return import(MODULE);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("dictionaries", () => {
  const enKeys = Object.keys(en).sort();
  const ptKeys = Object.keys(ptBR).sort();
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");

  it("defines exactly the same keys in English and Portuguese", () => {
    expect(ptKeys).toEqual(enKeys);
  });

  it("has no empty value and keeps every placeholder in the translation", () => {
    for (const key of enKeys) {
      const english = (en as Record<string, string>)[key]!;
      const portuguese = (ptBR as Record<string, string>)[key]!;
      expect(english.trim(), key).not.toBe("");
      expect(portuguese.trim(), key).not.toBe("");
      expect(placeholders(portuguese), key).toBe(placeholders(english));
    }
  });

  it("pairs every plural key (.one with .other)", () => {
    for (const key of enKeys.filter((item) => item.endsWith(".one"))) expect(enKeys, key).toContain(key.replace(/\.one$/, ".other"));
    for (const key of enKeys.filter((item) => item.endsWith(".other"))) expect(enKeys, key).toContain(key.replace(/\.other$/, ".one"));
  });

  it("does not translate provider names, tool names or the product name", () => {
    for (const key of enKeys) {
      for (const name of ["Codex", "OpenRouter", "Grokky"]) {
        const english = (en as Record<string, string>)[key]!;
        if (english.includes(name)) expect((ptBR as Record<string, string>)[key], key).toContain(name);
      }
    }
  });
});

describe("I1: the language changes immediately, without a restart", () => {
  it("re-resolves labels in the same session and notifies subscribers once per real change", async () => {
    stubStorage();
    const i18n = await reload();
    const listener = vi.fn();
    const unsubscribe = i18n.onLanguageChange(listener);
    expect(i18n.t("nav.newSession")).toBe("Nova sessão");
    i18n.setLanguage("en");
    expect(i18n.t("nav.newSession")).toBe("New session");
    expect(listener).toHaveBeenCalledTimes(1);
    i18n.setLanguage("en");
    expect(listener).toHaveBeenCalledTimes(1);
    i18n.setLanguage("pt-BR");
    expect(i18n.t("nav.newSession")).toBe("Nova sessão");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    i18n.setLanguage("en");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores an unsupported language", async () => {
    stubStorage();
    const i18n = await reload();
    i18n.setLanguage("fr" as never);
    expect(i18n.getLanguage()).toBe("pt-BR");
  });
});

describe("I2: the preference persists after a reload", () => {
  it("stores the choice in localStorage and restores it", async () => {
    const store = stubStorage();
    const first = await reload();
    first.setLanguage("en");
    expect(store.get(STORAGE_KEY)).toBe("en");
    const second = await reload();
    expect(second.getLanguage()).toBe("en");
    expect(second.t("nav.newSession")).toBe("New session");
    second.setLanguage("pt-BR");
    expect(store.get(STORAGE_KEY)).toBe("pt-BR");
    const third = await reload();
    expect(third.getLanguage()).toBe("pt-BR");
    expect(third.t("nav.newSession")).toBe("Nova sessão");
  });

  it("keeps working when storage rejects writes", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
    });
    const i18n = await reload();
    expect(() => i18n.setLanguage("en")).not.toThrow();
    expect(i18n.getLanguage()).toBe("en");
  });
});

describe("I3: without a saved choice the interface starts in pt-BR", () => {
  it("defaults to pt-BR when the key is absent", async () => {
    stubStorage();
    const i18n = await reload();
    expect(i18n.DEFAULT_UI_LANGUAGE).toBe("pt-BR");
    expect(i18n.getLanguage()).toBe("pt-BR");
  });

  it("falls back to pt-BR for an invalid or unreadable saved value", async () => {
    for (const bad of ["", "fr", "EN", "pt", "null", "{}"]) {
      stubStorage(bad);
      expect((await reload()).getLanguage(), JSON.stringify(bad)).toBe("pt-BR");
    }
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined });
    expect((await reload()).getLanguage()).toBe("pt-BR");
    vi.unstubAllGlobals();
    expect((await reload()).getLanguage()).toBe("pt-BR");
  });

  it("respects a valid saved value", async () => {
    stubStorage("en");
    expect((await reload()).getLanguage()).toBe("en");
    stubStorage("pt-BR");
    expect((await reload()).getLanguage()).toBe("pt-BR");
  });
});

describe("I4: English stays selectable and functional", () => {
  it("renders English labels, interpolation and plurals after choosing en", async () => {
    stubStorage("en");
    const i18n = await reload();
    expect(i18n.t("nav.settings")).toBe("Settings");
    expect(i18n.t("nav.sessionRunning", { title: "Demo" })).toBe("Demo is running");
    expect(i18n.tn("act.phases", 1)).toBe("1 phase");
    expect(i18n.tn("act.phases", 3)).toBe("3 phases");
  });

  it("renders Portuguese labels, interpolation and plurals after choosing pt-BR", async () => {
    stubStorage("pt-BR");
    const i18n = await reload();
    expect(i18n.t("nav.settings")).toBe("Configurações");
    expect(i18n.t("nav.sessionRunning", { title: "Demo" })).toBe("Demo está em execução");
    expect(i18n.tn("act.phases", 1)).toBe("1 fase");
    expect(i18n.tn("act.phases", 3)).toBe("3 fases");
  });

  it("translates fixed English labels with tr() and leaves unknown text unchanged", async () => {
    stubStorage("pt-BR");
    const i18n = await reload();
    expect(i18n.tr("Medium")).not.toBe("");
    expect(i18n.tr("Texto desconhecido fora do dicionario")).toBe("Texto desconhecido fora do dicionario");
    expect(i18n.tr("Settings")).toBe("Configurações");
    expect(i18n.tr("A model said this")).toBe("A model said this");
    expect(i18n.tr("Codex")).toBe("Codex");
    i18n.setLanguage("en");
    expect(i18n.tr("Settings")).toBe("Settings");
  });
});

describe("wiring", () => {
  const app = read("src/renderer/src/App.tsx");
  const controls = read("src/renderer/src/Controls.tsx");

  it("offers both languages in Settings and applies the choice through setLanguage", () => {
    expect(app).toContain('{ value: "pt-BR", label: t("lang.pt") }');
    expect(app).toContain('{ value: "en", label: t("lang.en") }');
    expect(app).toContain("languageChoices()");
    expect(app).toMatch(/onChange=\{\(next\) => setLanguage\(next\)\}/);
    expect(app).toContain("export function App() {\n  useStrings();");
  });

  it("only uses keys that exist in the dictionary", () => {
    const keys = new Set(Object.keys(en));
    for (const source of [app, controls]) {
      for (const match of source.matchAll(/\bt\("([^"]+)"/g)) expect(keys.has(match[1]!), match[1]).toBe(true);
      for (const match of source.matchAll(/\btn\("([^"]+)"/g)) {
        expect(keys.has(`${match[1]}.one`), match[1]).toBe(true);
        expect(keys.has(`${match[1]}.other`), match[1]).toBe(true);
      }
    }
  });

  it("does not hardcode a dictionary label as visible JSX text or attribute", () => {
    const labels = new Set(Object.values(en) as string[]);
    const offenders: string[] = [];
    for (const [name, source] of [["App.tsx", app], ["Controls.tsx", controls]] as const) {
      source.split("\n").forEach((line, index) => {
        for (const match of line.matchAll(/\b(?:aria-label|title|placeholder|alt|label|data-tooltip)="([^"{}]+)"/g)) {
          if (labels.has(match[1]!)) offenders.push(`${name}:${index + 1} attribute ${match[1]}`);
        }
        for (const match of line.matchAll(/([>}])([^<>{}\n]*[A-Za-z][^<>{}\n]*)(?=[<{])/g)) {
          if (labels.has(match[2]!.trim())) offenders.push(`${name}:${index + 1} text ${match[2]!.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("the runtime is untouched", () => {
  function filesUnder(directory: string): string[] {
    return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? filesUnder(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]
    );
  }

  it("is not referenced from main, preload or shared", () => {
    for (const file of ["src/main", "src/preload", "src/shared"].flatMap(filesUnder).filter((item) => /\.(ts|tsx)$/.test(item))) {
      expect(read(file), file).not.toMatch(/i18n|useStrings|grokky\.uiLanguage/);
    }
  });

  it("uses no i18n library and no new dependency", () => {
    const manifest = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(names.filter((name) => /i18n|intl|lingui|polyglot|formatjs/i.test(name))).toEqual([]);
  });
});
