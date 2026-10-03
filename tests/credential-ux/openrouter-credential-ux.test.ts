import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalCredentialDirectory,
  canonicalCredentialFile,
  credentialDialogDefaultPath,
  openRouterCredentialDialogOptions,
} from "../../src/main/credential-dialog";
import { providerStatuses } from "../../src/main/credentials";
import { en } from "../../src/renderer/src/i18n/strings.en";
import { ptBR } from "../../src/renderer/src/i18n/strings.pt-BR";
import type { AppSettings } from "../../src/shared/contracts";

// Built at runtime so no credential-shaped literal exists in the source.
const FAKE_KEY = ["sk", "or", "v1"].join("-") + "-" + "a1b2".repeat(10);

let home: string;
const saved: Record<string, string | undefined> = {};

function settingsWith(openRouterCredentialPath: string): AppSettings {
  return { openRouterCredentialPath } as AppSettings;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "grokky-g7-"));
  for (const name of ["OPENROUTER_API_KEY", "GROKKY_OPENROUTER_ENV_FILE", "CODEX_HOME"]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  process.env.CODEX_HOME = join(home, "codex-home");
});

afterEach(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
});

describe("OpenRouter credential dialog default path", () => {
  test("opens on the canonical env file when it exists", async () => {
    await mkdir(canonicalCredentialDirectory(home), { recursive: true });
    await writeFile(canonicalCredentialFile(home), "OPENROUTER_API_KEY=placeholder\n");
    const options = await openRouterCredentialDialogOptions(join(home, "Downloads", "other.md"), home);
    expect(options.defaultPath).toBe(join(home, ".config", "grokky", ".env"));
    expect(options.properties).toEqual(["openFile", "showHiddenFiles"]);
  });

  test("falls back to the canonical folder when the file is absent", async () => {
    await mkdir(canonicalCredentialDirectory(home), { recursive: true });
    expect(await credentialDialogDefaultPath("", home)).toBe(join(home, ".config", "grokky"));
  });

  test("falls back to the chosen file, then to the home directory", async () => {
    const chosen = join(home, "chosen.env");
    await writeFile(chosen, "X=1\n");
    expect(await credentialDialogDefaultPath(chosen, home)).toBe(chosen);
    expect(await credentialDialogDefaultPath(join(home, "missing.env"), home)).toBe(home);
  });

  test("uses the injected existence check", async () => {
    const seen: string[] = [];
    const result = await credentialDialogDefaultPath("", "/home/example", async (pathname) => { seen.push(pathname); return false; });
    expect(result).toBe("/home/example");
    expect(seen[0]).toBe(join("/home/example", ".config", "grokky", ".env"));
  });
});

describe("OpenRouter credential status for the renderer", () => {
  test("a valid key file is ready, exposes only its path, and never the key", async () => {
    const file = join(home, "good.env");
    await writeFile(file, `OPENROUTER_API_KEY=${FAKE_KEY}\n`);
    const statuses = await providerStatuses(settingsWith(file), home);
    const openRouter = statuses.find((status) => status.id === "openrouter");
    expect(openRouter?.ready).toBe(true);
    expect(openRouter?.source).toBe(file);
    expect(JSON.stringify(statuses)).not.toContain(FAKE_KEY);
    expect(Object.keys(openRouter ?? {}).sort()).toEqual(["detail", "id", "label", "ready", "source"]);
  });

  test("a chosen file without the key is not ready and keeps its path visible", async () => {
    const file = join(home, "spec.md");
    await writeFile(file, "# notes\nOTHER=1\n");
    const openRouter = (await providerStatuses(settingsWith(file), home)).find((status) => status.id === "openrouter");
    expect(openRouter?.ready).toBe(false);
    expect(openRouter?.source).toBe(file);
    expect(openRouter?.detail).toBe("Credential not found in this file.");
  });

  test("nothing configured keeps the generic call to action", async () => {
    const openRouter = (await providerStatuses(settingsWith(""), home)).find((status) => status.id === "openrouter");
    expect(openRouter?.ready).toBe(false);
    expect(openRouter?.source).toBe("No credential source found");
    expect(openRouter?.detail).toBe("Choose an env file containing OPENROUTER_API_KEY.");
  });

  test("the canonical file is found without choosing anything", async () => {
    await mkdir(canonicalCredentialDirectory(home), { recursive: true });
    await writeFile(canonicalCredentialFile(home), `OPENROUTER_API_KEY=${FAKE_KEY}\n`);
    const openRouter = (await providerStatuses(settingsWith(""), home)).find((status) => status.id === "openrouter");
    expect(openRouter?.ready).toBe(true);
    expect(openRouter?.source).toBe(canonicalCredentialFile(home));
  });
});

describe("strings and wiring", () => {
  const keys = ["set.credConfigured", "set.credNotConfigured", "set.credChooseEnvFile", "set.credFileNoKey", "prov.orFileNoKeyDetail", "prov.processEnvSource"] as const;

  test("new strings exist in both languages with real Portuguese accents", () => {
    for (const key of keys) {
      expect(en[key]).toBeTruthy();
      expect(ptBR[key]).toBeTruthy();
    }
    expect(ptBR["set.credConfigured"]).toBe("Configurada");
    expect(ptBR["set.credNotConfigured"]).toBe("N\u00e3o configurada");
    expect(ptBR["set.credFileNoKey"]).toBe("Credencial n\u00e3o encontrada neste arquivo");
    expect(ptBR["set.credChooseEnvFile"]).toBe("Escolher arquivo .env");
  });

  test("the main-process detail text matches its translatable key", async () => {
    const file = join(home, "spec.md");
    await writeFile(file, "nothing\n");
    const openRouter = (await providerStatuses(settingsWith(file), home)).find((status) => status.id === "openrouter");
    expect(openRouter?.detail).toBe(en["prov.orFileNoKeyDetail"]);
  });

  test("the picker is wired through the default-path helper and the renderer never sees a key", async () => {
    const ipc = await readFile(join(process.cwd(), "src", "main", "ipc.ts"), "utf8");
    const block = ipc.slice(ipc.indexOf("IPC.credentialChoose,"), ipc.indexOf("IPC.credentialChooseCompatible"));
    expect(block).toContain("openRouterCredentialDialogOptions(");
    expect(block).toContain("showOpenDialog(options)");
    const app = await readFile(join(process.cwd(), "src", "renderer", "src", "App.tsx"), "utf8");
    const row = app.slice(app.indexOf("function OpenRouterCredentialRow"), app.indexOf("function CompatibleSettings"));
    expect(row).not.toMatch(/apiKey|password|OPENROUTER_API_KEY=/i);
    const contracts = await readFile(join(process.cwd(), "src", "shared", "contracts.ts"), "utf8");
    const statusType = contracts.slice(contracts.indexOf("export interface ProviderStatus"), contracts.indexOf("export interface ProviderStatus") + 400);
    expect(statusType).not.toMatch(/apiKey/i);
  });
});
