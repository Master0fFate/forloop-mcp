import type { ProviderConfig } from "../models/provider-config.js";

export { appJs } from "./client-script.js";
export { renderIndexHtml } from "./html.js";
export { appCss } from "./styles/index.js";

export function redactedProviderKind(provider: ProviderConfig | undefined): string | undefined {
  return provider?.kind;
}
