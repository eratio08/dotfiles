import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type PatchOperation =
	| { type: "add"; path: string; content: string; diff: string }
	| { type: "update"; path: string; chunks: PatchChunk[]; moveTo?: string; diff: string }
	| { type: "delete"; path: string; diff: string };

export interface PatchChunk {
	lines: string[];
}

export type FileLock = <T>(path: string, action: () => Promise<T>) => Promise<T>;

export interface AppliedFile {
	type: PatchOperation["type"] | "move";
	path: string;
	destination?: string;
	additions: number;
	deletions: number;
	diff: string;
}

interface PreparedOperation {
	type: PatchOperation["type"];
	path: string;
	destination?: string;
	next?: Buffer;
	result: AppliedFile;
}

const begin = "*** Begin Patch";
const end = "*** End Patch";
const addPrefix = "*** Add File: ";
const updatePrefix = "*** Update File: ";
const deletePrefix = "*** Delete File: ";
const movePrefix = "*** Move to: ";

export function parsePatch(patchText: string): PatchOperation[] {
	const lines = patchText.replace(/\r\n?/g, "\n").split("\n");
	if (lines.at(-1) === "") lines.pop();
	if (lines[0] !== begin || lines.at(-1) !== end) throw new Error("apply_patch verification failed: patch must start with *** Begin Patch and end with *** End Patch");

	const operations: PatchOperation[] = [];
	let index = 1;
	while (index < lines.length - 1) {
		const header = lines[index] ?? "";
		if (header.startsWith(addPrefix)) {
			const path = header.slice(addPrefix.length);
			index++;
			const content: string[] = [];
			while (index < lines.length - 1 && !isHeader(lines[index] ?? "")) {
				const line = lines[index] ?? "";
				if (!line.startsWith("+")) throw new Error(`apply_patch verification failed: add content must start with +: ${path}`);
				content.push(line.slice(1));
				index++;
			}
			const text = content.join("\n");
			operations.push({ type: "add", path, content: text ? `${text}\n` : "", diff: addDiff(path, content) });
			continue;
		}
		if (header.startsWith(deletePrefix)) {
			const path = header.slice(deletePrefix.length);
			operations.push({ type: "delete", path, diff: `--- ${path}\n+++ /dev/null` });
			index++;
			continue;
		}
		if (header.startsWith(updatePrefix)) {
			const path = header.slice(updatePrefix.length);
			index++;
			let moveTo: string | undefined;
			if ((lines[index] ?? "").startsWith(movePrefix)) {
				moveTo = (lines[index] ?? "").slice(movePrefix.length);
				index++;
			}
			const chunks: PatchChunk[] = [];
			while (index < lines.length - 1 && !isHeader(lines[index] ?? "")) {
				if (!(lines[index] ?? "").startsWith("@@")) throw new Error(`apply_patch verification failed: expected @@ hunk marker: ${path}`);
				index++;
				const chunk: string[] = [];
				while (index < lines.length - 1 && !isHeader(lines[index] ?? "") && !(lines[index] ?? "").startsWith("@@")) {
					const line = lines[index] ?? "";
					if (!/^[ +\-]/.test(line)) throw new Error(`apply_patch verification failed: invalid hunk line: ${path}`);
					chunk.push(line);
					index++;
				}
				if (chunk.length === 0) throw new Error(`apply_patch verification failed: empty hunk: ${path}`);
				chunks.push({ lines: chunk });
			}
			if (chunks.length === 0) throw new Error(`apply_patch verification failed: no hunks found: ${path}`);
			operations.push({ type: "update", path, chunks, moveTo, diff: updateDiff(path, moveTo, chunks) });
			continue;
		}
		throw new Error(`apply_patch verification failed: unknown patch directive: ${header}`);
	}
	if (operations.length === 0) throw new Error("patch rejected: empty patch");
	return operations;
}

