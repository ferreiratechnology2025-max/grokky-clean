import { access } from "node:fs/promises";
import { join } from "node:path";

export type PathExists = (pathname: string) => Promise<boolean>;

const defaultExists: PathExists = (pathname) => access(pathname).then(() => true).catch(() => false);

export function canonicalCredentialDirectory(homeDirectory: string): string {
  return join(homeDirectory, ".config", "grokky");
}

export function canonicalCredentialFile(homeDirectory: string): string {
  return join(canonicalCredentialDirectory(homeDirectory), ".env");
}

/**
 * Where the OpenRouter credential picker should open: the canonical env file when it
 * exists (the dialog then opens in its folder with the file selected), else its folder,
 * else the previously chosen file, else the home directory.
 */
export async function credentialDialogDefaultPath(
  configuredPath: string,
  homeDirectory: string,
  exists: PathExists = defaultExists,
): Promise<string> {
  const candidates = [
    canonicalCredentialFile(homeDirectory),
    canonicalCredentialDirectory(homeDirectory),
    configuredPath,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return homeDirectory;
}

export interface CredentialDialogOptions {
  title: string;
  defaultPath: string;
  properties: Array<"openFile" | "showHiddenFiles">;
}

export async function openRouterCredentialDialogOptions(
  configuredPath: string,
  homeDirectory: string,
  exists?: PathExists,
): Promise<CredentialDialogOptions> {
  return {
    title: "Choose an env file containing OPENROUTER_API_KEY",
    defaultPath: await credentialDialogDefaultPath(configuredPath, homeDirectory, exists),
    properties: ["openFile", "showHiddenFiles"],
  };
}
