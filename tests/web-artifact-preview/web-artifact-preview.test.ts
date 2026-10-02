import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler); }) },
}));

import { PREVIEW_IPC } from "../../src/main/web-preview-contract";
import { activePreview, hasIndexHtml, registerWebPreviewIpc, startPreviewServer, startWebPreview, stopWebPreview } from "../../src/main/web-preview";

const root = resolve(__dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

// The contract: written out here on purpose, independent from the constant in the source.
const EXPECTED_CSP = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';";

let workspace = "";
let outside = "";
const PAGE = "<!doctype html><title>city</title><link rel=\"stylesheet\" href=\"style.css\"><h1>Hello city</h1>";

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "grokky-preview-"));
  workspace = join(base, "workspace");
  outside = join(base, "outside");
  mkdirSync(workspace);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET");
});

afterEach(async () => {
  await stopWebPreview();
  rmSync(resolve(workspace, ".."), { recursive: true, force: true });
});

interface RawResponse {
  status: number;
  body: string;
  type: string;
  headers: Record<string, string | string[] | undefined>;
}

function raw(port: number, path: string, options: { method?: string; host?: string } = {}): Promise<RawResponse> {
  return new Promise((resolveRequest, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: { host: options.host ?? `127.0.0.1:${port}` } }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolveRequest({ status: response.statusCode ?? 0, body, type: String(response.headers["content-type"] ?? ""), headers: response.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function refused(port: number): Promise<boolean> {
  try {
    await raw(port, "/");
    return false;
  } catch {
    return true;
  }
}

describe("P1: detection of index.html in the workspace", () => {
  it("is not available without index.html and is available with it", () => {
    expect(hasIndexHtml(workspace)).toBe(false);
    mkdirSync(join(workspace, "index.html"));
    expect(hasIndexHtml(workspace), "a directory named index.html does not count").toBe(false);
    rmSync(join(workspace, "index.html"), { recursive: true });
    writeFileSync(join(workspace, "index.html"), PAGE);
    expect(hasIndexHtml(workspace)).toBe(true);
  });

  it("refuses to start a preview for a workspace without index.html", async () => {
    await expect(startPreviewServer(workspace)).rejects.toThrow(/no index\.html/);
  });

  it("shows the button only when the preview is available, from a separate toolbar control", () => {
    const app = read("src/renderer/src/App.tsx");
    expect(app).toContain("(previewAvailable || previewUrl) && <button className={`preview-button");
    expect(app).toContain('t("preview.button")');
    const messageList = app.slice(app.indexOf("function MessageList"), app.indexOf("function MessageList") + 6000);
    expect(messageList).not.toContain("preview");
  });

  it("detects without polling: no interval or timer drives the check", () => {
    const app = read("src/renderer/src/App.tsx");
    const block = app.slice(app.indexOf("const previewConversationId"), app.indexOf("async function togglePreview"));
    expect(block).not.toMatch(/setInterval|setTimeout/);
    expect(block).toContain("previewStatus");
  });
});

describe("P2: the local server", () => {
  it("binds to 127.0.0.1 on a free port that is not 5173 and serves the page and its assets", async () => {
    writeFileSync(join(workspace, "index.html"), PAGE);
    writeFileSync(join(workspace, "style.css"), "h1 { color: red }");
    const handle = await startPreviewServer(workspace);
    try {
      expect(handle.host).toBe("127.0.0.1");
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.port).not.toBe(5173);
      expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/`);
      const page = await raw(handle.port, "/");
      expect(page.status).toBe(200);
      expect(page.type).toContain("text/html");
      expect(page.body).toBe(PAGE);
      const css = await raw(handle.port, "/style.css");
      expect(css.status).toBe(200);
      expect(css.type).toContain("text/css");
    } finally {
      await handle.close();
    }
  });

  it("never uses 5173 for artifacts: the port is reserved in the source", () => {
    const source = read("src/main/web-preview.ts");
    expect(source).toContain("RESERVED_PREVIEW_PORTS");
    expect(source).toContain("listen(0, \"127.0.0.1\"");
    expect(source).not.toContain("0.0.0.0");
  });

  it("two previews get different OS-chosen ports", async () => {
    writeFileSync(join(workspace, "index.html"), PAGE);
    const first = await startPreviewServer(workspace);
    const second = await startPreviewServer(workspace);
    try {
      expect(first.port).not.toBe(second.port);
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe("P3: lifecycle without orphan servers", () => {
  it("closing the preview stops the server and the port stops answering", async () => {
    writeFileSync(join(workspace, "index.html"), PAGE);
    const handle = await startWebPreview(workspace);
    expect(activePreview()).toBe(handle);
    expect((await raw(handle.port, "/")).status).toBe(200);
    await stopWebPreview();
    expect(activePreview()).toBeNull();
    expect(await refused(handle.port)).toBe(true);
    await stopWebPreview();
  });

  it("starting another preview (conversation switch) stops the previous server", async () => {
    writeFileSync(join(workspace, "index.html"), PAGE);
    const first = await startWebPreview(workspace);
    const second = await startWebPreview(workspace);
    expect(await refused(first.port)).toBe(true);
    expect((await raw(second.port, "/")).status).toBe(200);
    await stopWebPreview();
    expect(await refused(second.port)).toBe(true);
  });

  it("is wired to panel close, conversation switch, window close and app quit", () => {
    const app = read("src/renderer/src/App.tsx");
    expect(app).toMatch(/setPreviewUrl\(null\);\s*void window\.grokky\.previewStop\(\)/);
    expect(app).toContain("[previewConversationId]");
    expect(app).toMatch(/if \(previewUrl\) \{\s*setPreviewUrl\(null\);\s*await window\.grokky\.previewStop\(\)/);
    const main = read("src/main/index.ts");
    expect(main).toContain('mainWindow.on("closed", () => void stopWebPreview())');
    expect(main).toContain('app.on("before-quit", () => void stopWebPreview())');
  });

  it("IPC: resolves the workspace from the conversation id, never from a renderer path", async () => {
    writeFileSync(join(workspace, "index.html"), PAGE);
    registerWebPreviewIpc((conversationId) => (conversationId === "c1" ? workspace : undefined));
    const status = handlers.get(PREVIEW_IPC.status)!;
    const start = handlers.get(PREVIEW_IPC.start)!;
    const stop = handlers.get(PREVIEW_IPC.stop)!;
    expect(await status({}, "c1")).toEqual({ available: true });
    expect(() => status({}, "unknown")).toThrow(/Conversation not found/);
    expect(() => status({}, workspace + "\\..")).toThrow(/Conversation not found/);
    expect(() => status({}, "")).toThrow(/Invalid conversation ID/);
    expect(() => status({}, 42)).toThrow(/Invalid conversation ID/);
    expect(() => status({}, "x".repeat(201))).toThrow(/Invalid conversation ID/);
    const started = (await start({}, "c1")) as { url: string };
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const port = Number(new URL(started.url).port);
    expect((await raw(port, "/")).status).toBe(200);
    await stop({});
    expect(await refused(port)).toBe(true);
  });

  it("the contract reaches the preload, the IPC registry and the renderer types", () => {
    expect(read("src/preload/index.ts")).toContain("previewStart: (conversationId) => invoke(PREVIEW_IPC.start, conversationId)");
    expect(read("src/main/ipc.ts")).toContain("registerWebPreviewIpc(");
    expect(read("src/renderer/src/global.d.ts")).toContain("GrokkyApi & WebPreviewApi");
  });
});

describe("P4: isolation", () => {
  it("serves nothing outside the workspace", async () => {
    writeFileSync(join(workspace, "index.html"), PAGE);
    const handle = await startPreviewServer(workspace);
    try {
      for (const path of ["/../outside/secret.txt", "/..%2foutside%2fsecret.txt", "/%2e%2e/outside/secret.txt", "/..\\outside\\secret.txt", "/nope.txt"]) {
        const result = await raw(handle.port, path);
        expect(result.status, path).toBeGreaterThanOrEqual(403);
        expect(result.body, path).not.toContain("TOP SECRET");
      }
    } finally {
      await handle.close();
    }
  });

  it("does not follow a symlink that points outside the workspace", async () => {
    writeFileSync(join(workspace, "index.html"), PAGE);
    try {
      symlinkSync(join(outside, "secret.txt"), join(workspace, "leak.txt"));
    } catch {
      return; // symlinks not permitted on this machine
    }
    const handle = await startPreviewServer(workspace);
    try {
      const result = await raw(handle.port, "/leak.txt");
      expect(result.status).toBe(403);
      expect(result.body).not.toContain("TOP SECRET");
    } finally {
      await handle.close();
    }
  });

  it("hides dotfiles, refuses other methods and foreign Host headers", async () => {
    writeFileSync(join(workspace, "index.html"), PAGE);
    mkdirSync(join(workspace, ".git"));
    writeFileSync(join(workspace, ".git", "config"), "secret-config");
    writeFileSync(join(workspace, ".env"), "KEY=1");
    const handle = await startPreviewServer(workspace);
    try {
      expect((await raw(handle.port, "/.env")).status).toBe(403);
      expect((await raw(handle.port, "/.git/config")).status).toBe(403);
      expect((await raw(handle.port, "/", { method: "POST" })).status).toBe(403);
      expect((await raw(handle.port, "/", { host: "evil.example" })).status).toBe(403);
    } finally {
      await handle.close();
    }
  });

  it("does not intercept links: the Markdown message renderer does not reference the preview", () => {
    const app = read("src/renderer/src/App.tsx");
    const start = app.indexOf("function MarkdownMessage");
    expect(start).toBeGreaterThan(-1);
    const markdown = app.slice(start, start + 700);
    expect(markdown).not.toMatch(/preview/i);
  });
});

describe("P5: sandbox contract (iframe)", () => {
  it("the iframe sandbox is exactly allow-scripts", () => {
    const app = read("src/renderer/src/App.tsx");
    const iframes = app.match(/<iframe[^>]*>/g) ?? [];
    expect(iframes).toHaveLength(1);
    expect(iframes[0] ?? "").toContain('sandbox="allow-scripts"');
    const sandbox = /sandbox="([^"]*)"/.exec(iframes[0] ?? "")?.[1] ?? "";
    expect(sandbox).toBe("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-forms");
    for (const forbidden of ["allow-same-origin", "allow-forms", "allow-popups", "allow-top-navigation", "allow-modals", "allow-downloads"]) {
      expect(iframes[0] ?? "", forbidden).not.toContain(forbidden);
    }
  });

  it("the renderer CSP only allows framing the loopback preview server", () => {
    const html = read("src/renderer/index.html");
    expect(html).toContain("frame-src http://127.0.0.1:*");
    expect(html).not.toMatch(/frame-src[^;"]*(\*\s|https:|http:\/\/\*)/);
  });
});

describe("P6: Content-Security-Policy on every served response", () => {
  it("serves the exact CSP header on a file inside the workspace", async () => {
    writeFileSync(join(workspace, "index.html"), PAGE);
    writeFileSync(join(workspace, "style.css"), "h1 { color: red }");
    const handle = await startPreviewServer(workspace);
    try {
      for (const path of ["/", "/index.html", "/style.css"]) {
        const result = await raw(handle.port, path);
        expect(result.status, path).toBe(200);
        expect(result.headers["content-security-policy"], path).toBe(EXPECTED_CSP);
      }
    } finally {
      await handle.close();
    }
  });

  it("also carries the CSP on HEAD and on refusals", async () => {
    writeFileSync(join(workspace, "index.html"), PAGE);
    const handle = await startPreviewServer(workspace);
    try {
      const head = await raw(handle.port, "/", { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers["content-security-policy"]).toBe(EXPECTED_CSP);
      for (const result of [await raw(handle.port, "/nope.txt"), await raw(handle.port, "/.env"), await raw(handle.port, "/", { method: "POST" })]) {
        expect(result.status).toBeGreaterThanOrEqual(403);
        expect(result.headers["content-security-policy"]).toBe(EXPECTED_CSP);
      }
    } finally {
      await handle.close();
    }
  });

  it("the profile is self-contained: no external sources, no frames, objects, base or forms", () => {
    const directives = new Map(EXPECTED_CSP.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values] as const;
    }));
    for (const [name, values] of directives) {
      expect(values.some((value) => /^(https?:|\*|ws)/.test(value)), name).toBe(false);
    }
    expect(directives.get("frame-src")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'none'"]);
    expect(directives.get("form-action")).toEqual(["'none'"]);
    expect(directives.get("connect-src")).toEqual(["'self'"]);
  });
});
