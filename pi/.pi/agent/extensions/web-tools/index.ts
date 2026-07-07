import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { assertSafePublicHttpUrl, WEBFETCH_NAME, webFetchTool } from "./webfetch.ts";
import { hasWebSearchCredentials, webSearchTool } from "./websearch.ts";

export default function webToolsExtension(pi: ExtensionAPI) {
	pi.registerTool(webFetchTool);
	if (hasWebSearchCredentials()) {
		pi.registerTool(webSearchTool);
	}

	pi.on("tool_call", async (event) => {
		if (event.toolName !== WEBFETCH_NAME) return;
		const input = event.input as { url?: unknown };
		if (typeof input.url !== "string") {
			return { block: true, reason: "webfetch requires a string url" };
		}
		try {
			assertSafePublicHttpUrl(input.url);
		} catch (error) {
			return {
				block: true,
				reason: error instanceof Error ? error.message : "Blocked URL",
			};
		}
	});
}
