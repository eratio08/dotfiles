import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keyHint, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { applyPatch, type AppliedFile, parsePatch } from "./patch.ts";

const parameters = Type.Object({
	patchText: Type.String({ description: "OpenCode-style patch text enclosed by *** Begin Patch and *** End Patch" }),
});

interface ApplyPatchDetails {
	files: AppliedFile[];
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "apply_patch",
		label: "apply_patch",
		description: "Apply an OpenCode-style multi-file patch. Supports *** Add File, *** Update File, *** Move to, and *** Delete File sections inside *** Begin Patch / *** End Patch. Paths must be project-relative. Every update hunk must match exactly once. Use apply_patch for coordinated multi-file changes; use edit for precise one-file replacements.",
		promptSnippet: "Apply verified multi-file add, update, move, and delete patches",
		promptGuidelines: [
			"Use apply_patch for coordinated multi-file add, update, move, or delete changes.",
			"Use apply_patch only with an OpenCode-style patch enclosed by *** Begin Patch and *** End Patch.",
			"Use edit instead of apply_patch for precise changes within one existing file.",
		],
		parameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Operation aborted");
			const files = await applyPatch(ctx.cwd, parsePatch(params.patchText), withFileMutationQueue);
			if (signal?.aborted) throw new Error("Operation aborted");
			return {
				content: [{ type: "text", text: summary(files) }],
				details: { files } satisfies ApplyPatchDetails,
			};
		},
		renderCall(_args, theme, context) {
			const text = context.lastComponent as Text | undefined ?? new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold("apply_patch")));
			return text;
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			const text = context.lastComponent as Text | undefined ?? new Text("", 0, 0);
			if (isPartial) {
				text.setText(theme.fg("warning", "Applying patch..."));
				return text;
			}
			const details = result.details as ApplyPatchDetails | undefined;
			if (!details) {
				const content = result.content[0];
				text.setText(theme.fg(context.isError ? "error" : "muted", content?.type === "text" ? content.text : ""));
				return text;
			}
			let output = details.files.map(renderFile).join("\n");
			if (expanded) {
				output += `\n\n${details.files.map((file) => theme.fg("toolOutput", file.diff)).join("\n\n")}`;
			} else {
				output += theme.fg("muted", ` (${keyHint("app.tools.expand", "to expand")})`);
			}
			text.setText(output);
			return text;
		},
	});
}

function summary(files: AppliedFile[]): string {
	return `Applied patch:\n${files.map((file) => `${operationCode(file)} ${displayPath(file)}`).join("\n")}`;
}

function renderFile(file: AppliedFile): string {
	return `${operationCode(file)} ${displayPath(file)} +${file.additions} -${file.deletions}`;
}

function operationCode(file: AppliedFile): string {
	if (file.type === "add") return "A";
	if (file.type === "delete") return "D";
	if (file.type === "move") return "R";
	return "M";
}

function displayPath(file: AppliedFile): string {
	return file.destination ? `${file.path} -> ${file.destination}` : file.path;
}
