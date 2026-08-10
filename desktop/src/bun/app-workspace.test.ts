import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestContext } from "@mastra/core/request-context";
import { ensureProteusAppWorkspace, proteusAppWorkspaceRoot } from "./app-workspace";
import { WorkspaceRegistry } from "./workspace-registry";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Proteus app workspace bootstrap", () => {
  test("creates the owned root idempotently before registry resolution", async () => {
    const userData = await mkdtemp(join(tmpdir(), "proteus-app-workspace-"));
    roots.push(userData);
    const expected = proteusAppWorkspaceRoot(userData);
    await expect(access(expected)).rejects.toThrow();

    expect(await ensureProteusAppWorkspace(userData)).toBe(expected);
    expect((await stat(expected)).isDirectory()).toBeTrue();
    expect(await ensureProteusAppWorkspace(userData)).toBe(expected);

    const registry = new WorkspaceRegistry(userData);
    const context = new RequestContext();
    context.set("proteus-thread-id", "thread-default");
    context.set("proteus-workspace-root", expected);
    context.set("proteus-workspace-kind", "app");
    expect(await registry.resolveFromContext(context)).toBeDefined();
    expect(registry.size).toBe(1);
    await registry.destroy();
  });

  test("does not let registry resolution create an arbitrary missing project root", async () => {
    const userData = await mkdtemp(join(tmpdir(), "proteus-app-workspace-"));
    roots.push(userData);
    const missingProject = join(userData, "deleted-project");
    const registry = new WorkspaceRegistry(userData);
    const context = new RequestContext();
    context.set("proteus-thread-id", "thread-project");
    context.set("proteus-workspace-root", missingProject);
    context.set("proteus-workspace-kind", "project");

    await expect(registry.resolveFromContext(context)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(missingProject)).rejects.toThrow();
    expect(registry.size).toBe(0);
    await registry.destroy();
  });
});
