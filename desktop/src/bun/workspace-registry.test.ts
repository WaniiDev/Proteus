import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceRegistry } from "./workspace-registry";

const roots: string[] = [];
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "proteus-workspace-")); roots.push(base);
  const project = join(base, "project"); const data = join(base, "data");
  await mkdir(join(project, "src"), { recursive: true });
  await writeFile(join(project, "src", "index.ts"), "export const greeting = 'pastel proteus';\n", "utf8");
  return { base, project, registry: new WorkspaceRegistry(data, () => ({ readOnly: false, allowedPaths: [], skillPaths: [".agents/skills"], autoIndexPaths: [], searchMode: "bm25" as const })) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("WorkspaceRegistry", () => {
  test("lazily reuses one concrete Mastra workspace and destroys it", async () => {
    const { project, registry } = await fixture();
    const [first, second] = await Promise.all([registry.get(project), registry.get(project)]);
    expect(first).toBe(second); expect(registry.size).toBe(1);
    await registry.destroy(); expect(registry.size).toBe(0);
  });

  test("contains paths and rejects traversal and escaping symlinks", async () => {
    const { base, project, registry } = await fixture();
    await expect(registry.read(project, "../secret.txt")).rejects.toThrow("escapes");
    await writeFile(join(base, "secret.txt"), "secret"); await symlink(join(base, "secret.txt"), join(project, "link.txt"));
    await expect(registry.read(project, "link.txt")).rejects.toThrow("Symlink escapes");
    await registry.destroy();
  });

  test("lists and reads real files with bounded line ranges", async () => {
    const { project, registry } = await fixture(); const tree = await registry.tree(project, "", 3);
    expect(tree[0]?.name).toBe("src"); expect(tree[0]?.children?.[0]?.path).toBe("src/index.ts");
    const file = await registry.read(project, "src/index.ts", 1, 1);
    expect(file.kind).toBe("text"); expect(file.content).toContain("pastel proteus"); expect(file.version).toMatch(/^\d+:\d+$/);
    await registry.destroy();
  });

  test("protects writes from stale external modification", async () => {
    const { project, registry } = await fixture(); const before = await registry.read(project, "src/index.ts");
    await new Promise((resolve) => setTimeout(resolve, 5)); await writeFile(join(project, "src", "index.ts"), "external\n");
    await expect(registry.write(project, "src/index.ts", "overwrite", before.version)).rejects.toThrow("changed outside");
    expect(await readFile(join(project, "src", "index.ts"), "utf8")).toBe("external\n"); await registry.destroy();
  });

  test("indexes real content with Mastra BM25 and discovers conflicting skills", async () => {
    const { project, registry } = await fixture();
    await mkdir(join(project, ".agents", "skills", "review"), { recursive: true });
    await writeFile(join(project, ".agents", "skills", "review", "SKILL.md"), "---\ndescription: Review safely\n---\n# Review\n");
    expect((await registry.skills(project, true))[0]).toMatchObject({ name: "review", description: "Review safely", conflict: false });
    expect(await registry.index(project, ["src/index.ts"])).toEqual({ indexed: 1 });
    const results = await registry.search(project, "pastel proteus", { mode: "bm25" });
    expect(results[0]?.id).toBe("src/index.ts"); expect(results[0]?.score).toBeGreaterThan(0);
    await registry.destroy();
  });
});