export async function applyPatch(cwd: string, operations: PatchOperation[], lock: FileLock = async (_path, action) => action()): Promise<AppliedFile[]> {
	const root = await realpath(cwd);
	const paths = new Set<string>();
	for (const operation of operations) {
		if (operation.path === "") throw new Error("apply_patch verification failed: empty file path");
		paths.add(operation.path);
		if (operation.type === "update" && operation.moveTo) paths.add(operation.moveTo);
	}
	if (paths.size !== operations.reduce((count, operation) => count + (operation.type === "update" && operation.moveTo ? 2 : 1), 0)) {
		throw new Error("apply_patch verification failed: each path may appear in only one operation");
	}

	const resolvedPaths = await Promise.all(operations.map(async (operation) => {
		const paths = [await resolvePatchPath(root, operation.path)];
		if (operation.type === "update" && operation.moveTo) paths.push(await resolvePatchPath(root, operation.moveTo));
		return paths;
	}));
	const locked = [...new Set(resolvedPaths.flat())].sort();
	return withLockedPaths(locked, lock, async () => {
		const prepared: PreparedOperation[] = [];
		for (const operation of operations) prepared.push(await prepareOperation(root, operation));
		return commit(prepared);
	});
}

async function prepareOperation(root: string, operation: PatchOperation): Promise<PreparedOperation> {
	const path = await resolvePatchPath(root, operation.path);
	if (operation.type === "add") {
		if (await exists(path)) throw new Error(`apply_patch verification failed: file already exists: ${operation.path}`);
		return {
			type: "add",
			path,
			next: Buffer.from(operation.content),
			result: { type: "add", path: operation.path, additions: lineCount(operation.content), deletions: 0, diff: operation.diff },
		};
	}

	const source = await readText(path, operation.path);
	if (operation.type === "delete") {
		return {
			type: "delete",
			path,
			result: { type: "delete", path: operation.path, additions: 0, deletions: lineCount(source.text), diff: operation.diff },
		};
	}

	const destination = operation.moveTo ? await resolvePatchPath(root, operation.moveTo) : undefined;
	if (destination && (await exists(destination))) throw new Error(`apply_patch verification failed: destination already exists: ${operation.moveTo}`);
	const nextText = applyChunks(normalizeLineEndings(source.text), operation.chunks, operation.path);
	const next = Buffer.from(source.bom + restoreLineEndings(nextText, source.ending));
	const additions = operation.chunks.reduce((count, chunk) => count + chunk.lines.filter((line) => line.startsWith("+")).length, 0);
	const deletions = operation.chunks.reduce((count, chunk) => count + chunk.lines.filter((line) => line.startsWith("-")).length, 0);
	return {
		type: "update",
		path,
		destination,
		next,
		result: {
			type: destination ? "move" : "update",
			path: operation.path,
			destination: operation.moveTo,
			additions,
			deletions,
			diff: operation.diff,
		},
	};
}

function applyChunks(content: string, chunks: PatchChunk[], path: string): string {
	let next = content;
	for (const chunk of chunks) {
		const oldText = chunk.lines.filter((line) => !line.startsWith("+")).map((line) => line.slice(1)).join("\n");
		const newText = chunk.lines.filter((line) => !line.startsWith("-")).map((line) => line.slice(1)).join("\n");
		if (!oldText) throw new Error(`apply_patch verification failed: hunk has no original content: ${path}`);
		const first = next.indexOf(oldText);
		if (first < 0) throw new Error(`apply_patch verification failed: hunk does not match file: ${path}`);
		if (next.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`apply_patch verification failed: hunk matches multiple locations: ${path}`);
		next = `${next.slice(0, first)}${newText}${next.slice(first + oldText.length)}`;
	}
	return next;
}

