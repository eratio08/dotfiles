import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function herdrBlockerExtension(pi: ExtensionAPI) {
	let blockedAfterCompaction = false;
	let compactionPending = false;

	function blockAfterCompaction() {
		if (blockedAfterCompaction) return;
		blockedAfterCompaction = true;
		pi.events.emit("herdr:blocked", {
			active: true,
			label: "Waiting for user after compaction",
		});
	}

	function clearCompactionBlock() {
		compactionPending = false;
		if (!blockedAfterCompaction) return;
		blockedAfterCompaction = false;
		pi.events.emit("herdr:blocked", { active: false });
	}

	pi.on("session_compact", (event) => {
		if (event.reason === "manual" || event.willRetry) return;
		compactionPending = true;
	});

	pi.on("turn_start", () => {
		compactionPending = false;
	});

	pi.on("agent_settled", () => {
		if (!compactionPending) return;
		compactionPending = false;
		blockAfterCompaction();
	});

	pi.on("agent_start", clearCompactionBlock);
	pi.on("session_shutdown", clearCompactionBlock);
}
