import { lstat, readFile, readdir, realpath, rename, rm, mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { Workspace, LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { LibSQLVector } from "@mastra/libsql";
import { fastembed } from "@mastra/fastembed";
import type { RequestContext } from "@mastra/core/request-context";
import { FILE_WORKSPACE_TOOLS } from "./workspace-policy";

export type WorkspaceConfig = {
  readOnly: boolean;
  allowedPaths: string[];
  skillPaths: string[];
  autoIndexPaths: string[];
  searchMode: "bm25" | "vector" | "hybrid";
};
export type WorkspaceTreeEntry = { path: string; name: string; kind: "file" | "directory" | "symlink"; size?: number; modifiedAt?: string; children?: WorkspaceTreeEntry[] };
export type FileView = { path: string; kind: "text" | "image" | "pdf" | "binary"; content?: string; dataUrl?: string; size: number; modifiedAt: string; version: string; lineStart?: number; lineEnd?: number; truncated: boolean };
export type ProcessView = { id: string; command: string; status: "running" | "completed" | "failed" | "killed"; stdout: string; stderr: string; exitCode?: number; startedAt: string };
export type SkillView = { name: string; description: string; path: string; source: string; conflict: boolean; content?: string };

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".css", ".scss", ".html", ".xml", ".yaml", ".yml", ".toml", ".rs", ".go", ".py", ".sh", ".sql"]);
const IMAGE_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const DEFAULT_CONFIG: WorkspaceConfig = { readOnly: false, allowedPaths: [], skillPaths: [".agents/skills", ".claude/skills"], autoIndexPaths: [], searchMode: "bm25" };
const MAX_TEXT_BYTES = 2_000_000;
const MAX_MEDIA_BYTES = 10_000_000;

function safeId(value: string): string { return `workspace_${value.replace(/[^a-zA-Z0-9_]/g, "_").slice(-48)}`; }
function normalizeRelative(value: string): string {
  if (typeof value !== "string" || value.includes("\0") || isAbsolute(value)) throw new Error("Workspace paths must be relative");
  const normalized = normalize(value || ".").replaceAll("\\", "/");
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("Path escapes the workspace");
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}
function versionOf(size: number, modified: number): string { return `${size}:${Math.trunc(modified)}`; }

class WorkspaceHandle {
  readonly filesystem: LocalFilesystem;
  readonly sandbox: LocalSandbox;
  readonly workspace: Workspace;
  readonly processes = new Map<string, ProcessView>();
  initialized = false;
  lastUsedAt = Date.now();

  constructor(readonly root: string, readonly config: WorkspaceConfig, vectorDbPath: string) {
    this.filesystem = new LocalFilesystem({ basePath: root, contained: true, readOnly: config.readOnly, allowedPaths: config.allowedPaths.length ? config.allowedPaths : undefined });
    this.sandbox = new LocalSandbox({ id: safeId(root), workingDirectory: root, isolation: "none", timeout: 30_000 });
    const vectorEnabled = config.searchMode !== "bm25";
    const vectorStore = vectorEnabled ? new LibSQLVector({ id: `${safeId(root)}_vectors`, url: `file:${vectorDbPath}` }) : undefined;
    const embedder = vectorEnabled ? async (text: string): Promise<number[]> => {
      const result = await fastembed.doEmbed({ values: [text] });
      return result.embeddings[0] ?? [];
    } : undefined;
    this.workspace = new Workspace({
      id: safeId(root), name: `Proteus: ${root.split(/[\\/]/).pop() ?? "workspace"}`,
      filesystem: this.filesystem, sandbox: this.sandbox, lsp: true, bm25: true,
      vectorStore, embedder, searchIndexName: safeId(root), skills: config.skillPaths,
      autoIndexPaths: config.autoIndexPaths,
      tools: {
        ...FILE_WORKSPACE_TOOLS,
        [WORKSPACE_TOOLS.SEARCH.SEARCH]: { enabled: true, maxOutputTokens: 12_000 },
        [WORKSPACE_TOOLS.SEARCH.INDEX]: { enabled: true, requireApproval: true },
        [WORKSPACE_TOOLS.LSP.LSP_INSPECT]: { enabled: true, maxOutputTokens: 12_000 },
      },
      instructions: { dynamicSandbox: "resolve" },
    });
  }

