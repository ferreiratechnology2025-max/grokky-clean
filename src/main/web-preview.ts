import { createServer, type Server } from "node:http";
import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { ipcMain } from "electron";
import { PREVIEW_IPC } from "./web-preview-contract";

// Internal preview of a workspace index.html. One server at a time, bound to
// 127.0.0.1 on an OS-chosen port, serving only files inside the workspace root.
//
// The HTML may have been written by a model, so it is treated as untrusted:
// the renderer shows it in an iframe with sandbox="allow-scripts" only (opaque
// origin, no forms, no same-origin access) and every response carries the CSP
// below, which keeps the page self-contained (no external requests, no frames,
// no objects, no forms, no <base>).

export const RESERVED_PREVIEW_PORTS: ReadonlySet<number> = new Set([5173]);
const ENTRY = "index.html";

export const PREVIEW_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ") + ";";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function hasIndexHtml(directory: string): boolean {
  try {
    return statSync(join(directory, ENTRY)).isFile();
  } catch {
    return false;
  }
}

export interface PreviewHandle {
  url: string;
  host: string;
  port: number;
  root: string;
  close(): Promise<void>;
}

function insideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

export async function startPreviewServer(directory: string): Promise<PreviewHandle> {
  const root = realpathSync(resolve(directory));
  if (!hasIndexHtml(root)) throw new Error("This workspace has no index.html to preview");
  let allowedHosts = new Set<string>();

  const server: Server = createServer(async (request, response) => {
    const deny = (status: number) => {
      response.writeHead(status, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": PREVIEW_CSP,
      });
      response.end(status === 404 ? "Not found" : "Forbidden");
    };
    try {
      if (request.method !== "GET" && request.method !== "HEAD") return deny(403);
      if (!allowedHosts.has(String(request.headers.host ?? "").toLowerCase())) return deny(403);
      const url = new URL(request.url ?? "/", "http://preview.local");
      const rawPath = decodeURIComponent(url.pathname);
      if (rawPath.includes("\0")) return deny(403);
      const segments = rawPath.split(/[\\/]+/).filter(Boolean);
      if (segments.some((segment) => segment === ".." || segment.startsWith("."))) return deny(403);
      let target = resolve(root, ...segments);
      if (!insideRoot(root, target)) return deny(403);
      if (!existsSync(target)) return deny(404);
      if (statSync(target).isDirectory()) target = join(target, ENTRY);
      if (!existsSync(target)) return deny(404);
      const real = realpathSync(target);
      if (!insideRoot(root, real) || !statSync(real).isFile()) return deny(403);
      const body = await readFile(real);
      response.writeHead(200, {
        "content-type": MIME[extname(real).toLowerCase()] ?? "application/octet-stream",
        "content-length": body.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": PREVIEW_CSP,
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      deny(404);
    }
  });

  let port = 0;
  let host = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolveListen();
      });
    });
    const address = server.address();
    port = typeof address === "object" && address ? address.port : 0;
    host = typeof address === "object" && address ? address.address : "";
    if (port && !RESERVED_PREVIEW_PORTS.has(port)) break;
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    port = 0;
  }
  if (!port) throw new Error("Could not find a free port for the preview");
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  let closed = false;
  return {
    url: `http://127.0.0.1:${port}/`,
    host,
    port,
    root,
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections?.();
      });
    },
  };
}

// Single active preview for the app.
let current: PreviewHandle | null = null;

export async function stopWebPreview(): Promise<void> {
  const handle = current;
  current = null;
  if (handle) await handle.close();
}

export function activePreview(): PreviewHandle | null {
  return current;
}

export async function startWebPreview(directory: string): Promise<PreviewHandle> {
  await stopWebPreview();
  const handle = await startPreviewServer(directory);
  current = handle;
  return handle;
}

export function registerWebPreviewIpc(workspaceOf: (conversationId: string) => string | undefined): void {
  const directoryFor = (value: unknown): string => {
    if (typeof value !== "string" || !value || value.length > 200) throw new Error("Invalid conversation ID");
    const directory = workspaceOf(value);
    if (!directory) throw new Error("Conversation not found");
    return directory;
  };
  ipcMain.handle(PREVIEW_IPC.status, (_event, conversationId) => ({ available: hasIndexHtml(directoryFor(conversationId)) }));
  ipcMain.handle(PREVIEW_IPC.start, async (_event, conversationId) => {
    const handle = await startWebPreview(directoryFor(conversationId));
    return { url: handle.url };
  });
  ipcMain.handle(PREVIEW_IPC.stop, () => stopWebPreview());
}
