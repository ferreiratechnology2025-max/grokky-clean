import type { GrokkyApi } from "../../shared/contracts";
import type { WebPreviewApi } from "../../main/web-preview-contract";

declare global {
  interface Window {
    grokky: GrokkyApi & WebPreviewApi;
  }
}

export {};