  async init() { if (!this.initialized) { await this.workspace.init(); this.initialized = true; } this.lastUsedAt = Date.now(); }
  async destroy() { await this.workspace.destroy(); this.processes.clear(); }
}

/** Owns exactly one initialized Mastra Workspace per canonical root. */
export class WorkspaceRegistry {
  private readonly handles = new Map<string, Promise<WorkspaceHandle>>();
  constructor(private readonly dataRoot: string, private readonly configFor: (root: string) => WorkspaceConfig = () => DEFAULT_CONFIG) {}

  private async canonicalRoot(root: string): Promise<string> {
    if (!isAbsolute(root)) throw new Error("Workspace root is not absolute");
    const canonical = await realpath(root);
    return process.platform === "win32" ? canonical.toLowerCase() : canonical;
  }
  async get(root: string): Promise<WorkspaceHandle> {
    const canonical = await this.canonicalRoot(root);
    let pending = this.handles.get(canonical);
    if (!pending) {
      pending = (async () => {
        await mkdir(join(this.dataRoot, "workspace-indexes"), { recursive: true });
        const handle = new WorkspaceHandle(canonical, this.configFor(canonical), join(this.dataRoot, "workspace-indexes", `${safeId(canonical)}.db`));
        try { await handle.init(); return handle; } catch (error) { await handle.destroy().catch(() => undefined); throw error; }
      })();
      this.handles.set(canonical, pending);
      pending.catch(() => this.handles.delete(canonical));
    }
    return pending;
  }
  async resolve(root: string): Promise<Workspace> { return (await this.get(root)).workspace; }
  async resolveFromContext(requestContext: RequestContext): Promise<Workspace> {
    const root = requestContext.get("proteus-workspace-root");
    if (typeof root !== "string") throw new Error("No trusted workspace is available");
    return this.resolve(root);
  }
  async remove(root: string) { const key = await this.canonicalRoot(root); const pending = this.handles.get(key); this.handles.delete(key); if (pending) await (await pending).destroy(); }
  async destroy() { const all = [...this.handles.values()]; this.handles.clear(); await Promise.allSettled(all.map(async (item) => (await item).destroy())); }
  get size() { return this.handles.size; }

  private async contained(root: string, path: string, allowMissing = false): Promise<{ absolute: string; relative: string }> {
    const canonicalRoot = await this.canonicalRoot(root);
    const rel = normalizeRelative(path);
    const candidate = resolve(canonicalRoot, rel);
    const relation = relative(canonicalRoot, candidate);
    if (relation.startsWith(`..${sep}`) || relation === ".." || isAbsolute(relation)) throw new Error("Path escapes the workspace");
    const parent = await realpath(allowMissing ? dirname(candidate) : candidate).catch(() => null);
    if (parent) { const check = relative(canonicalRoot, parent); if (check.startsWith(`..${sep}`) || check === ".." || isAbsolute(check)) throw new Error("Symlink escapes the workspace"); }
    return { absolute: candidate, relative: rel };
  }