async function commit(operations: PreparedOperation[]): Promise<AppliedFile[]> {
	const originals = new Map<string, Buffer | undefined>();
	const temporary = new Map<string, string>();
	const touched = [...new Set(operations.flatMap((operation) => [operation.path, operation.destination].filter((path): path is string => Boolean(path))))];
	for (const path of touched) originals.set(path, (await exists(path)) ? await readFile(path) : undefined);
	try {
		for (const operation of operations) {
			const target = operation.destination ?? (operation.type === "delete" ? undefined : operation.path);
			if (!target || !operation.next) continue;
			await mkdir(dirname(target), { recursive: true });
			const temp = resolve(dirname(target), `.${basename(target)}.apply-patch-${randomUUID()}`);
			await writeFile(temp, operation.next);
			temporary.set(target, temp);
		}
		for (const [target, temp] of temporary) await rename(temp, target);
		for (const operation of operations) {
			if (operation.type === "delete" || operation.destination) await rm(operation.path, { force: false });
		}
		return operations.map((operation) => operation.result);
	} catch (error) {
		await Promise.allSettled([...originals].map(async ([path, content]) => {
			if (content === undefined) await rm(path, { force: true });
			else {
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, content);
			}
		}));
		throw error;
	} finally {
		await Promise.allSettled([...temporary.values()].map((path) => rm(path, { force: true })));
	}
}

async function withLockedPaths<T>(paths: string[], fileLock: FileLock, action: () => Promise<T>): Promise<T> {
	const lock = async (index: number): Promise<T> => {
		if (index === paths.length) return action();
		return fileLock(paths[index]!, () => lock(index + 1));
	};
	return lock(0);
}

async function resolvePatchPath(root: string, patchPath: string): Promise<string> {
	if (!patchPath || isAbsolute(patchPath)) throw new Error(`apply_patch verification failed: path must be project-relative: ${patchPath}`);
	const target = resolve(root, patchPath);
	if (!inside(root, target)) throw new Error(`apply_patch verification failed: path escapes project: ${patchPath}`);
	const parent = await existingParent(target);
	const actualParent = await realpath(parent);
	if (!inside(root, actualParent)) throw new Error(`apply_patch verification failed: path escapes project through symlink: ${patchPath}`);
	return target;
}

async function readText(path: string, displayPath: string): Promise<{ bom: string; text: string; ending: "\n" | "\r\n" }> {
	let info;
	try {
		info = await lstat(path);
	} catch {
		throw new Error(`apply_patch verification failed: file not found: ${displayPath}`);
	}
	if (!info.isFile() || info.isSymbolicLink()) throw new Error(`apply_patch verification failed: target is not a regular file: ${displayPath}`);
	const bytes = await readFile(path);
	const decoded = bytes.toString("utf8");
	if (!Buffer.from(decoded).equals(bytes)) throw new Error(`apply_patch verification failed: file is not UTF-8 text: ${displayPath}`);
	const bom = decoded.startsWith("\uFEFF") ? "\uFEFF" : "";
	const text = bom ? decoded.slice(1) : decoded;
	return { bom, text, ending: text.includes("\r\n") ? "\r\n" : "\n" };
}

async function existingParent(path: string): Promise<string> {
	let current = dirname(path);
	while (!(await exists(current))) current = dirname(current);
	return current;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function inside(root: string, target: string): boolean {
	const value = relative(root, target);
	return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

function normalizeLineEndings(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function restoreLineEndings(value: string, ending: "\n" | "\r\n"): string {
	return ending === "\n" ? value : value.replace(/\n/g, "\r\n");
}

function lineCount(value: string): number {
	return value === "" ? 0 : value.endsWith("\n") ? value.slice(0, -1).split("\n").length : value.split("\n").length;
}

function isHeader(line: string): boolean {
	return line.startsWith("*** Add File: ") || line.startsWith("*** Update File: ") || line.startsWith("*** Delete File: ") || line === end;
}

function addDiff(path: string, content: string[]): string {
	return [`--- /dev/null`, `+++ ${path}`, ...content.map((line) => `+${line}`)].join("\n");
}

function updateDiff(path: string, moveTo: string | undefined, chunks: PatchChunk[]): string {
	return [`--- ${path}`, `+++ ${moveTo ?? path}`, ...chunks.flatMap((chunk) => ["@@", ...chunk.lines])].join("\n");
}
