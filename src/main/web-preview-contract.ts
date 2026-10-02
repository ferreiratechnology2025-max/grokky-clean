// Contract shared by main, preload and renderer for the internal HTML preview.
// Pure types and constants: no imports, so the preload can bundle it safely.
export const PREVIEW_IPC = {
  status: "grokky:preview:status",
  start: "grokky:preview:start",
  stop: "grokky:preview:stop",
} as const;

export interface WebPreviewApi {
  previewStatus(conversationId: string): Promise<{ available: boolean }>;
  previewStart(conversationId: string): Promise<{ url: string }>;
  previewStop(): Promise<void>;
}