  async tree(root: string, path = "", depth = 3, includeHidden = false): Promise<WorkspaceTreeEntry[]> {
    const base = await this.contained(root, path);
    const walk = async (absolute: string, prefix: string, level: number): Promise<WorkspaceTreeEntry[]> => {
      const entries = await readdir(absolute, { withFileTypes: true });
      const result: WorkspaceTreeEntry[] = [];
      for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
        if ((!includeHidden && entry.name.startsWith(".")) || ["node_modules", "graphify-out", "dist", "build"].includes(entry.name)) continue;
        const rel = [prefix, entry.name].filter(Boolean).join("/"); const absoluteEntry = join(absolute, entry.name); const stat = await lstat(absoluteEntry);
        const kind = stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file";
        result.push({ path: rel, name: entry.name, kind, size: stat.isFile() ? stat.size : undefined, modifiedAt: stat.mtime.toISOString(), children: kind === "directory" && level > 1 ? await walk(absoluteEntry, rel, level - 1) : undefined });
      }
      return result;
    };
    return walk(base.absolute, base.relative, Math.max(1, Math.min(depth, 8)));
  }

  async read(root: string, path: string, lineStart = 1, lineEnd?: number): Promise<FileView> {
    const item = await this.contained(root, path); const stat = await lstat(item.absolute); if (!stat.isFile()) throw new Error("Path is not a file");
    const extension = extname(item.absolute).toLowerCase(); const limit = IMAGE_MIME[extension] || extension === ".pdf" ? MAX_MEDIA_BYTES : MAX_TEXT_BYTES;
    if (stat.size > limit) throw new Error(`File exceeds the ${Math.round(limit / 1_000_000)} MB preview limit`);
    const buffer = await readFile(item.absolute); const base = { path: item.relative, size: stat.size, modifiedAt: stat.mtime.toISOString(), version: versionOf(stat.size, stat.mtimeMs), truncated: false };
    if (IMAGE_MIME[extension]) return { ...base, kind: "image", dataUrl: `data:${IMAGE_MIME[extension]};base64,${buffer.toString("base64")}` };
    if (extension === ".pdf") return { ...base, kind: "pdf", dataUrl: `data:application/pdf;base64,${buffer.toString("base64")}` };
    if (!TEXT_EXTENSIONS.has(extension) && buffer.subarray(0, 8_000).includes(0)) return { ...base, kind: "binary" };
    const lines = buffer.toString("utf8").split(/\r?\n/); const start = Math.max(1, lineStart); const end = Math.min(lines.length, lineEnd ?? start + 499);
    return { ...base, kind: "text", content: lines.slice(start - 1, end).join("\n"), lineStart: start, lineEnd: end, truncated: end < lines.length };
  }

  async write(root: string, path: string, content: string, expectedVersion?: string): Promise<FileView> {
    const handle = await this.get(root); if (handle.config.readOnly) throw new Error("Workspace is read-only");
    const item = await this.contained(root, path, true); const current = await lstat(item.absolute).catch(() => null);
    if (expectedVersion && (!current || versionOf(current.size, current.mtimeMs) !== expectedVersion)) throw new Error("File changed outside Proteus; refresh before saving");
    await mkdir(dirname(item.absolute), { recursive: true }); await writeFile(item.absolute, content, "utf8"); return this.read(root, path);
  }
  async createDirectory(root: string, path: string) { const item = await this.contained(root, path, true); await mkdir(item.absolute, { recursive: true }); }
  async delete(root: string, path: string) { if (!normalizeRelative(path)) throw new Error("Cannot delete workspace root"); const item = await this.contained(root, path); await rm(item.absolute, { recursive: true, force: false }); }
  async move(root: string, from: string, to: string) { const source = await this.contained(root, from); const destination = await this.contained(root, to, true); await mkdir(dirname(destination.absolute), { recursive: true }); await rename(source.absolute, destination.absolute); }
  async copy(root: string, from: string, to: string) { const source = await this.contained(root, from); const destination = await this.contained(root, to, true); await mkdir(dirname(destination.absolute), { recursive: true }); await copyFile(source.absolute, destination.absolute); }
  async search(root: string, query: string, options: { mode?: "bm25" | "vector" | "hybrid"; topK?: number; minScore?: number; vectorWeight?: number } = {}) {
    const handle = await this.get(root); return handle.workspace.search(query, { mode: options.mode ?? handle.config.searchMode, topK: Math.min(50, options.topK ?? 10), minScore: options.minScore, vectorWeight: options.vectorWeight });
  }
  async index(root: string, paths: string[]) { const handle = await this.get(root); let indexed = 0; for (const path of paths) { const file = await this.read(root, path, 1, 20_000); if (file.kind === "text" && file.content) { await handle.workspace.index(file.path, file.content, { metadata: { path: file.path, modifiedAt: file.modifiedAt } }); indexed++; } } return { indexed }; }

  async skills(root: string, load = false): Promise<SkillView[]> {
    const handle = await this.get(root); const found: SkillView[] = [];
    for (const skillRoot of handle.config.skillPaths) {
      const base = await this.contained(root, skillRoot).catch(() => null); if (!base) continue;
      for (const entry of await readdir(base.absolute, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue; const skillPath = `${skillRoot}/${entry.name}/SKILL.md`; const view = await this.read(root, skillPath).catch(() => null); if (!view?.content) continue;
        const description = view.content.match(/^description:\s*["']?([^\n"']+)/m)?.[1]?.trim() ?? "Workspace skill";
        found.push({ name: entry.name, description, path: skillPath, source: skillRoot, conflict: false, content: load ? view.content : undefined });
      }
    }
    const counts = new Map<string, number>(); for (const skill of found) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
    return found.map((skill) => ({ ...skill, conflict: (counts.get(skill.name) ?? 0) > 1 }));
  }
}
